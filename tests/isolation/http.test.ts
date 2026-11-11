import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Contract, createContract, readSpec } from "../support/contract";
import { createHarness, type Harness, hasTestDatabase } from "../support/harness";
import {
  discoverSnapshotPlan,
  EXPECTED_TENANT_SCOPED_TABLES,
  type SnapshotPlan,
  seedWorld,
  snapshotScope,
  targetRow,
  type World,
} from "./fixtures";
import {
  buildMatrix,
  caseLabel,
  coverageGaps,
  EXEMPT,
  type MatrixCase,
  specOperations,
  UNIMPLEMENTED,
} from "./matrix";

interface Envelope {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  body: { message: string; error: string; statusCode: number };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bodyOf(response: Response): Promise<unknown> {
  return response.status === 204 ? null : response.json();
}

function expectEnvelope(
  response: Response,
  body: unknown,
  status: number,
  message: string,
  error: string,
): void {
  const envelope = body as Envelope;
  expect(response.status).toBe(status);
  expect(response.headers.get("x-request-id")).toBeTruthy();
  expect(envelope.statusCode).toBe(status);
  expect(envelope.message).toBe(message);
  expect(envelope.body).toEqual({ message, error, statusCode: status });
  expect(typeof envelope.timestamp).toBe("string");
  expect(envelope.path.startsWith("/v1/")).toBe(true);
}

function withoutEchoedPath(body: unknown): string {
  const envelope = body as Envelope;
  if (envelope && typeof envelope === "object" && "path" in envelope) {
    return JSON.stringify({ ...envelope, path: "<echo>" });
  }
  return JSON.stringify(body);
}

function documented(contract: Contract, operationId: string, status: number): boolean {
  return contract
    .documented()
    .some((pair) => pair.operationId === operationId && pair.status === status);
}

function foreignScope(testCase: MatrixCase, world: World): { tenantId: string; subjectId: string } {
  if (testCase.kind === "foreign-subject" || testCase.kind === "foreign-child-a2") {
    return { tenantId: world.sibling.tenantId, subjectId: world.sibling.subjectId };
  }
  return { tenantId: world.foreign.tenantId, subjectId: world.foreign.subjectId };
}

const OWN_PROBES: Record<string, (world: World) => string[]> = {
  listBrains: (world) => [world.own.brainId, world.own.brainSlug],
  listPages: (world) => [world.own.pageId, world.own.pageSlug],
  searchBrain: (world) => [world.searchToken],
  getIndex: (world) => [world.own.pageSlug],
  getGraph: (world) => [world.own.pageSlug, world.own.connectionId],
  listConnections: (world) => [world.own.connectionId],
  listChanges: (world) => [world.own.changeId],
  listRoutingReviews: (world) => [world.own.reviewId, world.own.pageTitle],
  listIngestSources: (world) => [world.own.sourceId],
  listWebhooks: (world) => [world.own.webhookId],
  listApiKeys: (world) => [world.keys.nonOwnerKeyId],
  getTenant: (world) => [world.own.tenantId],
  listMembers: (world) => [world.members.own],
  exportBrain: (world) => [world.own.pageSlug, world.own.sourceId, world.own.connectionId],
};

describe.skipIf(!hasTestDatabase)("the HTTP isolation matrix", () => {
  let harness: Harness;
  let world: World;
  let contract: Contract;
  let operations: ReturnType<typeof specOperations>;
  let cases: MatrixCase[];
  let plan: SnapshotPlan;
  const undocumented400 = new Set<string>();

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness);
    plan = await discoverSnapshotPlan(harness.owner);
    const spec = readSpec();
    operations = specOperations(spec);
    cases = buildMatrix(operations, world);
    contract = createContract(spec);
  });

  afterAll(async () => {
    try {
      if (cases && operations) {
        expect(coverageGaps(operations, cases)).toEqual([]);
      }
    } finally {
      await harness?.close();
    }
  });

  test("every foreign tenant, subject and child id answers 404 and reads or writes nothing", async () => {
    const failures: string[] = [];
    for (const testCase of cases.filter((entry) => entry.foreign)) {
      const label = caseLabel(testCase);
      try {
        const scope = foreignScope(testCase, world);
        const before = await snapshotScope(harness.owner, plan, scope.tenantId, scope.subjectId);
        const targetBefore = testCase.foreignTarget
          ? await targetRow(harness.owner, testCase.foreignTarget.table, testCase.foreignTarget.id)
          : undefined;

        const response = await harness.request(testCase.path, testCase.options);
        const body = await bodyOf(response);

        expect({ label, status: response.status }).toEqual({ label, status: 404 });
        expectEnvelope(response, body, 404, "Not found", "NotFoundError");
        contract.expectContract(response, body, {
          method: testCase.method,
          path: testCase.template,
        });

        const serialized = withoutEchoedPath(body);
        const leaked = world.foreignMarkers.filter((marker) => serialized.includes(marker));
        expect({ label, leaked }).toEqual({ label, leaked: [] });

        const after = await snapshotScope(harness.owner, plan, scope.tenantId, scope.subjectId);
        expect({ label, unchanged: after }).toEqual({ label, unchanged: before });

        if (testCase.foreignTarget) {
          const targetAfter = await targetRow(
            harness.owner,
            testCase.foreignTarget.table,
            testCase.foreignTarget.id,
          );
          expect({ label, target: targetAfter }).toEqual({ label, target: targetBefore });
        }
      } catch (error) {
        failures.push(`${label}: ${messageOf(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("subject settings operations only read or update the caller tenant and subject", async () => {
    for (const testCase of cases.filter((entry) => entry.kind === "scoped-settings")) {
      for (const scope of [world.sibling, world.foreign]) {
        await harness.owner.query(
          `INSERT INTO memory_settings (tenant_id, subject_id, mode) VALUES ($1, $2, 'ask')
           ON CONFLICT (tenant_id, subject_id) DO UPDATE SET mode = 'ask'`,
          [scope.tenantId, scope.subjectId],
        );
        const before = (await snapshotScope(
          harness.owner,
          plan,
          scope.tenantId,
          scope.subjectId,
        )) as Record<string, Record<string, unknown>[]>;
        const response = await harness.request(testCase.path, testCase.options);
        expect(response.status).toBe(200);
        const settings = (await response.json()) as { mode: string; updatedAt: string | null };
        expect(settings.mode).toBe(testCase.method === "PUT" ? "off" : "auto");
        contract.expectContract(response, settings, {
          method: testCase.method,
          path: testCase.template,
        });
        const after = (await snapshotScope(
          harness.owner,
          plan,
          scope.tenantId,
          scope.subjectId,
        )) as Record<string, Record<string, unknown>[]>;
        const priorAudits = before.audit_events ?? [];
        const audits = after.audit_events ?? [];
        expect(audits).toEqual(expect.arrayContaining(priorAudits));
        const added = audits.filter((row) => !priorAudits.some((prior) => prior.id === row.id));
        expect(added.length).toBe(
          testCase.method === "PUT" && scope.tenantId === world.own.tenantId ? 1 : 0,
        );
        for (const row of added) {
          expect(row).toMatchObject({
            tenant_id: world.own.tenantId,
            target_id: world.own.subjectId,
            action: "memory_settings.updated",
            metadata: { mode: "off" },
          });
        }
        expect({ ...after, audit_events: priorAudits }).toEqual({
          ...before,
          audit_events: priorAudits,
        });
      }
      const ownBefore = await snapshotScope(
        harness.owner,
        plan,
        world.own.tenantId,
        world.own.subjectId,
      );
      const foreign = await harness.request(testCase.path, {
        ...testCase.options,
        key: harness.keys.b,
        subject: world.own.subjectId,
      });
      expect(foreign.status).toBe(200);
      const foreignSettings = (await foreign.json()) as { mode: string; updatedAt: string | null };
      expect(foreignSettings.mode).toBe(testCase.method === "PUT" ? "off" : "auto");
      contract.expectContract(foreign, foreignSettings, {
        method: testCase.method,
        path: testCase.template,
      });
      expect(
        await snapshotScope(harness.owner, plan, world.own.tenantId, world.own.subjectId),
      ).toEqual(ownBefore);
    }
  });

  test("every list and read answers with no foreign id, slug or title", async () => {
    const failures: string[] = [];
    for (const testCase of cases.filter((entry) => entry.kind === "own-list")) {
      const label = caseLabel(testCase);
      try {
        const response = await harness.request(testCase.path, testCase.options);
        const body = await bodyOf(response);
        expect({ label, status: response.status }).toEqual({ label, status: 200 });
        contract.expectContract(response, body, {
          method: testCase.method,
          path: testCase.template,
        });

        const serialized = JSON.stringify(body);
        const leaked = world.foreignMarkers.filter((marker) => serialized.includes(marker));
        expect({ label, leaked }).toEqual({ label, leaked: [] });

        const probe = OWN_PROBES[testCase.operationId];
        expect({ label, hasProbe: probe !== undefined }).toEqual({ label, hasProbe: true });
        const expected = probe ? probe(world) : [];
        const missing = expected.filter((marker) => !serialized.includes(marker));
        expect({ label, missing }).toEqual({ label, missing: [] });
      } catch (error) {
        failures.push(`${label}: ${messageOf(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("every operation rejects a missing, unknown or revoked key and a malformed subject without writing", async () => {
    const failures: string[] = [];
    for (const testCase of cases.filter((entry) => entry.kind.startsWith("auth-"))) {
      const label = caseLabel(testCase);
      try {
        const before = await snapshotScope(
          harness.owner,
          plan,
          world.own.tenantId,
          world.own.subjectId,
        );
        const response = await harness.request(testCase.path, testCase.options);
        const body = await bodyOf(response);
        const errorCode = testCase.expectedStatus === 401 ? "UnauthorizedError" : "BadRequestError";

        expect({ label, status: response.status }).toEqual({
          label,
          status: testCase.expectedStatus,
        });
        expectEnvelope(
          response,
          body,
          testCase.expectedStatus,
          testCase.expectedMessage,
          errorCode,
        );
        if (documented(contract, testCase.operationId, testCase.expectedStatus)) {
          contract.expectContract(response, body, {
            method: testCase.method,
            path: testCase.template,
          });
        } else {
          undocumented400.add(`${testCase.operationId}:${testCase.expectedStatus}`);
        }

        const after = await snapshotScope(
          harness.owner,
          plan,
          world.own.tenantId,
          world.own.subjectId,
        );
        expect({ label, unchanged: after }).toEqual({ label, unchanged: before });
      } catch (error) {
        failures.push(`${label}: ${messageOf(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("every spec operation has a route", () => {
    expect([...UNIMPLEMENTED]).toEqual([]);
  });

  test("profile suggestions cover foreign tenant, foreign subject and all auth negatives without exemptions", () => {
    expect(
      cases
        .filter((entry) => entry.operationId === "suggestProfile")
        .map((entry) => entry.kind)
        .sort(),
    ).toEqual([
      "auth-malformed-subject",
      "auth-missing-key",
      "auth-revoked-key",
      "auth-unknown-key",
      "foreign-subject",
      "foreign-tenant",
    ]);
    expect(EXEMPT.some((entry) => entry.operationId === "suggestProfile")).toBe(false);
  });

  test("the snapshot discovers every tenant-scoped table and filters by the narrowest column", () => {
    const discovered = plan.tables.map((entry) => entry.table);
    expect(discovered).toEqual(expect.arrayContaining([...EXPECTED_TENANT_SCOPED_TABLES]));
    expect(new Set(discovered).size).toBe(discovered.length);
    const filterOf = new Map(plan.tables.map((entry) => [entry.table, entry.filter]));
    expect(Object.fromEntries(filterOf)).toMatchObject({
      api_keys: "tenant",
      webhooks: "subject",
      connections: "brain",
      page_versions: "page",
    });
  });

  test("the matrix covers every spec operation or says why it cannot", () => {
    expect(operations.length).toBeGreaterThan(0);
    expect(coverageGaps(operations, cases)).toEqual([]);
    for (const exemption of EXEMPT) {
      expect(operations.some((entry) => entry.operationId === exemption.operationId)).toBe(true);
    }
  });

  test("every malformed-subject 400 the matrix produced is documented", () => {
    expect([...undocumented400].sort()).toEqual([]);
  });
});
