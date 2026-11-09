import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { diffSpecs } from "./compat.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPAT_PATH = resolve(HERE, "compat.mjs");
const RESPONSE_SCHEMA = "#/paths/~1v1~1things/get/responses/200/content/application~1json/schema";

function makeSpec() {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/things": {
        get: {
          operationId: "listThings",
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 200 },
            },
          ],
          responses: {
            200: {
              description: "Things",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Thing" } },
              },
            },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
    },
    components: {
      responses: {
        NotFound: {
          description: "Missing",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Error" } },
          },
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string" } },
        },
        Thing: {
          type: "object",
          required: ["id", "kind"],
          properties: {
            id: { type: "string", format: "uuid" },
            kind: { $ref: "#/components/schemas/Kind" },
            value: { oneOf: [{ type: "string" }, { type: "number" }] },
          },
        },
        Kind: { type: "string", enum: ["alpha", "beta"] },
      },
    },
  };
}

function breaking(findings) {
  return findings.filter((finding) => finding.severity === "breaking");
}

function nonBreaking(findings) {
  return findings.filter((finding) => finding.severity === "non-breaking");
}

function writeTempSpec(directory, name, document) {
  const path = join(directory, name);
  writeFileSync(path, stringify(document));
  return path;
}

describe("spec compat", () => {
  test("an unchanged spec has no findings", () => {
    expect(diffSpecs(makeSpec(), makeSpec())).toEqual([]);
  });

  test("removing a path is breaking", () => {
    const current = makeSpec();
    delete current.paths["/v1/things"];
    expect(diffSpecs(makeSpec(), current)).toEqual([
      {
        severity: "breaking",
        path: "#/paths/~1v1~1things",
        message: "removed path",
      },
    ]);
  });

  test("removing a method is breaking", () => {
    const current = makeSpec();
    delete current.paths["/v1/things"].get;
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: "#/paths/~1v1~1things/get",
      message: "removed GET operation",
    });
  });

  test("adding a required query parameter is breaking", () => {
    const current = makeSpec();
    current.paths["/v1/things"].get.parameters.push({
      name: "tenant",
      in: "query",
      required: true,
      schema: { type: "string" },
    });
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: "#/paths/~1v1~1things/get/parameters/query:tenant",
      message: "added required query parameter tenant",
    });
  });

  test("adding a path parameter is breaking even when it is not marked required", () => {
    const current = makeSpec();
    current.paths["/v1/things"].get.parameters.push({
      name: "thingId",
      in: "path",
      required: false,
      schema: { type: "string" },
    });
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: "#/paths/~1v1~1things/get/parameters/path:thingId",
      message: "added path parameter thingId",
    });
  });

  test("removing a parameter is breaking", () => {
    const current = makeSpec();
    current.paths["/v1/things"].get.parameters = [];
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: "#/paths/~1v1~1things/get/parameters/query:limit",
      message: "removed query parameter limit",
    });
  });

  test("changing a request property type is breaking", () => {
    const current = makeSpec();
    current.components.schemas.Thing.properties.id.type = "integer";
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: `${RESPONSE_SCHEMA}/properties/id`,
      message: "type changed from string to integer",
    });
  });

  test("removing a response property is breaking", () => {
    const current = makeSpec();
    delete current.components.schemas.Thing.properties.kind;
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: `${RESPONSE_SCHEMA}/properties/kind`,
      message: "removed property kind",
    });
  });

  test("narrowing an enum is breaking", () => {
    const current = makeSpec();
    current.components.schemas.Kind.enum = ["alpha"];
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: `${RESPONSE_SCHEMA}/properties/kind`,
      message: 'removed enum value "beta"',
    });
  });

  test("removing a oneOf variant is breaking", () => {
    const current = makeSpec();
    current.components.schemas.Thing.properties.value.oneOf = [{ type: "string" }];
    expect(diffSpecs(makeSpec(), current)).toContainEqual({
      severity: "breaking",
      path: `${RESPONSE_SCHEMA}/properties/value/oneOf/1`,
      message: "removed oneOf variant 2",
    });
  });

  test("a new path, an optional property and a new enum value are non-breaking", () => {
    const current = makeSpec();
    current.paths["/v1/other"] = {
      get: { operationId: "getOther", responses: { 200: { description: "ok" } } },
    };
    current.components.schemas.Thing.properties.note = { type: "string" };
    current.components.schemas.Kind.enum.push("gamma");
    const findings = diffSpecs(makeSpec(), current);
    expect(breaking(findings)).toEqual([]);
    expect(findings).toHaveLength(3);
    expect(
      nonBreaking(findings)
        .map((finding) => finding.message)
        .sort(),
    ).toEqual(['added enum value "gamma"', "added optional property note", "added path"]);
  });

  test("renaming a component with the same shape has no findings", () => {
    const current = makeSpec();
    current.components.schemas.Widget = current.components.schemas.Thing;
    delete current.components.schemas.Thing;
    current.components.schemas.Category = current.components.schemas.Kind;
    delete current.components.schemas.Kind;
    current.components.schemas.Widget.properties.kind = {
      $ref: "#/components/schemas/Category",
    };
    current.paths["/v1/things"].get.responses["200"].content["application/json"].schema = {
      $ref: "#/components/schemas/Widget",
    };
    expect(diffSpecs(makeSpec(), current)).toEqual([]);
  });

  test("adding a security requirement is breaking and removing one is non-breaking", () => {
    const base = makeSpec();
    const stricter = makeSpec();
    stricter.security = [{ apiKey: [], subjectId: [] }];
    expect(diffSpecs(base, stricter)).toContainEqual({
      severity: "breaking",
      path: "#/security",
      message: "added security requirement subjectId",
    });
    expect(diffSpecs(stricter, base)).toContainEqual({
      severity: "non-breaking",
      path: "#/security",
      message: "removed security requirement subjectId",
    });
  });

  test("cyclic refs terminate and report the real change", () => {
    const base = makeSpec();
    const current = makeSpec();
    for (const spec of [base, current]) {
      spec.components.schemas.Node = {
        type: "object",
        properties: {
          label: { type: "string" },
          child: { $ref: "#/components/schemas/Node" },
        },
      };
      spec.components.schemas.Thing.properties.node = {
        $ref: "#/components/schemas/Node",
      };
    }
    current.components.schemas.Node.properties.extra = { type: "string" };
    const findings = diffSpecs(base, current);
    expect(breaking(findings)).toEqual([]);
    expect(findings.map((finding) => finding.message)).toEqual(["added optional property extra"]);
  });

  test("cli exits 1 and emits json for a breaking change", () => {
    const directory = mkdtempSync(join(tmpdir(), "memtavi-compat-"));
    try {
      const baselinePath = writeTempSpec(directory, "baseline.yaml", makeSpec());
      const broken = makeSpec();
      delete broken.paths["/v1/things"];
      const currentPath = writeTempSpec(directory, "current.yaml", broken);
      const result = spawnSync(
        process.execPath,
        [COMPAT_PATH, "--baseline", baselinePath, "--current", currentPath, "--json"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual([
        {
          severity: "breaking",
          path: "#/paths/~1v1~1things",
          message: "removed path",
        },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("cli --update copies the current spec over the baseline", () => {
    const directory = mkdtempSync(join(tmpdir(), "memtavi-compat-"));
    try {
      const baselinePath = writeTempSpec(directory, "baseline.yaml", makeSpec());
      const current = makeSpec();
      current.info.version = "1.1.0";
      const currentPath = writeTempSpec(directory, "current.yaml", current);
      const result = spawnSync(
        process.execPath,
        [COMPAT_PATH, "--baseline", baselinePath, "--current", currentPath, "--update"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(readFileSync(baselinePath, "utf8")).toBe(readFileSync(currentPath, "utf8"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
