import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ErrorBanner, Loading } from "../components/feedback";
import type { Profile, ProfileFields } from "../lib/api";
import { useApi } from "../lib/api-context";
import { parseDirectives } from "../lib/profile";

const fields = [
  ["whoTheyAre", "Who they are"],
  ["whatTheyDo", "What they do"],
  ["focus", "Focus"],
  ["goals", "Goals"],
  ["currentProjects", "Current projects"],
  ["stuckOn", "Stuck on"],
  ["vaultOrganization", "Vault organization"],
] as const;

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
    <form
      className="panel space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.valid && !update.isPending) {
          setSaved(false);
          update.mutate({ ...draft, directives: parsed.value });
        }
      }}
    >
      <ErrorBanner error={update.error} />
      <fieldset className="grid min-w-0 gap-5 sm:grid-cols-2" disabled={update.isPending}>
        <legend className="sr-only">Subject profile</legend>
        {fields.map(([field, label]) => (
          <div key={field} className="min-w-0">
            <label htmlFor={`profile-${field}`}>{label}</label>
            <textarea
              id={`profile-${field}`}
              rows={3}
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
            className="font-mono text-sm"
            rows={8}
            spellCheck={false}
            value={directives}
            aria-invalid={!parsed.valid}
            aria-describedby={parsed.valid ? "directives-help" : "directives-help directives-error"}
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
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="primary" disabled={update.isPending || !parsed.valid}>
          {update.isPending ? "Saving…" : "Save profile"}
        </button>
        <p role="status" aria-live="polite">
          {saved ? "Profile saved." : ""}
        </p>
      </div>
    </form>
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
      <h1>Subject profile</h1>
      <p className="text-slate-600">
        Describe the subject and the priorities that guide this brain.
      </p>
      <ErrorBanner error={profile.error} />
      {profile.isPending ? <Loading label="Loading subject profile" /> : null}
      {profile.data ? <ProfileForm key={brainId} profile={profile.data} brainId={brainId} /> : null}
    </>
  );
}
