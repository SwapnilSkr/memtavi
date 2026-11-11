import { FetchError, type FetchedDocument, type FetchFailureCode } from "@memtavi/fetch";
import { decryptWebhookSecret, signWebhookPayload } from "@memtavi/shared/webhooks";
import type { PoolClient } from "pg";
import { type JobContext, JobError } from "./types";

interface WebhookRow {
  id: string;
  subjectId: string;
  url: string;
  events: string[];
  secretEnc: string;
  active: boolean;
}

interface EventRow {
  id: string;
  kind: "change" | "connection" | "import";
  action: string | null;
  payload: Record<string, unknown>;
  subjectId: string;
}

interface DeliveryRow {
  id: string;
  status: string;
  payload: Record<string, unknown>;
}

type OutcomeStatus = "delivered" | "failed" | "dead";

interface Outcome {
  status: OutcomeStatus;
  responseStatus: number | null;
  lastError: string | null;
  retryAfterSeconds: number;
}

type Prepared =
  | { kind: "skip" }
  | { kind: "dead"; message: string }
  | {
      kind: "send";
      deliveryId: string;
      url: string;
      body: string;
      headers: Record<string, string>;
    };

const WEBHOOK_SQL = `
  SELECT id, subject_id AS "subjectId", url, events, secret_enc AS "secretEnc", active
  FROM webhooks WHERE tenant_id = $1 AND id = $2
`;

const EVENT_SQL = `
  SELECT id, kind, action, payload, subject_id AS "subjectId"
  FROM webhook_events WHERE tenant_id = $1 AND id = $2 AND brain_id = $3
`;

const DELIVERY_SQL = `
  SELECT id, status, payload FROM webhook_deliveries
  WHERE tenant_id = $1 AND webhook_id = $2 AND event_id = $3
  ORDER BY id LIMIT 1
`;

const INSERT_DELIVERY_SQL = `
  INSERT INTO webhook_deliveries
  (id, tenant_id, webhook_id, event_id, payload, status, attempts, next_attempt_at)
  VALUES ($1::uuid, $2, $3::uuid, $4, $5::jsonb, 'pending', 0, now())
`;

const OUTCOME_SQL = `
  UPDATE webhook_deliveries
  SET status = $3::delivery_status,
      attempts = attempts + 1,
      response_status = $4,
      last_error = $5,
      next_attempt_at = now() + make_interval(secs => $6)
  WHERE tenant_id = $1 AND id = $2
`;

const MISSING_KEY_MESSAGE = "Webhook signing is not configured on this server";
const DECRYPT_FAILURE_MESSAGE = "Webhook secret could not be decrypted";
const TRANSIENT_FETCH_CODES = new Set<FetchFailureCode>(["timeout", "network"]);

function retrySeconds(attempts: number): number {
  return Math.min(300, 2 ** attempts);
}

async function recordOutcome(
  client: PoolClient,
  tenantId: string,
  deliveryId: string,
  outcome: Outcome,
): Promise<void> {
  await client.query(OUTCOME_SQL, [
    tenantId,
    deliveryId,
    outcome.status,
    outcome.responseStatus,
    outcome.lastError,
    outcome.retryAfterSeconds,
  ]);
}

