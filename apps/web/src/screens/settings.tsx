import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router";
import { ErrorBanner, Loading, Pagination } from "../components/feedback";
import { ApiError, type MemberRole, type MemorySettings } from "../lib/api";
import { useApi } from "../lib/api-context";
import { exportFilename } from "../lib/export";
import {
  createApiKeyOnce,
  createWebhookOnce,
  refreshSettings,
  webhookEvents,
} from "../lib/settings";

function ApiKeysSettings() {
  const api = useApi();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useQuery({
    queryKey: ["api-keys", null, { limit: 50, offset }],
    queryFn: () => api.listApiKeys({ limit: 50, offset }),
  });
  const create = useMutation({
    mutationFn: () => createApiKeyOnce(api, { name: name.trim(), role }, setSecret),
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      setName("");
      await refreshSettings(client, "api-keys");
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: async () => {
      setSecret(null);
      await refreshSettings(client, "api-keys");
    },
  });
  return (
    <section className="panel space-y-4" aria-labelledby="api-keys-heading">
      <h2 id="api-keys-heading">API keys</h2>
      <p>
        Admin access required. Copy a new key now; it is shown only once and cleared when you leave
        Settings.
      </p>
      <ErrorBanner error={keys.error ?? create.error ?? revoke.error} />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <label htmlFor="key-name">Key name</label>
        <input
          id="key-name"
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor="key-role">Role</label>
        <select
          id="key-role"
          value={role}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          {(["viewer", "developer", "admin", "owner"] as const).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Creating…" : "Create API key"}
        </button>
      </form>
      {secret ? (
        <div role="status">
          <p>New API key (shown once):</p>
          <code className="break-all">{secret}</code>
          <button type="button" onClick={() => setSecret(null)}>
            Dismiss API key
          </button>
        </div>
      ) : null}
      {create.isSuccess && !secret ? (
        <p role="status">Key created. Its plaintext is no longer available here.</p>
      ) : null}
      {keys.isPending ? <Loading label="Loading API keys" /> : null}
      {keys.data?.items.length === 0 ? <p>No keys on this page. Create a key above.</p> : null}
      <ul className="space-y-3">
        {keys.data?.items.map((key) => (
          <li key={key.id} className="break-words">
            <p>
              {key.name} · {key.prefix} · {key.role} · {key.revokedAt ? "Revoked" : "Active"}
            </p>
            {!key.revokedAt ? (
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => {
                  if (window.confirm(`Revoke API key “${key.name}”? This cannot be undone.`))
                    revoke.mutate(key.id);
                }}
              >
                Revoke {key.name}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {keys.data ? (
        <Pagination {...keys.data} pending={keys.isFetching} onChange={setOffset} />
      ) : null}
    </section>
  );
}

function WebhooksSettings({ subjectId }: { subjectId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["brain.page.updated"]);
  const [secret, setSecret] = useState<string | null>(null);
  const webhooks = useQuery({
    queryKey: ["webhooks", null, { subjectId, limit: 50, offset }],
    queryFn: () => api.listWebhooks({ limit: 50, offset }),
  });
  const create = useMutation({
    mutationFn: () => createWebhookOnce(api, { url: url.trim(), events }, setSecret),
    retry: false,
    gcTime: 0,
    onSuccess: async () => {
      setUrl("");
      await refreshSettings(client, "webhooks", subjectId);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: async () => {
      setSecret(null);
      await refreshSettings(client, "webhooks", subjectId);
    },
  });
  return (
    <section className="panel space-y-4" aria-labelledby="webhooks-heading">
      <h2 id="webhooks-heading">Webhooks</h2>
      <p>
        Webhooks belong to the current subject. Copy a new signing secret now; it is shown only once
        and cleared when you leave Settings.
      </p>
      <ErrorBanner error={webhooks.error ?? create.error ?? remove.error} />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim() && events.length && !create.isPending) create.mutate();
        }}
      >
        <label htmlFor="webhook-url">Webhook URL (HTTP or HTTPS)</label>
        <input
          id="webhook-url"
          type="url"
          required
          pattern="https?://.*"
          maxLength={2048}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <fieldset disabled={create.isPending}>
          <legend>Events</legend>
          {webhookEvents.map((eventName) => (
            <label key={eventName} className="flex items-center gap-2 break-all">
              <input
                className="w-auto"
                type="checkbox"
                checked={events.includes(eventName)}
                onChange={(event) =>
                  setEvents((current) =>
                    event.target.checked
                      ? [...current, eventName]
                      : current.filter((name) => name !== eventName),
                  )
                }
              />
              {eventName}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={create.isPending || !url.trim() || !events.length}>
          {create.isPending ? "Creating…" : "Create webhook"}
        </button>
      </form>
      {secret ? (
        <div role="status">
          <p>Signing secret (shown once):</p>
          <code className="break-all">{secret}</code>
          <button type="button" onClick={() => setSecret(null)}>
            Dismiss signing secret
          </button>
        </div>
      ) : null}
      {create.isSuccess && !secret ? (
        <p role="status">Webhook created. Its signing secret is no longer available here.</p>
      ) : null}
      {webhooks.isPending ? <Loading label="Loading webhooks" /> : null}
      {webhooks.data?.items.length === 0 ? (
        <p>No webhooks on this page. Create one above.</p>
      ) : null}
      <ul className="space-y-3">
        {webhooks.data?.items.map((webhook) => (
          <li key={webhook.id} className="break-all">
            <p>
              {webhook.url} · {webhook.active ? "Active" : "Inactive"}
            </p>
            <p>{webhook.events.join(", ")}</p>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete webhook “${webhook.url}”? This cannot be undone.`))
                  remove.mutate(webhook.id);
              }}
            >
              Delete {webhook.url}
            </button>
          </li>
        ))}
      </ul>
      {webhooks.data ? (
        <Pagination {...webhooks.data} pending={webhooks.isFetching} onChange={setOffset} />
      ) : null}
    </section>
  );
}

function MembersSettings() {
  const api = useApi();
  const [offset, setOffset] = useState(0);
  const members = useQuery({
    queryKey: ["members", null, { limit: 50, offset }],
    queryFn: () => api.listMembers({ limit: 50, offset }),
    retry: false,
  });
  const requiresAdmin = members.error instanceof ApiError && members.error.status === 403;
  return (
    <section className="panel space-y-4" aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      {requiresAdmin ? (
        <p role="alert">Viewing members requires admin access.</p>
      ) : (
        <ErrorBanner error={members.error} />
      )}
      {members.isPending ? <Loading label="Loading members" /> : null}
      {members.data?.items.length === 0 ? (
        <p>No members on this page. Return to the previous page.</p>
      ) : null}
      <ul>
        {members.data?.items.map((member) => (
          <li key={member.id} className="break-words">
            {member.name} · {member.email} · {member.role}
          </li>
        ))}
      </ul>
      {members.data ? (
        <Pagination {...members.data} pending={members.isFetching} onChange={setOffset} />
      ) : null}
    </section>
  );
}

function MemoryModeSettings({ subjectId }: { subjectId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const [draft, setDraft] = useState<MemorySettings["mode"] | null>(null);
  const settings = useQuery({
    queryKey: ["memory-settings", null, { subjectId }],
    queryFn: () => api.getMemorySettings(),
  });
  const save = useMutation({
    mutationFn: (mode: MemorySettings["mode"]) => api.updateMemorySettings({ mode }),
    onSuccess: async (updated) => {
      client.setQueryData(["memory-settings", null, { subjectId }], updated);
      setDraft(null);
      await refreshSettings(client, "memory-settings", subjectId);
    },
  });
  const mode = draft ?? settings.data?.mode;
  return (
    <section className="panel space-y-4" aria-labelledby="memory-heading">
      <h2 id="memory-heading">Memory mode</h2>
      <p className="break-all">Current subject: {subjectId}</p>
      <p>
        Auto stores and compiles captures automatically. Ask stores captures and waits for your
        approval before compiling. Off does not store new captures. Existing captures are unchanged.
      </p>
      <ErrorBanner error={settings.error ?? save.error} />
      {settings.isPending ? <Loading label="Loading memory settings" /> : null}
      {settings.data ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode && !save.isPending) save.mutate(mode);
          }}
        >
          <label htmlFor="memory-mode">Mode</label>
          <select
            id="memory-mode"
            value={mode}
            onChange={(event) => setDraft(event.target.value as MemorySettings["mode"])}
          >
            <option value="auto">Auto</option>
            <option value="ask">Ask</option>
            <option value="off">Off</option>
          </select>
          <button type="submit" disabled={save.isPending || mode === settings.data.mode}>
            {save.isPending ? "Saving…" : "Save memory mode"}
          </button>
        </form>
      ) : null}
      {save.isSuccess ? <p role="status">Memory mode saved.</p> : null}
    </section>
  );
}

function ExportSettings({ brainId }: { brainId: string | null }) {
  const api = useApi();
  const brain = useQuery({
    queryKey: ["brain", brainId, {}],
    queryFn: () => api.getBrain(brainId ?? ""),
    enabled: Boolean(brainId),
  });
  const download = useMutation({
    mutationFn: async () => {
      if (!brainId) return;
      const bundle = await api.exportBrain(brainId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFilename(bundle.brain.slug);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <section className="panel space-y-4" aria-labelledby="export-heading">
      <h2 id="export-heading">Export</h2>
      <ErrorBanner error={brain.error ?? download.error} />
      {brainId ? (
        <>
          <p className="break-words">Active brain: {brain.data?.name ?? brainId}</p>
          <button
            type="button"
            disabled={download.isPending || brain.data?.deletionState !== "active"}
            onClick={() => download.mutate()}
          >
            {download.isPending ? "Exporting…" : "Download brain export"}
          </button>
        </>
      ) : (
        <p>
          <Link to="/">Choose a brain</Link>, then return to Settings to export it.
        </p>
      )}
      {download.isSuccess ? <p role="status">Export downloaded.</p> : null}
    </section>
  );
}

function DeletionProgress() {
  const api = useApi();
  const [offset, setOffset] = useState(0);
  const brains = useQuery({
    queryKey: ["brains", null, { limit: 50, offset }],
    queryFn: () => api.listBrains({ limit: 50, offset }),
    refetchInterval: (query) =>
      query.state.data?.items.some((brain) => brain.deletionState === "deleting") ? 3000 : false,
  });
  const deleting = brains.data?.items.filter((brain) => brain.deletionState === "deleting") ?? [];
  return (
    <section className="panel space-y-4" aria-labelledby="deletion-heading">
      <h2 id="deletion-heading">Deletion progress</h2>
      <p>
        Deletion is asynchronous and cannot be undone. Any returned deleting state refreshes
        automatically. Purge completion is unavailable; a missing brain does not confirm completion.
      </p>
      <ErrorBanner error={brains.error} />
      {brains.isPending ? <Loading label="Loading deletion progress" /> : null}
      <ul aria-live="polite">
        {deleting.map((brain) => (
          <li key={brain.id} className="break-words">
            {brain.name}: deleting
          </li>
        ))}
      </ul>
      {brains.data && !deleting.length ? (
        <p>No deletion state is available for brains on this page.</p>
      ) : null}
      <button type="button" disabled={brains.isFetching} onClick={() => void brains.refetch()}>
        Refresh deletion progress
      </button>
      {brains.data ? (
        <Pagination {...brains.data} pending={brains.isFetching} onChange={setOffset} />
      ) : null}
    </section>
  );
}

export function SettingsScreen({ subjectId }: { subjectId: string }) {
  const location = useLocation();
  const { activeBrainId } = useOutletContext<{ activeBrainId: string | null }>();
  return (
    <>
      <h1>Settings</h1>
      <p>
        API keys and members apply to your tenant. Webhooks and memory mode apply to your current
        subject.
      </p>
      <ApiKeysSettings key={location.key} />
      <WebhooksSettings key={`${subjectId}:${location.key}`} subjectId={subjectId} />
      <MembersSettings />
      <MemoryModeSettings key={subjectId} subjectId={subjectId} />
      <ExportSettings key={activeBrainId} brainId={activeBrainId} />
      <DeletionProgress />
    </>
  );
}
