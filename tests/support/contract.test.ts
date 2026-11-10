import { describe, expect, test } from "bun:test";
import { ContractViolation, createContract } from "./contract";

interface FakeSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, FakeSchema>;
  additionalProperties?: boolean;
  $ref?: string;
}

interface FakeResponse {
  description?: string;
  headers?: Record<string, unknown>;
  content?: Record<string, { schema: FakeSchema }>;
  $ref?: string;
}

interface FakeOperation {
  operationId: string;
  responses: Record<string, FakeResponse>;
}

interface FakeSpec {
  openapi: string;
  paths: Record<string, Record<string, FakeOperation>>;
  components: { responses: Record<string, FakeResponse>; schemas: Record<string, FakeSchema> };
}

function jsonResponse(body: unknown, status = 200, requestId = "req-1"): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (requestId !== "") headers["x-request-id"] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function widgetSpec(): FakeSpec {
  return {
    openapi: "3.1.0",
    paths: {
      "/widgets": {
        get: {
          operationId: "listWidgets",
          responses: {
            "200": {
              description: "Widgets",
              headers: { "x-request-id": { schema: { type: "string" } } },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id"],
                    properties: { id: { type: "string" } },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
    },
    components: {
      responses: {
        NotFound: {
          description: "Not found",
          headers: { "x-request-id": { schema: { type: "string" } } },
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: { message: { type: "string" } },
              },
            },
          },
        },
      },
      schemas: {},
    },
  };
}

describe("contract harness", () => {
  test("coverage reports a documented operation that was never validated", () => {
    const spec = widgetSpec();
    spec.paths["/gadgets"] = {
      get: {
        operationId: "listGadgets",
        responses: {
          "200": {
            description: "Gadgets",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    };

    const contract = createContract(spec);
    expect(contract.operations()).toEqual(["listGadgets", "listWidgets"]);
    expect(contract.coverage()).toEqual([
      { operationId: "listGadgets", status: 200 },
      { operationId: "listWidgets", status: 200 },
      { operationId: "listWidgets", status: 404 },
    ]);

    contract.expectContract(
      jsonResponse({ id: "w" }),
      { id: "w" },
      {
        method: "GET",
        path: "/widgets",
      },
    );
    expect(contract.validated("listWidgets", 200)).toBe(true);
    expect(contract.coverage()).toEqual([
      { operationId: "listGadgets", status: 200 },
      { operationId: "listWidgets", status: 404 },
    ]);
  });

  test("strict mode rejects a property the spec does not document", () => {
    const contract = createContract(widgetSpec());
    const body = { id: "w", leaked: true };
    expect(() =>
      contract.expectContract(jsonResponse(body), body, { method: "GET", path: "/widgets" }),
    ).toThrow(ContractViolation);
    expect(() =>
      contract.expectContract(jsonResponse(body), body, { method: "GET", path: "/widgets" }),
    ).toThrow(/does not match the spec/);
  });

  test("strict mode follows a $ref into a component schema", () => {
    const spec = widgetSpec();
    spec.components.schemas.Widget = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    };
    const response = spec.paths["/widgets"]?.get?.responses["200"];
    if (response?.content) {
      response.content["application/json"] = { schema: { $ref: "#/components/schemas/Widget" } };
    }
    const contract = createContract(spec);
    const body = { id: "w", leaked: true };
    expect(() =>
      contract.expectContract(jsonResponse(body), body, { method: "GET", path: "/widgets" }),
    ).toThrow(/does not match the spec/);
  });

  test("an explicit additionalProperties: true still allows extra keys", () => {
    const spec = widgetSpec();
    const schema = spec.paths["/widgets"]?.get?.responses["200"]?.content?.["application/json"];
    if (schema) {
      schema.schema = {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        additionalProperties: true,
      };
    }
    const contract = createContract(spec);
    const body = { id: "w", extra: true };
    expect(() =>
      contract.expectContract(jsonResponse(body), body, { method: "GET", path: "/widgets" }),
    ).not.toThrow();
  });

  test("an undocumented status is a violation", () => {
    const contract = createContract(widgetSpec());
    expect(() =>
      contract.expectContract(
        jsonResponse({ message: "boom" }, 500),
        { message: "boom" },
        {
          method: "GET",
          path: "/widgets",
        },
      ),
    ).toThrow(/returned 500; documented statuses are 200, 404/);
  });

  test("a response without x-request-id is a violation", () => {
    const contract = createContract(widgetSpec());
    expect(() =>
      contract.expectContract(
        jsonResponse({ id: "w" }, 200, ""),
        { id: "w" },
        {
          method: "GET",
          path: "/widgets",
        },
      ),
    ).toThrow(/missing the x-request-id header/);
  });
});
