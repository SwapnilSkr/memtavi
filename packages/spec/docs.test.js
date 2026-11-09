import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { renderDocs } from "./docs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(HERE, "openapi.yaml");
const DOCS_PATH = resolve(HERE, "../../docs/API.md");

function spec() {
  return parse(readFileSync(SPEC_PATH, "utf8"));
}

describe("spec docs", () => {
  test("renders identical bytes on every run", () => {
    expect(renderDocs(spec())).toBe(renderDocs(spec()));
  });

  test("orders paths first, then methods", () => {
    const output = renderDocs(spec());
    const apiKeys = output.indexOf("### GET /v1/api-keys");
    const brains = output.indexOf("### GET /v1/brains\n");
    const createBrain = output.indexOf("### POST /v1/brains\n");
    expect(apiKeys).toBeGreaterThan(-1);
    expect(brains).toBeGreaterThan(-1);
    expect(createBrain).toBeGreaterThan(-1);
    expect(apiKeys).toBeLessThan(brains);
    expect(brains).toBeLessThan(createBrain);
  });

  test("checked-in docs match the spec", () => {
    expect(renderDocs(spec())).toBe(readFileSync(DOCS_PATH, "utf8"));
  });
});
