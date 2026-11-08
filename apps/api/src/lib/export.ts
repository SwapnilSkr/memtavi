import type { PoolClient } from "pg";
import { getBrain } from "./brains";
import { sourceBody, sourceColumns } from "./captures";
import { connectionColumns } from "./graph";
import { pageColumns } from "./pages";

const versionColumns = `v.id, v.page_id AS "pageId", v.version, v.title, v.summary, v.body,
  v.ingest_source_id AS "ingestSourceId", v.actor, v.created_at AS "createdAt"`;

export async function exportBrain(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
) {
  const brain = await getBrain(client, tenantId, subjectId, brainId);
  const pages = await client.query(
    `SELECT ${pageColumns} FROM pages
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deletion_state = 'active'
     ORDER BY slug, id`,
    [tenantId, subjectId, brainId],
  );
  const versions = await client.query(
    `SELECT ${versionColumns}
     FROM page_versions v
     JOIN pages p ON p.tenant_id = v.tenant_id AND p.id = v.page_id
     WHERE p.tenant_id = $1 AND p.subject_id = $2 AND p.brain_id = $3
     AND p.deletion_state = 'active'
     ORDER BY v.page_id, v.version`,
    [tenantId, subjectId, brainId],
  );
  const sources = await client.query(
    `SELECT ${sourceColumns} FROM ingest_sources
     WHERE tenant_id = $1 AND subject_id = $2 AND brain_id = $3 AND deleted_at IS NULL
     ORDER BY id`,
    [tenantId, subjectId, brainId],
  );
  const connections = await client.query(
    `SELECT ${connectionColumns} FROM connections
     WHERE tenant_id = $1 AND brain_id = $2
     ORDER BY page_a_id, page_b_id, id`,
    [tenantId, brainId],
  );
  return {
    brain,
    pages: pages.rows,
    versions: versions.rows,
    sources: sources.rows.map(sourceBody),
    connections: connections.rows,
  };
}
