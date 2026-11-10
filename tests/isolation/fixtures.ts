import { newId } from "@memtavi/shared/ids";
import type { Pool } from "pg";
import type { Harness } from "../support/harness";

export interface SubjectFixtures {
  tenantId: string;
  subjectId: string;
  brainId: string;
  brainName: string;
  brainSlug: string;
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  secondPageId: string;
  secondPageSlug: string;
  sourceId: string;
  sourceLabel: string;
  sourceContent: string;
  connectionId: string;
  connectionReasoning: string;
  changeId: string;
  changeSummary: string;
  webhookId: string;
  webhookUrl: string;
  profileFocus: string;
}

export interface ForeignTenant {
  id: string;
  name: string;
  slug: string;
}

export interface World {
  own: SubjectFixtures;
  sibling: SubjectFixtures;
  foreign: SubjectFixtures;
  foreignTenant: ForeignTenant;
  keys: {
    own: string;
    nonOwner: string;
    nonOwnerKeyId: string;
    revoked: string;
    unknown: string;
    foreign: string;
    foreignKeyId: string;
    foreignKeyName: string;
  };
  searchToken: string;
  foreignMarkers: string[];
}

export type TargetTable =
  | "brains"
  | "pages"
  | "ingest_sources"
  | "connections"
  | "change_events"
  | "webhooks"
  | "api_keys";

function token(label: string): string {
  return `${label}-${crypto.randomUUID().slice(0, 8)}`;
}

async function brainFor(
  harness: Harness,
  key: string,
  subject: string,
  label: string,
): Promise<{ id: string; name: string; slug: string }> {
  const name = `${label} brain`;
  const slug = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const response = await harness.request("/v1/brains", {
    key,
    subject,
    method: "POST",
    body: { name, slug },
  });
  if (response.status !== 201) {
    throw new Error(`Seeding ${label} brain answered ${response.status}`);
  }
  const body = (await response.json()) as { id: string; name: string; slug: string };
  return { id: body.id, name: body.name, slug: body.slug };
}

async function captureFor(
  harness: Harness,
  key: string,
  subject: string,
  brainId: string,
  label: string,
): Promise<{ id: string; label: string; content: string }> {
  const content = `${label} source content`;
  const sourceLabel = `${label}-source-label`;
  const response = await harness.request(`/v1/brains/${brainId}/captures`, {
    key,
    subject,
    method: "POST",
    body: { kind: "note", content, label: sourceLabel },
  });
  if (response.status !== 201) {
    throw new Error(`Seeding ${label} source answered ${response.status}`);
  }
  const body = (await response.json()) as { id: string };
  return { id: body.id, label: sourceLabel, content };
}

async function webhookFor(
  harness: Harness,
  key: string,
  subject: string,
  label: string,
): Promise<{ id: string; url: string }> {
  const url = `https://${label}.example.invalid/hook`;
  const response = await harness.request("/v1/webhooks", {
    key,
    subject,
    method: "POST",
    body: { url, events: ["created"] },
  });
  if (response.status !== 201) {
    throw new Error(`Seeding ${label} webhook answered ${response.status}`);
  }
  const body = (await response.json()) as { id: string; url: string };
  return { id: body.id, url: body.url };
}

async function keyFor(
  harness: Harness,
  key: string,
  subject: string,
  label: string,
  role: "admin" | "viewer",
): Promise<{ id: string; key: string; name: string }> {
  const name = `${label} key`;
  const response = await harness.request("/v1/api-keys", {
    key,
    subject,
    method: "POST",
    body: { name, role },
  });
  if (response.status !== 201) {
    throw new Error(`Seeding ${label} key answered ${response.status}`);
  }
  const body = (await response.json()) as { id: string; key: string; name: string };
  return { id: body.id, key: body.key, name: body.name };
}

