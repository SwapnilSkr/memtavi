import type { Logger } from "@memtavi/shared/logging";
import { createLogger } from "@memtavi/shared/logging";
import { currentTraceId } from "@memtavi/shared/telemetry";
import { Elysia } from "elysia";

export function requestLog(logger?: Logger) {
  const log = logger ?? createLogger();
  const starts = new WeakMap<Request, number>();

  return new Elysia({ name: "request-log" })
    .onRequest(({ request }) => {
      starts.set(request, Date.now());
    })
    .onAfterResponse({ as: "global" }, ({ request, set }) => {
      const start = starts.get(request);
      if (start === undefined) return;
      starts.delete(request);
      const status = typeof set.status === "number" ? set.status : 200;
      const fields = {
        requestId: String(set.headers["x-request-id"] ?? request.headers.get("x-request-id") ?? ""),
        traceId: currentTraceId(),
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        durationMs: Date.now() - start,
      };
      if (status >= 500) log.error(fields, "request");
      else log.info(fields, "request");
    });
}
