import {
  enterSpan,
  extractTraceContext,
  type Span,
  SpanKind,
  SpanStatusCode,
  startSpan,
  telemetryEnabled,
} from "@memtavi/shared/telemetry";
import { Elysia } from "elysia";
import { DomainError } from "./errors";

function finish(
  span: Span,
  request: Request,
  route: string,
  status: number,
  requestId: unknown,
): void {
  const name = route === "" ? "unmatched" : route;
  span.setAttributes({
    "http.route": name,
    "http.response.status_code": status,
    ...(typeof requestId === "string" && requestId !== "" ? { "request.id": requestId } : {}),
  });
  span.updateName(`${request.method} ${name}`);
  if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
}

export function telemetry() {
  const spans = new WeakMap<Request, Span>();

  return new Elysia({ name: "telemetry" })
    .onRequest(({ request }) => {
      if (!telemetryEnabled()) return;
      const parent = extractTraceContext(request.headers.get("traceparent"));
      const span = startSpan(
        `${request.method} request`,
        { "http.request.method": request.method },
        { kind: SpanKind.SERVER, ...(parent === undefined ? {} : { parent }) },
      );
      enterSpan(span, parent);
      spans.set(request, span);
    })
    .onAfterHandle({ as: "global" }, ({ request, set, route }) => {
      const span = spans.get(request);
      if (span === undefined) return;
      spans.delete(request);
      const status = typeof set.status === "number" ? set.status : 200;
      finish(span, request, route, status, set.headers["x-request-id"]);
    })
    .onError({ as: "global" }, ({ request, set, route, error, code }) => {
      const span = spans.get(request);
      if (span === undefined) return;
      spans.delete(request);
      const status =
        error instanceof DomainError
          ? error.status
          : code === "NOT_FOUND"
            ? 404
            : code === "PARSE" || code === "VALIDATION"
              ? 400
              : 500;
      finish(span, request, route, status, set.headers["x-request-id"]);
    });
}
