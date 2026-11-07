import { SQL } from "bun";
import { compileCapture } from "../../../apps/worker/src/compile";
import type {
  ClaimedJob,
  CompilerConfig,
  CompilerUsage,
  JobContext,
} from "../../../apps/worker/src/types";
import { newId } from "../../../packages/shared/src/ids";
import { contentHash } from "../../../packages/storage/src/keys";
import type { ObjectStore } from "../../../packages/storage/src/types";
import { assertTestDatabase, type Queryable, withTenant } from "./db";
import type { Conversation } from "./types";

export interface PipelineOptions {
  ownerUrl: string;
  appUrl: string;
  store: ObjectStore;
  compiler: CompilerConfig;
  onUsage?: (usage: CompilerUsage) => Promise<void> | void;
}

export interface CompiledConversation {
  conversationId: string;
  brainId: string;
  sourceIds: string[];
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
      const text = session.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
      await this.owner.unsafe(
        `INSERT INTO ingest_sources
         (id, tenant_id, subject_id, brain_id, kind, content, content_hash)
         VALUES ($1, $2::uuid, $3::uuid, $4, 'transcript', $5, $6)`,
        [sourceId, this.tenantId, this.subjectId, brainId, text, contentHash(text)],
      );
      sourceIds.push(sourceId);
    }

    for (const sourceId of sourceIds) {
      await this.compileSource(brainId, sourceId);
    }
    return { conversationId: conversation.id, brainId, sourceIds };
  }

  async withScope<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return withTenant(this.app, this.tenantId, this.subjectId, fn);
  }

  private async compileSource(brainId: string, sourceId: string): Promise<void> {
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
