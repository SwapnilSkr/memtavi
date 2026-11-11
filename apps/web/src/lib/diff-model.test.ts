import { expect, test } from "bun:test";
import { diffRows, orderedVersions } from "./diff-model";

test("diff rows mark additions and removals with text as well as an operation", () => {
  expect(
    diffRows([
      { op: "context", text: "same" },
      { op: "remove", text: "old" },
      { op: "add", text: "new" },
    ]),
  ).toEqual([
    { key: "0:context:same", op: "context", text: "same", marker: " ", label: "unchanged" },
    { key: "1:remove:old", op: "remove", text: "old", marker: "−", label: "removed" },
    { key: "2:add:new", op: "add", text: "new", marker: "+", label: "added" },
  ]);
});

test("an empty hunk has no rows", () => {
  expect(diffRows([])).toEqual([]);
});

test.each([
  { from: 1, to: 2, ordered: true },
  { from: 2, to: 2, ordered: false },
  { from: 3, to: 2, ordered: false },
  { from: 0, to: 1, ordered: false },
  { from: 1.5, to: 2, ordered: false },
])("versions $from to $to are comparable: $ordered", ({ from, to, ordered }) => {
  expect(orderedVersions(from, to)).toBe(ordered);
});
