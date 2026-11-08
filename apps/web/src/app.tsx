import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { Loading, NotFound } from "./components/feedback";
import { Layout } from "./components/layout";
import { createApi } from "./lib/api";
import { ApiContext } from "./lib/api-context";
import { clearSession, readSession, type Session } from "./lib/session";
import { Brains } from "./screens/brains";
import { Capture } from "./screens/capture";
import { Changes } from "./screens/changes";
import { Connections } from "./screens/connections";
import { GraphScreen } from "./screens/graph";
import { Pages } from "./screens/pages";
import { ProfileScreen } from "./screens/profile";
import { ScoreScreen } from "./screens/score";
import { Search } from "./screens/search";
import { Setup } from "./screens/setup";

const PageDetail = lazy(() =>
  import("./screens/page-detail").then((module) => ({ default: module.PageDetail })),
);

function Inspector({ session, onDisconnect }: { session: Session; onDisconnect: () => void }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            staleTime: 30_000,
          },
        },
      }),
  );
  const [api] = useState(() => createApi(session));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <Routes>
          <Route
            element={
              <Layout
                onDisconnect={() => {
                  queryClient.clear();
                  onDisconnect();
                }}
              />
            }
          >
            <Route index element={<Brains />} />
            <Route path="brains/:brainId/capture" element={<Capture />} />
            <Route path="brains/:brainId/pages" element={<Pages />} />
            <Route
              path="brains/:brainId/pages/:slug"
              element={
                <Suspense fallback={<Loading label="Loading page reader" />}>
                  <PageDetail />
                </Suspense>
              }
            />
            <Route path="brains/:brainId/search" element={<Search />} />
            <Route path="brains/:brainId/graph" element={<GraphScreen />} />
            <Route path="brains/:brainId/connections" element={<Connections />} />
            <Route path="brains/:brainId/changes" element={<Changes />} />
            <Route path="brains/:brainId/score" element={<ScoreScreen />} />
            <Route path="brains/:brainId/profile" element={<ProfileScreen />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}

export function App() {
  const [session, setSession] = useState(readSession);
  return (
    <BrowserRouter>
      {session ? (
        <Inspector
          session={session}
          onDisconnect={() => {
            try {
              clearSession();
            } finally {
              setSession(null);
            }
          }}
        />
      ) : (
        <Setup onSave={setSession} />
      )}
    </BrowserRouter>
  );
}
