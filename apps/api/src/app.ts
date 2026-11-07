import { Elysia } from "elysia";
import type { AppConfig } from "./lib/config";
import { errors } from "./middleware/errors";
import { requestId } from "./middleware/request-id";
import { apiKeyRoutes } from "./routes/api-keys";
import { brainRoutes } from "./routes/brains";
import { captureRoutes } from "./routes/captures";
import { changeRoutes } from "./routes/changes";
import { graphRoutes } from "./routes/graph";
import { pageRoutes } from "./routes/pages";
import { profileRoutes } from "./routes/profile";
import { scoreRoutes } from "./routes/score";
import { tenantRoutes } from "./routes/tenant";

export function createApp(config: AppConfig) {
  const securityDenials = { 401: 0, 403: 0, 404: 0 };
  return new Elysia()
    .decorate("securityDenials", securityDenials)
    .use(requestId)
    .use(errors(config.now ?? (() => new Date()), securityDenials))
    .use(brainRoutes(config))
    .use(captureRoutes(config))
    .use(pageRoutes(config))
    .use(changeRoutes(config))
    .use(graphRoutes(config))
    .use(scoreRoutes(config))
    .use(profileRoutes(config))
    .use(apiKeyRoutes(config))
    .use(tenantRoutes(config));
}
