#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SPEC_PATH = resolve(ROOT, "packages/spec/openapi.yaml");
const DOCS_PATH = resolve(ROOT, "docs/API.md");

function compare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").replaceAll("|", "\\|").trim();
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function renderDocs(document) {
  const paths = document?.paths ?? {};

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

  function deref(node) {
    let current = node;
    const seen = new Set();
    while (current && typeof current === "object" && typeof current.$ref === "string") {
      if (seen.has(current.$ref)) return undefined;
      seen.add(current.$ref);
      current = resolvePointer(current.$ref);
    }
    return current;
  }

  function refName(ref) {
    return ref.slice(ref.lastIndexOf("/") + 1);
  }

  function typeName(schema) {
    if (!schema || typeof schema !== "object") return "unknown";
    if (typeof schema.$ref === "string") return refName(schema.$ref);
    const declared = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (declared.includes("array")) {
      const item = typeName(schema.items);
      return item.includes(" | ") ? `(${item})[]` : `${item}[]`;
    }
    if (declared.includes("object") || schema.properties || schema.additionalProperties) {
      return "object";
    }
    if (declared.length === 0) return schema.enum ? "string" : "unknown";
    const format = typeof schema.format === "string" ? ` (${schema.format})` : "";
    return declared.map((type) => (type === "null" ? "null" : `${type}${format}`)).join(" | ");
  }

  function typeCell(schema) {
    if (schema && typeof schema === "object" && typeof schema.$ref === "string") {
      const name = refName(schema.$ref);
      return `[\`${name}\`](#${slugify(name)})`;
    }
    return `\`${inlineShape(schema).replaceAll("|", "\\|")}\``;
  }

  function inlineShape(schema) {
    if (!schema || typeof schema !== "object") return "unknown";
    if (typeof schema.$ref === "string") return refName(schema.$ref);
    const declared = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (declared.includes("array")) return `${inlineShape(schema.items)}[]`;
    const properties = schema.properties;
    if (declared.includes("object") || properties) {
      const entries = Object.entries(properties ?? {});
      if (entries.length === 0) return "object";
      const fields = entries.map(([key, value]) => `${key}: ${inlineShape(value)}`);
      return `object { ${fields.join(", ")} }`;
    }
    return typeName(schema);
  }

  function constraints(schema) {
    const parts = [];
    if (Array.isArray(schema?.enum)) {
      parts.push(`One of ${schema.enum.map((value) => `\`${String(value)}\``).join(", ")}.`);
    }
    if (schema && Object.hasOwn(schema, "const")) {
      parts.push(`Must be \`${String(schema.const)}\`.`);
    }
    if (schema && Object.hasOwn(schema, "default")) {
      parts.push(`Default \`${String(schema.default)}\`.`);
    }
    if (typeof schema?.minimum === "number") parts.push(`Minimum ${schema.minimum}.`);
    if (typeof schema?.maximum === "number") parts.push(`Maximum ${schema.maximum}.`);
    if (typeof schema?.minLength === "number") parts.push(`Minimum length ${schema.minLength}.`);
    if (typeof schema?.maxLength === "number") parts.push(`Maximum length ${schema.maxLength}.`);
    if (typeof schema?.pattern === "string") parts.push(`Matches \`${schema.pattern}\`.`);
    if (typeof schema?.minItems === "number") {
      parts.push(`At least ${plural(schema.minItems, "item")}.`);
    }
    if (schema?.additionalProperties === true) parts.push("Free-form object.");
    return parts.join(" ");
  }

  function notes(object) {
    const parts = [];
    if (typeof object?.description === "string" && object.description.trim() !== "") {
      parts.push(cell(object.description));
    }
    const extra = constraints(object);
    if (extra !== "") parts.push(extra);
    return parts.join(" ");
  }

  function effectiveSecurity(pathItem, operation) {
    if (Array.isArray(operation?.security)) return operation.security;
    if (Array.isArray(pathItem?.security)) return pathItem.security;
    return Array.isArray(document?.security) ? document.security : [];
  }

  function hasScheme(requirement, scheme) {
    return (
      requirement !== null && typeof requirement === "object" && Object.hasOwn(requirement, scheme)
    );
  }

  const schemes = document?.components?.securitySchemes ?? {};
  const apiKeyHeader = schemes.apiKey?.name ?? "x-api-key";
  const subjectHeader = schemes.subjectId?.name ?? "x-subject-id";

  function securityLabel(requirements) {
    if (requirements.length === 0) return "none";
    return requirements
      .map((requirement) => {
        const names = Object.keys(requirement ?? {});
        if (names.length === 0) return "none";
        return names.map((name) => `\`${schemes[name]?.name ?? name}\``).join(" + ");
      })
      .join(" or ");
  }

  const operations = [];
  for (const path of Object.keys(paths).sort(compare)) {
    const pathItem = paths[path] ?? {};
    for (const method of HTTP_METHOD_ORDER) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      operations.push({ path, method, pathItem, operation });
    }
  }

  const schemas = Object.entries(document?.components?.schemas ?? {}).sort(([left], [right]) =>
    compare(left, right),
  );

  const securityByPath = new Map();
  for (const entry of operations) {
    const requirements = securityByPath.get(entry.path) ?? [];
    requirements.push(effectiveSecurity(entry.pathItem, entry.operation));
    securityByPath.set(entry.path, requirements);
  }

  const subjectPaths = [];
  const tenantPaths = [];
  for (const [path, requirements] of securityByPath) {
    if (requirements.length === 0) continue;
    if (
      requirements.every(
        (requirement) =>
          requirement.length > 0 && requirement.every((entry) => hasScheme(entry, "subjectId")),
      )
    ) {
      subjectPaths.push(path);
    } else if (
      requirements.every(
        (requirement) =>
          requirement.length > 0 &&
          requirement.every(
            (entry) => hasScheme(entry, "apiKey") && !hasScheme(entry, "subjectId"),
          ),
      )
    ) {
      tenantPaths.push(path);
    }
  }

  const servers = (document?.servers ?? []).map((server) => server.url).filter(Boolean);

  const lines = [
    `# ${document?.info?.title ?? "API"} reference`,
    "",
    "Generated from `packages/spec/openapi.yaml` by `packages/spec/docs.mjs`. Do not edit this",
    "file by hand; run `bun run spec:docs`.",
    "",
    `- OpenAPI: ${document?.openapi ?? "unknown"}`,
    `- Version: ${document?.info?.version ?? "unknown"}`,
  ];
  if (servers.length > 0) lines.push(`- Server: ${servers.join(", ")}`);
  lines.push(
    `- Endpoints: ${plural(operations.length, "operation")} across ${plural(
      Object.keys(paths).length,
      "path",
    )}`,
    `- Schemas: ${plural(schemas.length, "component schema")}`,
    "",
  );

  lines.push(
    "## Authentication",
    "",
    `Every request carries \`${apiKeyHeader}\`. Subject routes also carry \`${subjectHeader}\`,`,
    `which selects the brains that are visible. Tenant routes never accept \`${subjectHeader}\`.`,
    "",
    "| Header | Scope | Meaning |",
    "| --- | --- | --- |",
    `| \`${apiKeyHeader}\` | Tenant | ${cell(
      schemes.apiKey?.description ?? "Tenant-scoped credential carrying a role.",
    )} |`,
    `| \`${subjectHeader}\` | Subject | ${cell(
      schemes.subjectId?.description ?? "End-user UUID that determines which brains are visible.",
    )} |`,
    "",
    `Subject routes (require \`${subjectHeader}\`):`,
    "",
  );
  if (subjectPaths.length === 0) lines.push("- None.");
  for (const path of subjectPaths) lines.push(`- \`${path}\``);
  lines.push("", `Tenant routes (do not accept \`${subjectHeader}\`):`, "");
  if (tenantPaths.length === 0) lines.push("- None.");
  for (const path of tenantPaths) lines.push(`- \`${path}\``);
  lines.push("");

  lines.push("## Contents", "");
  for (const { path, method, operation } of operations) {
    const label = `${method.toUpperCase()} ${path}`;
    const tag = operation.tags?.[0] ?? "Untagged";
    lines.push(`- [\`${label}\`](#${slugify(label)}) — ${cell(tag)}`);
  }
  lines.push("- [Schema reference](#schema-reference)");
  for (const [name] of schemas) lines.push(`  - [\`${name}\`](#${slugify(name)})`);
  lines.push("");

  lines.push("## Endpoints", "");
  for (const { path, method, pathItem, operation } of operations) {
    const label = `${method.toUpperCase()} ${path}`;
    lines.push(`### ${label}`, "");

    const meta = [`\`${operation.operationId ?? "no-operation-id"}\``];
    if (Array.isArray(operation.tags) && operation.tags.length > 0) {
      meta.push(`Tags: ${operation.tags.map((tag) => cell(tag)).join(", ")}`);
    }
    lines.push(meta.join(" · "), "");
    if (typeof operation.summary === "string" && operation.summary.trim() !== "") {
      lines.push(operation.summary.trim(), "");
    }
    if (typeof operation.description === "string" && operation.description.trim() !== "") {
      lines.push(operation.description.trim(), "");
    }
    lines.push(`**Security:** ${securityLabel(effectiveSecurity(pathItem, operation))}`, "");

    const parameters = [];
    const seenParameters = new Set();
    for (const parameter of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
      const resolved = deref(parameter);
      if (!resolved) continue;
      const key = `${resolved.in}:${resolved.name}`;
      if (seenParameters.has(key)) continue;
      seenParameters.add(key);
      parameters.push(resolved);
    }

    if (parameters.length > 0) {
      lines.push(
        "**Parameters**",
        "",
        "| Name | In | Required | Type | Notes |",
        "| --- | --- | --- | --- | --- |",
      );
      for (const parameter of parameters) {
        const parts = [];
        if (typeof parameter.description === "string" && parameter.description.trim() !== "") {
          parts.push(cell(parameter.description));
        }
        const extra = constraints(parameter.schema);
        if (extra !== "") parts.push(extra);
        lines.push(
          `| \`${parameter.name}\` | ${parameter.in} | ${
            parameter.required === true ? "yes" : "no"
          } | ${typeCell(parameter.schema)} | ${parts.join(" ")} |`,
        );
      }
      lines.push("");
    }

    const requestBody = operation.requestBody ? deref(operation.requestBody) : undefined;
    if (requestBody) {
      const media = Object.keys(requestBody.content ?? {}).sort(compare);
      const bodies = media.map(
        (type) => `\`${inlineShape(requestBody.content[type]?.schema)}\` (\`${type}\`)`,
      );
      lines.push(
        `**Request body** (${requestBody.required === true ? "required" : "optional"})`,
        "",
        bodies.length > 0 ? bodies.join(", ") : "None.",
        "",
      );
    }

    lines.push("**Responses**", "", "| Status | Description | Schema |", "| --- | --- | --- |");
    const responses = operation.responses ?? {};
    const statuses = Object.keys(responses).sort((left, right) => {
      const rank = (status) =>
        status === "default" ? Number.MAX_SAFE_INTEGER : Number.parseInt(status, 10);
      return rank(left) - rank(right) || compare(left, right);
    });
    for (const status of statuses) {
      const response = deref(responses[status]);
      const schema = response?.content?.["application/json"]?.schema;
      const shape = schema === undefined ? "—" : `\`${inlineShape(schema)}\``;
      lines.push(`| ${status} | ${cell(response?.description ?? "")} | ${shape} |`);
    }
    lines.push("");
  }

  lines.push("## Schema reference", "");
  for (const [name, schema] of schemas) {
    lines.push(`### ${name}`, "");
    if (typeof schema?.description === "string" && schema.description.trim() !== "") {
      lines.push(schema.description.trim(), "");
    }
    const properties = schema?.properties;
    if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) {
      lines.push(`Type: ${typeCell(schema)}`, "");
      const extra = constraints(schema);
      if (extra !== "") lines.push(extra, "");
      continue;
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    lines.push(
      `Required: ${required.length === 0 ? "none" : required.map((key) => `\`${key}\``).join(", ")}`,
      "",
      "| Property | Type | Required | Notes |",
      "| --- | --- | --- | --- |",
    );
    for (const [property, value] of Object.entries(properties)) {
      lines.push(
        `| \`${property}\` | ${typeCell(value)} | ${
          required.includes(property) ? "yes" : "no"
        } | ${notes(value)} |`,
      );
    }
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function difference(current, generated) {
  const before = current.split("\n");
  const after = generated.split("\n");
  const total = Math.max(before.length, after.length);
  let first = 0;
  let differing = 0;
  for (let index = 0; index < total; index += 1) {
    if ((before[index] ?? "") === (after[index] ?? "")) continue;
    differing += 1;
    if (first === 0) first = index + 1;
  }
  return `first difference at line ${first}; ${plural(differing, "line")} differ`;
}

if (import.meta.main) {
  const generated = renderDocs(parse(readFileSync(SPEC_PATH, "utf8")));
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(DOCS_PATH, "utf8");
    } catch {
      console.error("spec:docs check failed: docs/API.md does not exist");
      console.error("run `bun run spec:docs` to generate it");
      process.exit(1);
    }
    if (current === generated) {
      console.log("spec:docs check ok: docs/API.md matches packages/spec/openapi.yaml");
    } else {
      console.error("spec:docs check failed: docs/API.md is stale");
      console.error(difference(current, generated));
      console.error("run `bun run spec:docs` to regenerate it");
      process.exit(1);
    }
  } else {
    writeFileSync(DOCS_PATH, generated);
    console.log(`wrote docs/API.md (${plural(generated.split("\n").length - 1, "line")})`);
  }
}
