import { expect, test } from "bun:test";
import { parseDirectives } from "./profile";

test.each(["", " ", "\n\t"])("empty directives become an empty object: %j", (text) => {
  expect(parseDirectives(text)).toEqual({ valid: true, value: {} });
});

test("valid directives preserve nested objects, arrays and scalar values", () => {
  const result = parseDirectives(
    '{"tone":"brief","limits":{"count":2},"topics":["a"],"enabled":true,"none":null}',
  );
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error(result.message);
  expect(result.value.tone).toBe("brief");
  expect(result.value.limits).toEqual({ count: 2 });
  expect(result.value.topics).toEqual(["a"]);
  expect(result.value.enabled).toBe(true);
  expect(result.value.none).toBeNull();
});

test.each(['{"broken":', '{"trailing": true,}', "undefined"])(
  "invalid JSON is rejected: %s",
  (text) => {
    const result = parseDirectives(text);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected validation failure");
    expect(result.message).toContain("valid JSON");
  },
);

test.each(["null", "[]", '"text"', "42", "true"])("non-object JSON is rejected: %s", (text) => {
  const result = parseDirectives(text);
  expect(result.valid).toBe(false);
  if (result.valid) throw new Error("Expected validation failure");
  expect(result.message).toContain("JSON object");
});
