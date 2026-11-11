import type { Api, ApiKeyCreate, WebhookCreate } from "./api";

export const webhookEvents = [
  "brain.page.updated",
  "brain.change.new",
  "brain.connection.new",
  "brain.import.progress",
  "created",
  "updated",
  "renamed",
  "merged",
  "split",
  "archived",
  "restored",
  "recovered",
  "routed",
] as const;

export async function createApiKeyOnce(
  api: Pick<Api, "createApiKey">,
  body: ApiKeyCreate,
  reveal: (secret: string | null) => void,
): Promise<void> {
  reveal(null);
  const result = await api.createApiKey(body);
  reveal(result.key ?? null);
}

export async function createWebhookOnce(
  api: Pick<Api, "createWebhook">,
  body: WebhookCreate,
  reveal: (secret: string | null) => void,
): Promise<void> {
  reveal(null);
  const result = await api.createWebhook(body);
  reveal(result.secret ?? null);
}

export async function refreshSettings(
  client: import("@tanstack/react-query").QueryClient,
  resource: "api-keys" | "webhooks" | "memory-settings",
  subjectId?: string,
): Promise<void> {
  await Promise.all(
    client
      .getQueryCache()
      .findAll({ queryKey: [resource, null] })
      .filter((query) => {
        if (subjectId === undefined) return true;
        const params = query.queryKey[2];
        return (
          params !== null &&
          typeof params === "object" &&
          "subjectId" in params &&
          params.subjectId === subjectId
        );
      })
      .map((query) => client.invalidateQueries({ queryKey: query.queryKey, exact: true })),
  );
}
