import { describe, expect, test } from "bun:test";
import { newId } from "./ids";

const cases = [
  ["brain", "brn"],
  ["source", "src"],
  ["page", "pg"],
  ["connection", "cnn"],
  ["change", "chg"],
] as const;

describe("newId", () => {
  test.each(cases)("formats a %s id with the %s prefix", (kind, prefix) => {
    const id = newId(kind);
    expect(id).toMatch(new RegExp(`^${prefix}_[0-9a-f]{32}$`));
    expect(id).toBe(id.toLowerCase());
  });

  test("returns a different id on each call", () => {
    expect(newId("brain")).not.toBe(newId("brain"));
  });
});
