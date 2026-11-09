import { Elysia } from "elysia";
import type { AppConfig } from "../lib/config";
import { pagination, webhookCreate } from "../lib/schemas";
import { createWebhook, deleteWebhook, listWebhooks } from "../lib/webhooks";
import { auth } from "../middleware/auth";
import { scope, subjectId } from "../middleware/scope";

export function webhookRoutes(config: AppConfig) {
  return new Elysia()
    .use(auth(config.ownerPool))
    .get(
      "/v1/webhooks",
      ({ auth, request, query }) => {
        const subject = subjectId(request);
        return scope(config, auth, subject, (client) =>
          listWebhooks(client, auth.tenantId, subject, query.limit ?? 50, query.offset ?? 0),
        );
      },
      { query: pagination },
    )
    .post(
      "/v1/webhooks",
      async ({ auth, request, body, set }) => {
        const subject = subjectId(request);
        const webhook = await scope(config, auth, subject, (client) =>
          createWebhook(client, auth.tenantId, subject, config.webhookSecretKey, body),
        );
        set.status = 201;
        return webhook;
      },
      { body: webhookCreate },
    )
    .delete("/v1/webhooks/:webhookId", async ({ auth, request, params, set }) => {
      const subject = subjectId(request);
      await scope(config, auth, subject, (client) =>
        deleteWebhook(client, auth.tenantId, subject, params.webhookId),
      );
      set.status = 204;
      return null;
    });
}
