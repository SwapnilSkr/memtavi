import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorBanner, Loading } from "../components/feedback";
import type { Profile, ProfileFields, ProfileSuggestion } from "../lib/api";
import { useApi } from "../lib/api-context";
import { parseDirectives, profileSuggestionError } from "../lib/profile";

const fields = [
  ["whoTheyAre", "Who they are"],
  ["whatTheyDo", "What they do"],
  ["focus", "Focus"],
  ["goals", "Goals"],
  ["currentProjects", "Current projects"],
  ["stuckOn", "Stuck on"],
  ["vaultOrganization", "Vault organization"],
] as const;

function ProfileSuggestionsPanel({
  brainId,
  saving,
  onApplied,
  onApplyingChange,
}: {
  brainId: string;
  saving: boolean;
  onApplied: (item: ProfileSuggestion) => void;
  onApplyingChange: (pending: boolean) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [applied, setApplied] = useState<string[]>([]);
  const suggestions = useMutation({
    mutationFn: () => api.suggestProfile(brainId),
    retry: false,
    onSuccess: () => setApplied([]),
  });
  const apply = useMutation({
    mutationFn: (item: ProfileSuggestion) =>
      api.updateProfile(brainId, { [item.field]: item.value }),
    onMutate: () => onApplyingChange(true),
    onSettled: () => onApplyingChange(false),
    onSuccess: async (updated, item) => {
      queryClient.setQueryData(["profile", brainId, {}], updated);
      setApplied((current) => [...current, item.field]);
      onApplied(item);
      await queryClient.invalidateQueries({ queryKey: ["profile", brainId, {}], exact: true });
    },
  });
  const message = profileSuggestionError(suggestions.error);

  return (
    <section className="panel space-y-4" aria-labelledby="profile-suggestions-heading">
      <div className="border-b border-slate-200 pb-3">
        <h2 id="profile-suggestions-heading" className="section-title">
          Inferred suggestions
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Generate suggestions from page summaries. This uses a paid model call. Nothing is applied
          automatically. Applying a suggestion saves that field and updates it in the editor; other
          drafts are kept.
        </p>
      </div>
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={suggestions.isPending || apply.isPending || saving}
        onClick={() => suggestions.mutate()}
      >
        {suggestions.isPending ? "Generating…" : "Generate profile suggestions"}
      </button>
      {message ? (
        <p role="alert" className="text-xs text-amber-800">
          {message}
        </p>
      ) : null}
      <ErrorBanner error={apply.error} />
      {suggestions.isPending ? <Loading label="Generating profile suggestions" /> : null}
      {suggestions.data?.items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No suggestions yet.{" "}
          <Link
            to={`/brains/${encodeURIComponent(brainId)}/capture`}
            className="font-medium text-indigo-700 hover:underline"
          >
            Capture more knowledge
          </Link>{" "}
          or edit the profile below.
        </p>
      ) : null}
      <ul className="space-y-3">
        {suggestions.data?.items.map((item) => (
          <li
            key={item.field}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2 break-words"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">
                {fields.find(([field]) => field === item.field)?.[1] ?? item.field}
              </h3>
              <span className="badge badge-info">
                Confidence: {(item.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{item.value}</p>
            {item.evidence.length > 0 ? (
              <div className="text-xs space-y-1">
                <span className="meta">Evidence pages:</span>
                <ul className="flex flex-wrap gap-2" aria-label="Evidence pages">
                  {item.evidence.map((page) => (
                    <li key={page.slug}>
                      <Link
                        to={`/brains/${encodeURIComponent(brainId)}/pages/${encodeURIComponent(page.slug)}`}
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        {page.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="pt-1">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={
                  saving || apply.isPending || suggestions.isPending || applied.includes(item.field)
                }
                onClick={() => apply.mutate(item)}
              >
                {applied.includes(item.field)
                  ? "Applied"
                  : `Apply ${fields.find(([field]) => field === item.field)?.[1] ?? item.field}`}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {applied.length ? (
        <p role="status" className="text-xs text-emerald-800">
          Suggestions applied to the saved profile.
        </p>
      ) : null}
    </section>
  );
}

function ProfileForm({ profile, brainId }: { profile: Profile; brainId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => ({
    whoTheyAre: profile.whoTheyAre ?? "",
    whatTheyDo: profile.whatTheyDo ?? "",
    focus: profile.focus ?? "",
    goals: profile.goals ?? "",
    currentProjects: profile.currentProjects ?? "",
    stuckOn: profile.stuckOn ?? "",
    vaultOrganization: profile.vaultOrganization ?? "",
  }));
  const [directives, setDirectives] = useState(() =>
    JSON.stringify(profile.directives ?? {}, null, 2),
  );
  const [saved, setSaved] = useState(false);
  const [applying, setApplying] = useState(false);
  const parsed = parseDirectives(directives);
  const update = useMutation({
    mutationFn: (body: ProfileFields) => api.updateProfile(brainId, body),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["profile", brainId, {}], updated);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["profile", brainId, {}], exact: true });
    },
  });
  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  return (
    <div className="space-y-6">
      <ProfileSuggestionsPanel
        brainId={brainId}
        saving={update.isPending}
        onApplyingChange={setApplying}
        onApplied={(item) => {
          setSaved(false);
          setDraft((current) => ({ ...current, [item.field]: item.value }));
        }}
      />
      <form
        className="panel space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed.valid && !update.isPending && !applying) {
            setSaved(false);
            update.mutate({ ...draft, directives: parsed.value });
          }
        }}
      >
        <div className="border-b border-slate-200 pb-3">
          <h2 className="section-title">Profile fields</h2>
          <p className="mt-1 text-sm text-slate-600">
            Define context and focus areas for this brain.
          </p>
        </div>
        <ErrorBanner error={update.error} />
        <fieldset
          className="grid min-w-0 gap-5 sm:grid-cols-2"
          disabled={update.isPending || applying}
        >
          <legend className="sr-only">Subject profile</legend>
          {fields.map(([field, label]) => (
            <div key={field} className="min-w-0">
              <label htmlFor={`profile-${field}`}>{label}</label>
              <textarea
                id={`profile-${field}`}
                rows={3}
                placeholder={`Describe ${label.toLowerCase()}…`}
                value={draft[field]}
                onChange={(event) => {
                  setSaved(false);
                  setDraft({ ...draft, [field]: event.target.value });
                }}
              />
            </div>
          ))}
          <div className="min-w-0 sm:col-span-2">
            <label htmlFor="profile-directives">Directives (JSON object)</label>
            <textarea
              id="profile-directives"
              className="font-mono text-xs sm:text-sm"
              rows={6}
              spellCheck={false}
              value={directives}
              aria-invalid={!parsed.valid}
              aria-describedby={
                parsed.valid ? "directives-help" : "directives-help directives-error"
              }
              onChange={(event) => {
                setSaved(false);
                setDirectives(event.target.value);
              }}
            />
            <p id="directives-help" className="help">
              Enter a JSON object. Leave empty to save an empty object.
            </p>
            <div aria-live="polite">
              {!parsed.valid ? (
                <p id="directives-error" className="mt-2 text-sm text-red-800">
                  {parsed.message}
                </p>
              ) : null}
            </div>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={update.isPending || applying || !parsed.valid}
          >
            {update.isPending ? "Saving…" : "Save profile"}
          </button>
          <p role="status" aria-live="polite" className="text-xs font-medium text-emerald-800">
            {saved ? "Profile saved." : ""}
          </p>
        </div>
      </form>
    </div>
  );
}

export function ProfileScreen() {
  const api = useApi();
  const { brainId = "" } = useParams();
  const profile = useQuery({
    queryKey: ["profile", brainId, {}],
    queryFn: () => api.getProfile(brainId),
  });

  return (
    <>
      <div>
        <h1>Subject profile</h1>
        <p className="mt-1 text-slate-600">
          Describe the subject and the priorities that guide this brain.
        </p>
      </div>
      <ErrorBanner error={profile.error} />
      {profile.isPending ? <Loading label="Loading subject profile" /> : null}
      {profile.data ? <ProfileForm key={brainId} profile={profile.data} brainId={brainId} /> : null}
    </>
  );
}
