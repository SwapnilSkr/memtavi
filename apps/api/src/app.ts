import { withIsolatedTrace } from "@memtavi/shared/telemetry";
import { Elysia } from "elysia";
import { type AppConfig, profileSuggestionsFromEnv, type RouteConfig } from "./lib/config";
import { createRateLimiter } from "./lib/rate-limit";
import { errors } from "./middleware/errors";
import { requestId } from "./middleware/request-id";
import { requestLog } from "./middleware/request-log";
import { telemetry } from "./middleware/telemetry";
import { apiKeyRoutes } from "./routes/api-keys";
import { brainRoutes } from "./routes/brains";
import { captureRoutes } from "./routes/captures";
import { changeRoutes } from "./routes/changes";
import { exportRoutes } from "./routes/export";
import { graphRoutes } from "./routes/graph";
import { memberRoutes } from "./routes/members";
import { memorySettingsRoutes } from "./routes/memory-settings";
import { pageRoutes } from "./routes/pages";
import { profileRoutes } from "./routes/profile";
import { routingReviewRoutes } from "./routes/routing-reviews";
import { scoreRoutes } from "./routes/score";
import { tenantRoutes } from "./routes/tenant";
import { webhookRoutes } from "./routes/webhooks";

export function createApp(config: AppConfig) {
  const securityDenials = { 401: 0, 403: 0, 404: 0 };
  const profileSuggestions = config.profileSuggestions ?? profileSuggestionsFromEnv();
  const routeConfig: RouteConfig = {
    ...config,
    ...(profileSuggestions === undefined ? {} : { profileSuggestions }),
    rateLimiter: createRateLimiter({
      limit: config.rateLimitPerMinute ?? 300,
      ...(config.now === undefined ? {} : { now: config.now }),
    }),
  };
  const app = new Elysia()
    .decorate("securityDenials", securityDenials)
    .use(telemetry())
    .use(requestId)
    .use(errors(config.now ?? (() => new Date()), securityDenials))
    .use(requestLog(config.logger))
    .use(brainRoutes(routeConfig))
    .use(captureRoutes(routeConfig))
    .use(memorySettingsRoutes(routeConfig))
    .use(pageRoutes(routeConfig))
    .use(exportRoutes(routeConfig))
    .use(changeRoutes(routeConfig))
    .use(routingReviewRoutes(routeConfig))
    .use(graphRoutes(routeConfig))
    .use(scoreRoutes(routeConfig))
    .use(profileRoutes(routeConfig))
    .use(apiKeyRoutes(routeConfig))
    .use(webhookRoutes(routeConfig))
    .use(memberRoutes(routeConfig))
    .use(tenantRoutes(routeConfig));

  const fetch = app.fetch.bind(app);
  Object.defineProperty(app, "fetch", {
    value: (request: Request) => withIsolatedTrace(() => fetch(request)),
    configurable: true,
    writable: true,
  });
  return app;
}
