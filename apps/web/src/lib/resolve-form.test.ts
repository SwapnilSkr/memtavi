import { expect, test } from "bun:test";
import { pageResolveBody } from "./resolve-form";

test.each([
  { note: "", body: "Edited", expected: undefined },
  { note: "   ", body: "", expected: undefined },
  { note: " Keep both ", body: "", expected: { note: "Keep both" } },
  { note: " Keep both ", body: "   ", expected: { note: "Keep both" } },
  {
    note: " Rewritten ",
    body: "  The revised page  ",
    expected: { note: "Rewritten", body: "  The revised page  " },
  },
])("resolve note $note", ({ note, body, expected }) => {
  expect(pageResolveBody(note, body)).toEqual(expected);
});
