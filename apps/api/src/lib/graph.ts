import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import { requireBrain } from "./pages";

export const connectionColumns = `id, brain_id AS "brainId", page_a_id AS "pageAId",
  page_b_id AS "pageBId", similarity, strength, reasoning, source, acked_at AS "ackedAt"`;

const nodeColumns = `id, slug, title, page_type AS "pageType", bucket, status, pinned`;

function liveNode(alias: string): string {
  return `${alias}.deletion_state = 'active' AND ${alias}.archived = false
    AND ${alias}.status IN ('active', 'contested')`;
}

export async function getGraph(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const nodes = await client.query(
    `SELECT ${nodeColumns} FROM pages p
     WHERE p.tenant_id = $1 AND p.brain_id = $2 AND ${liveNode("p")}
     ORDER BY p.slug, p.id`,
    [tenantId, brainId],
  );
  const edges = await client.query(
    `SELECT c.id AS "connectionId", c.page_a_id AS "pageAId", c.page_b_id AS "pageBId",
       c.similarity, c.strength, c.source
     FROM connections c
     JOIN pages a
       ON a.tenant_id = c.tenant_id AND a.brain_id = c.brain_id AND a.id = c.page_a_id
     JOIN pages b
       ON b.tenant_id = c.tenant_id AND b.brain_id = c.brain_id AND b.id = c.page_b_id
     WHERE c.tenant_id = $1 AND c.brain_id = $2
       AND ${liveNode("a")} AND ${liveNode("b")}
     ORDER BY c.page_a_id, c.page_b_id`,
    [tenantId, brainId],
  );
  return { nodes: nodes.rows, edges: edges.rows };
}

export async function listConnections(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  limit: number,
  offset: number,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM connections WHERE tenant_id = $1 AND brain_id = $2`,
    [tenantId, brainId],
  );
  const items = await client.query(
    `SELECT ${connectionColumns} FROM connections
     WHERE tenant_id = $1 AND brain_id = $2
     ORDER BY similarity DESC, page_a_id, page_b_id, id
     LIMIT $3 OFFSET $4`,
    [tenantId, brainId, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function ackConnection(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  connectionId: string,
  acked: boolean,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `UPDATE connections
     SET acked_at = CASE WHEN $4 THEN COALESCE(acked_at, now()) ELSE NULL::timestamptz END
     WHERE tenant_id = $1 AND brain_id = $2 AND id = $3
     RETURNING ${connectionColumns}`,
    [tenantId, brainId, connectionId, acked],
  );
  const connection = result.rows[0];
  if (!connection) throw new DomainError("NotFoundError", 404, "Not found");
  return connection;
}
