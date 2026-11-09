import {
  encryptWebhookSecret,
  generateWebhookSecret,
  WEBHOOK_EVENTS,
} from "@memtavi/shared/webhooks";
import type { Static } from "elysia";
import type { PoolClient } from "pg";
import { DomainError } from "../middleware/errors";
import { uuidPattern } from "../middleware/scope";
import type { webhookCreate } from "./schemas";

const columns = `id, subject_id AS "subjectId", url, events, active`;

const MAX_URL_LENGTH = 2048;
const MAX_EVENTS = 20;
const events = new Set<string>(WEBHOOK_EVENTS);

export async function listWebhooks(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  limit: number,
  offset: number,
) {
  const total = await client.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM webhooks WHERE tenant_id = $1 AND subject_id = $2",
    [tenantId, subjectId],
  );
  const items = await client.query(
    `SELECT ${columns} FROM webhooks WHERE tenant_id = $1 AND subject_id = $2
     ORDER BY id LIMIT $3 OFFSET $4`,
    [tenantId, subjectId, limit, offset],
  );
  return { items: items.rows, total: total.rows[0]?.total ?? 0, limit, offset };
}

function validateUrl(raw: string): string {
  if (raw.length > MAX_URL_LENGTH) {
    throw new DomainError("BadRequestError", 400, "Invalid webhook URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DomainError("BadRequestError", 400, "Invalid webhook URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainError("BadRequestError", 400, "Invalid webhook URL");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new DomainError("BadRequestError", 400, "Invalid webhook URL");
  }
  return raw;
}

function validateEvents(raw: string[]): string[] {
  if (raw.length < 1 || raw.length > MAX_EVENTS) {
    throw new DomainError("UnprocessableEntityError", 422, "Invalid webhook events");
  }
  if (new Set(raw).size !== raw.length) {
    throw new DomainError("UnprocessableEntityError", 422, "Invalid webhook events");
  }
  for (const event of raw) {
    if (!events.has(event)) {
      throw new DomainError("UnprocessableEntityError", 422, "Invalid webhook events");
    }
  }
  return raw;
}

export async function createWebhook(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  key: string | undefined,
  body: Static<typeof webhookCreate>,
) {
  const url = validateUrl(body.url);
  const selected = validateEvents(body.events);
  if (key === undefined) {
    throw new DomainError(
      "InternalServerError",
      500,
      "Webhook signing is not configured on this server",
    );
  }
  const secret = generateWebhookSecret();
  const encrypted = encryptWebhookSecret(secret, key);
  await client.query(
    "INSERT INTO subject_links (tenant_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [tenantId, subjectId],
  );
  const result = await client.query(
    `INSERT INTO webhooks (tenant_id, subject_id, url, events, secret_enc)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`,
    [tenantId, subjectId, url, selected, encrypted],
  );
  const webhook = result.rows[0];
  if (!webhook) throw new Error("Webhook insert returned no row");
  return { ...webhook, secret };
}

export async function deleteWebhook(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  webhookId: string,
) {
  if (!uuidPattern.test(webhookId)) throw new DomainError("NotFoundError", 404, "Not found");
  const result = await client.query(
    "DELETE FROM webhooks WHERE tenant_id = $1 AND subject_id = $2 AND id = $3 RETURNING id",
    [tenantId, subjectId, webhookId],
  );
  if (!result.rowCount) throw new DomainError("NotFoundError", 404, "Not found");
}
