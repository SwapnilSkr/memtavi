import { promptVersion } from "@memtavi/core/compile/prompts";
import { budgetExceeded } from "@memtavi/core/profile/budget";
import {
  buildProfileMessages,
  PROFILE_SUGGESTIONS_ESTIMATED_OUTPUT_TOKENS,
  PROFILE_SUGGESTIONS_INDEX_LIMIT,
  PROFILE_SUGGESTIONS_MIN_PAGES,
  type ProfilePage,
  suggestProfile,
} from "@memtavi/core/profile/suggestions";
import { chatCostUsd } from "@memtavi/llm/cost";
import { ProviderError } from "@memtavi/llm/provider";
import type { Static } from "elysia";
import type { PoolClient } from "pg";
import { DomainError, ServiceUnavailableError, UpstreamError } from "../middleware/errors";
import type { RouteConfig } from "./config";
import { getIndex, requireBrain } from "./pages";
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

export async function getProfileSuggestions(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  brainId: string,
  config: RouteConfig,
) {
  const current = await getProfile(client, tenantId, subjectId, brainId);
  const index = await getIndex(
    client,
    tenantId,
    subjectId,
    brainId,
    null,
    PROFILE_SUGGESTIONS_INDEX_LIMIT,
    0,
  );
  const pages: ProfilePage[] = index.items.map(({ slug, title, summary }) => ({
    slug,
    title,
    summary,
  }));
  const settings = config.profileSuggestions;
  if (pages.length < PROFILE_SUGGESTIONS_MIN_PAGES) {
    return suggestProfile(pages, current, settings?.model ?? "");
  }
  if (config.budgetEmergencyStop?.() ?? process.env.BUDGET_EMERGENCY_STOP === "true") {
    return new DomainError("BudgetExceededError", 429, "Model work is temporarily stopped");
  }
  if (!settings?.model.trim() || /latest/i.test(settings.model)) {
    return new ServiceUnavailableError("Profile suggestions are not configured");
  }
  const cap = (
    await client.query<{ monthlyUsd: string; hardStop: boolean }>(
      `SELECT monthly_usd AS "monthlyUsd", hard_stop AS "hardStop"
       FROM budget_caps WHERE tenant_id = $1 FOR UPDATE`,
      [tenantId],
    )
  ).rows[0];
  const spend = Number(
    (
      await client.query<{ spend: string }>(
        `SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM usage_ledger
       WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`,
        [tenantId],
      )
    ).rows[0]?.spend ?? 0,
  );
  const inputTokens = buildProfileMessages(pages, current).reduce(
    (sum, message) => sum + Math.ceil(message.content.length / 4),
    0,
  );
  const estimatedUsd = chatCostUsd(
    inputTokens,
    PROFILE_SUGGESTIONS_ESTIMATED_OUTPUT_TOKENS,
    settings.prices,
  );
  if (
    budgetExceeded(
      cap ? { monthlyUsd: Number(cap.monthlyUsd), hardStop: cap.hardStop } : undefined,
      spend,
      estimatedUsd,
    )
  ) {
    return new DomainError("BudgetExceededError", 429, "Monthly budget cap exceeded");
  }
  try {
    const response = await settings.provider.chat({
      model: settings.model,
      temperature: 0,
      responseFormat: "json",
      messages: buildProfileMessages(pages, current),
    });
    await client.query(
      `WITH completed_job AS (
             INSERT INTO jobs
               (tenant_id, brain_id, type, payload, idempotency_key, status, attempts, max_attempts)
             VALUES ($1, $2, 'profile.suggest', jsonb_build_object('model', $3::text, 'promptHash', $4::text),
               $5, 'completed', 1, 1)
             RETURNING id
           )
           INSERT INTO usage_ledger
             (tenant_id, brain_id, job_id, provider, model, kind, input_tokens, output_tokens, cost_usd)
           SELECT $1, $2, id, 'openrouter', $3, 'chat', $6, $7, $8 FROM completed_job`,
      [
        tenantId,
        brainId,
        response.model,
        promptVersion("profileSuggestions"),
        `profile.suggest:${crypto.randomUUID()}`,
        response.usage.inputTokens,
        response.usage.outputTokens,
        chatCostUsd(response.usage.inputTokens, response.usage.outputTokens, settings.prices),
      ],
    );
    return suggestProfile(pages, current, response.model, response.text);
  } catch (error) {
    if (error instanceof ProviderError) {
      return error.transient
        ? new ServiceUnavailableError("Profile suggestions unavailable")
        : new UpstreamError("Profile suggestions unavailable");
    }
    throw error;
  }
}
