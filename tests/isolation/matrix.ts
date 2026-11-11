import type { RequestOptions } from "../support/harness";
import type { TargetTable, World } from "./fixtures";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const CHILD_PARAMS = new Set([
  "sourceId",
  "slug",
  "connectionId",
  "changeId",
  "reviewId",
  "version",
]);
const TENANT_SCOPED_PARAMS = new Set(["webhookId", "keyId"]);
const SUBJECT_SCOPED_PARAMS = new Set(["webhookId"]);

export const UNIMPLEMENTED = new Set<string>();

export const OWN_LIST = new Set([
  "listBrains",
  "listPages",
  "searchBrain",
  "getIndex",
  "getGraph",
  "listConnections",
  "listChanges",
  "listRoutingReviews",
  "listIngestSources",
  "listWebhooks",
  "listApiKeys",
  "getTenant",
  "listMembers",
  "exportBrain",
]);

export type CaseKind =
  | "foreign-tenant"
  | "foreign-subject"
  | "foreign-child-a2"
  | "foreign-child-b"
  | "tenant-scoped"
  | "own-list"
  | "scoped-settings"
  | "auth-missing-key"
  | "auth-unknown-key"
  | "auth-revoked-key"
  | "auth-malformed-subject";

const FOREIGN_KINDS: CaseKind[] = [
  "foreign-tenant",
  "foreign-subject",
  "foreign-child-a2",
  "foreign-child-b",
  "tenant-scoped",
];

const AUTH_KINDS: CaseKind[] = [
  "auth-missing-key",
  "auth-unknown-key",
  "auth-revoked-key",
  "auth-malformed-subject",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type JsonObject = Record<string, unknown>;

export interface SpecOperation {
  operationId: string;
  method: string;
  template: string;
  pathParams: string[];
  requiresBody: boolean;
}

export interface ForeignTarget {
  table: TargetTable;
  id: string;
}

export interface MatrixCase {
  operationId: string;
  method: string;
  template: string;
  kind: CaseKind;
  path: string;
  options: RequestOptions;
  foreign: boolean;
  mutation: boolean;
  expectedStatus: number;
  expectedMessage: string;
  foreignTarget?: ForeignTarget;
}

export interface Exemption {
  operationId: string;
  kind: CaseKind | "foreign-id" | "all";
  reason: string;
}

export const EXEMPT: readonly Exemption[] = [
  {
    operationId: "createBrain",
    kind: "foreign-id",
    reason:
      "The request carries no id and creates a new resource, so there is no foreign row to name. The four auth negatives still cover it.",
  },
  {
    operationId: "createWebhook",
    kind: "foreign-id",
    reason:
      "The request carries no id and creates a new resource, so there is no foreign row to name. The four auth negatives still cover it.",
  },
  {
    operationId: "createApiKey",
    kind: "foreign-id",
    reason:
      "The request carries no id and creates a new resource, so there is no foreign row to name. The four auth negatives still cover it.",
  },
];

const BODIES: Record<string, () => unknown> = {
  createBrain: () => ({ name: "Matrix brain", slug: `matrix-${crypto.randomUUID()}` }),
  updateBrain: () => ({ name: "Matrix brain" }),
  createCapture: () => ({ kind: "note", content: `matrix capture ${crypto.randomUUID()}` }),
  updatePage: () => ({ title: "Matrix page", version: 1 }),
  resolveRoutingReview: () => ({ newPage: true }),
  resolvePage: () => ({ note: "Matrix resolution" }),
  ackConnection: () => ({ acked: true }),
  ackChange: () => ({ acked: true }),
  updateProfile: () => ({ focus: "matrix focus" }),
  updateMemorySettings: () => ({ mode: "off" }),
  createWebhook: () => ({ url: "https://matrix.example.invalid/hook", events: ["created"] }),
  createApiKey: () => ({ name: `Matrix key ${crypto.randomUUID()}` }),
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dereference(document: JsonObject, node: unknown): JsonObject | null {
  let current = node;
  const seen = new Set<string>();
  while (isObject(current) && typeof current.$ref === "string") {
    const ref = current.$ref;
    if (seen.has(ref) || !ref.startsWith("#/")) return null;
    seen.add(ref);
    let target: unknown = document;
    for (const key of ref.slice(2).split("/")) {
      if (!isObject(target)) return null;
      target = target[key];
    }
    current = target;
  }
  return isObject(current) ? current : null;
}

export function specOperations(spec: unknown): SpecOperation[] {
  if (!isObject(spec)) throw new Error("The spec is not an object");
  const document = spec;
  const paths = document.paths;
  if (!isObject(paths)) throw new Error("The spec has no paths");
  const operations: SpecOperation[] = [];
  for (const [template, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) continue;
    const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation) || typeof operation.operationId !== "string") continue;
      const own = Array.isArray(operation.parameters) ? operation.parameters : [];
      const pathParams: string[] = [];
      for (const raw of [...shared, ...own]) {
        const parameter = dereference(document, raw);
        if (parameter?.in === "path" && typeof parameter.name === "string") {
          pathParams.push(parameter.name);
        }
      }
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        template,
        pathParams,
        requiresBody: isObject(operation.requestBody) && operation.requestBody.required === true,
      });
    }
  }
  return operations.sort((left, right) =>
    left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
  );
}

