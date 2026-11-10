import { readFileSync } from "node:fs";
import Ajv, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;
const SPEC_URL = new URL("../../packages/spec/openapi.yaml", import.meta.url);

type JsonObject = Record<string, unknown>;

export interface DocumentedPair {
  operationId: string;
  status: number;
}

export interface ContractRequest {
  method: string;
  path: string;
}

export interface Contract {
  expectContract(response: Response, body: unknown, request: ContractRequest): void;
  documented(): DocumentedPair[];
  coverage(): DocumentedPair[];
  validated(operationId: string, status: number): boolean;
  operations(): string[];
}

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointer(document: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = document;
  for (const rawKey of ref.slice(2).split("/")) {
    const key = decodeURIComponent(rawKey.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (!isObject(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

function resolveReference(document: unknown, node: unknown): unknown {
  let current = node;
  const seen = new Set<string>();
  while (isObject(current) && typeof current.$ref === "string") {
    const ref = current.$ref;
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    current = pointer(document, ref);
  }
  return current;
}

function strictCopy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictCopy);
  if (!isObject(node)) return node;
  const copy: JsonObject = {};
  for (const [key, value] of Object.entries(node)) copy[key] = strictCopy(value);
  const properties = copy.properties;
  if (
    isObject(properties) &&
    Object.keys(properties).length > 0 &&
    copy.additionalProperties === undefined &&
    copy.unevaluatedProperties === undefined
  ) {
    copy.unevaluatedProperties = false;
  }
  return copy;
}

function jsonSchemaOf(response: unknown): unknown {
  if (!isObject(response) || !isObject(response.content)) return null;
  const media = response.content["application/json"];
  if (!isObject(media) || !isObject(media.schema)) return null;
  return media.schema;
}

interface OperationEntry {
  operationId: string;
  method: string;
  template: string;
  responses: JsonObject;
}

function pairKey(pair: DocumentedPair): string {
  return `${pair.operationId}\u0000${pair.status}`;
}

export function readSpec(): unknown {
  return parse(readFileSync(SPEC_URL, "utf8"));
}

export function createContract(spec: unknown = readSpec()): Contract {
  const document = strictCopy(spec);
  const operations = new Map<string, OperationEntry>();
  const pairs: DocumentedPair[] = [];
  const recorded = new Set<string>();
  const validators = new Map<string, ValidateFunction>();
  const ajv = new Ajv({ strict: false, allErrors: true, unevaluated: true });
  addFormats(ajv);

  const paths = isObject(document) && isObject(document.paths) ? document.paths : {};
  for (const [template, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation) || typeof operation.operationId !== "string") continue;
      if (!isObject(operation.responses)) continue;
      const entry: OperationEntry = {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        template,
        responses: operation.responses,
      };
      operations.set(`${entry.method} ${template}`, entry);
      for (const status of Object.keys(operation.responses)) {
        if (!/^\d{3}$/.test(status)) continue;
        pairs.push({ operationId: entry.operationId, status: Number(status) });
      }
    }
  }
  pairs.sort((left, right) =>
    left.operationId === right.operationId
      ? left.status - right.status
      : left.operationId < right.operationId
        ? -1
        : 1,
  );

  const components = isObject(document) && isObject(document.components) ? document.components : {};

  function compile(entry: OperationEntry, status: string, schema: unknown): ValidateFunction {
    const key = `${entry.operationId}\u0000${status}`;
    const cached = validators.get(key);
    if (cached !== undefined) return cached;
    const compiled = ajv.compile({ ...(schema as JsonObject), components });
    validators.set(key, compiled);
    return compiled;
  }

  function expectContract(response: Response, body: unknown, request: ContractRequest): void {
    const key = `${request.method.toUpperCase()} ${request.path}`;
    const entry = operations.get(key);
    if (entry === undefined) {
      throw new ContractViolation(`No documented operation for ${key}`);
    }
    const label = `${entry.method} ${entry.template} (${entry.operationId})`;
    const status = response.status;
    const responseNode = entry.responses[String(status)];
    if (responseNode === undefined) {
      throw new ContractViolation(
        `${label} returned ${status}; documented statuses are ${Object.keys(entry.responses).join(", ")}`,
      );
    }
    recorded.add(pairKey({ operationId: entry.operationId, status }));

    if (!response.headers.get("x-request-id")) {
      throw new ContractViolation(`${label} ${status} is missing the x-request-id header`);
    }

    const resolved = resolveReference(document, responseNode);
    const schema = jsonSchemaOf(resolved);
    if (schema === null) return;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ContractViolation(
        `${label} ${status} returned content type ${JSON.stringify(contentType)} instead of application/json`,
      );
    }

    const validate = compile(entry, String(status), schema);
    if (!validate(body)) {
      throw new ContractViolation(
        `${label} ${status} body does not match the spec: ${ajv.errorsText(validate.errors, { separator: "; " })}`,
      );
    }
  }

  return {
    expectContract,
    documented: () => pairs.map((pair) => ({ ...pair })),
    coverage: () =>
      pairs.filter((pair) => !recorded.has(pairKey(pair))).map((pair) => ({ ...pair })),
    validated: (operationId, status) => recorded.has(pairKey({ operationId, status })),
    operations: () => [...new Set(pairs.map((pair) => pair.operationId))].sort(),
  };
}
