#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);
const ERROR_SCHEMA_REF = "#/components/schemas/ErrorEnvelope";
const TENANT_SCOPED_PATHS = ["/v1/tenant", "/v1/members", "/v1/api-keys", "/v1/api-keys/{keyId}"];
const SUBJECT_SCOPED_ROOT = "/v1/brains";

const specPath = resolve(dirname(fileURLToPath(import.meta.url)), "openapi.yaml");
const document = parse(readFileSync(specPath, "utf8"));
const problems = [];

function fail(pointer, message) {
  problems.push(`${pointer}: ${message}`);
}

function escapePointer(segment) {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function resolvePointer(ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node = document;
  for (const rawKey of ref.slice(2).split("/")) {
    const key = decodeURIComponent(rawKey.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

function checkRef(ref, pointer) {
  if (resolvePointer(ref) === undefined) fail(pointer, `$ref does not resolve: ${ref}`);
}

function walk(node, pointer) {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) walk(item, `${pointer}/${index}`);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const next = `${pointer}/${escapePointer(key)}`;
    if (key === "$ref" && typeof value === "string") checkRef(value, next);
    else walk(value, next);
  }
}

function errorSchemaRef(response) {
  const resolved =
    response !== null && typeof response === "object" && "$ref" in response
      ? resolvePointer(response.$ref)
      : response;
  return resolved?.content?.["application/json"]?.schema?.$ref;
}

function hasSecurityScheme(requirement, scheme) {
  return (
    requirement !== null && typeof requirement === "object" && Object.hasOwn(requirement, scheme)
  );
}

function effectiveSecurity(pathItem, operation) {
  if (Array.isArray(operation?.security)) return operation.security;
  if (Array.isArray(pathItem?.security)) return pathItem.security;
  return Array.isArray(document?.security) ? document.security : [];
}

function securityLocation(path, method, operation, pathItem) {
  const base = `#/paths/${escapePointer(path)}`;
  if (Array.isArray(operation?.security)) return `${base}/${method}/security`;
  if (Array.isArray(pathItem?.security)) return `${base}/security`;
  return Array.isArray(document?.security) ? "#/security" : `${base}/security`;
}

if (typeof document?.openapi !== "string" || !document.openapi.startsWith("3.1.")) {
  fail("#/openapi", `must be a 3.1.x document, found ${JSON.stringify(document?.openapi)}`);
}

const paths = document?.paths ?? {};
const operations = [];
const operationIds = new Map();

for (const [path, pathItem] of Object.entries(paths)) {
  if (!path.startsWith("/v1")) fail(`#/paths/${escapePointer(path)}`, "path must start with /v1");
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!HTTP_METHODS.has(method)) continue;
    const label = `${method.toUpperCase()} ${path}`;
    const pointer = `#/paths/${escapePointer(path)}/${method}`;
    operations.push(label);

    if (typeof operation.operationId !== "string" || operation.operationId.length === 0) {
      fail(pointer, `${label} has no operationId`);
    } else if (operationIds.has(operation.operationId)) {
      const first = operationIds.get(operation.operationId);
      fail(
        pointer,
        `${label} repeats operationId ${operation.operationId} (first used by ${first})`,
      );
    } else {
      operationIds.set(operation.operationId, label);
    }

    if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
      fail(pointer, `${label} has no tags`);
    }

    const responses = operation.responses ?? {};
    const statuses = Object.keys(responses);
    if (!statuses.some((status) => /^2\d\d$/.test(status))) {
      fail(pointer, `${label} has no 2xx response`);
    }
    if (!statuses.some((status) => /^4\d\d$/.test(status))) {
      fail(pointer, `${label} has no 4xx response`);
    }

    for (const status of statuses) {
      if (!/^[45]\d\d$/.test(status) && status !== "default") continue;
      if (errorSchemaRef(responses[status]) !== ERROR_SCHEMA_REF) {
        fail(
          `${pointer}/responses/${escapePointer(status)}`,
          `${label} error response ${status} does not use ErrorEnvelope`,
        );
      }
    }
  }
}

for (const path of TENANT_SCOPED_PATHS) {
  const pathItem = paths[path];
  if (pathItem === undefined) {
    fail(`#/paths/${escapePointer(path)}`, "tenant-scoped path is missing from the document");
    continue;
  }
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!HTTP_METHODS.has(method)) continue;
    const label = `${method.toUpperCase()} ${path}`;
    const where = securityLocation(path, method, operation, pathItem);
    const requirements = effectiveSecurity(pathItem, operation);
    if (requirements.length === 0) {
      fail(
        where,
        `${label} must require apiKey; tenant-scoped paths authenticate with apiKey only`,
      );
    }
    for (const requirement of requirements) {
      if (hasSecurityScheme(requirement, "subjectId")) {
        fail(where, `${label} must not require subjectId; the path is tenant-scoped`);
      }
      if (!hasSecurityScheme(requirement, "apiKey")) {
        fail(where, `${label} must require apiKey; the path is tenant-scoped`);
      }
    }
  }
}

for (const [path, pathItem] of Object.entries(paths)) {
  if (path !== SUBJECT_SCOPED_ROOT && !path.startsWith(`${SUBJECT_SCOPED_ROOT}/`)) continue;
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!HTTP_METHODS.has(method)) continue;
    const label = `${method.toUpperCase()} ${path}`;
    const where = securityLocation(path, method, operation, pathItem);
    const requirements = effectiveSecurity(pathItem, operation);
    const subjectScoped =
      requirements.length > 0 &&
      requirements.every((requirement) => hasSecurityScheme(requirement, "subjectId"));
    if (!subjectScoped) {
      fail(where, `${label} must require subjectId; the path is subject-scoped`);
    }
  }
}

walk(document, "#");

if (problems.length > 0) {
  const suffix = problems.length === 1 ? "" : "s";
  console.error(`spec:lint failed with ${problems.length} problem${suffix}:`);
  for (const [index, problem] of problems.entries()) console.error(`${index + 1}. ${problem}`);
  process.exit(1);
}

const schemaCount = Object.keys(document.components?.schemas ?? {}).length;
console.log(
  `spec ok: ${Object.keys(paths).length} paths, ${operations.length} operations, ${schemaCount} schemas`,
);