function requiredKinds(operation: SpecOperation): CaseKind[] {
  if (UNIMPLEMENTED.has(operation.operationId)) return [];
  const kinds: CaseKind[] = [];
  if (["getMemorySettings", "updateMemorySettings"].includes(operation.operationId))
    kinds.push("scoped-settings");
  if (operation.pathParams.includes("brainId")) {
    kinds.push("foreign-tenant", "foreign-subject");
  }
  if (operation.pathParams.some((name) => SUBJECT_SCOPED_PARAMS.has(name))) {
    kinds.push("foreign-subject");
  }
  if (operation.pathParams.some((name) => CHILD_PARAMS.has(name))) {
    if (operation.pathParams.includes("brainId")) {
      kinds.push("foreign-child-a2", "foreign-child-b");
    }
  }
  if (operation.pathParams.some((name) => TENANT_SCOPED_PARAMS.has(name))) {
    kinds.push("tenant-scoped");
  }
  if (OWN_LIST.has(operation.operationId)) kinds.push("own-list");
  return [...new Set([...kinds, ...AUTH_KINDS])];
}

function requiredForeignKinds(operation: SpecOperation): CaseKind[] {
  return requiredKinds(operation).filter((kind) => FOREIGN_KINDS.includes(kind));
}

interface ParamValues {
  brainId: string;
  sourceId: string;
  slug: string;
  version: string;
  connectionId: string;
  changeId: string;
  reviewId: string;
  webhookId: string;
  keyId: string;
}

function paramValues(kind: CaseKind, world: World): ParamValues {
  const own: ParamValues = {
    brainId: world.own.brainId,
    sourceId: world.own.sourceId,
    slug: world.own.pageSlug,
    version: "1",
    connectionId: world.own.connectionId,
    changeId: world.own.changeId,
    reviewId: world.own.reviewId,
    webhookId: world.own.webhookId,
    keyId: world.keys.nonOwnerKeyId,
  };
  const sibling: ParamValues = {
    brainId: world.sibling.brainId,
    sourceId: world.sibling.sourceId,
    slug: world.sibling.pageSlug,
    version: "1",
    connectionId: world.sibling.connectionId,
    changeId: world.sibling.changeId,
    reviewId: world.sibling.reviewId,
    webhookId: world.sibling.webhookId,
    keyId: world.keys.nonOwnerKeyId,
  };
  const foreign: ParamValues = {
    brainId: world.foreign.brainId,
    sourceId: world.foreign.sourceId,
    slug: world.foreign.pageSlug,
    version: "1",
    connectionId: world.foreign.connectionId,
    changeId: world.foreign.changeId,
    reviewId: world.foreign.reviewId,
    webhookId: world.foreign.webhookId,
    keyId: world.keys.foreignKeyId,
  };
  switch (kind) {
    case "foreign-tenant":
      return foreign;
    case "foreign-subject":
      return sibling;
    case "foreign-child-a2":
      return {
        ...own,
        sourceId: sibling.sourceId,
        slug: sibling.slug,
        connectionId: sibling.connectionId,
        changeId: sibling.changeId,
        reviewId: sibling.reviewId,
      };
    case "foreign-child-b":
      return {
        ...own,
        sourceId: foreign.sourceId,
        slug: foreign.slug,
        connectionId: foreign.connectionId,
        changeId: foreign.changeId,
        reviewId: foreign.reviewId,
      };
    case "tenant-scoped":
      return { ...own, webhookId: foreign.webhookId, keyId: world.keys.foreignKeyId };
    default:
      return own;
  }
}

