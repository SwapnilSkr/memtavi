import { Elysia } from "elysia";

export const requestId = new Elysia({ name: "request-id" })
  .onRequest(({ request, set }) => {
    set.headers["x-request-id"] = request.headers.get("x-request-id") ?? crypto.randomUUID();
  })
  .derive({ as: "global" }, ({ set }) => ({
    requestId: String(set.headers["x-request-id"]),
  }));
