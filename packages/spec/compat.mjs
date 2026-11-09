#!/usr/bin/env bun
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
const ANNOTATIONS = new Set([
  "$comment",
  "deprecated",
  "description",
  "example",
  "examples",
  "externalDocs",
  "title",
  "xml",
]);
const LOWER_BOUNDS = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"];
const UPPER_BOUNDS = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"];
const BREAKING = "breaking";
const NON_BREAKING = "non-breaking";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASELINE = "tests/contract/openapi.baseline.yaml";
const DEFAULT_CURRENT = "packages/spec/openapi.yaml";

function compare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePointer(segment) {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function pathPointer(path) {
  return `#/paths/${escapePointer(path)}`;
}

function operationPointer(path, method) {
  return `${pathPointer(path)}/${method}`;
}

function json(value) {
  return JSON.stringify(value);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function resolvePointer(document, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node = document;
  for (const rawKey of ref.slice(2).split("/")) {
    const key = decodeURIComponent(rawKey.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

function resolveRefs(document, node) {
  let current = node;
  const seen = new Set();
  while (isObject(current) && typeof current.$ref === "string") {
    if (seen.has(current.$ref)) return undefined;
    seen.add(current.$ref);
    current = resolvePointer(document, current.$ref);
  }
  return current;
}

function canonicalSchema(document, node, stack = new Set()) {
  if (Array.isArray(node)) return node.map((item) => canonicalSchema(document, item, stack));
  if (!isObject(node)) return node;
  if (typeof node.$ref === "string") {
    if (stack.has(node.$ref)) return { $cycle: true };
    const target = resolvePointer(document, node.$ref);
    if (target === undefined) return { $ref: node.$ref };
    const next = new Set(stack);
    next.add(node.$ref);
    return canonicalSchema(document, target, next);
  }
  const output = {};
  for (const key of Object.keys(node).sort(compare)) {
    if (ANNOTATIONS.has(key)) continue;
    output[key] = canonicalSchema(document, node[key], stack);
  }
  return output;
}

function canonicalKey(document, node) {
  return json(canonicalSchema(document, node));
}

function createFindings() {
  const records = new Map();
  const pairs = new WeakMap();
  return {
    add(severity, path, message) {
      const key = `${severity}\u0000${path}\u0000${message}`;
      if (!records.has(key)) records.set(key, { severity, path, message });
    },
    enter(base, current) {
      let seen = pairs.get(base);
      if (seen === undefined) {
        seen = new WeakSet();
        pairs.set(base, seen);
      }
      if (seen.has(current)) return false;
      seen.add(current);
      return true;
    },
    leave(base, current) {
      pairs.get(base)?.delete(current);
    },
    list() {
      return [...records.values()].sort((left, right) => {
        if (left.severity !== right.severity) return left.severity === BREAKING ? -1 : 1;
        const byPath = compare(left.path, right.path);
        return byPath === 0 ? compare(left.message, right.message) : byPath;
      });
    },
  };
}

function typeNames(schema) {
  if (Array.isArray(schema.type)) return new Set(schema.type.map(String));
  if (typeof schema.type === "string") return new Set([schema.type]);
  return new Set();
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function describeTypes(types) {
  return types.size === 0 ? "untyped" : [...types].sort(compare).join("|");
}

function valueKey(value) {
  return JSON.stringify(value) ?? String(value);
}

function compareTypes(base, current, pointer, findings) {
  const baseTypes = typeNames(base);
  const currentTypes = typeNames(current);
  if (baseTypes.size === 0 && currentTypes.size === 0) return;
  if (sameSet(baseTypes, currentTypes)) return;
  findings.add(
    BREAKING,
    pointer,
    `type changed from ${describeTypes(baseTypes)} to ${describeTypes(currentTypes)}`,
  );
}

function compareFormat(base, current, pointer, findings) {
  if (base.format === current.format) return;
  findings.add(
    BREAKING,
    pointer,
    `format changed from ${json(base.format)} to ${json(current.format)}`,
  );
}

function compareEnum(base, current, pointer, findings) {
  const baseValues = Array.isArray(base.enum) ? base.enum : undefined;
  const currentValues = Array.isArray(current.enum) ? current.enum : undefined;
  if (baseValues === undefined && currentValues === undefined) return;
  if (currentValues === undefined) {
    findings.add(NON_BREAKING, pointer, "enum constraint removed");
    return;
  }
  if (baseValues === undefined) {
    findings.add(BREAKING, pointer, `enum constraint added with ${currentValues.length} values`);
    return;
  }
  const baseKeys = new Map(baseValues.map((value) => [valueKey(value), value]));
  const currentKeys = new Set(currentValues.map(valueKey));
  for (const [key, value] of baseKeys) {
    if (!currentKeys.has(key)) {
      findings.add(BREAKING, pointer, `removed enum value ${json(value)}`);
    }
  }
  for (const value of currentValues) {
    if (!baseKeys.has(valueKey(value))) {
      findings.add(NON_BREAKING, pointer, `added enum value ${json(value)}`);
    }
  }
}

function compareLowerBound(key, baseValue, currentValue, pointer, findings) {
  const baseNumber = typeof baseValue === "number" ? baseValue : undefined;
  const currentNumber = typeof currentValue === "number" ? currentValue : undefined;
  if (currentNumber === undefined) {
    if (baseNumber !== undefined) findings.add(NON_BREAKING, pointer, `constraint ${key} removed`);
    return;
  }
  if (baseNumber === undefined || currentNumber > baseNumber) {
    findings.add(BREAKING, pointer, `constraint ${key} tightened to ${currentNumber}`);
  } else if (currentNumber < baseNumber) {
    findings.add(NON_BREAKING, pointer, `constraint ${key} relaxed to ${currentNumber}`);
  }
}

function compareUpperBound(key, baseValue, currentValue, pointer, findings) {
  const baseNumber = typeof baseValue === "number" ? baseValue : undefined;
  const currentNumber = typeof currentValue === "number" ? currentValue : undefined;
  if (currentNumber === undefined) {
    if (baseNumber !== undefined) findings.add(NON_BREAKING, pointer, `constraint ${key} removed`);
    return;
  }
  if (baseNumber === undefined || currentNumber < baseNumber) {
    findings.add(BREAKING, pointer, `constraint ${key} tightened to ${currentNumber}`);
  } else if (currentNumber > baseNumber) {
    findings.add(NON_BREAKING, pointer, `constraint ${key} relaxed to ${currentNumber}`);
  }
}

function compareBounds(base, current, pointer, findings) {
  for (const key of LOWER_BOUNDS) {
    compareLowerBound(key, base[key], current[key], pointer, findings);
  }
  for (const key of UPPER_BOUNDS) {
    compareUpperBound(key, base[key], current[key], pointer, findings);
  }
}

function comparePattern(base, current, pointer, findings) {
  const basePattern = typeof base.pattern === "string" ? base.pattern : undefined;
  const currentPattern = typeof current.pattern === "string" ? current.pattern : undefined;
  if (basePattern === currentPattern) return;
  if (currentPattern === undefined) {
    findings.add(NON_BREAKING, pointer, "pattern constraint removed");
    return;
  }
  if (basePattern === undefined) {
    findings.add(BREAKING, pointer, `pattern constraint added: ${currentPattern}`);
    return;
  }
  findings.add(BREAKING, pointer, `pattern changed from ${basePattern} to ${currentPattern}`);
}

function compareVariants(baseDoc, currentDoc, keyword, base, current, pointer, findings) {
  const baseVariants = Array.isArray(base[keyword]) ? base[keyword] : undefined;
  const currentVariants = Array.isArray(current[keyword]) ? current[keyword] : undefined;
  const where = `${pointer}/${keyword}`;
  if (baseVariants === undefined) {
    if (currentVariants !== undefined) {
      findings.add(
        BREAKING,
        where,
        `${keyword} constraint added with ${currentVariants.length} variants`,
      );
    }
    return;
  }
  if (currentVariants === undefined) {
    findings.add(BREAKING, where, `${keyword} constraint removed`);
    return;
  }
  const baseKeys = new Map(
    baseVariants.map((variant, index) => [canonicalKey(baseDoc, variant), index]),
  );
  const currentKeys = new Map(
    currentVariants.map((variant, index) => [canonicalKey(currentDoc, variant), index]),
  );
  for (const [key, index] of baseKeys) {
    if (!currentKeys.has(key)) {
      findings.add(BREAKING, `${where}/${index}`, `removed ${keyword} variant ${index + 1}`);
    }
  }
  for (const [key, index] of currentKeys) {
    if (!baseKeys.has(key)) {
      findings.add(NON_BREAKING, `${where}/${index}`, `added ${keyword} variant ${index + 1}`);
    }
  }
}

function compareProperties(baseDoc, currentDoc, base, current, pointer, findings, direction) {
  const baseProperties = isObject(base.properties) ? base.properties : {};
  const currentProperties = isObject(current.properties) ? current.properties : {};
  const baseRequired = new Set(Array.isArray(base.required) ? base.required : []);
  const currentRequired = new Set(Array.isArray(current.required) ? current.required : []);
  const where = `${pointer}/properties`;

  for (const [name, baseProperty] of Object.entries(baseProperties)) {
    const propertyPointer = `${where}/${escapePointer(name)}`;
    if (!Object.hasOwn(currentProperties, name)) {
      findings.add(BREAKING, propertyPointer, `removed property ${name}`);
      continue;
    }
    compareSchemaPair(
      baseDoc,
      currentDoc,
      baseProperty,
      currentProperties[name],
      propertyPointer,
      findings,
      direction,
    );
  }

  for (const name of Object.keys(currentProperties)) {
    if (Object.hasOwn(baseProperties, name)) continue;
    const propertyPointer = `${where}/${escapePointer(name)}`;
    if (currentRequired.has(name)) {
      findings.add(BREAKING, propertyPointer, `added required property ${name}`);
    } else {
      findings.add(NON_BREAKING, propertyPointer, `added optional property ${name}`);
    }
  }

  for (const name of currentRequired) {
    if (baseRequired.has(name) || !Object.hasOwn(baseProperties, name)) continue;
    findings.add(
      BREAKING,
      `${pointer}/required/${escapePointer(name)}`,
      `property ${name} became required`,
    );
  }
  for (const name of baseRequired) {
    if (currentRequired.has(name)) continue;
    findings.add(
      NON_BREAKING,
      `${pointer}/required/${escapePointer(name)}`,
      `property ${name} is no longer required`,
    );
  }
}

function compareItems(baseDoc, currentDoc, base, current, pointer, findings, direction) {
  const where = `${pointer}/items`;
  const baseItems = base.items;
  const currentItems = current.items;
  if (baseItems === undefined && currentItems === undefined) return;
  if (currentItems === undefined) {
    findings.add(NON_BREAKING, where, "array items schema removed");
    return;
  }
  if (baseItems === undefined) {
    findings.add(BREAKING, where, "array items schema added");
    return;
  }
  compareSchemaPair(baseDoc, currentDoc, baseItems, currentItems, where, findings, direction);
}

function compareSchemaObjects(baseDoc, currentDoc, base, current, pointer, findings, direction) {
  compareTypes(base, current, pointer, findings);
  compareFormat(base, current, pointer, findings);
  compareEnum(base, current, pointer, findings);
  compareBounds(base, current, pointer, findings);
  comparePattern(base, current, pointer, findings);
  compareProperties(baseDoc, currentDoc, base, current, pointer, findings, direction);
  compareItems(baseDoc, currentDoc, base, current, pointer, findings, direction);
  compareVariants(baseDoc, currentDoc, "oneOf", base, current, pointer, findings);
  compareVariants(baseDoc, currentDoc, "anyOf", base, current, pointer, findings);
}

function compareSchemaPair(
  baseDoc,
  currentDoc,
  baseNode,
  currentNode,
  pointer,
  findings,
  direction,
) {
  if (baseNode === undefined && currentNode === undefined) return;
  if (baseNode === undefined) {
    findings.add(BREAKING, pointer, "schema added");
    return;
  }
  if (currentNode === undefined) {
    findings.add(NON_BREAKING, pointer, "schema removed");
    return;
  }

  const base = resolveRefs(baseDoc, baseNode);
  const current = resolveRefs(currentDoc, currentNode);
  if (base === undefined || current === undefined) {
    if (json(baseNode) !== json(currentNode)) {
      findings.add(BREAKING, pointer, "schema reference does not resolve consistently");
    }
    return;
  }

  const baseObject = isObject(base);
  const currentObject = isObject(current);
  if (!(baseObject || currentObject)) {
    if (base !== current) {
      findings.add(
        BREAKING,
        pointer,
        `schema value changed from ${json(base)} to ${json(current)}`,
      );
    }
    return;
  }
  if (baseObject !== currentObject) {
    findings.add(BREAKING, pointer, "schema kind changed");
    return;
  }
  if (!findings.enter(base, current)) return;
  try {
    compareSchemaObjects(baseDoc, currentDoc, base, current, pointer, findings, direction);
  } finally {
    findings.leave(base, current);
  }
}

function compareContent(
  baseDoc,
  currentDoc,
  baseContent,
  currentContent,
  pointer,
  findings,
  direction,
) {
  const baseTypes = isObject(baseContent) ? baseContent : {};
  const currentTypes = isObject(currentContent) ? currentContent : {};
  for (const mediaType of Object.keys(baseTypes)) {
    const mediaPointer = `${pointer}/${escapePointer(mediaType)}`;
    if (!Object.hasOwn(currentTypes, mediaType)) {
      findings.add(BREAKING, mediaPointer, `removed ${direction} content type ${mediaType}`);
      continue;
    }
    compareSchemaPair(
      baseDoc,
      currentDoc,
      baseTypes[mediaType]?.schema,
      currentTypes[mediaType]?.schema,
      `${mediaPointer}/schema`,
      findings,
      direction,
    );
  }
  for (const mediaType of Object.keys(currentTypes)) {
    if (Object.hasOwn(baseTypes, mediaType)) continue;
    findings.add(
      NON_BREAKING,
      `${pointer}/${escapePointer(mediaType)}`,
      `added ${direction} content type ${mediaType}`,
    );
  }
}

function collectParameters(document, pathItem, operation) {
  const parameters = new Map();
  const add = (entry) => {
    const resolved = resolveRefs(document, entry);
    if (!isObject(resolved)) return;
    if (typeof resolved.name !== "string" || typeof resolved.in !== "string") return;
    parameters.set(`${resolved.in}:${resolved.name}`, resolved);
  };
  if (Array.isArray(pathItem.parameters)) {
    for (const entry of pathItem.parameters) add(entry);
  }
  if (Array.isArray(operation.parameters)) {
    for (const entry of operation.parameters) add(entry);
  }
  return parameters;
}

function compareParameters(
  baseDoc,
  currentDoc,
  baseItem,
  baseOperation,
  currentItem,
  currentOperation,
  pointer,
  findings,
) {
  const baseParameters = collectParameters(baseDoc, baseItem, baseOperation);
  const currentParameters = collectParameters(currentDoc, currentItem, currentOperation);
  const where = `${pointer}/parameters`;

  for (const [key, baseParameter] of baseParameters) {
    const parameterPointer = `${where}/${escapePointer(key)}`;
    const currentParameter = currentParameters.get(key);
    if (currentParameter === undefined) {
      findings.add(
        BREAKING,
        parameterPointer,
        `removed ${baseParameter.in} parameter ${baseParameter.name}`,
      );
      continue;
    }
    if (baseParameter.required !== true && currentParameter.required === true) {
      findings.add(
        BREAKING,
        parameterPointer,
        `${baseParameter.in} parameter ${baseParameter.name} became required`,
      );
    } else if (baseParameter.required === true && currentParameter.required !== true) {
      findings.add(
        NON_BREAKING,
        parameterPointer,
        `${baseParameter.in} parameter ${baseParameter.name} is now optional`,
      );
    }
    compareSchemaPair(
      baseDoc,
      currentDoc,
      baseParameter.schema,
      currentParameter.schema,
      `${parameterPointer}/schema`,
      findings,
      "request",
    );
  }

  for (const [key, currentParameter] of currentParameters) {
    if (baseParameters.has(key)) continue;
    const parameterPointer = `${where}/${escapePointer(key)}`;
    if (currentParameter.in === "path") {
      findings.add(BREAKING, parameterPointer, `added path parameter ${currentParameter.name}`);
    } else if (currentParameter.required === true) {
      findings.add(
        BREAKING,
        parameterPointer,
        `added required ${currentParameter.in} parameter ${currentParameter.name}`,
      );
    } else {
      findings.add(
        NON_BREAKING,
        parameterPointer,
        `added optional ${currentParameter.in} parameter ${currentParameter.name}`,
      );
    }
  }
}

function compareRequestBody(
  baseDoc,
  currentDoc,
  baseOperation,
  currentOperation,
  pointer,
  findings,
) {
  const where = `${pointer}/requestBody`;
  const baseBody = resolveRefs(baseDoc, baseOperation.requestBody);
  const currentBody = resolveRefs(currentDoc, currentOperation.requestBody);
  if (baseBody === undefined && currentBody === undefined) return;
  if (baseBody === undefined) {
    if (!isObject(currentBody)) return;
    findings.add(
      currentBody.required === true ? BREAKING : NON_BREAKING,
      where,
      currentBody.required === true ? "added required request body" : "added optional request body",
    );
    compareContent(
      baseDoc,
      currentDoc,
      undefined,
      currentBody.content,
      `${where}/content`,
      findings,
      "request",
    );
    return;
  }
  if (currentBody === undefined) {
    findings.add(BREAKING, where, "removed request body");
    return;
  }
  if (!isObject(baseBody) || !isObject(currentBody)) return;
  if (baseBody.required !== true && currentBody.required === true) {
    findings.add(BREAKING, where, "request body became required");
  } else if (baseBody.required === true && currentBody.required !== true) {
    findings.add(NON_BREAKING, where, "request body is now optional");
  }
  compareContent(
    baseDoc,
    currentDoc,
    baseBody.content,
    currentBody.content,
    `${where}/content`,
    findings,
    "request",
  );
}

function compareResponses(baseDoc, currentDoc, baseOperation, currentOperation, pointer, findings) {
  const where = `${pointer}/responses`;
  const baseResponses = isObject(baseOperation.responses) ? baseOperation.responses : {};
  const currentResponses = isObject(currentOperation.responses) ? currentOperation.responses : {};

  for (const status of Object.keys(baseResponses)) {
    const statusPointer = `${where}/${escapePointer(status)}`;
    if (!Object.hasOwn(currentResponses, status)) {
      findings.add(BREAKING, statusPointer, `removed response ${status}`);
      continue;
    }
    const baseResponse = resolveRefs(baseDoc, baseResponses[status]);
    const currentResponse = resolveRefs(currentDoc, currentResponses[status]);
    if (!isObject(baseResponse) || !isObject(currentResponse)) continue;
    compareContent(
      baseDoc,
      currentDoc,
      baseResponse.content,
      currentResponse.content,
      `${statusPointer}/content`,
      findings,
      "response",
    );
  }

  for (const status of Object.keys(currentResponses)) {
    if (Object.hasOwn(baseResponses, status)) continue;
    findings.add(NON_BREAKING, `${where}/${escapePointer(status)}`, `added response ${status}`);
  }
}

function effectiveSecurity(document, pathItem, operation) {
  if (Array.isArray(operation?.security)) return operation.security;
  if (Array.isArray(pathItem?.security)) return pathItem.security;
  return Array.isArray(document?.security) ? document.security : [];
}

function securitySchemes(requirements) {
  const schemes = new Set();
  for (const requirement of requirements) {
    if (!isObject(requirement)) continue;
    for (const name of Object.keys(requirement)) schemes.add(name);
  }
  return schemes;
}

function securityPointer(document, path, method, pathItem, operation) {
  const base = pathPointer(path);
  if (Array.isArray(operation?.security)) return `${base}/${method}/security`;
  if (Array.isArray(pathItem?.security)) return `${base}/security`;
  return Array.isArray(document?.security) ? "#/security" : `${base}/${method}/security`;
}

function compareSecurity(
  baseDoc,
  currentDoc,
  path,
  method,
  baseItem,
  baseOperation,
  currentItem,
  currentOperation,
  findings,
) {
  const baseSchemes = securitySchemes(effectiveSecurity(baseDoc, baseItem, baseOperation));
  const currentSchemes = securitySchemes(
    effectiveSecurity(currentDoc, currentItem, currentOperation),
  );
  const pointer = securityPointer(baseDoc, path, method, baseItem, baseOperation);
  for (const scheme of currentSchemes) {
    if (!baseSchemes.has(scheme)) {
      findings.add(BREAKING, pointer, `added security requirement ${scheme}`);
    }
  }
  for (const scheme of baseSchemes) {
    if (!currentSchemes.has(scheme)) {
      findings.add(NON_BREAKING, pointer, `removed security requirement ${scheme}`);
    }
  }
}

function compareOperation(baseDoc, currentDoc, path, method, baseItem, currentItem, findings) {
  const baseOperation = baseItem[method];
  const currentOperation = currentItem[method];
  const pointer = operationPointer(path, method);

  compareParameters(
    baseDoc,
    currentDoc,
    baseItem,
    baseOperation,
    currentItem,
    currentOperation,
    pointer,
    findings,
  );
  compareRequestBody(baseDoc, currentDoc, baseOperation, currentOperation, pointer, findings);
  compareResponses(baseDoc, currentDoc, baseOperation, currentOperation, pointer, findings);
  compareSecurity(
    baseDoc,
    currentDoc,
    path,
    method,
    baseItem,
    baseOperation,
    currentItem,
    currentOperation,
    findings,
  );
}

export function diffSpecs(baseline, current) {
  const findings = createFindings();
  const basePaths = isObject(baseline?.paths) ? baseline.paths : {};
  const currentPaths = isObject(current?.paths) ? current.paths : {};

  for (const path of Object.keys(basePaths)) {
    if (!Object.hasOwn(currentPaths, path)) {
      findings.add(BREAKING, pathPointer(path), "removed path");
      continue;
    }
    const baseItem = isObject(basePaths[path]) ? basePaths[path] : {};
    const currentItem = isObject(currentPaths[path]) ? currentPaths[path] : {};
    for (const method of HTTP_METHODS) {
      const baseOperation = baseItem[method];
      const currentOperation = currentItem[method];
      if (baseOperation !== undefined && currentOperation === undefined) {
        findings.add(
          BREAKING,
          operationPointer(path, method),
          `removed ${method.toUpperCase()} operation`,
        );
      } else if (baseOperation === undefined && currentOperation !== undefined) {
        findings.add(
          NON_BREAKING,
          operationPointer(path, method),
          `added ${method.toUpperCase()} operation`,
        );
      } else if (isObject(baseOperation) && isObject(currentOperation)) {
        compareOperation(baseline, current, path, method, baseItem, currentItem, findings);
      }
    }
  }

  for (const path of Object.keys(currentPaths)) {
    if (Object.hasOwn(basePaths, path)) continue;
    findings.add(NON_BREAKING, pathPointer(path), "added path");
  }

  return findings.list();
}

function parseOptions(argv) {
  const options = {
    baseline: resolve(ROOT, DEFAULT_BASELINE),
    current: resolve(ROOT, DEFAULT_CURRENT),
    update: false,
    json: false,
  };
  const takeValue = (inline, index, flag) => {
    const value = inline ?? argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a path`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--update") {
      options.update = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    const equals = argument.indexOf("=");
    const flag = equals >= 0 ? argument.slice(0, equals) : argument;
    const inline = equals >= 0 ? argument.slice(equals + 1) : undefined;
    if (flag === "--baseline") {
      options.baseline = resolve(takeValue(inline, index, flag));
      if (inline === undefined) index += 1;
      continue;
    }
    if (flag === "--current") {
      options.current = resolve(takeValue(inline, index, flag));
      if (inline === undefined) index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function readSpec(path) {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${relative(ROOT, path)}: ${messageOf(error)}`);
  }
}

if (import.meta.main) {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`spec:compat: ${messageOf(error)}`);
    process.exit(2);
  }

  if (options.update) {
    try {
      mkdirSync(dirname(options.baseline), { recursive: true });
      copyFileSync(options.current, options.baseline);
    } catch (error) {
      console.error(`spec:baseline: ${messageOf(error)}`);
      process.exit(2);
    }
    console.log(
      `spec:baseline: wrote ${relative(ROOT, options.baseline)} from ${relative(ROOT, options.current)}`,
    );
    process.exit(0);
  }

  let findings;
  try {
    findings = diffSpecs(readSpec(options.baseline), readSpec(options.current));
  } catch (error) {
    console.error(`spec:compat: ${messageOf(error)}`);
    process.exit(2);
  }

  const breaking = findings.filter((finding) => finding.severity === BREAKING).length;
  const nonBreaking = findings.length - breaking;

  if (options.json) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    console.log(`spec:compat: ${breaking} breaking, ${nonBreaking} non-breaking`);
    for (const finding of findings) {
      const label = finding.severity === BREAKING ? "breaking" : "ok      ";
      console.log(`  ${label}  ${finding.path}  ${finding.message}`);
    }
  }

  process.exit(breaking > 0 ? 1 : 0);
}