function renderPath(operation: SpecOperation, values: ParamValues): string {
  return operation.template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name as keyof ParamValues];
    if (value === undefined) throw new Error(`No value for path parameter ${name}`);
    return encodeURIComponent(value);
  });
}

function foreignTarget(
  operation: SpecOperation,
  kind: CaseKind,
  world: World,
): ForeignTarget | undefined {
  if (!FOREIGN_KINDS.includes(kind)) return undefined;
  const params = operation.pathParams;
  if (kind === "foreign-tenant" || kind === "tenant-scoped") {
    if (params.includes("webhookId")) return { table: "webhooks", id: world.foreign.webhookId };
    if (params.includes("keyId")) return { table: "api_keys", id: world.keys.foreignKeyId };
    if (params.includes("brainId")) return { table: "brains", id: world.foreign.brainId };
    return undefined;
  }
  if (kind === "foreign-subject") {
    if (params.includes("brainId")) return { table: "brains", id: world.sibling.brainId };
    if (params.includes("webhookId")) return { table: "webhooks", id: world.sibling.webhookId };
    return undefined;
  }
  const child = kind === "foreign-child-a2" ? world.sibling : world.foreign;
  if (params.includes("sourceId")) return { table: "ingest_sources", id: child.sourceId };
  if (params.includes("slug")) return { table: "pages", id: child.pageId };
  if (params.includes("connectionId")) return { table: "connections", id: child.connectionId };
  if (params.includes("reviewId")) return { table: "routing_reviews", id: child.reviewId };
  if (params.includes("changeId")) return { table: "change_events", id: child.changeId };
  return undefined;
}

const EXPECTATIONS: Record<CaseKind, { status: number; message: string }> = {
  "foreign-tenant": { status: 404, message: "Not found" },
  "foreign-subject": { status: 404, message: "Not found" },
  "foreign-child-a2": { status: 404, message: "Not found" },
  "foreign-child-b": { status: 404, message: "Not found" },
  "tenant-scoped": { status: 404, message: "Not found" },
  "own-list": { status: 200, message: "" },
  "scoped-settings": { status: 200, message: "" },
  "auth-missing-key": { status: 401, message: "Missing API key" },
  "auth-unknown-key": { status: 401, message: "Invalid API key" },
  "auth-revoked-key": { status: 401, message: "Invalid API key" },
  "auth-malformed-subject": { status: 400, message: "Invalid subject id" },
};

function buildCase(operation: SpecOperation, kind: CaseKind, world: World): MatrixCase {
  const values = paramValues(kind, world);
  const path = renderPath(operation, values);
  const options: RequestOptions = { method: operation.method };
  if (operation.requiresBody) {
    const body = BODIES[operation.operationId];
    if (!body) throw new Error(`${operation.operationId} requires a body but the matrix has none`);
    options.body = body();
  }
  if (operation.operationId === "deletePage") options.query = { permanent: "true" };
  if (operation.operationId === "searchBrain") options.query = { q: world.searchToken };
  if (operation.operationId === "getIndex") options.query = { offset: "0", status: "active" };
  if (operation.operationId === "diffPageVersions") options.query = { from: "1", to: "2" };
  if (kind === "auth-missing-key") options.key = null;
  if (kind === "auth-unknown-key") options.key = world.keys.unknown;
  if (kind === "auth-revoked-key") options.key = world.keys.revoked;
  if (kind === "auth-malformed-subject") options.subject = "not-a-uuid";
  if (kind === "tenant-scoped" && operation.pathParams.includes("keyId")) {
    options.key = world.keys.nonOwner;
  }
  const target = foreignTarget(operation, kind, world);
  const expectation = EXPECTATIONS[kind];
  const result: MatrixCase = {
    operationId: operation.operationId,
    method: operation.method,
    template: operation.template,
    kind,
    path,
    options,
    foreign: FOREIGN_KINDS.includes(kind),
    mutation: FOREIGN_KINDS.includes(kind) && MUTATING_METHODS.has(operation.method),
    expectedStatus: expectation.status,
    expectedMessage: expectation.message,
  };
  if (target !== undefined) result.foreignTarget = target;
  return result;
}

