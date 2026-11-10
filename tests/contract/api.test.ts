import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@memtavi/shared/ids";
import { type Contract, ContractViolation, createContract } from "@memtavi/test-support/contract";
import {
  createHarness,
  type Harness,
  hasTestDatabase,
  type RequestOptions,
} from "@memtavi/test-support/harness";

interface Probe {
  operationId: string;
  method: string;
  template: string;
  path: string;
  options: RequestOptions;
}

interface Unexercised {
  operationId: string;
  status: number;
  reason: string;
}

interface KnownDrift {
  operationId: string;
  method: string;
  template: string;
  status: number;
  documented: boolean;
  reason: string;
  path(brainId: string): string;
  options: RequestOptions;
}

const OPERATION_NOT_IMPLEMENTED = "Operation not implemented yet.";
const RATE_LIMITED = "Rate limiting is out of scope for this brief.";
const SERVER_ERROR = "A 5xx needs fault injection and is out of scope for this brief.";

const UNIMPLEMENTED = new Set<string>();
const UNKNOWN_BRAIN = `brn_${"0".repeat(32)}`;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const INVALID_KEY = "mtv_invalid_contract_key";

const contract: Contract = createContract();

const UNEXERCISED: readonly Unexercised[] = [
  ...contract
    .documented()
    .filter((pair) => pair.status === 429)
    .map((pair) => ({ ...pair, reason: RATE_LIMITED })),
  ...contract
    .documented()
    .filter((pair) => pair.status === 500)
    .map((pair) => ({ ...pair, reason: SERVER_ERROR })),
  ...contract
    .documented()
    .filter(
      (pair) =>
        UNIMPLEMENTED.has(pair.operationId) &&
        pair.status !== 404 &&
        pair.status !== 429 &&
        pair.status !== 500,
    )
    .map((pair) => ({ ...pair, reason: OPERATION_NOT_IMPLEMENTED })),
];

const KNOWN_DRIFT: readonly KnownDrift[] = [];

