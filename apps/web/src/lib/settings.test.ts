import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createApi } from "./api";
import { createApiKeyOnce, createWebhookOnce, refreshSettings, webhookEvents } from "./settings";

test.each(["key", "webhook"] as const)(
  "new %s secret reaches component state without reaching either cache",
  async (kind) => {
    const client = new QueryClient();
    const api = createApi(
      { baseUrl: "", apiKey: "synthetic-session", subjectId: "subject" },
      async () =>
        Response.json(
          { id: "fixture", key: "synthetic-new-key", secret: "synthetic-new-signature" },
          { status: 201 },
        ),
    );
    let componentSecret: string | null = "old-value";
    const reveals: (string | null)[] = [];
    const reveal = (value: string | null) => {
      componentSecret = value;
      reveals.push(value);
    };
    const mutation = new MutationObserver(client, {
      mutationFn: () =>
        kind === "key"
          ? createApiKeyOnce(api, { name: "Test" }, reveal)
          : createWebhookOnce(
              api,
              { url: "https://example.test", events: ["brain.page.updated"] },
              reveal,
            ),
    });
    expect(await mutation.mutate()).toBeUndefined();
    expect(reveals[0]).toBeNull();
    expect(componentSecret).toBe(kind === "key" ? "synthetic-new-key" : "synthetic-new-signature");
    expect(mutation.getCurrentResult().data).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    const cachedStates = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((entry) => entry.state),
    );
    expect(cachedStates).not.toContain("synthetic-new-key");
    expect(cachedStates).not.toContain("synthetic-new-signature");
    reveal(null);
    expect(componentSecret).toBeNull();
    client.clear();
  },
);

test("a failed secret creation clears the previous reveal and is not retried", async () => {
  let calls = 0;
  const api = createApi(
    { baseUrl: "", apiKey: "synthetic-session", subjectId: "subject" },
    async () => {
      calls++;
      return Response.json({ message: "Unavailable" }, { status: 503 });
    },
  );
  const reveals: (string | null)[] = [];
  await expect(
    createApiKeyOnce(api, { name: "Test" }, (value) => reveals.push(value)),
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(1);
  expect(reveals).toEqual([null]);
});

test("settings invalidation refreshes every affected page and preserves other subjects and resources", async () => {
  const client = new QueryClient();
  const affected = [
    ["webhooks", null, { subjectId: "own", offset: 0 }],
    ["webhooks", null, { subjectId: "own", offset: 50 }],
  ];
  const unaffected = [
    ["webhooks", null, { subjectId: "other", offset: 0 }],
    ["members", null, { offset: 0 }],
    ["memory-settings", null, { subjectId: "own" }],
  ];
  for (const key of [...affected, ...unaffected]) client.setQueryData(key, {});
  await refreshSettings(client, "webhooks", "own");
  for (const key of unaffected) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  client.clear();
});

test("tenant key invalidation covers all cached offsets", async () => {
  const client = new QueryClient();
  const keys = [
    ["api-keys", null, { offset: 0 }],
    ["api-keys", null, { offset: 50 }],
  ];
  for (const key of keys) client.setQueryData(key, {});
  client.setQueryData(["brains", null, {}], {});
  await refreshSettings(client, "api-keys");
  expect(client.getQueryState(["brains", null, {}])?.isInvalidated).toBe(false);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  client.clear();
});

test("webhook choices include all PRD event names", () => {
  for (const event of [
    "brain.page.updated",
    "brain.change.new",
    "brain.connection.new",
    "brain.import.progress",
  ] as const)
    expect(webhookEvents).toContain(event);
  expect(new Set(webhookEvents).size).toBe(webhookEvents.length);
});
