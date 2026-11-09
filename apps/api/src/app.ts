import { Elysia } from "elysia";
import type { AppConfig, RouteConfig } from "./lib/config";
import { createRateLimiter } from "./lib/rate-limit";
import { errors } from "./middleware/errors";
import { requestId } from "./middleware/request-id";
import { requestLog } from "./middleware/request-log";
import { apiKeyRoutes } from "./routes/api-keys";
import { brainRoutes } from "./routes/brains";
import { captureRoutes } from "./routes/captures";
import { changeRoutes } from "./routes/changes";
import { exportRoutes } from "./routes/export";
import { graphRoutes } from "./routes/graph";
import { pageRoutes } from "./routes/pages";
import { profileRoutes } from "./routes/profile";
import { scoreRoutes } from "./routes/score";
import { tenantRoutes } from "./routes/tenant";
import { webhookRoutes } from "./routes/webhooks";

export function createApp(config: AppConfig) {
  const securityDenials = { 401: 0, 403: 0, 404: 0 };
  const routeConfig: RouteConfig = {
    ...config,
    rateLimiter: createRateLimiter({
      limit: config.rateLimitPerMinute ?? 300,
      ...(config.now === undefined ? {} : { now: config.now }),
    }),
  };
  return new Elysia()
    .decorate("securityDenials", securityDenials)
    .use(requestId)
    .use(errors(config.now ?? (() => new Date()), securityDenials))
    .use(requestLog(config.logger))
    .use(brainRoutes(routeConfig))
    .use(captureRoutes(routeConfig))
    .use(pageRoutes(routeConfig))
    .use(exportRoutes(routeConfig))
    .use(changeRoutes(routeConfig))
    .use(graphRoutes(routeConfig))
    .use(scoreRoutes(routeConfig))
    .use(profileRoutes(routeConfig))
    .use(apiKeyRoutes(routeConfig))
    .use(webhookRoutes(routeConfig))
    .use(tenantRoutes(routeConfig));
}