async function prepare(
  client: PoolClient,
  tenantId: string,
  webhookId: string,
  eventId: string,
  brainId: string,
  key: string | undefined,
): Promise<Prepared> {
  const hooks = await client.query<WebhookRow>(WEBHOOK_SQL, [tenantId, webhookId]);
  const webhook = hooks.rows[0];
  if (!webhook?.active) return { kind: "skip" };

  const events = await client.query<EventRow>(EVENT_SQL, [tenantId, eventId, brainId]);
  const event = events.rows[0];
  if (!event || event.subjectId !== webhook.subjectId) return { kind: "skip" };

  const existing = await client.query<DeliveryRow>(DELIVERY_SQL, [tenantId, webhookId, eventId]);
  const delivery = existing.rows[0];
  if (delivery && (delivery.status === "delivered" || delivery.status === "dead")) {
    return { kind: "skip" };
  }

  const type =
    event.kind === "change"
      ? event.action !== null && webhook.events.includes(event.action)
        ? event.action
        : webhook.events.includes("brain.page.updated")
          ? "brain.page.updated"
          : "brain.change.new"
      : event.kind === "connection"
        ? "brain.connection.new"
        : "brain.import.progress";
  if (!webhook.events.includes(type)) return { kind: "skip" };

  const deliveryId = delivery?.id ?? crypto.randomUUID();
  const payload = delivery?.payload ?? {
    deliveryId,
    eventId: event.id,
    type,
    ...event.payload,
    ...(event.kind === "change" && type !== event.action ? { action: event.action } : {}),
  };
  const body = JSON.stringify(
    event.kind === "change" && payload.type === event.action
      ? {
          deliveryId: payload.deliveryId,
          eventId: payload.eventId,
          type: payload.type,
          brainId: payload.brainId,
          pageId: payload.pageId,
          changeSummary: payload.changeSummary,
          fromVersion: payload.fromVersion,
          toVersion: payload.toVersion,
          createdAt: payload.createdAt,
        }
      : Object.fromEntries(
          Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
  );
  if (!delivery) {
    await client.query(INSERT_DELIVERY_SQL, [deliveryId, tenantId, webhookId, eventId, body]);
  }

  if (key === undefined) {
    await recordOutcome(client, tenantId, deliveryId, {
      status: "dead",
      responseStatus: null,
      lastError: MISSING_KEY_MESSAGE,
      retryAfterSeconds: 0,
    });
    return { kind: "dead", message: MISSING_KEY_MESSAGE };
  }

  let secret: string;
  try {
    secret = decryptWebhookSecret(webhook.secretEnc, key);
  } catch {
    await recordOutcome(client, tenantId, deliveryId, {
      status: "dead",
      responseStatus: null,
      lastError: DECRYPT_FAILURE_MESSAGE,
      retryAfterSeconds: 0,
    });
    return { kind: "dead", message: DECRYPT_FAILURE_MESSAGE };
  }

  return {
    kind: "send",
    deliveryId,
    url: webhook.url,
    body,
    headers: {
      "x-memtavi-event": String(payload.type),
      "x-memtavi-delivery": deliveryId,
      "x-memtavi-signature": `sha256=${signWebhookPayload(secret, body)}`,
    },
  };
}

function classify(
  error: unknown,
  attempts: number,
): { kind: "transient" | "permanent"; message: string; outcome: Outcome } {
  const message = error instanceof FetchError ? error.message : "Webhook delivery failed";
  const transient = error instanceof FetchError && TRANSIENT_FETCH_CODES.has(error.code);
  return {
    kind: transient ? "transient" : "permanent",
    message,
    outcome: {
      status: transient ? "failed" : "dead",
      responseStatus: null,
      lastError: message,
      retryAfterSeconds: transient ? retrySeconds(attempts) : 0,
    },
  };
}

export async function deliverWebhook(context: JobContext): Promise<void> {
  const { job, withTenant } = context;
  if (withTenant === undefined)
    throw new JobError("permanent", "Webhook delivery is not configured");

  const brain = await context.client.query(
    `SELECT id FROM brains WHERE tenant_id = $1 AND id = $2
     AND deletion_state = 'active' FOR SHARE`,
    [job.tenantId, job.brainId],
  );
  if (!brain.rowCount) return;

  const webhookId = job.payload.webhookId;
  const eventId = job.payload.eventId;
  if (
    typeof webhookId !== "string" ||
    webhookId === "" ||
    typeof eventId !== "string" ||
    eventId === ""
  ) {
    throw new JobError("permanent", "Invalid job payload");
  }

  const prepared = await withTenant(job.tenantId, (client) =>
    prepare(client, job.tenantId, webhookId, eventId, job.brainId, context.webhookSecretKey),
  );
  if (prepared.kind === "skip") return;
  if (prepared.kind === "dead") throw new JobError("permanent", prepared.message);

  const postJson = context.postJson;
  if (postJson === undefined) throw new JobError("permanent", "Webhook delivery is not configured");

  const finish = (outcome: Outcome) =>
    withTenant(job.tenantId, (client) =>
      recordOutcome(client, job.tenantId, prepared.deliveryId, outcome),
    );

  let response: FetchedDocument;
  try {
    response = await postJson(prepared.url, prepared.body, prepared.headers);
  } catch (error) {
    const failure = classify(error, job.attempts);
    await finish(failure.outcome);
    throw new JobError(failure.kind, failure.message);
  }

  if (response.status >= 200 && response.status < 300) {
    await finish({
      status: "delivered",
      responseStatus: response.status,
      lastError: null,
      retryAfterSeconds: 0,
    });
    return;
  }

  const message = `Webhook endpoint returned ${response.status}`;
  if (response.status === 429 || response.status >= 500) {
    await finish({
      status: "failed",
      responseStatus: response.status,
      lastError: message,
      retryAfterSeconds: retrySeconds(job.attempts),
    });
    throw new JobError("transient", message);
  }

  await finish({
    status: "dead",
    responseStatus: response.status,
    lastError: message,
    retryAfterSeconds: 0,
  });
  throw new JobError("permanent", message);
}
