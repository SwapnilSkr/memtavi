import { expect, test } from "bun:test";
import type { SourceStatus } from "./api";
import { sourcePollingInterval } from "./capture";

test.each<{ status: SourceStatus | undefined; interval: 1500 | false }>([
  { status: undefined, interval: false },
  { status: "pending", interval: 1500 },
  { status: "compiling", interval: 1500 },
  { status: "completed", interval: false },
  { status: "failed", interval: false },
])("polling $status uses $interval", ({ status, interval }) => {
  expect(sourcePollingInterval(status)).toBe(interval);
});
