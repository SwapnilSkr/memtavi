import type { SourceStatus } from "./api";

export function sourcePollingInterval(status: SourceStatus | undefined): 1500 | false {
  return status === "pending" || status === "compiling" ? 1500 : false;
}
