import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmptyState, ErrorBanner, Loading, Pagination } from "../components/feedback";
import { useApi } from "../lib/api-context";

export function Brains() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawOffset = Number(params.get("offset") ?? 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
  return (
    <>
      <h1>Your brains</h1>
      <p className="text-slate-600">
        Choose a brain to inspect its pages and search its knowledge.
      </p>
      <ErrorBanner error={brains.error ?? create.error} />
      <section aria-labelledby="create-heading" className="panel">
        <h2 id="create-heading">Create a brain</h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
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
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="brain-description">
              Description <span className="font-normal">(optional)</span>
            </label>
            <input
              id="brain-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <button
            className="primary justify-self-start"
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
            No brains on this page. Create one above or <Link to="/">return to the first page</Link>
            .
          </p>
        </EmptyState>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {brains.data?.items.map((brain) => (
          <li className="panel min-w-0" key={brain.id}>
            <h2>
              <Link to={`/brains/${encodeURIComponent(brain.id)}/pages`}>{brain.name}</Link>
            </h2>
            <p className="mt-2 break-words text-slate-600">
              {brain.description || "No description"}
            </p>
            <p className="help">{brain.deletionState}</p>
          </li>
        ))}
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
