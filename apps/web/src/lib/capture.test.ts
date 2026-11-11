import { expect, test } from "bun:test";
import type { SourceStatus } from "./api";
import {
  newlyCompleted,
  SOURCE_POLL_CEILING_MS,
  SOURCE_POLL_LIMIT_MS,
  SOURCE_POLL_MS,
  sourcePollingInterval,
  sourceStatusKey,
  sourcesPollingInterval,
  upsertSource,
} from "./capture";

test.each<{
  source: { status: SourceStatus; awaitingApproval?: boolean } | undefined;
  interval: typeof SOURCE_POLL_MS | false;
}>([
  { source: undefined, interval: false },
  { source: { status: "pending" }, interval: SOURCE_POLL_MS },
  { source: { status: "compiling" }, interval: SOURCE_POLL_MS },
  { source: { status: "pending", awaitingApproval: true }, interval: false },
  { source: { status: "completed" }, interval: false },
  { source: { status: "failed" }, interval: false },
])("polling $source uses $interval", ({ source, interval }) => {
  expect(sourcePollingInterval(source)).toBe(interval);
});

test.each<{
  sources: { status: SourceStatus; awaitingApproval?: boolean }[] | undefined;
  interval: typeof SOURCE_POLL_MS | false;
}>([
  { sources: undefined, interval: false },
  { sources: [], interval: false },
  { sources: [{ status: "completed" }, { status: "failed" }], interval: false },
  {
    sources: [{ status: "pending", awaitingApproval: true }, { status: "failed" }],
    interval: false,
  },
  { sources: [{ status: "completed" }, { status: "compiling" }], interval: SOURCE_POLL_MS },
  { sources: [{ status: "pending" }], interval: SOURCE_POLL_MS },
])("queue polling stops when every source is settled: $interval", ({ sources, interval }) => {
  expect(sourcesPollingInterval(sources)).toBe(interval);
});

const active = [{ status: "pending" as const }];

test.each<{ elapsed: number; interval: number | false }>([
  { elapsed: 0, interval: SOURCE_POLL_MS },
  { elapsed: SOURCE_POLL_MS - 1, interval: SOURCE_POLL_MS },
  { elapsed: SOURCE_POLL_MS, interval: SOURCE_POLL_MS * 2 },
  { elapsed: SOURCE_POLL_MS + SOURCE_POLL_MS * 2 - 1, interval: SOURCE_POLL_MS * 2 },
  { elapsed: 4_500, interval: SOURCE_POLL_MS * 4 },
  { elapsed: 10_500, interval: SOURCE_POLL_MS * 8 },
  { elapsed: 22_500, interval: SOURCE_POLL_MS * 16 },
  { elapsed: 46_500, interval: SOURCE_POLL_CEILING_MS },
  { elapsed: SOURCE_POLL_LIMIT_MS - 1, interval: SOURCE_POLL_CEILING_MS },
  { elapsed: SOURCE_POLL_LIMIT_MS, interval: false },
  { elapsed: SOURCE_POLL_LIMIT_MS + 1, interval: false },
])("active queue elapsed $elapsed polls at $interval", ({ elapsed, interval }) => {
  expect(sourcesPollingInterval(active, elapsed)).toBe(interval);
  expect(sourcesPollingInterval([{ status: "compiling" }], elapsed)).toBe(interval);
});

test("settled sources stay stopped after the quiet limit", () => {
  expect(sourcesPollingInterval([{ status: "completed" }], SOURCE_POLL_LIMIT_MS)).toBe(false);
  expect(sourcesPollingInterval([{ status: "failed" }], 0)).toBe(false);
  expect(
    sourcesPollingInterval([{ status: "pending", awaitingApproval: true }], SOURCE_POLL_MS),
  ).toBe(false);
});

test("a status change starts the short interval again", () => {
  const pending = [{ id: "src_a", status: "pending" as const }];
  const compiling = [{ id: "src_a", status: "compiling" as const }];
  const elapsed =
    sourceStatusKey(pending) === sourceStatusKey(compiling) ? SOURCE_POLL_LIMIT_MS : 0;
  expect(sourcesPollingInterval(compiling, elapsed)).toBe(SOURCE_POLL_MS);
});

test("the same statuses keep a long quiet interval, so polling stops", () => {
  const pending = [{ id: "src_a", status: "pending" as const }];
  const again = [{ id: "src_a", status: "pending" as const, awaitingApproval: false }];
  const elapsed = sourceStatusKey(pending) === sourceStatusKey(again) ? SOURCE_POLL_LIMIT_MS : 0;
  expect(sourcesPollingInterval(again, elapsed)).toBe(false);
});

test("source order is not a status change", () => {
  const pending = { id: "src_a", status: "pending" as const };
  const compiling = { id: "src_b", status: "compiling" as const };
  expect(sourceStatusKey([pending, compiling])).toBe(sourceStatusKey([compiling, pending]));
});

test("leaving approval is a status change and starts the short interval again", () => {
  const waiting = [{ id: "src_a", status: "pending" as const, awaitingApproval: true }];
  const released = [{ id: "src_a", status: "pending" as const }];
  const elapsed = sourceStatusKey(waiting) === sourceStatusKey(released) ? SOURCE_POLL_LIMIT_MS : 0;
  expect(elapsed).toBe(0);
  expect(sourcesPollingInterval(released, elapsed)).toBe(SOURCE_POLL_MS);
});

test("the first observation of a completed source does not count as a transition", () => {
  expect(newlyCompleted(new Map(), [{ id: "src_a", status: "completed" }])).toEqual([]);
});

test("a source that leaves an in-progress status for completed is newly completed", () => {
  expect(
    newlyCompleted(new Map([["src_a", "compiling"]]), [
      { id: "src_a", status: "completed" },
      { id: "src_b", status: "completed" },
    ]),
  ).toEqual([{ id: "src_a", status: "completed" }]);
});

test("an already completed source is not completed again", () => {
  expect(
    newlyCompleted(new Map([["src_a", "completed"]]), [{ id: "src_a", status: "completed" }]),
  ).toEqual([]);
});

test("upsert leaves a missing list untouched", () => {
  expect(upsertSource(undefined, { id: "src_a" })).toBeUndefined();
});

test("upsert replaces an existing source without changing the total", () => {
  expect(
    upsertSource(
      { items: [{ id: "src_a", status: "failed" }], total: 4, limit: 50, offset: 0 },
      { id: "src_a", status: "pending" },
    ),
  ).toEqual({ items: [{ id: "src_a", status: "pending" }], total: 4, limit: 50, offset: 0 });
});

test("upsert prepends a new source and increments the total", () => {
  expect(
    upsertSource({ items: [{ id: "src_b" }], total: 1, limit: 50, offset: 0 }, { id: "src_a" }),
  ).toEqual({
    items: [{ id: "src_a" }, { id: "src_b" }],
    total: 2,
    limit: 50,
    offset: 0,
  });
});