export function buildMatrix(operations: SpecOperation[], world: World): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const operation of operations) {
    for (const kind of requiredKinds(operation)) cases.push(buildCase(operation, kind, world));
  }
  return cases;
}

export function caseLabel(testCase: MatrixCase): string {
  return `${testCase.operationId} [${testCase.kind}] ${testCase.method} ${testCase.path}`;
}

export function coverageGaps(operations: SpecOperation[], cases: MatrixCase[]): string[] {
  const gaps: string[] = [];
  const generated = new Map<string, Set<CaseKind>>();
  for (const testCase of cases) {
    const kinds = generated.get(testCase.operationId) ?? new Set<CaseKind>();
    kinds.add(testCase.kind);
    generated.set(testCase.operationId, kinds);
  }
  const exemptions = new Map<string, Exemption>();
  for (const exemption of EXEMPT) {
    const key = `${exemption.operationId}\u0000${exemption.kind}`;
    if (exemptions.has(key)) gaps.push(`EXEMPT repeats ${exemption.operationId}:${exemption.kind}`);
    exemptions.set(key, exemption);
  }

  for (const operation of operations) {
    const kinds = generated.get(operation.operationId) ?? new Set<CaseKind>();
    if (kinds.size === 0) {
      if (!exemptions.has(`${operation.operationId}\u0000all`)) {
        gaps.push(`${operation.operationId}: no generated case and no EXEMPT entry`);
      }
      continue;
    }
    for (const kind of requiredKinds(operation)) {
      if (
        !kinds.has(kind) &&
        !exemptions.has(`${operation.operationId}\u0000${kind}`) &&
        !(
          FOREIGN_KINDS.includes(kind) && exemptions.has(`${operation.operationId}\u0000foreign-id`)
        )
      ) {
        gaps.push(`${operation.operationId}: no ${kind} case`);
      }
    }
  }

  for (const exemption of EXEMPT) {
    const operation = operations.find((entry) => entry.operationId === exemption.operationId);
    if (!operation) {
      gaps.push(`EXEMPT names an unknown operation: ${exemption.operationId}`);
      continue;
    }
    const kinds = generated.get(operation.operationId) ?? new Set<CaseKind>();
    if (exemption.kind === "all") {
      if (kinds.size > 0) {
        gaps.push(`EXEMPT all for ${exemption.operationId} is stale: cases are now generated`);
      }
      continue;
    }
    if (exemption.kind === "foreign-id") {
      const covered = requiredForeignKinds(operation).filter((kind) => kinds.has(kind));
      if (covered.length > 0) {
        gaps.push(
          `EXEMPT foreign-id for ${exemption.operationId} is stale: ${covered.join(", ")} cases exist`,
        );
      }
      continue;
    }
    if (kinds.has(exemption.kind)) {
      gaps.push(`EXEMPT ${exemption.operationId}:${exemption.kind} is stale: the case exists`);
    }
  }

  for (const testCase of cases) {
    if (!operations.some((operation) => operation.operationId === testCase.operationId)) {
      gaps.push(`${testCase.operationId}: a case exists for an operation missing from the spec`);
    }
  }
  return [...new Set(gaps)].sort();
}

export function countByKind(cases: MatrixCase[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const testCase of cases) counts[testCase.kind] = (counts[testCase.kind] ?? 0) + 1;
  return counts;
}