async function seedChildren(
  owner: Pool,
  fixtures: SubjectFixtures,
  firstTitle: string,
  secondTitle: string,
): Promise<void> {
  await owner.query(
    `INSERT INTO pages
       (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, 'first summary', $6, 'topic', $7),
            ($8, $2, $3, $4, $9, $10, 'second summary', $10, 'topic', $11)`,
    [
      fixtures.pageId,
      fixtures.tenantId,
      fixtures.subjectId,
      fixtures.brainId,
      fixtures.pageSlug,
      firstTitle,
      token("hash-first"),
      fixtures.secondPageId,
      fixtures.secondPageSlug,
      secondTitle,
      token("hash-second"),
    ],
  );
  const [pageA, pageB] = [fixtures.pageId, fixtures.secondPageId].sort() as [string, string];
  await owner.query(
    `INSERT INTO connections
       (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source)
     VALUES ($1, $2, $3, $4, $5, 0.87, 'strong', $6, 'auto')`,
    [
      fixtures.connectionId,
      fixtures.tenantId,
      fixtures.brainId,
      pageA,
      pageB,
      fixtures.connectionReasoning,
    ],
  );
  await owner.query(
    `INSERT INTO change_events
       (id, tenant_id, brain_id, page_id, action, change_summary, to_version)
     VALUES ($1, $2, $3, $4, 'created', $5, 1)`,
    [
      fixtures.changeId,
      fixtures.tenantId,
      fixtures.brainId,
      fixtures.pageId,
      fixtures.changeSummary,
    ],
  );
  await owner.query("INSERT INTO profiles (brain_id, tenant_id, focus) VALUES ($1, $2, $3)", [
    fixtures.brainId,
    fixtures.tenantId,
    fixtures.profileFocus,
  ]);
  await owner.query(
    `INSERT INTO score_snapshots (tenant_id, brain_id, freshness, readiness, strain, factors)
     VALUES ($1, $2, 0.5, 0.6, 0.1, '{"seeded": true}')`,
    [fixtures.tenantId, fixtures.brainId],
  );
}

function markersOf(fixtures: SubjectFixtures): string[] {
  return [
    fixtures.brainId,
    fixtures.brainName,
    fixtures.brainSlug,
    fixtures.pageId,
    fixtures.pageSlug,
    fixtures.pageTitle,
    fixtures.secondPageId,
    fixtures.secondPageSlug,
    fixtures.sourceId,
    fixtures.sourceLabel,
    fixtures.sourceContent,
    fixtures.connectionId,
    fixtures.connectionReasoning,
    fixtures.changeId,
    fixtures.changeSummary,
    fixtures.webhookId,
    fixtures.webhookUrl,
    fixtures.profileFocus,
  ];
}

