import { newId } from "@memtavi/shared/ids";
import type { Static } from "elysia";
import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import type { brainCreate, brainUpdate } from "./schemas";

const columns = `id, subject_id AS "subjectId", project_id AS "projectId", name, slug,
  description, brief_settings AS "briefSettings", deletion_state AS "deletionState",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function createBrain(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  body: Static<typeof brainCreate>,
) {
  if (body.projectId) {
    const project = await client.query("SELECT id FROM projects WHERE tenant_id = $1 AND id = $2", [
      tenantId,
      body.projectId,
    ]);
    if (!project.rowCount) throw new DomainError("BadRequestError", 400, "Invalid project id");
  }
  await client.query(
    "INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [tenantId, subjectId],
  );
  const id = newId("brain");
  const slug =
    body.slug ??
    (body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
      id);
  try {
    const result = await client.query(
      `INSERT INTO brains (id, tenant_id, subject_id, name, slug, description, project_id, brief_settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${columns}`,
      [
        id,
        tenantId,
        subjectId,
        body.name,
        slug,
        body.description ?? "",
        body.projectId ?? null,
        body.briefSettings ?? {},
      ],
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      throw new DomainError("ConflictError", 409, "Brain slug already exists");
    }
    throw error;
  }
}

export async function getBrain(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
) {
  const result = await client.query(
    `SELECT ${columns} FROM brains WHERE tenant_id = $1 AND subject_id = $2 AND id = $3`,
    [tenantId, subjectId, brainId],
  );
  if (!result.rows[0]) throw new DomainError("NotFoundError", 404, "Not found");
  return result.rows[0];
}

export async function updateBrain(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  body: Static<typeof brainUpdate>,
) {
  const found = await client.query(
    `SELECT ${columns} FROM brains
     WHERE tenant_id = $1 AND subject_id = $2 AND id = $3
     FOR UPDATE`,
    [tenantId, subjectId, brainId],
  );
  const brain = found.rows[0];
  if (!brain) throw new DomainError("NotFoundError", 404, "Not found");

  if (body.projectId !== undefined && body.projectId !== null) {
    const project = await client.query("SELECT id FROM projects WHERE tenant_id = $1 AND id = $2", [
      tenantId,
      body.projectId,
    ]);
    if (!project.rowCount) throw new DomainError("BadRequestError", 400, "Invalid project id");
  }

  type Assignable = string | null | Record<string, unknown>;
  const values: Assignable[] = [tenantId, subjectId, brainId];
  const assignments: string[] = [];
  function assign(column: string, value: Assignable) {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }
  if (body.name !== undefined) assign("name", body.name);
  if (body.description !== undefined) assign("description", body.description);
  if (body.projectId !== undefined) assign("project_id", body.projectId);
  if (body.briefSettings !== undefined) assign("brief_settings", body.briefSettings);
  if (assignments.length === 0) return brain;
  assignments.push("updated_at = now()");

  const updated = await client.query(
    `UPDATE brains SET ${assignments.join(", ")}
     WHERE tenant_id = $1 AND subject_id = $2 AND id = $3
     RETURNING ${columns}`,
    values,
  );
  return updated.rows[0];
}

export async function listBrains(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  limit: number,
  offset: number,
) {
  const total = await client.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM brains WHERE tenant_id = $1 AND subject_id = $2",
    [tenantId, subjectId],
  );
  const items = await client.query(
    `SELECT ${columns} FROM brains WHERE tenant_id = $1 AND subject_id = $2
     ORDER BY id LIMIT $3 OFFSET $4`,
    [tenantId, subjectId, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}
