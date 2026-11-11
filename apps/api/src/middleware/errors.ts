import { Elysia } from "elysia";

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class RateLimitError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super("RateLimitError", 429, "Rate limit exceeded");
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(
    message: string,
    readonly retryAfterSeconds = 60,
  ) {
    super("ServiceUnavailableError", 503, message);
  }
}

export class UpstreamError extends DomainError {
  constructor(message: string) {
    super("UpstreamError", 502, message);
  }
}

export function errors(now: () => Date, denials: Record<401 | 403 | 404, number>) {
  return new Elysia({ name: "errors" }).onError(
    { as: "global" },
    ({ code, error, request, set }) => {
      const failure =
        error instanceof DomainError
          ? error
          : code === "NOT_FOUND"
            ? new DomainError("NotFoundError", 404, "Not found")
            : code === "PARSE" || code === "VALIDATION"
              ? new DomainError("BadRequestError", 400, "Invalid request")
              : new DomainError("InternalServerError", 500, "Internal server error");
      set.status = failure.status;
      if (failure instanceof RateLimitError || failure instanceof ServiceUnavailableError) {
        set.headers["Retry-After"] = String(failure.retryAfterSeconds);
      }
      if (failure.status === 401 || failure.status === 403 || failure.status === 404) {
        denials[failure.status] += 1;
      }
      return {
        statusCode: failure.status,
        timestamp: now().toISOString(),
        path: new URL(request.url).pathname,
        message: failure.message,
        body: {
          message: failure.message,
          error: failure.code,
          statusCode: failure.status,
        },
      };
    },
  );
}