describe.skipIf(!hasTestDatabase)("the API contract", () => {
  let harness: Harness;
  let brainId = "";
  let pageSlug = "";
  let deleteSlug = "";
  let connectionId = "";
  let changeId = "";
  let sourceId = "";
  let deletedSourceId = "";
  let throwawayKeyId = "";
  let viewerKey = "";
  const probes = new Map<string, Probe>();

  function pairKey(operationId: string, status: number): string {
    return `${operationId}:${status}`;
  }

  function bodyOf(response: Response): Promise<unknown> {
    return response.status === 204 ? Promise.resolve(null) : response.json();
  }

  async function callSuccess(
    operationId: string,
    template: string,
    method: string,
    path: string,
    options: RequestOptions,
    expected: number,
  ): Promise<unknown> {
    const response = await harness.request(path, options);
    const body = await bodyOf(response);
    expect({ operationId, status: response.status }).toEqual({ operationId, status: expected });
    contract.expectContract(response, body, { method, path: template });
    probes.set(operationId, { operationId, method, template, path, options });
    return body;
  }

  async function callVariant(
    probe: Probe,
    path: string,
    options: RequestOptions,
    expected: number,
  ): Promise<unknown> {
    const response = await harness.request(path, options);
    const body = await bodyOf(response);
    expect({ operationId: probe.operationId, path, status: response.status }).toEqual({
      operationId: probe.operationId,
      path,
      status: expected,
    });
    contract.expectContract(response, body, { method: probe.method, path: probe.template });
    return body;
  }

  function unknownPath(probe: Probe): string | null {
    if (probe.path.startsWith("/v1/brains/")) return probe.path.replace(brainId, UNKNOWN_BRAIN);
    if (probe.path.startsWith("/v1/webhooks/")) return `/v1/webhooks/${UNKNOWN_UUID}`;
    if (probe.path.startsWith("/v1/api-keys/")) return `/v1/api-keys/${UNKNOWN_UUID}`;
    return null;
  }

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    if (!harness) return;
    try {
      const allowed = new Set(UNEXERCISED.map((pair) => pairKey(pair.operationId, pair.status)));
      const gaps = contract.coverage();
      expect(gaps.filter((pair) => !allowed.has(pairKey(pair.operationId, pair.status)))).toEqual(
        [],
      );
      expect(
        [...allowed].filter(
          (key) => !gaps.some((pair) => pairKey(pair.operationId, pair.status) === key),
        ),
      ).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  test("every documented success response validates", async () => {
    const created = (await callSuccess(
      "createBrain",
      "/v1/brains",
      "POST",
      "/v1/brains",
      { method: "POST", body: { name: "Contract", slug: `contract-${crypto.randomUUID()}` } },
      201,
    )) as { id: string };
    brainId = created.id;

    const doomed = await harness.request("/v1/brains", {
      method: "POST",
      body: { name: "Delete contract", slug: `delete-contract-${crypto.randomUUID()}` },
    });
    expect(doomed.status).toBe(201);
    const deletionBrain = (await doomed.json()) as { id: string };
    await callSuccess(
      "deleteBrain",
      "/v1/brains/{brainId}",
      "DELETE",
      `/v1/brains/${deletionBrain.id}`,
      { method: "DELETE" },
      202,
    );

    await callSuccess("listBrains", "/v1/brains", "GET", "/v1/brains", {}, 200);
    await callSuccess("getBrain", "/v1/brains/{brainId}", "GET", `/v1/brains/${brainId}`, {}, 200);
    await callSuccess(
      "updateBrain",
      "/v1/brains/{brainId}",
      "PATCH",
      `/v1/brains/${brainId}`,
      { method: "PATCH", body: { name: "Contract renamed" } },
      200,
    );

    const alphaId = newId("page");
    const betaId = newId("page");
    const deleteId = newId("page");
    const [pageAId, pageBId] = [alphaId, betaId].sort();
    pageSlug = "alpha";
    deleteSlug = "delete-me";
    await harness.owner.query(
      `INSERT INTO pages
         (id, tenant_id, subject_id, brain_id, slug, title, summary, body, page_type, content_hash)
       VALUES ($1, $2, $3, $4, 'alpha', 'Alpha guide', 'The first page', 'alpha body', 'topic', 'hash-alpha'),
              ($5, $2, $3, $4, 'beta', 'Beta note', '', '', 'entity', 'hash-beta'),
              ($6, $2, $3, $4, 'delete-me', 'Delete me', '', '', 'topic', 'hash-delete')`,
      [alphaId, harness.tenants.a, harness.subjects.a, brainId, betaId, deleteId],
    );
    connectionId = newId("connection");
    await harness.owner.query(
      `INSERT INTO connections
         (id, tenant_id, brain_id, page_a_id, page_b_id, similarity, strength, reasoning, source)
       VALUES ($1, $2, $3, $4, $5, 0.87, 'strong', 'Both discuss alpha', 'auto')`,
      [connectionId, harness.tenants.a, brainId, pageAId, pageBId],
    );
    changeId = newId("change");
    await harness.owner.query(
      `INSERT INTO change_events
         (id, tenant_id, brain_id, page_id, action, change_summary, to_version)
       VALUES ($1, $2, $3, $4, 'created', 'Seeded for the contract', 1)`,
      [changeId, harness.tenants.a, brainId, alphaId],
    );
    await harness.owner.query(
      `INSERT INTO score_snapshots (tenant_id, brain_id, freshness, readiness, strain, factors)
       VALUES ($1, $2, 0.5, 0.6, 0.1, '{"seeded": true}')`,
      [harness.tenants.a, brainId],
    );

    await callSuccess(
      "createCapture",
      "/v1/brains/{brainId}/captures",
      "POST",
      `/v1/brains/${brainId}/captures`,
      { method: "POST", body: { kind: "note", content: "Contract body" } },
      201,
    );
    const basic = (await callSuccess(
      "createCapture",
      "/v1/brains/{brainId}/captures",
      "POST",
      `/v1/brains/${brainId}/captures`,
      { method: "POST", body: { kind: "note", content: "Body for content reads" } },
      201,
    )) as { id: string };
    sourceId = basic.id;
    const withOrigin = (await callSuccess(
      "createCapture",
      "/v1/brains/{brainId}/captures",
      "POST",
      `/v1/brains/${brainId}/captures`,
      {
        method: "POST",
        body: { kind: "note", content: "Origin body", originRef: "contract-origin" },
      },
      201,
    )) as { id: string };
    deletedSourceId = withOrigin.id;
    await callSuccess(
      "createCapture",
      "/v1/brains/{brainId}/captures",
      "POST",
      `/v1/brains/${brainId}/captures`,
      {
        method: "POST",
        body: { kind: "note", content: "Origin body", originRef: "contract-origin" },
      },
      200,
    );

    await callSuccess(
      "listIngestSources",
      "/v1/brains/{brainId}/sources",
      "GET",
      `/v1/brains/${brainId}/sources`,
      {},
      200,
    );
    await callSuccess(
      "getIngestSource",
      "/v1/brains/{brainId}/sources/{sourceId}",
      "GET",
      `/v1/brains/${brainId}/sources/${sourceId}`,
      {},
      200,
    );
    await callSuccess(
      "getSourceContent",
      "/v1/brains/{brainId}/sources/{sourceId}/content",
      "GET",
      `/v1/brains/${brainId}/sources/${sourceId}/content`,
      {},
      200,
    );
    await callSuccess(
      "deleteIngestSource",
      "/v1/brains/{brainId}/sources/{sourceId}",
      "DELETE",
      `/v1/brains/${brainId}/sources/${deletedSourceId}`,
      { method: "DELETE" },
      202,
    );

    await callSuccess(
      "listPages",
      "/v1/brains/{brainId}/pages",
      "GET",
      `/v1/brains/${brainId}/pages`,
      {},
      200,
    );
    await callSuccess(
      "getPage",
      "/v1/brains/{brainId}/pages/{slug}",
      "GET",
      `/v1/brains/${brainId}/pages/${pageSlug}`,
      {},
      200,
    );
    await callSuccess(
      "updatePage",
      "/v1/brains/{brainId}/pages/{slug}",
      "PATCH",
      `/v1/brains/${brainId}/pages/${pageSlug}`,
      { method: "PATCH", body: { title: "Alpha guide v2", version: 1 } },
      200,
    );
    await callSuccess(
      "deletePage",
      "/v1/brains/{brainId}/pages/{slug}",
      "DELETE",
      `/v1/brains/${brainId}/pages/${deleteSlug}?permanent=true`,
      { method: "DELETE" },
      202,
    );
    await callSuccess(
      "searchBrain",
      "/v1/brains/{brainId}/search",
      "GET",
      `/v1/brains/${brainId}/search?q=alpha`,
      {},
      200,
    );
    await callSuccess(
      "getIndex",
      "/v1/brains/{brainId}/index",
      "GET",
      `/v1/brains/${brainId}/index`,
      {},
      200,
    );
    await callSuccess(
      "getGraph",
      "/v1/brains/{brainId}/graph",
      "GET",
      `/v1/brains/${brainId}/graph`,
      {},
      200,
    );
    await callSuccess(
      "listConnections",
      "/v1/brains/{brainId}/connections",
      "GET",
      `/v1/brains/${brainId}/connections`,
      {},
      200,
    );
    await callSuccess(
      "ackConnection",
      "/v1/brains/{brainId}/connections/{connectionId}",
      "PATCH",
      `/v1/brains/${brainId}/connections/${connectionId}`,
      { method: "PATCH", body: { acked: true } },
      200,
    );
    await callSuccess(
      "listChanges",
      "/v1/brains/{brainId}/changes",
      "GET",
      `/v1/brains/${brainId}/changes`,
      {},
      200,
    );
    await callSuccess(
      "ackChange",
      "/v1/brains/{brainId}/changes/{changeId}",
      "PATCH",
      `/v1/brains/${brainId}/changes/${changeId}`,
      { method: "PATCH", body: { acked: true } },
      200,
    );
    await callSuccess(
      "getScore",
      "/v1/brains/{brainId}/score",
      "GET",
      `/v1/brains/${brainId}/score`,
      {},
      200,
    );
    await callSuccess(
      "getProfile",
      "/v1/brains/{brainId}/profile",
      "GET",
      `/v1/brains/${brainId}/profile`,
      {},
      200,
    );
    await callSuccess(
      "updateProfile",
      "/v1/brains/{brainId}/profile",
      "PATCH",
      `/v1/brains/${brainId}/profile`,
      { method: "PATCH", body: { focus: "contract coverage" } },
      200,
    );
    await callSuccess(
      "exportBrain",
      "/v1/brains/{brainId}/export",
      "GET",
      `/v1/brains/${brainId}/export`,
      {},
      200,
    );

    await callSuccess("listWebhooks", "/v1/webhooks", "GET", "/v1/webhooks", {}, 200);
    const webhook = (await callSuccess(
      "createWebhook",
      "/v1/webhooks",
      "POST",
      "/v1/webhooks",
      {
        method: "POST",
        body: { url: "https://example.invalid/contract", events: ["created", "updated"] },
      },
      201,
    )) as { id: string };
    await callSuccess(
      "deleteWebhook",
      "/v1/webhooks/{webhookId}",
      "DELETE",
      `/v1/webhooks/${webhook.id}`,
      { method: "DELETE" },
      204,
    );

    await callSuccess("getTenant", "/v1/tenant", "GET", "/v1/tenant", {}, 200);
    await callSuccess("listMembers", "/v1/members", "GET", "/v1/members", {}, 200);
    await callSuccess("listApiKeys", "/v1/api-keys", "GET", "/v1/api-keys", {}, 200);
    const viewer = (await callSuccess(
      "createApiKey",
      "/v1/api-keys",
      "POST",
      "/v1/api-keys",
      { method: "POST", body: { name: "Contract viewer", role: "viewer" } },
      201,
    )) as { id: string; key: string };
    viewerKey = viewer.key;
    const throwaway = (await callSuccess(
      "createApiKey",
      "/v1/api-keys",
      "POST",
      "/v1/api-keys",
      { method: "POST", body: { name: "Contract throwaway" } },
      201,
    )) as { id: string };
    throwawayKeyId = throwaway.id;
    await callSuccess(
      "deleteApiKey",
      "/v1/api-keys/{keyId}",
      "DELETE",
      `/v1/api-keys/${throwawayKeyId}`,
      { method: "DELETE" },
      204,
    );
  });

  test("a missing and an invalid key both answer 401 with distinct messages", async () => {
    const missing = await harness.request("/v1/brains", { key: null });
    const missingBody = (await missing.json()) as { message: string };
    expect(missing.status).toBe(401);
    expect(missingBody.message).toBe("Missing API key");
    contract.expectContract(missing, missingBody, { method: "GET", path: "/v1/brains" });

    const invalid = await harness.request("/v1/brains", { key: INVALID_KEY });
    const invalidBody = (await invalid.json()) as { message: string };
    expect(invalid.status).toBe(401);
    expect(invalidBody.message).toBe("Invalid API key");
    contract.expectContract(invalid, invalidBody, { method: "GET", path: "/v1/brains" });
  });

  test("every documented 401 validates for an unknown key", async () => {
    for (const pair of contract.documented()) {
      if (pair.status !== 401 || contract.validated(pair.operationId, 401)) continue;
      const probe = probes.get(pair.operationId);
      if (!probe) continue;
      await callVariant(probe, probe.path, { ...probe.options, key: INVALID_KEY }, 401);
    }
  });

  test("every documented 400 validates for a malformed subject", async () => {
    for (const pair of contract.documented()) {
      if (pair.status !== 400 || contract.validated(pair.operationId, 400)) continue;
      const probe = probes.get(pair.operationId);
      if (!probe) continue;
      await callVariant(probe, probe.path, { ...probe.options, subject: "not-a-uuid" }, 400);
    }
  });

  test("a viewer key is forbidden from every privileged operation", async () => {
    const cases: Array<{ operationId: string; path: string; options: RequestOptions }> = [
      {
        operationId: "createBrain",
        path: "/v1/brains",
        options: { method: "POST", body: { name: "Forbidden", slug: "forbidden-contract" } },
      },
      {
        operationId: "updateBrain",
        path: `/v1/brains/${brainId}`,
        options: { method: "PATCH", body: { name: "Forbidden rename" } },
      },
      {
        operationId: "deleteBrain",
        path: `/v1/brains/${brainId}`,
        options: { method: "DELETE" },
      },
      { operationId: "getTenant", path: "/v1/tenant", options: {} },
      { operationId: "listMembers", path: "/v1/members", options: {} },
      { operationId: "listApiKeys", path: "/v1/api-keys", options: {} },
      {
        operationId: "createApiKey",
        path: "/v1/api-keys",
        options: { method: "POST", body: { name: "Forbidden" } },
      },
      {
        operationId: "deleteApiKey",
        path: `/v1/api-keys/${throwawayKeyId}`,
        options: { method: "DELETE" },
      },
    ];
    for (const entry of cases) {
      const probe = probes.get(entry.operationId);
      expect(probe).toBeDefined();
      if (!probe) continue;
      await callVariant(probe, entry.path, { ...entry.options, key: viewerKey }, 403);
    }
  });

  test("every documented 404 validates for an unknown id", async () => {
    for (const pair of contract.documented()) {
      if (pair.status !== 404 || contract.validated(pair.operationId, 404)) continue;
      const probe = probes.get(pair.operationId);
      if (!probe) continue;
      const path = unknownPath(probe);
      if (path === null) continue;
      await callVariant(probe, path, probe.options, 404);
    }
  });

  test("every reachable documented 409 validates", async () => {
    const duplicate = await harness.request("/v1/brains", {
      method: "POST",
      body: { name: "Contract", slug: `contract-${crypto.randomUUID()}` },
    });
    expect(duplicate.status).toBe(201);
    const duplicateSlug = (await duplicate.json()) as { slug: string };
    const conflict = await harness.request("/v1/brains", {
      method: "POST",
      body: { name: "Contract", slug: duplicateSlug.slug },
    });
    expect(conflict.status).toBe(409);
    contract.expectContract(conflict, await conflict.json(), {
      method: "POST",
      path: "/v1/brains",
    });

    const key = `contract-${crypto.randomUUID()}`;
    const first = await harness.request(`/v1/brains/${brainId}/captures`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: { kind: "note", content: "First attempt" },
    });
    expect(first.status).toBe(201);
    contract.expectContract(first, await first.json(), {
      method: "POST",
      path: "/v1/brains/{brainId}/captures",
    });
    const replay = await harness.request(`/v1/brains/${brainId}/captures`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: { kind: "note", content: "Different body" },
    });
    expect(replay.status).toBe(409);
    contract.expectContract(replay, await replay.json(), {
      method: "POST",
      path: "/v1/brains/{brainId}/captures",
    });

    const stale = await harness.request(`/v1/brains/${brainId}/pages/${pageSlug}`, {
      method: "PATCH",
      body: { title: "Stale write", version: 1 },
    });
    expect(stale.status).toBe(409);
    contract.expectContract(stale, await stale.json(), {
      method: "PATCH",
      path: "/v1/brains/{brainId}/pages/{slug}",
    });
  });

  test("a bad enum and a capture with both content and fetchUrl answer 400", async () => {
    const badEnum = await harness.request(`/v1/brains/${brainId}/pages/${pageSlug}`, {
      method: "PATCH",
      body: { status: "not-a-status" },
    });
    expect(badEnum.status).toBe(400);
    contract.expectContract(badEnum, await badEnum.json(), {
      method: "PATCH",
      path: "/v1/brains/{brainId}/pages/{slug}",
    });

    const both = await harness.request(`/v1/brains/${brainId}/captures`, {
      method: "POST",
      body: { kind: "note", content: "text", fetchUrl: "https://example.invalid/page" },
    });
    expect(both.status).toBe(400);
    contract.expectContract(both, await both.json(), {
      method: "POST",
      path: "/v1/brains/{brainId}/captures",
    });
  });

  test("invalid webhook events answer 422 and the length bounds answer 400", async () => {
    const cases: Array<{ label: string; events: string[]; status: number; message: string }> = [
      {
        label: "duplicate events",
        events: ["created", "created"],
        status: 422,
        message: "Invalid webhook events",
      },
      {
        label: "an unknown event",
        events: ["created", "exploded"],
        status: 422,
        message: "Invalid webhook events",
      },
      { label: "no events", events: [], status: 400, message: "Invalid request" },
      {
        label: "more than twenty events",
        events: Array.from({ length: 21 }, (_, index) => `event-${index}`),
        status: 400,
        message: "Invalid request",
      },
    ];
    for (const entry of cases) {
      const response = await harness.request("/v1/webhooks", {
        method: "POST",
        body: { url: "https://example.invalid/contract", events: entry.events },
      });
      const body = (await response.json()) as { message: string };
      expect({ label: entry.label, status: response.status }).toEqual({
        label: entry.label,
        status: entry.status,
      });
      expect({ label: entry.label, message: body.message }).toEqual({
        label: entry.label,
        message: entry.message,
      });
      contract.expectContract(response, body, { method: "POST", path: "/v1/webhooks" });
    }
  });

  test("known drift matches the behaviour recorded in KNOWN_DRIFT", async () => {
    for (const drift of KNOWN_DRIFT) {
      const response = await harness.request(drift.path(brainId), drift.options);
      expect({ operationId: drift.operationId, status: response.status }).toEqual({
        operationId: drift.operationId,
        status: drift.status,
      });
      const request = { method: drift.method, path: drift.template };
      if (drift.documented) {
        contract.expectContract(response, await bodyOf(response), request);
      } else {
        const rejection = (() => {
          try {
            contract.expectContract(response, null, request);
          } catch (error) {
            return error;
          }
          return null;
        })();
        expect(rejection).toBeInstanceOf(ContractViolation);
        expect((rejection as Error).message).toContain(`returned ${drift.status}`);
      }
    }
  });
});
