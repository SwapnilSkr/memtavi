import type { Static } from "elysia";
import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import { requireBrain } from "./pages";
import type { profileUpdate } from "./schemas";

const profileColumns = `brain_id AS "brainId", who_they_are AS "whoTheyAre",
  what_they_do AS "whatTheyDo", focus, goals, current_projects AS "currentProjects",
  stuck_on AS "stuckOn", vault_organization AS "vaultOrganization", directives`;

function emptyProfile(brainId: string) {
  return {
    brainId,
    whoTheyAre: "",
    whatTheyDo: "",
    focus: "",
    goals: "",
    currentProjects: "",
    stuckOn: "",
    vaultOrganization: "",
    directives: {},
  };
}

export async function getProfile(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `SELECT ${profileColumns} FROM profiles WHERE tenant_id = $1 AND brain_id = $2`,
    [tenantId, brainId],
  );
  return result.rows[0] ?? emptyProfile(brainId);
}

export async function updateProfile(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  update: Static<typeof profileUpdate>,
) {
  await requireBrain(client, tenantId, subjectId, brainId);
  const result = await client.query(
    `INSERT INTO profiles
       (brain_id, tenant_id, who_they_are, what_they_do, focus, goals, current_projects,
        stuck_on, vault_organization, directives)
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, ''), COALESCE($6, ''),
       COALESCE($7, ''), COALESCE($8, ''), COALESCE($9, ''), COALESCE($10, '{}'::jsonb))
     ON CONFLICT (brain_id) DO UPDATE SET
       who_they_are = COALESCE($3, profiles.who_they_are),
       what_they_do = COALESCE($4, profiles.what_they_do),
       focus = COALESCE($5, profiles.focus),
       goals = COALESCE($6, profiles.goals),
       current_projects = COALESCE($7, profiles.current_projects),
       stuck_on = COALESCE($8, profiles.stuck_on),
       vault_organization = COALESCE($9, profiles.vault_organization),
       directives = COALESCE($10, profiles.directives)
     WHERE profiles.tenant_id = $2
     RETURNING ${profileColumns}`,
    [
      brainId,
      tenantId,
      update.whoTheyAre ?? null,
      update.whatTheyDo ?? null,
      update.focus ?? null,
      update.goals ?? null,
      update.currentProjects ?? null,
      update.stuckOn ?? null,
      update.vaultOrganization ?? null,
      update.directives ?? null,
    ],
  );
  const profile = result.rows[0];
  if (!profile) throw new DomainError("NotFoundError", 404, "Not found");
  return profile;
}
