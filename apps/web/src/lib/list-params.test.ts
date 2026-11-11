import { expect, test } from "bun:test";
import { listSearchParams, parseOffset, parsePageStatus } from "./list-params";

test.each([
  { value: null, offset: 0 },
  { value: "", offset: 0 },
  { value: "0", offset: 0 },
  { value: "50", offset: 50 },
  { value: "-1", offset: 0 },
  { value: "1.5", offset: 0 },
  { value: "nope", offset: 0 },
  { value: "9007199254740993", offset: 0 },
])("offset $value parses to $offset", ({ value, offset }) => {
  expect(parseOffset(value)).toBe(offset);
});

test.each([
  { value: null, status: undefined },
  { value: "contested", status: "contested" },
  { value: "active", status: "active" },
  { value: "nope", status: undefined },
])("status $value parses to $status", ({ value, status }) => {
  expect(parsePageStatus(value)).toBe(status);
});

test("list params keep a status when returning to the first page", () => {
  expect(listSearchParams("contested", 0)).toEqual({ status: "contested" });
  expect(listSearchParams("stale", 50)).toEqual({ status: "stale", offset: "50" });
  expect(listSearchParams(undefined, 0)).toEqual({});
});
