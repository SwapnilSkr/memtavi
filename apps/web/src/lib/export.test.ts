import { expect, test } from "bun:test";
import { exportFilename } from "./export";

test.each([
  ["research-2026", "research-2026.json"],
  ["My Brain / Notes", "my-brain-notes.json"],
  ["  Leading and trailing  ", "leading-and-trailing.json"],
  ["...", "brain.json"],
  ["", "brain.json"],
  ["a/b\\c:d*e", "a-b-c-d-e.json"],
])("builds a JSON filename from the brain slug %p", (slug, expected) => {
  expect(exportFilename(slug)).toBe(expected);
});
