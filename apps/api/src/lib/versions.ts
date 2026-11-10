import { structuredPatch } from "diff";
import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import { findPageBySlug } from "./pages";

const MAX_DIFF_LINES = 5000;

const summaryColumns = `version, title, summary, actor,
  ingest_source_id AS "ingestSourceId", created_at AS "createdAt"`;

const detailColumns = `${summaryColumns}, body`;

type DiffOp = "context" | "add" | "remove";

interface DiffLine {
  op: DiffOp;
  text: string;
}

interface VersionRow {
  version: number;
  title: string;
  summary: string;
  body: string;
}

function lineCount(body: string): number {
  return body === "" ? 0 : body.split("\n").length;
}

function mapLines(lines: string[]): DiffLine[] {
  const mapped: DiffLine[] = [];
  for (const line of lines) {
    if (line.startsWith("\\")) continue;
    const prefix = line.charAt(0);
    const text = line.slice(1);
    if (prefix === "+") mapped.push({ op: "add", text });
    else if (prefix === "-") mapped.push({ op: "remove", text });
    else mapped.push({ op: "context", text });
  }
  return mapped;
}

export async function listPageVersions(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
  limit: number,
  offset: number,
) {
  const page = await findPageBySlug(client, tenantId, subjectId, brainId, slug);
  const total = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM page_versions
     WHERE tenant_id = $1 AND page_id = $2`,
    [tenantId, page.id],
  );
  const items = await client.query(
    `SELECT ${summaryColumns} FROM page_versions
     WHERE tenant_id = $1 AND page_id = $2
     ORDER BY version DESC
     LIMIT $3 OFFSET $4`,
    [tenantId, page.id, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

export async function getPageVersion(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
  version: number,
) {
  const page = await findPageBySlug(client, tenantId, subjectId, brainId, slug);
  const result = await client.query(
    `SELECT ${detailColumns} FROM page_versions
     WHERE tenant_id = $1 AND page_id = $2 AND version = $3`,
    [tenantId, page.id, version],
  );
  const found = result.rows[0];
  if (!found) throw new DomainError("NotFoundError", 404, "Not found");
  return found;
}

export async function diffPageVersions(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  slug: string,
  fromVersion: number,
  toVersion?: number,
) {
  const page = await findPageBySlug(client, tenantId, subjectId, brainId, slug);
  const to = toVersion ?? page.version;
  if (fromVersion >= to) {
    throw new DomainError("BadRequestError", 400, "Invalid version range");
  }
  const result = await client.query<VersionRow>(
    `SELECT version, title, summary, body FROM page_versions
     WHERE tenant_id = $1 AND page_id = $2 AND version IN ($3, $4)`,
    [tenantId, page.id, fromVersion, to],
  );
  const from = result.rows.find((row) => row.version === fromVersion);
  const target = result.rows.find((row) => row.version === to);
  if (!from || !target) throw new DomainError("NotFoundError", 404, "Not found");
  if (lineCount(from.body) > MAX_DIFF_LINES || lineCount(target.body) > MAX_DIFF_LINES) {
    throw new DomainError("BadRequestError", 400, "Diff too large");
  }
  const patch = structuredPatch("", "", from.body, target.body, undefined, undefined, {
    context: 3,
  });
  return {
    from: fromVersion,
    to,
    title: { from: from.title, to: target.title },
    summary: { from: from.summary, to: target.summary },
    hunks: patch.hunks.map((hunk) => ({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: mapLines(hunk.lines),
    })),
  };
}
