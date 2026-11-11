import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "@memtavi/api/app";
import { promptVersion } from "@memtavi/core/compile/prompts";
import { createFakeProvider } from "@memtavi/llm/fake";
import { ProviderError } from "@memtavi/llm/provider";
import { newId } from "@memtavi/shared/ids";
import { createFakeStore } from "@memtavi/storage/fake";
import { createContract } from "../support/contract";
import { createHarness, FIXED_NOW, type Harness, hasTestDatabase } from "../support/harness";

const template = "/v1/brains/{brainId}/profile/suggestions";
const provider = createFakeProvider();
const contract = createContract();

describe.skipIf(!hasTestDatabase)("profile suggestions", () => {
  let harness: Harness;
  let app: ReturnType<typeof createApp>;
  let emergencyStop = false;
  let viewerKey = "";
  let developerKey = "";

  async function brain(subject = harness.subjects.a, key = harness.keys.a) {
    const response = await harness.request("/v1/brains", {
      method: "POST",
      key,
      subject,
      body: { name: "Suggestions", slug: `suggestions-${crypto.randomUUID()}` },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  async function seed(brainId: string, count = 3) {
    for (let index = 0; index < count; index += 1) {
      await harness.owner.query(
        `INSERT INTO pages
           (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, content_hash, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PRIVATE_BODY', 'topic', $5, $8)`,
        [
          newId("page"),
          harness.tenants.a,
          harness.subjects.a,
          brainId,
          `page-${String(index).padStart(2, "0")}`,
          `Page ${index}`,
          `Summary ${index}`,
          index === count - 1,
        ],
      );
    }
  }

  async function request(
    brainId: string,
    key = developerKey,
    subject = harness.subjects.a,
    targetApp = app,
  ) {
    const response = await targetApp.handle(
      new Request(`http://localhost/v1/brains/${brainId}/profile/suggestions`, {
        method: "POST",
        headers: { "x-api-key": key, "x-subject-id": subject },
      }),
    );
    const body = (await response.json()) as {
      model?: string;
      promptHash?: string;
      items?: unknown[];
      body?: { error: string };
    };
    contract.expectContract(response, body, { method: "POST", path: template });
    return { response, body };
  }

  async function ledger(brainId: string) {
    return (
      await harness.owner.query(
        `SELECT model, input_tokens, output_tokens, cost_usd FROM usage_ledger
       WHERE tenant_id = $1 AND brain_id = $2`,
        [harness.tenants.a, brainId],
      )
    ).rows;
  }

  beforeAll(async () => {
    harness = await createHarness();
    const db = await import("@memtavi/db/client");
    app = createApp({
      ownerPool: harness.owner,
      withTenant: db.withTenant,
      store: createFakeStore(),
      now: () => FIXED_NOW,
      budgetEmergencyStop: () => emergencyStop,
      profileSuggestions: {
        provider,
        model: "pinned-chat-v1",
        prices: { inputPerMillionUsd: 2, outputPerMillionUsd: 3 },
      },
    });
    for (const role of ["viewer", "developer"]) {
      const response = await harness.request("/v1/api-keys", {
        method: "POST",
        body: { name: `Suggestions ${role}`, role },
      });
      expect(response.status).toBe(201);
      const key = ((await response.json()) as { key: string }).key;
      if (role === "viewer") viewerKey = key;
      else developerKey = key;
    }
  });

  beforeEach(async () => {
    provider.reset();
    emergencyStop = false;
    await harness.owner.query("DELETE FROM usage_ledger WHERE tenant_id = $1", [harness.tenants.a]);
    await harness.owner.query(
      `INSERT INTO budget_caps (tenant_id, monthly_usd, hard_stop) VALUES ($1, 100, true)
       ON CONFLICT (tenant_id) DO UPDATE SET monthly_usd = 100, hard_stop = true`,
      [harness.tenants.a],
    );
  });

  afterAll(async () => {
    await harness?.close();
  });

  test("foreign tenant and subject return 404 before any inference or usage write", async () => {
    const foreign = await brain(harness.subjects.b, harness.keys.b);
    const sibling = await brain(harness.subjects.b);
    for (const id of [foreign, sibling, newId("brain")]) {
      expect((await request(id)).response.status).toBe(404);
      expect(await ledger(id)).toEqual([]);
    }
    expect(provider.calls).toHaveLength(0);
    const own = await brain();
    expect((await request(own)).response.status).toBe(200);
  });

  test("developer receives filtered evidence-backed suggestions, records usage once and never updates the profile", async () => {
    const id = await brain();
    await seed(id);
    expect(
      (
        await harness.request(`/v1/brains/${id}/profile`, {
          method: "PATCH",
          body: { focus: "Shipping", directives: { private: "PRIVATE_DIRECTIVES" } },
        })
      ).status,
    ).toBe(200);
    const before = await (await harness.request(`/v1/brains/${id}/profile`)).json();
    const item = {
      field: "goals",
      value: "Ship the API",
      confidence: 0.8,
      evidence: [{ slug: "page-00", title: "Invented" }],
    };
    provider.queueChat({
      text: JSON.stringify({
        items: [
          item,
          { ...item, field: "unknown" },
          { ...item, field: "focus", value: "Shipping" },
          { ...item, evidence: [{ slug: "hallucinated", title: "Foreign" }] },
        ],
      }),
      model: "reported-chat-v1",
      usage: { inputTokens: 1000, outputTokens: 200 },
    });
    const { response, body } = await request(id);
    expect(response.status).toBe(200);
    expect(body.model).toBe("reported-chat-v1");
    expect(body.promptHash).toBe(promptVersion("profileSuggestions"));
    expect(body.items).toEqual([{ ...item, evidence: [{ slug: "page-00", title: "Page 0" }] }]);
    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0];
    expect(call?.kind).toBe("chat");
    if (call?.kind !== "chat") throw new Error("Expected one chat call");
    expect(call.request.model).toBe("pinned-chat-v1");
    expect(call.request.temperature).toBe(0);
    const input = JSON.parse(call.request.messages[1]?.content ?? "");
    expect(input.untrustedData.profile.focus).toBe("Shipping");
    expect(input.untrustedData.pages.map((page: { slug: string }) => page.slug)).toEqual([
      "page-02",
      "page-00",
      "page-01",
    ]);
    expect(JSON.stringify(input)).not.toContain("PRIVATE_BODY");
    expect(JSON.stringify(input)).not.toContain("PRIVATE_DIRECTIVES");
    const usage = await ledger(id);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      model: "reported-chat-v1",
      input_tokens: 1000,
      output_tokens: 200,
    });
    expect(Number(usage[0]?.cost_usd)).toBeCloseTo(0.0026, 8);
    const jobs = await harness.owner.query(
      `SELECT j.type, j.status, j.payload FROM jobs j JOIN usage_ledger u
         ON u.tenant_id = j.tenant_id AND u.brain_id = j.brain_id AND u.job_id = j.id
       WHERE u.tenant_id = $1 AND u.brain_id = $2`,
      [harness.tenants.a, id],
    );
    expect(jobs.rows).toEqual([
      {
        type: "profile.suggest",
        status: "completed",
        payload: { model: "reported-chat-v1", promptHash: promptVersion("profileSuggestions") },
      },
    ]);
    expect(await (await harness.request(`/v1/brains/${id}/profile`)).json()).toEqual(before);
  });

  test("only the top 40 pages in existing index rank reach the provider", async () => {
    const id = await brain();
    await seed(id, 45);
    provider.queueChat(
      JSON.stringify({
        items: [
          {
            field: "focus",
            value: "Excluded",
            confidence: 0.9,
            evidence: [{ slug: "page-43", title: "Page 43" }],
          },
        ],
      }),
    );
    const { response, body } = await request(id);
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    const call = provider.calls[0];
    if (call?.kind !== "chat") throw new Error("Expected a chat call");
    const pages = JSON.parse(call.request.messages[1]?.content ?? "").untrustedData.pages;
    expect(pages).toHaveLength(40);
    expect(pages[0].slug).toBe("page-44");
    expect(pages.at(-1).slug).toBe("page-38");
  });

  test("thin signal returns an empty set without provider calls or usage even when budget is stopped", async () => {
    const id = await brain();
    await seed(id, 2);
    emergencyStop = true;
    await harness.owner.query("UPDATE budget_caps SET monthly_usd = 0 WHERE tenant_id = $1", [
      harness.tenants.a,
    ]);
    const { response, body } = await request(id);
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(provider.calls).toHaveLength(0);
    expect(await ledger(id)).toEqual([]);
  });

  test.each([0, 0.000001])(
    "budget %s refuses exhausted or unaffordable work with no call",
    async (cap) => {
      const id = await brain();
      await seed(id);
      await harness.owner.query("UPDATE budget_caps SET monthly_usd = $2 WHERE tenant_id = $1", [
        harness.tenants.a,
        cap,
      ]);
      const { response, body } = await request(id);
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(body.body?.error).toBe("BudgetExceededError");
      expect(provider.calls).toHaveLength(0);
      expect(await ledger(id)).toEqual([]);
    },
  );

  test("current-month spend is checked under a cap lock for concurrent requests", async () => {
    const id = await brain();
    await seed(id);
    await harness.owner.query("UPDATE budget_caps SET monthly_usd = 0.02 WHERE tenant_id = $1", [
      harness.tenants.a,
    ]);
    provider.queueChat({
      text: '{"items":[]}',
      model: "pinned-chat-v1",
      usage: { inputTokens: 10000, outputTokens: 0 },
    });
    const results = await Promise.all([request(id), request(id)]);
    expect(results.map(({ response }) => response.status).sort()).toEqual([200, 429]);
    expect(provider.calls).toHaveLength(1);
    expect(await ledger(id)).toHaveLength(1);
  });

  test("emergency stop refuses a populated brain before the call", async () => {
    const id = await brain();
    await seed(id);
    emergencyStop = true;
    const { response, body } = await request(id);
    expect(response.status).toBe(429);
    expect(body.body?.error).toBe("BudgetExceededError");
    expect(provider.calls).toHaveLength(0);
    expect(await ledger(id)).toEqual([]);
  });

  test("viewer is forbidden before inference", async () => {
    const id = await brain();
    await seed(id);
    expect((await request(id, viewerKey)).response.status).toBe(403);
    expect(provider.calls).toHaveLength(0);
    expect(await ledger(id)).toEqual([]);
  });

  test("malformed output is best-effort and its paid usage is committed", async () => {
    const id = await brain();
    await seed(id);
    provider.queueChat("not JSON");
    const { response, body } = await request(id);
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(await ledger(id)).toHaveLength(1);
  });

  test.each([undefined, "", "   ", "provider/latest"])(
    "missing or unpinned configuration %s returns a safe 503 before inference",
    async (model) => {
      const id = await brain();
      await seed(id);
      const db = await import("@memtavi/db/client");
      const unconfigured = createApp({
        ownerPool: harness.owner,
        withTenant: db.withTenant,
        store: createFakeStore(),
        now: () => FIXED_NOW,
        budgetEmergencyStop: () => false,
        ...(model === undefined ? {} : { profileSuggestions: { provider, model } }),
      });
      const { response, body } = await request(id, developerKey, harness.subjects.a, unconfigured);
      expect(response.status).toBe(503);
      expect(body.body?.error).toBe("ServiceUnavailableError");
      expect(body).toMatchObject({ message: "Profile suggestions are not configured" });
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(provider.calls).toHaveLength(0);
      expect(await ledger(id)).toEqual([]);
    },
  );

  test.each([
    [
      new ProviderError("rate_limited", true, "PRIVATE_PROVIDER_PAYLOAD", 429),
      503,
      "ServiceUnavailableError",
    ],
    [
      new ProviderError("timeout", true, "PRIVATE_PROVIDER_PAYLOAD"),
      503,
      "ServiceUnavailableError",
    ],
    [
      new ProviderError("network", true, "PRIVATE_PROVIDER_PAYLOAD"),
      503,
      "ServiceUnavailableError",
    ],
    [
      new ProviderError("server_error", true, "PRIVATE_PROVIDER_PAYLOAD", 503),
      503,
      "ServiceUnavailableError",
    ],
    [
      new ProviderError("bad_request", false, "PRIVATE_PROVIDER_PAYLOAD", 400),
      502,
      "UpstreamError",
    ],
    [
      new ProviderError("malformed_response", false, "PRIVATE_PROVIDER_PAYLOAD"),
      502,
      "UpstreamError",
    ],
  ])(
    "provider failure %s returns %s (%s) without an internal retry",
    async (error, status, code) => {
      const id = await brain();
      await seed(id);
      provider.queueChat(error);
      const { response, body } = await request(id);
      expect(response.status).toBe(status);
      expect(body.body?.error).toBe(code);
      expect(body).toMatchObject({
        statusCode: status,
        timestamp: FIXED_NOW.toISOString(),
        path: `/v1/brains/${id}/profile/suggestions`,
        message: "Profile suggestions unavailable",
        body: { error: code, statusCode: status, message: "Profile suggestions unavailable" },
      });
      expect(response.headers.get("Retry-After")).toBe(status === 503 ? "60" : null);
      expect(JSON.stringify(body)).not.toContain("PRIVATE_PROVIDER_PAYLOAD");
      expect(provider.calls).toHaveLength(1);
      expect(await ledger(id)).toEqual([]);
    },
  );
});
