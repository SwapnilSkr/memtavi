import { expect, test } from "bun:test";
import { buildPageUpdate } from "./page-update";

const original = { title: "Original", summary: "Summary", body: "# Body", version: 7 };

test("an unchanged page includes only its version", () => {
  expect(buildPageUpdate(original, { ...original })).toEqual({ version: 7 });
});

test.each([{ title: "New title" }, { summary: "" }, { body: "# Revised\n\nBody\n" }])(
  "a partial update sends only changed fields and the original version: %j",
  (edited) => {
    expect(buildPageUpdate(original, { ...original, ...edited })).toEqual({
      ...edited,
      version: 7,
    });
  },
);

test("multiple changes preserve Markdown whitespace and do not copy unrelated fields", () => {
  expect(
    buildPageUpdate(original, {
      title: "Revised",
      summary: "",
      body: "  indented\n\n",
    }),
  ).toEqual({ title: "Revised", summary: "", body: "  indented\n\n", version: 7 });
});
