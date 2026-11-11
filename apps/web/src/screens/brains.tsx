import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import { StatusBadge } from "../components/status-badge";
import type { Brain, ListResponse } from "../lib/api";
import { useApi } from "../lib/api-context";
import { applyCacheEffect } from "../lib/invalidation";
import { parseOffset } from "../lib/list-params";

export function Brains() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const offset = parseOffset(params.get("offset"));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<{ id: string; name: string; state: string }[]>([]);
  const brains = useQuery({
    queryKey: ["brains", null, { limit: 50, offset }],
    queryFn: () => api.listBrains({ limit: 50, offset }),
  });
  const create = useMutation({
    mutationFn: () => api.createBrain({ name: name.trim(), description: description.trim() }),
    onSuccess: async (brain) => {
      await Promise.all(
        queryClient
          .getQueryCache()
          .findAll({ queryKey: ["brains", null] })
          .map((query) => queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })),
      );
      queryClient.setQueryData(["brain", brain.id, {}], brain);
      navigate(`/brains/${encodeURIComponent(brain.id)}/pages`);
    },
  });
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.updateBrain(input.id, { name: input.name }),
    onSuccess: async (brain) => {
      queryClient.setQueryData(["brain", brain.id, {}], brain);
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ["brains", null] })) {
        queryClient.setQueryData<ListResponse<Brain>>(query.queryKey, (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === brain.id ? brain : item)),
              }
            : current,
        );
      }
      setEditingId(null);
      await applyCacheEffect(queryClient, "updateBrain", { brainId: brain.id });
    },
  });
  const remove = useMutation({
    mutationFn: (input: { id: string; name: string }) => api.deleteBrain(input.id),
    onSuccess: async (receipt, input) => {
      setReceipts((current) => [
        ...current.filter((item) => item.id !== input.id),
        { id: input.id, name: input.name, state: receipt.state },
      ]);
      setConfirmingId(null);
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ["brains", null] })) {
        queryClient.setQueryData<ListResponse<Brain>>(query.queryKey, (current) => {
          if (!current) return current;
          const items = current.items.filter((item) => item.id !== input.id);
          return {
            ...current,
            items,
            total: items.length === current.items.length ? current.total : current.total - 1,
          };
        });
      }
      await applyCacheEffect(queryClient, "deleteBrain", { brainId: input.id });
    },
  });
  return (
    <>
      <div>
        <h1>Your brains</h1>
        <p className="mt-1 text-slate-600">
          Choose a brain to inspect its pages and search its knowledge.
        </p>
      </div>
      <ErrorBanner error={brains.error ?? create.error} />
      {receipts.length > 0 ? (
        <div aria-live="polite" className="space-y-2">
          {receipts.map((receipt) => (
            <div
              key={receipt.id}
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs sm:text-sm text-amber-900"
            >
              Deletion receipt for “{receipt.name}”: {receipt.state}. The purge is asynchronous and
              cannot be undone.
            </div>
          ))}
        </div>
      ) : null}
      <section aria-labelledby="create-heading" className="panel space-y-4">
        <h2 id="create-heading" className="section-title">
          Create a brain
        </h2>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) create.mutate();
          }}
        >
          <div>
            <label htmlFor="brain-name">Name</label>
            <input
              id="brain-name"
              required
              maxLength={200}
              placeholder="e.g. Engineering Handbook"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="brain-description">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="brain-description"
              placeholder="What this brain covers"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <button
            className="btn-primary justify-self-start"
            type="submit"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? "Creating…" : "Create brain"}
          </button>
        </form>
      </section>
      {brains.isPending ? <Loading label="Loading brains" /> : null}
      {brains.data?.items.length === 0 ? (
        <EmptyState>
          <p>
            No brains on this page. Create one above or{" "}
            <Link to="/" className="font-semibold text-indigo-700 hover:underline">
              return to the first page
            </Link>
            .
          </p>
        </EmptyState>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {brains.data?.items.map((brain) => {
          const renaming = editingId === brain.id;
          const confirming = confirmingId === brain.id;
          const renamingThis = rename.isPending && rename.variables?.id === brain.id;
          const deletingThis = remove.isPending && remove.variables?.id === brain.id;
          return (
            <li className="panel min-w-0 space-y-3" key={brain.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  <Link
                    to={`/brains/${encodeURIComponent(brain.id)}/pages`}
                    className="text-slate-900 hover:text-indigo-700"
                  >
                    {brain.name}
                  </Link>
                </h2>
                <StatusBadge status={brain.deletionState} />
              </div>
              <p className="break-words text-sm text-slate-600">
                {brain.description || "No description"}
              </p>
              {renaming ? (
                <form
                  className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = draftName.trim();
                    if (!next || next === brain.name || renamingThis) return;
                    rename.mutate({ id: brain.id, name: next });
                  }}
                >
                  <div>
                    <label htmlFor={`rename-${brain.id}`}>Name</label>
                    <input
                      id={`rename-${brain.id}`}
                      required
                      maxLength={200}
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-primary text-xs"
                      type="submit"
                      disabled={
                        renamingThis || !draftName.trim() || draftName.trim() === brain.name
                      }
                    >
                      {renamingThis ? "Saving…" : `Save ${brain.name}`}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={renamingThis}
                      onClick={() => {
                        setEditingId(null);
                        rename.reset();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {confirming ? (
                <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-900">
                    Delete “{brain.name}”? The purge is asynchronous and cannot be undone.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-danger text-xs"
                      disabled={deletingThis}
                      onClick={() => remove.mutate({ id: brain.id, name: brain.name })}
                    >
                      {deletingThis ? "Deleting…" : `Delete ${brain.name}`}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={deletingThis}
                      onClick={() => {
                        setConfirmingId(null);
                        remove.reset();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {brain.deletionState === "active" && !renaming && !confirming ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setConfirmingId(null);
                      setEditingId(brain.id);
                      setDraftName(brain.name);
                      rename.reset();
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn-danger text-xs"
                    onClick={() => {
                      setEditingId(null);
                      setConfirmingId(brain.id);
                      remove.reset();
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
              <ErrorBanner
                error={
                  (renaming && rename.variables?.id === brain.id ? rename.error : null) ||
                  (confirming && remove.variables?.id === brain.id ? remove.error : null)
                }
              />
            </li>
          );
        })}
      </ul>
      {brains.data ? (
        <Pagination
          {...brains.data}
          pending={brains.isFetching}
          onChange={(next) => setParams(next ? { offset: String(next) } : {})}
        />
      ) : null}
    </>
  );
}
