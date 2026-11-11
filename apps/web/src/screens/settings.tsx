import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router";
import { ErrorBanner, Loading, Pagination } from "../components/feedback";
import { StatusBadge } from "../components/status-badge";
import { ApiError, type MemberRole, type MemorySettings } from "../lib/api";
import { useApi } from "../lib/api-context";
import { exportFilename } from "../lib/export";
import {
  createApiKeyOnce,
  createWebhookOnce,
  refreshSettings,
  webhookEvents,
} from "../lib/settings";

function SecretBox({
  secret,
  onDismiss,
  title,
}: {
  secret: string;
  onDismiss: () => void;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  };

  return (
    <div
      role="status"
      className="rounded-lg border-2 border-indigo-400 bg-indigo-50/60 p-4 space-y-3 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="badge badge-warning font-semibold">shown once</span>
          <p className="text-sm font-semibold text-indigo-950">{title} (shown once)</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 break-all rounded-md border border-slate-300 bg-white p-2.5 font-mono text-xs text-slate-900 shadow-inner">
          {secret}
        </code>
        <button type="button" className="btn-primary text-xs shrink-0" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

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
    <section className="panel space-y-5" aria-labelledby="api-keys-heading">
      <div className="border-b border-slate-200 pb-3">
        <h2 id="api-keys-heading" className="section-title">
          API keys
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Admin access required. Copy a new key now; it is shown only once and cleared when you
          leave Settings.
        </p>
      </div>
      <ErrorBanner error={keys.error ?? create.error ?? revoke.error} />
      <form
        className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <h3 className="text-sm font-semibold text-slate-900">Create new API key</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="key-name">Key name</label>
            <input
              id="key-name"
              required
              maxLength={200}
              placeholder="e.g. CLI Production"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
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
          </div>
        </div>
        <button
          className="btn-primary text-xs"
          type="submit"
          disabled={create.isPending || !name.trim()}
        >
          {create.isPending ? "Creating…" : "Create API key"}
        </button>
      </form>

      {secret ? (
        <SecretBox secret={secret} title="New API key" onDismiss={() => setSecret(null)} />
      ) : null}

      {create.isSuccess && !secret ? (
        <p role="status" className="meta">
          Key created. Its plaintext is no longer available here.
        </p>
      ) : null}

      {keys.isPending ? <Loading label="Loading API keys" /> : null}
      {keys.data?.items.length === 0 ? (
        <p className="text-sm text-slate-500">No keys on this page. Create a key above.</p>
      ) : null}

      <ul className="space-y-3">
        {keys.data?.items.map((key) => (
          <li
            key={key.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{key.name}</span>
                <span className="badge badge-neutral">{key.role}</span>
                <StatusBadge status={key.revokedAt ? "revoked" : "active"} />
              </div>
              <p className="font-mono text-xs text-slate-500">Prefix: {key.prefix}</p>
            </div>
            {!key.revokedAt ? (
              <button
                type="button"
                className="btn-danger text-xs"
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
    <section className="panel space-y-5" aria-labelledby="webhooks-heading">
      <div className="border-b border-slate-200 pb-3">
        <h2 id="webhooks-heading" className="section-title">
          Webhooks
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Webhooks belong to the current subject. Copy a new signing secret now; it is shown only
          once and cleared when you leave Settings.
        </p>
      </div>
      <ErrorBanner error={webhooks.error ?? create.error ?? remove.error} />
      <form
        className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim() && events.length && !create.isPending) create.mutate();
        }}
      >
        <h3 className="text-sm font-semibold text-slate-900">Add webhook endpoint</h3>
        <div>
          <label htmlFor="webhook-url">Webhook URL (HTTP or HTTPS)</label>
          <input
            id="webhook-url"
            type="url"
            required
            pattern="https?://.*"
            maxLength={2048}
            placeholder="https://example.com/api/webhooks/memtavi"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <fieldset disabled={create.isPending} className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Subscribed events
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {webhookEvents.map((eventName) => (
              <label
                key={eventName}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs font-normal"
              >
                <input
                  className="size-4 shrink-0"
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
                <span className="font-mono text-slate-800">{eventName}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="btn-primary text-xs"
          type="submit"
          disabled={create.isPending || !url.trim() || !events.length}
        >
          {create.isPending ? "Creating…" : "Create webhook"}
        </button>
      </form>

      {secret ? (
        <SecretBox secret={secret} title="Signing secret" onDismiss={() => setSecret(null)} />
      ) : null}

      {create.isSuccess && !secret ? (
        <p role="status" className="meta">
          Webhook created. Its signing secret is no longer available here.
        </p>
      ) : null}

      {webhooks.isPending ? <Loading label="Loading webhooks" /> : null}
      {webhooks.data?.items.length === 0 ? (
        <p className="text-sm text-slate-500">No webhooks on this page. Create one above.</p>
      ) : null}

      <ul className="space-y-3">
        {webhooks.data?.items.map((webhook) => (
          <li
            key={webhook.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900 break-all">{webhook.url}</span>
                <StatusBadge status={webhook.active ? "active" : "inactive"} />
              </div>
              <p className="font-mono text-xs text-slate-500">{webhook.events.join(", ")}</p>
            </div>
            <button
              type="button"
              className="btn-danger text-xs"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete webhook “${webhook.url}”? This cannot be undone.`))
                  remove.mutate(webhook.id);
              }}
            >
              Delete
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
      <div className="border-b border-slate-200 pb-3">
        <h2 id="members-heading" className="section-title">
          Members
        </h2>
        <p className="mt-1 text-sm text-slate-600">Users with access to this tenant workspace.</p>
      </div>
      {requiresAdmin ? (
        <p role="alert" className="text-sm text-amber-800">
          Viewing members requires admin access.
        </p>
      ) : (
        <ErrorBanner error={members.error} />
      )}
      {members.isPending ? <Loading label="Loading members" /> : null}
      {members.data?.items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No members on this page. Return to the previous page.
        </p>
      ) : null}
      <ul className="space-y-2.5">
        {members.data?.items.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xs"
          >
            <div>
              <p className="font-semibold text-slate-900">{member.name}</p>
              <p className="text-xs text-slate-500">{member.email}</p>
            </div>
            <span className="badge badge-neutral">{member.role}</span>
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
      <div className="border-b border-slate-200 pb-3">
        <h2 id="memory-heading" className="section-title">
          Memory mode
        </h2>
        <p className="mt-1 text-xs font-mono text-slate-500">Current subject: {subjectId}</p>
        <p className="mt-2 text-sm text-slate-600">
          Auto stores and compiles captures automatically. Ask stores captures and waits for your
          approval before compiling. Off does not store new captures. Existing captures are
          unchanged.
        </p>
      </div>
      <ErrorBanner error={settings.error ?? save.error} />
      {settings.isPending ? <Loading label="Loading memory settings" /> : null}
      {settings.data ? (
        <form
          className="max-w-xs space-y-3"
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
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={save.isPending || mode === settings.data.mode}
          >
            {save.isPending ? "Saving…" : "Save memory mode"}
          </button>
        </form>
      ) : null}
      {save.isSuccess ? (
        <p role="status" className="text-xs text-emerald-800">
          Memory mode saved.
        </p>
      ) : null}
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
      <div className="border-b border-slate-200 pb-3">
        <h2 id="export-heading" className="section-title">
          Export
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Download a complete JSON export of pages, sources, versions, and connections.
        </p>
      </div>
      <ErrorBanner error={brain.error ?? download.error} />
      {brainId ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Active brain:{" "}
            <span className="font-semibold text-slate-900">{brain.data?.name ?? brainId}</span>
          </p>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={download.isPending || brain.data?.deletionState !== "active"}
            onClick={() => download.mutate()}
          >
            {download.isPending ? "Exporting…" : "Download brain export"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          <Link to="/" className="font-medium text-indigo-700 hover:underline">
            Choose a brain
          </Link>
          , then return to Settings to export it.
        </p>
      )}
      {download.isSuccess ? (
        <p role="status" className="text-xs text-emerald-800">
          Export downloaded.
        </p>
      ) : null}
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
      <div className="border-b border-slate-200 pb-3">
        <h2 id="deletion-heading" className="section-title">
          Deletion progress
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Deletion is asynchronous and cannot be undone. Any returned deleting state refreshes
          automatically. Purge completion is unavailable; a missing brain does not confirm
          completion.
        </p>
      </div>
      <ErrorBanner error={brains.error} />
      {brains.isPending ? <Loading label="Loading deletion progress" /> : null}
      <ul aria-live="polite" className="space-y-2">
        {deleting.map((brain) => (
          <li
            key={brain.id}
            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <span className="font-semibold">{brain.name}</span>
            <StatusBadge status="deleting" label="Deleting" />
          </li>
        ))}
      </ul>
      {brains.data && !deleting.length ? (
        <p className="text-sm text-slate-500">
          No deletion state is available for brains on this page.
        </p>
      ) : null}
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={brains.isFetching}
        onClick={() => void brains.refetch()}
      >
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
      <div>
        <h1>Settings</h1>
        <p className="mt-1 text-slate-600">
          API keys and members apply to your tenant. Webhooks and memory mode apply to your current
          subject.
        </p>
      </div>
      <ApiKeysSettings key={location.key} />
      <WebhooksSettings key={`${subjectId}:${location.key}`} subjectId={subjectId} />
      <MembersSettings />
      <MemoryModeSettings key={subjectId} subjectId={subjectId} />
      <ExportSettings key={activeBrainId} brainId={activeBrainId} />
      <DeletionProgress />
    </>
  );
}
