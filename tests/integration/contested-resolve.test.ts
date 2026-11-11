import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { createFakeProvider, type FakeEmbeddingCall } from "@memtavi/llm/fake";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { contentHash } from "@memtavi/storage/keys";
import { type Contract, createContract, readSpec } from "../support/contract";
import {
  createHarness,
  FIXED_NOW,
  type Harness,
  hasTestDatabase,
  type RequestOptions,
} from "../support/harness";

interface PageBody {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: string;
  version: number;
  contentHash: string;
  embeddingModel: string | null;
  userEditedAt: string | null;
}

interface ListBody<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface VersionRow {
  version: number;
  title: string;
  summary: string;
  body: string;
  actor: string;
}

interface EventRow {
  id: string;
  action: string;
  changeSummary: string;
  fromVersion: number | null;
  toVersion: number;
  contradictions: unknown[];
}

const PAGES = "/v1/brains/{brainId}/pages";
const RESOLVE = "/v1/brains/{brainId}/pages/{slug}/resolve";
const embeddingModel = "fake-embedding";

describe.skipIf(!hasTestDatabase)("resolving a contested page", () => {
  let harness: Harness;
  let contract: Contract;
  let semanticApp: ReturnType<typeof createApp>;
  const embedder = createFakeProvider({ embeddingModel });
  let brainId = "";
  let viewerKey = "";

  function request(
    path: string,
    options: RequestOptions & { target?: ReturnType<typeof createApp> } = {},
  ) {
    const { target, ...rest } = options;
    if (!target) return harness.request(path, rest);
    const headers = new Headers(rest.headers);
    const key = rest.key === undefined ? harness.keys.a : rest.key;
    if (key !== null) headers.set("x-api-key", key);
    const subject = rest.subject === undefined ? harness.subjects.a : rest.subject;
    if (subject !== null) headers.set("x-subject-id", subject);
    if (rest.body !== undefined) headers.set("content-type", "application/json");
    return target.handle(
      new Request(`http://localhost${path}`, {
        method: rest.method ?? "GET",
        headers,
        ...(rest.body === undefined ? {} : { body: JSON.stringify(rest.body) }),
      }),
    );
  }

  async function expectStatus(
    response: Response,
    status: number,
    template: string,
    method: string,
  ): Promise<unknown> {
    const body = response.status === 204 ? null : await response.json();
    expect({ status: response.status, path: template }).toEqual({ status, path: template });
    contract.expectContract(response, body, { method, path: template });
    return body;
  }

  async function seedPage(options: {
    slug: string;
    status: string;
    title: string;
    body: string;
    versions: number;
  }): Promise<string> {
    const id = newId("page");
    await harness.owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type,
          content_hash, version, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, 'topic', $8, $9, $10)`,
      [
        id,
        harness.tenants.a,
        harness.subjects.a,
        brainId,
        options.slug,
        options.title,
        options.body,
        `hash-${options.slug}`,
        options.versions,
        options.status,
      ],
    );
    for (let version = 1; version <= options.versions; version += 1) {
      const current = version === options.versions;
      await harness.owner.query(
        `INSERT INTO page_versions (tenant_id, page_id, version, title, summary, body, actor)
         VALUES ($1, $2, $3, $4, '', $5, 'compiler')`,
        [
          harness.tenants.a,
          id,
          version,
          current ? options.title : `${options.title} v${version}`,
          current ? options.body : `${options.body} v${version}`,
        ],
      );
    }
    return id;
  }

  async function recordContradiction(
    pageId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<void> {
    await harness.owner.query(
      `INSERT INTO change_events
         (id, tenant_id, brain_id, page_id, action, change_summary, from_version, to_version, contradictions)
       VALUES ($1, $2, $3, $4, 'updated', 'Contradiction detected', $5, $6, $7::jsonb)`,
      [
        newId("change"),
        harness.tenants.a,
        brainId,
        pageId,
        fromVersion,
        toVersion,
        JSON.stringify([{ existingClaim: "old", newClaim: "new" }]),
      ],
    );
  }

  async function pageRow(pageId: string) {
    return (
      await harness.owner.query<{ row: unknown }>(
        "SELECT to_jsonb(t) AS row FROM pages t WHERE id = $1",
        [pageId],
      )
    ).rows[0]?.row as Record<string, unknown> | undefined;
  }

  async function versionRows(pageId: string): Promise<VersionRow[]> {
    return (
      await harness.owner.query<VersionRow>(
        `SELECT version, title, summary, body, actor FROM page_versions
         WHERE tenant_id = $1 AND page_id = $2 ORDER BY version`,
        [harness.tenants.a, pageId],
      )
    ).rows;
  }

  async function eventRows(pageId: string): Promise<EventRow[]> {
    return (
      await harness.owner.query<EventRow>(
        `SELECT id, action, change_summary AS "changeSummary", from_version AS "fromVersion",
           to_version AS "toVersion", contradictions
         FROM change_events WHERE tenant_id = $1 AND page_id = $2 ORDER BY created_at, id`,
        [harness.tenants.a, pageId],
      )
    ).rows;
  }

  async function embeddingRows(pageId: string) {
    return (
      await harness.owner.query<{ model: string; dimensions: number; contentHash: string }>(
        `SELECT model, dimensions, content_hash AS "contentHash" FROM page_embeddings
         WHERE tenant_id = $1 AND page_id = $2`,
        [harness.tenants.a, pageId],
      )
    ).rows;
  }

  function embedTexts(): string[][] {
    return embedder.calls
      .filter((call): call is FakeEmbeddingCall => call.kind === "embed")
      .map((call) => call.texts);
  }

  beforeAll(async () => {
    harness = await createHarness();
    contract = createContract(readSpec());
    const db = await import("@memtavi/db/client");
    semanticApp = createApp({
      ownerPool: harness.owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => FIXED_NOW,
      embeddings: embedder,
    });

    const created = await request("/v1/brains", {
      method: "POST",
      body: { name: "Resolve", slug: `resolve-${crypto.randomUUID()}` },
    });
    expect(created.status).toBe(201);
    brainId = ((await created.json()) as { id: string }).id;

    const viewer = await request("/v1/api-keys", {
      method: "POST",
      body: { name: "Resolve viewer", role: "viewer" },
    });
    expect(viewer.status).toBe(201);
    viewerKey = ((await viewer.json()) as { key: string }).key;
  });

  afterAll(async () => {
    await harness?.close();
  });

  test("a note alone activates the page, keeps the version and records the note", async () => {
    const pageId = await seedPage({
      slug: "note-only",
      status: "contested",
      title: "Note only",
      body: "the original body",
      versions: 2,
    });
    await recordContradiction(pageId, 1, 2);
    const versionsBefore = await versionRows(pageId);
    const eventsBefore = await eventRows(pageId);

    const response = await request(`/v1/brains/${brainId}/pages/note-only/resolve`, {
      method: "POST",
      body: { note: "Keep the original claim" },
    });
    const body = (await expectStatus(response, 200, RESOLVE, "POST")) as PageBody;
    expect(body).toMatchObject({
      id: pageId,
      slug: "note-only",
      status: "active",
      version: 2,
      body: "the original body",
      userEditedAt: null,
    });

    const row = await pageRow(pageId);
    expect(row).toMatchObject({ status: "active", version: 2, user_edited_at: null });
    expect(await versionRows(pageId)).toEqual(versionsBefore);

    const eventsAfter = await eventRows(pageId);
    expect(eventsAfter).toHaveLength(eventsBefore.length + 1);
    expect(eventsAfter.at(-1)).toMatchObject({
      action: "updated",
      changeSummary: "Keep the original claim",
      fromVersion: 2,
      toVersion: 2,
      contradictions: [],
    });
  });

  test("a new body writes version + 1 for the user and leaves older versions untouched", async () => {
    const pageId = await seedPage({
      slug: "new-body",
      status: "contested",
      title: "New body",
      body: "the contested body",
      versions: 2,
    });
    await recordContradiction(pageId, 1, 2);
    const before = await versionRows(pageId);

    const response = await request(`/v1/brains/${brainId}/pages/new-body/resolve`, {
      method: "POST",
      body: { note: "The newer claim stands", body: "the resolved body" },
    });
    const body = (await expectStatus(response, 200, RESOLVE, "POST")) as PageBody;
    expect(body).toMatchObject({
      id: pageId,
      status: "active",
      version: 3,
      body: "the resolved body",
    });
    expect(body.userEditedAt).not.toBeNull();

    const versions = await versionRows(pageId);
    expect(versions.slice(0, 2)).toEqual(before);
    expect(versions.at(-1)).toMatchObject({
      version: 3,
      body: "the resolved body",
      actor: "user",
    });

    const events = await eventRows(pageId);
    expect(events.at(-1)).toMatchObject({
      action: "updated",
      changeSummary: "The newer claim stands",
      fromVersion: 2,
      toVersion: 3,
      contradictions: [],
    });
  });

  test("a new body re-embeds the page under the resolved content hash", async () => {
    const pageId = await seedPage({
      slug: "resolve-embedded",
      status: "contested",
      title: "Embed title",
      body: "the contested body",
      versions: 2,
    });
    await recordContradiction(pageId, 1, 2);
    embedder.reset();

    const response = await request(`/v1/brains/${brainId}/pages/resolve-embedded/resolve`, {
      method: "POST",
      body: { note: "The resolved claim", body: "the resolved body" },
      target: semanticApp,
    });
    const body = (await expectStatus(response, 200, RESOLVE, "POST")) as PageBody;
    const expectedText = "Embed title\n\nthe resolved body";
    const expectedHash = contentHash(expectedText);
    expect(body.contentHash).toBe(expectedHash);
    expect(body.embeddingModel).toBe(embeddingModel);
    expect(await embeddingRows(pageId)).toEqual([
      { model: embeddingModel, dimensions: 1536, contentHash: expectedHash },
    ]);
    expect(embedTexts()).toEqual([[expectedText]]);
  });

  test("a note-only resolve does not call the embedding provider", async () => {
    const pageId = await seedPage({
      slug: "resolve-note-no-embed",
      status: "contested",
      title: "Note only",
      body: "unchanged body",
      versions: 1,
    });
    embedder.reset();

    const response = await request(`/v1/brains/${brainId}/pages/resolve-note-no-embed/resolve`, {
      method: "POST",
      body: { note: "No content change" },
      target: semanticApp,
    });
    await expectStatus(response, 200, RESOLVE, "POST");
    expect(embedTexts()).toEqual([]);
    expect(await embeddingRows(pageId)).toEqual([]);
  });

  test("a page that is not contested answers 409 and nothing is written", async () => {
    const pageId = await seedPage({
      slug: "already-active",
      status: "active",
      title: "Already active",
      body: "settled",
      versions: 1,
    });
    const rowBefore = await pageRow(pageId);
    const versionsBefore = await versionRows(pageId);
    const eventsBefore = await eventRows(pageId);

    const response = await request(`/v1/brains/${brainId}/pages/already-active/resolve`, {
      method: "POST",
      body: { note: "No conflict here" },
    });
    await expectStatus(response, 409, RESOLVE, "POST");

    expect(await pageRow(pageId)).toEqual(rowBefore);
    expect(await versionRows(pageId)).toEqual(versionsBefore);
    expect(await eventRows(pageId)).toEqual(eventsBefore);
  });

  test("the status filter lists only the contested queue", async () => {
    await seedPage({
      slug: "queue-contested",
      status: "contested",
      title: "Queue contested",
      body: "conflict",
      versions: 1,
    });
    await seedPage({
      slug: "queue-active",
      status: "active",
      title: "Queue active",
      body: "settled",
      versions: 1,
    });
    await seedPage({
      slug: "queue-archived",
      status: "archived",
      title: "Queue archived",
      body: "retired",
      versions: 1,
    });

    const contested = await request(`/v1/brains/${brainId}/pages?status=contested&limit=200`);
    const contestedBody = (await expectStatus(contested, 200, PAGES, "GET")) as ListBody<PageBody>;
    expect(contestedBody.items.length).toBe(contestedBody.total);
    expect(contestedBody.items.every((page) => page.status === "contested")).toBe(true);
    expect(contestedBody.items.map((page) => page.slug)).toContain("queue-contested");
    expect(contestedBody.items.map((page) => page.slug)).not.toContain("queue-active");
    expect(contestedBody.items.map((page) => page.slug)).not.toContain("queue-archived");

    const active = await request(`/v1/brains/${brainId}/pages?status=active&limit=200`);
    const activeBody = (await expectStatus(active, 200, PAGES, "GET")) as ListBody<PageBody>;
    expect(activeBody.items.every((page) => page.status === "active")).toBe(true);
    expect(activeBody.items.map((page) => page.slug)).not.toContain("queue-contested");

    const invalid = await request(`/v1/brains/${brainId}/pages?status=exploded`);
    await expectStatus(invalid, 400, PAGES, "GET");
  });

  test("a viewer cannot resolve and the page is unchanged", async () => {
    const pageId = await seedPage({
      slug: "viewer-blocked",
      status: "contested",
      title: "Viewer blocked",
      body: "conflict",
      versions: 1,
    });
    const rowBefore = await pageRow(pageId);
    const eventsBefore = await eventRows(pageId);

    const response = await request(`/v1/brains/${brainId}/pages/viewer-blocked/resolve`, {
      method: "POST",
      key: viewerKey,
      body: { note: "A viewer tries to resolve" },
    });
    await expectStatus(response, 403, RESOLVE, "POST");

    expect(await pageRow(pageId)).toEqual(rowBefore);
    expect(await eventRows(pageId)).toEqual(eventsBefore);
  });

  test("foreign tenants and subjects answer 404 and change nothing", async () => {
    const pageId = await seedPage({
      slug: "foreign-protected",
      status: "contested",
      title: "Foreign protected",
      body: "conflict",
      versions: 1,
    });
    const rowBefore = await pageRow(pageId);
    const eventsBefore = await eventRows(pageId);
    const path = `/v1/brains/${brainId}/pages/foreign-protected/resolve`;

    const foreignTenant = await request(path, {
      method: "POST",
      key: harness.keys.b,
      subject: harness.subjects.b,
      body: { note: "Another tenant" },
    });
    await expectStatus(foreignTenant, 404, RESOLVE, "POST");

    const foreignSubject = await request(path, {
      method: "POST",
      subject: harness.subjects.b,
      body: { note: "Another subject" },
    });
    await expectStatus(foreignSubject, 404, RESOLVE, "POST");

    const unknownSlug = await request(`/v1/brains/${brainId}/pages/missing/resolve`, {
      method: "POST",
      body: { note: "No such page" },
    });
    await expectStatus(unknownSlug, 404, RESOLVE, "POST");

    expect(await pageRow(pageId)).toEqual(rowBefore);
    expect(await eventRows(pageId)).toEqual(eventsBefore);
  });

  test("a registered webhook gets one outbox row for the resolution event", async () => {
    const webhookResponse = await request("/v1/webhooks", {
      method: "POST",
      body: { url: "https://resolve.example.invalid/hook", events: ["updated"] },
    });
    expect(webhookResponse.status).toBe(201);
    const webhook = (await webhookResponse.json()) as { id: string };

    const pageId = await seedPage({
      slug: "webhook-notified",
      status: "contested",
      title: "Webhook notified",
      body: "conflict",
      versions: 1,
    });

    const response = await request(`/v1/brains/${brainId}/pages/webhook-notified/resolve`, {
      method: "POST",
      key: harness.keys.a,
      body: { note: "Resolved for the webhook" },
    });
    await expectStatus(response, 200, RESOLVE, "POST");

    const event = (await eventRows(pageId)).at(-1);
    expect(event).toBeDefined();
    const jobs = await harness.owner.query<{
      type: string;
      payload: { webhookId: string; eventId: string };
      max_attempts: number;
    }>(
      `SELECT type, payload, max_attempts FROM jobs
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [harness.tenants.a, `webhook:${event?.id}:${webhook.id}`],
    );
    expect(jobs.rowCount).toBe(1);
    expect(jobs.rows[0]).toMatchObject({
      type: "webhook.deliver",
      payload: { webhookId: webhook.id, eventId: event?.id },
      max_attempts: 5,
    });
  });
});
