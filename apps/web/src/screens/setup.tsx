import { useState } from "react";
import { ErrorBanner } from "../components/feedback";
import { type Session, saveSession } from "../lib/session";

export function Setup({ onSave }: { onSave: (session: Session) => void }) {
  const [error, setError] = useState<Error | null>(null);
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-6">
        <h1>Connect your inspector</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter your API connection. Settings are saved only for this browser tab’s session.
        </p>
      </div>
      <ErrorBanner error={error} />
      <form
        className="panel space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const fields = new FormData(event.currentTarget);
          const baseUrl = String(fields.get("baseUrl") ?? "")
            .trim()
            .replace(/\/+$/, "");
          const apiKey = String(fields.get("apiKey") ?? "").trim();
          const subjectId = String(fields.get("subjectId") ?? "").trim();
          if (baseUrl) {
            try {
              const url = new URL(baseUrl);
              if (
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password ||
                url.search ||
                url.hash
              )
                throw new Error();
            } catch {
              setError(
                new Error(
                  "Enter an HTTP or HTTPS base URL without credentials, query parameters or a fragment, or leave it blank.",
                ),
              );
              return;
            }
          }
          if (
            !apiKey ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)
          ) {
            setError(new Error("Enter an API key and a subject id in UUID format."));
            return;
          }
          const session = { baseUrl, apiKey, subjectId };
          try {
            saveSession(session);
            onSave(session);
          } catch {
            setError(
              new Error("Session storage is unavailable. Enable it for this site to connect."),
            );
          }
        }}
      >
        <div>
          <label htmlFor="baseUrl">API base URL</label>
          <input
            id="baseUrl"
            name="baseUrl"
            type="url"
            placeholder="http://localhost:3000"
            aria-describedby="baseUrl-help"
          />
          <p id="baseUrl-help" className="help">
            Leave blank to use this origin and the development proxy. Do not include /v1.
          </p>
        </div>
        <div>
          <label htmlFor="apiKey">API key</label>
          <input id="apiKey" name="apiKey" type="password" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor="subjectId">Subject id</label>
          <input
            id="subjectId"
            name="subjectId"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        <button className="btn-primary" type="submit">
          Connect
        </button>
      </form>
    </main>
  );
}
