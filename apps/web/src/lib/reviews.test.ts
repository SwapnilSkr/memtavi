import { expect, test } from "bun:test";
import { reviewDismissBody, reviewResolveBody } from "./reviews";

test.each([
  { placement: "", note: "because", body: undefined },
  { placement: "new", note: "", body: { newPage: true } },
  { placement: "new", note: "  keep separate  ", body: { newPage: true, note: "keep separate" } },
  { placement: "pg_1", note: "", body: { pageId: "pg_1" } },
  { placement: "pg_1", note: " because ", body: { pageId: "pg_1", note: "because" } },
])("resolve placement $placement note $note", ({ placement, note, body }) => {
  expect(reviewResolveBody(placement, note)).toEqual(body);
});

test.each([
  { note: "", body: undefined },
  { note: "   ", body: undefined },
  { note: " keep the source ", body: { note: "keep the source" } },
])("dismiss note $note", ({ note, body }) => {
  expect(reviewDismissBody(note)).toEqual(body);
});
