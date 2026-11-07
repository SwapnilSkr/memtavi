import { Elysia } from "elysia";
import type { AppConfig } from "./lib/config";
import { errors } from "./middleware/errors";
import { requestId } from "./middleware/request-id";
import { apiKeyRoutes } from "./routes/api-keys";
import { brainRoutes } from "./routes/brains";
import { tenantRoutes } from "./routes/tenant";

export function createApp(config: AppConfig) {
  const securityDenials = { 401: 0, 403: 0, 404: 0 };
  return new Elysia()
    .decorate("securityDenials", securityDenials)
    .use(requestId)
    .use(errors(config.now ?? (() => new Date()), securityDenials))
    .use(brainRoutes(config))
    .use(apiKeyRoutes(config))
    .use(tenantRoutes(config));
}