export async function seedWorld(harness: Harness): Promise<World> {
  const owner = harness.owner;
  const siblingSubject = crypto.randomUUID();
  const searchToken = `a1alpha${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

  const ownBrain = await brainFor(harness, harness.keys.a, harness.subjects.a, "Isolation A1");
  const siblingBrain = await brainFor(harness, harness.keys.a, siblingSubject, "Isolation A2");
  const foreignBrain = await brainFor(harness, harness.keys.b, harness.subjects.b, "Isolation B1");
  const ownSource = await captureFor(
    harness,
    harness.keys.a,
    harness.subjects.a,
    ownBrain.id,
    "a1",
  );
  const siblingSource = await captureFor(
    harness,
    harness.keys.a,
    siblingSubject,
    siblingBrain.id,
    "a2",
  );
  const foreignSource = await captureFor(
    harness,
    harness.keys.b,
    harness.subjects.b,
    foreignBrain.id,
    "b1",
  );
  const ownWebhook = await webhookFor(harness, harness.keys.a, harness.subjects.a, "isolation-a1");
  const siblingWebhook = await webhookFor(harness, harness.keys.a, siblingSubject, "isolation-a2");
  const foreignWebhook = await webhookFor(
    harness,
    harness.keys.b,
    harness.subjects.b,
    "isolation-b1",
  );
  const nonOwner = await keyFor(
    harness,
    harness.keys.a,
    harness.subjects.a,
    "Isolation admin",
    "admin",
  );
  const revoked = await keyFor(
    harness,
    harness.keys.a,
    harness.subjects.a,
    "Isolation revoked",
    "viewer",
  );
  const foreignKey = await keyFor(
    harness,
    harness.keys.b,
    harness.subjects.b,
    "Isolation B admin",
    "admin",
  );
  const revokeResponse = await harness.request(`/v1/api-keys/${revoked.id}`, {
    key: harness.keys.a,
    subject: harness.subjects.a,
    method: "DELETE",
  });
  if (revokeResponse.status !== 204) {
    throw new Error(`Revoking the isolation key answered ${revokeResponse.status}`);
  }

  const own: SubjectFixtures = {
    tenantId: harness.tenants.a,
    subjectId: harness.subjects.a,
    brainId: ownBrain.id,
    brainName: ownBrain.name,
    brainSlug: ownBrain.slug,
    pageId: newId("page"),
    pageSlug: "a1-page-one",
    pageTitle: `${searchToken} alpha page`,
    secondPageId: newId("page"),
    secondPageSlug: "a1-page-two",
    sourceId: ownSource.id,
    sourceLabel: ownSource.label,
    sourceContent: ownSource.content,
    connectionId: newId("connection"),
    connectionReasoning: token("a1-connection-reasoning"),
    changeId: newId("change"),
    changeSummary: token("a1-change-summary"),
    webhookId: ownWebhook.id,
    webhookUrl: ownWebhook.url,
    profileFocus: token("a1-profile-focus"),
  };
  const sibling: SubjectFixtures = {
    tenantId: harness.tenants.a,
    subjectId: siblingSubject,
    brainId: siblingBrain.id,
    brainName: siblingBrain.name,
    brainSlug: siblingBrain.slug,
    pageId: newId("page"),
    pageSlug: "a2-page-one",
    pageTitle: token("a2-secret-page"),
    secondPageId: newId("page"),
    secondPageSlug: "a2-page-two",
    sourceId: siblingSource.id,
    sourceLabel: siblingSource.label,
    sourceContent: siblingSource.content,
    connectionId: newId("connection"),
    connectionReasoning: token("a2-connection-reasoning"),
    changeId: newId("change"),
    changeSummary: token("a2-change-summary"),
    webhookId: siblingWebhook.id,
    webhookUrl: siblingWebhook.url,
    profileFocus: token("a2-profile-focus"),
  };
  const foreign: SubjectFixtures = {
    tenantId: harness.tenants.b,
    subjectId: harness.subjects.b,
    brainId: foreignBrain.id,
    brainName: foreignBrain.name,
    brainSlug: foreignBrain.slug,
    pageId: newId("page"),
    pageSlug: "b1-page-one",
    pageTitle: token("b1-secret-page"),
    secondPageId: newId("page"),
    secondPageSlug: "b1-page-two",
    sourceId: foreignSource.id,
    sourceLabel: foreignSource.label,
    sourceContent: foreignSource.content,
    connectionId: newId("connection"),
    connectionReasoning: token("b1-connection-reasoning"),
    changeId: newId("change"),
    changeSummary: token("b1-change-summary"),
    webhookId: foreignWebhook.id,
    webhookUrl: foreignWebhook.url,
    profileFocus: token("b1-profile-focus"),
  };

  await seedChildren(owner, own, `${searchToken} alpha page`, "A1 second page");
  await seedChildren(owner, sibling, sibling.pageTitle, "A2 second page");
  await seedChildren(owner, foreign, foreign.pageTitle, "B1 second page");

  const tenant = await owner.query<{ id: string; name: string; slug: string }>(
    "SELECT id, name, slug FROM tenants WHERE id = $1",
    [harness.tenants.b],
  );
  const foreignTenant = tenant.rows[0];
  if (!foreignTenant) throw new Error("The second isolation tenant is missing");

  return {
    own,
    sibling,
    foreign,
    foreignTenant,
    keys: {
      own: harness.keys.a,
      nonOwner: nonOwner.key,
      nonOwnerKeyId: nonOwner.id,
      revoked: revoked.key,
      unknown: `mtv_live_${crypto.randomUUID()}`,
      foreign: harness.keys.b,
      foreignKeyId: foreignKey.id,
      foreignKeyName: foreignKey.name,
    },
    searchToken,
    foreignMarkers: [
      ...markersOf(sibling),
      ...markersOf(foreign),
      foreignKey.id,
      foreignKey.name,
      foreignTenant.id,
      foreignTenant.name,
      foreignTenant.slug,
    ],
  };
}

export const EXPECTED_TENANT_SCOPED_TABLES = [
  "api_keys",
  "audit_events",
  "brains",
  "briefs",
  "budget_caps",
  "change_events",
  "connections",
  "deletion_ops",
  "idempotency_keys",
  "ingest_sources",
  "jobs",
  "memberships",
  "memory_settings",
  "page_embeddings",
  "page_sources",
  "page_versions",
  "pages",
  "profiles",
  "projects",
  "routing_reviews",
  "score_snapshots",
  "sessions",
  "source_chunks",
  "subject_links",
  "usage_ledger",
  "webhook_deliveries",
  "webhooks",
] as const;

const COLUMN_EXCLUSIONS: Record<string, readonly string[]> = {
  api_keys: ["last_used_at"],
};

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export type SnapshotFilter = "tenant" | "subject" | "brain" | "page";

export interface SnapshotTable {
  table: string;
  filter: SnapshotFilter;
  excludedColumns: string[];
}

export interface SnapshotPlan {
  tables: SnapshotTable[];
  sql: string;
}

function quoteIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error(`Unsafe catalog identifier: ${name}`);
  return `"${name}"`;
}

async function catalogTables(owner: Pool): Promise<{ table: string; columns: Set<string> }[]> {
  const result = await owner.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  return [...columnsByTable.entries()]
    .filter(([, columns]) => columns.has("tenant_id"))
    .map(([table, columns]) => ({ table, columns }))
    .sort((left, right) => (left.table < right.table ? -1 : left.table > right.table ? 1 : 0));
}

function filterFor(columns: Set<string>): SnapshotFilter {
  if (columns.has("subject_id")) return "subject";
  if (columns.has("brain_id")) return "brain";
  if (columns.has("page_id")) return "page";
  return "tenant";
}

function rowExpression(alias: string, excludedColumns: readonly string[]): string {
  return excludedColumns.reduce(
    (expression, column) => `${expression} - '${column}'`,
    `to_jsonb(${alias})`,
  );
}

function subjectClause(filter: SnapshotFilter): string {
  switch (filter) {
    case "subject":
      return " AND t.subject_id = $2";
    case "brain":
      return " AND t.brain_id IN (SELECT id FROM brains WHERE tenant_id = $1 AND subject_id = $2)";
    case "page":
      return " AND t.page_id IN (SELECT id FROM pages WHERE tenant_id = $1 AND subject_id = $2)";
    default:
      return "";
  }
}

export async function discoverSnapshotPlan(owner: Pool): Promise<SnapshotPlan> {
  const tables: SnapshotTable[] = (await catalogTables(owner)).map((entry) => {
    const excludedColumns = (COLUMN_EXCLUSIONS[entry.table] ?? []).filter((column) =>
      entry.columns.has(column),
    );
    for (const column of excludedColumns) {
      if (!SAFE_IDENTIFIER.test(column)) throw new Error(`Unsafe catalog identifier: ${column}`);
    }
    return {
      table: entry.table,
      filter: filterFor(entry.columns),
      excludedColumns: [...excludedColumns],
    };
  });
  const parts = tables.map((entry) => {
    const row = rowExpression("t", entry.excludedColumns);
    return `'${entry.table}', (SELECT coalesce(jsonb_agg(${row} ORDER BY ${row}), '[]'::jsonb)
      FROM ${quoteIdentifier(entry.table)} t WHERE t.tenant_id = $1${subjectClause(entry.filter)})`;
  });
  return { tables, sql: `SELECT jsonb_build_object(\n${parts.join(",\n")}\n) AS snapshot` };
}

export async function snapshotScope(
  owner: Pool,
  plan: SnapshotPlan,
  tenantId: string,
  subjectId: string,
): Promise<unknown> {
  const result = await owner.query<{ snapshot: unknown }>(plan.sql, [tenantId, subjectId]);
  return result.rows[0]?.snapshot;
}

export async function targetRow(owner: Pool, table: TargetTable, id: string): Promise<unknown> {
  const result = await owner.query<{ row: unknown }>(
    `SELECT to_jsonb(t) AS row FROM ${table} t WHERE t.id = $1`,
    [id],
  );
  return result.rows[0]?.row ?? null;
}
