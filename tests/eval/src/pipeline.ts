import { SQL } from "bun";
import { compileCapture } from "../../../apps/worker/src/compile";
import type {
  ClaimedJob,
  CompilerConfig,
  CompilerUsage,
  JobContext,
  RoutingEvent,
} from "../../../apps/worker/src/types";
import { newId } from "../../../packages/shared/src/ids";
import { contentHash } from "../../../packages/storage/src/keys";
import type { ObjectStore } from "../../../packages/storage/src/types";
import { BudgetExceededError } from "./budget";
import { assertTestDatabase, type Queryable, withTenant } from "./db";
import type { CompileCounts, Conversation, Session } from "./types";

export interface PipelineOptions {
  ownerUrl: string;
  appUrl: string;
  store: ObjectStore;
  compiler: CompilerConfig;
  onUsage?: (usage: CompilerUsage) => Promise<void> | void;
}

interface CountRow {
  sources_completed: number;
  sources_failed: number;
  pages: number;
  page_versions: number;
  routing_reviews: number;
}

export interface CompiledConversation {
  conversationId: string;
  brainId: string;
  sourceIds: string[];
  counts: CompileCounts;
  failures: { sourceId: string; message: string }[];
  routing: RoutingEvent[];
}

export function sessionSourceText(session: Session): string {
  const turns = session.turns.map((turn) => `${turn.speaker}: ${turn.text}`);
  if (session.date === undefined) return turns.join("\n");
  return [`Session date: ${session.date}`, ...turns].join("\n");
}

function slugFor(conversationId: string, ordinal: number): string {
  const base =
    conversationId
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "conversation";
  return `eval-${base}-${ordinal}`;
}

export class EvalPipeline {
  private constructor(
    private readonly owner: SQL,
    private readonly app: SQL,
    readonly tenantId: string,
    readonly subjectId: string,
    private readonly store: ObjectStore,
    private readonly compiler: CompilerConfig,
    private readonly onUsage: (usage: CompilerUsage) => Promise<void> | void,
  ) {}

  static async open(options: PipelineOptions): Promise<EvalPipeline> {
    const owner = new SQL(options.ownerUrl);
    const app = new SQL(options.appUrl);
    const tenantId = crypto.randomUUID();
    try {
      await assertTestDatabase(owner, "TEST_DATABASE_URL");
      await assertTestDatabase(app, "TEST_APP_DATABASE_URL");
      const subjectId = crypto.randomUUID();
      await owner.unsafe("INSERT INTO tenants (id, name, slug) VALUES ($1::uuid, $2, $3)", [
        tenantId,
        "Eval run",
        `eval-${tenantId}`,
      ]);
      await owner.unsafe(
        "INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1::uuid, $2::uuid)",
        [tenantId, subjectId],
      );
      return new EvalPipeline(
        owner,
        app,
        tenantId,
        subjectId,
        options.store,
        options.compiler,
        options.onUsage ?? (() => undefined),
      );
    } catch (error) {
      await owner
        .unsafe("DELETE FROM tenants WHERE id = $1::uuid", [tenantId])
        .catch(() => undefined);
      await Promise.allSettled([owner.close(), app.close()]);
      throw error;
    }
  }

  async compileConversation(
    conversation: Conversation,
    ordinal: number,
  ): Promise<CompiledConversation> {
    const brainId = newId("brain");
    await this.owner.unsafe(
      `INSERT INTO brains (id, tenant_id, subject_id, name, slug)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5)`,
      [
        brainId,
        this.tenantId,
        this.subjectId,
        `Eval ${conversation.id}`,
        slugFor(conversation.id, ordinal),
      ],
    );

    const sourceIds: string[] = [];
    for (const session of conversation.sessions) {
      const sourceId = newId("source");
      const text = sessionSourceText(session);
      await this.owner.unsafe(
        `INSERT INTO ingest_sources
         (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
         VALUES ($1, $2::uuid, $3::uuid, $4, 'transcript', $5, $6)`,
        [sourceId, this.tenantId, this.subjectId, brainId, text, contentHash(text)],
      );
      sourceIds.push(sourceId);
    }

    const failures: { sourceId: string; message: string }[] = [];
    const routing: RoutingEvent[] = [];
    for (const sourceId of sourceIds) {
      try {
        await this.compileSource(brainId, sourceId, (event) => routing.push(event));
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ sourceId, message });
        await this.failSource(brainId, sourceId, message);
      }
    }
    const counts = await this.collectCounts(brainId);
    return { conversationId: conversation.id, brainId, sourceIds, counts, failures, routing };
  }

  private async failSource(brainId: string, sourceId: string, message: string): Promise<void> {
    await this.withScope(async (client) => {
      await client.query(
        `UPDATE ingest_sources SET status = 'failed', last_error = $4
         WHERE tenant_id = $1 AND brain_id = $2 AND id = $3`,
        [this.tenantId, brainId, sourceId, message],
      );
    });
  }

  private async collectCounts(brainId: string): Promise<CompileCounts> {
    return this.withScope(async (client) => {
      const result = await client.query<CountRow>(
        `SELECT
           (SELECT count(*)::int FROM ingest_sources
             WHERE tenant_id = $1 AND brain_id = $2 AND status = 'completed') AS sources_completed,
           (SELECT count(*)::int FROM ingest_sources
             WHERE tenant_id = $1 AND brain_id = $2 AND status = 'failed') AS sources_failed,
           (SELECT count(*)::int FROM pages
             WHERE tenant_id = $1 AND brain_id = $2 AND deletion_state = 'active') AS pages,
           (SELECT count(*)::int FROM page_versions v
             JOIN pages p ON p.tenant_id = v.tenant_id AND p.id = v.page_id
             WHERE v.tenant_id = $1 AND p.brain_id = $2) AS page_versions,
           (SELECT count(*)::int FROM routing_reviews
             WHERE tenant_id = $1 AND brain_id = $2) AS routing_reviews`,
        [this.tenantId, brainId],
      );
      const row = result.rows[0];
      return {
        sourcesCompleted: row?.sources_completed ?? 0,
        sourcesFailed: row?.sources_failed ?? 0,
        pages: row?.pages ?? 0,
        pageVersions: row?.page_versions ?? 0,
        routingReviews: row?.routing_reviews ?? 0,
      };
    });
  }

  async withScope<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return withTenant(this.app, this.tenantId, this.subjectId, fn);
  }

  private async compileSource(
    brainId: string,
    sourceId: string,
    onRouting: (event: RoutingEvent) => void,
  ): Promise<void> {
    const job: ClaimedJob = {
      id: crypto.randomUUID(),
      tenantId: this.tenantId,
      brainId,
      type: "capture.compile",
      payload: { sourceId, brainId },
      attempts: 1,
      maxAttempts: 5,
    };
    await withTenant(this.app, this.tenantId, this.subjectId, async (client) => {
      const context: JobContext = {
        job,
        client: client as unknown as JobContext["client"],
        store: this.store,
        fetchDocument: async () => {
          throw new Error("Network is forbidden during eval");
        },
        compiler: this.compiler,
        recordUsage: async (usage) => {
          await this.onUsage(usage);
        },
        onRouting,
      };
      await compileCapture(context);
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.owner.close(), this.app.close()]);
  }

  async cleanup(): Promise<void> {
    await this.owner.unsafe("DELETE FROM tenants WHERE id = $1::uuid", [this.tenantId]);
  }
}
