---
id: conv-web
when: touching apps/web
holds: Inspector stack, state boundaries, evidence UI, accessibility
links: conv-code, conv-tests
---

# Web conventions

Vite + React + TypeScript + Tailwind. React Router for routes. TanStack Query for every server value. Zustand only for ephemeral UI state: selected brain, open panel, filters that do not belong in the URL.

## State boundaries

- Server data lives in TanStack Query, keyed by `[resource, brainId, params]`. Mutations invalidate the exact keys they affect; never invalidate the whole cache.
- A page body, an API key or a signing secret is never written to `localStorage`, `sessionStorage`, cookies, or IndexedDB.
- URL state is for shareable filters (bucket, status, query). Panel state is Zustand. Nothing else is global.

## Screens

| Route | Must show |
|---|---|
| `/brains` | List, create, rename, delete, health badge |
| `/brains/:id/capture` | Composer, queue with live status, per-source error and retry |
| `/brains/:id/pages` | Bucket nav with counts, status filter, search, infinite list |
| `/brains/:id/pages/:slug` | Body, summary, versions and diff, sources with evidence, connections, actions |
| `/brains/:id/conflicts` | Contested queue, both claims side by side, resolve with a note |
| `/brains/:id/health` | Three metrics, factor breakdown, 30-day trend, suggestions |
| `/brains/:id/profile` | Editor plus inferred suggestions |
| `/settings` | API keys (shown once), webhooks, export, deletion progress |

## The evidence rule

On the page-detail screen, every material claim must be one click from the chunk span that supports it. If a claim has no evidence, it is rendered as unsupported. This screen is why people trust the product; it outranks every visual consideration.

## Interaction rules

- Destructive actions require the resource name typed or a confirm dialog that names it. Permanent delete says "cannot be undone".
- A `contested` page is visibly disputed everywhere it appears, never silently styled as normal.
- Loading states are skeletons in the shape of the content. No layout shift on resolve.
- Empty states say what to do next and link to it.
- Never call `getPage` to hydrate a list. It mutates `lastReferencedAt` and corrupts the health score.

## UI versus frontend logic

The lane depends on behaviour, not on the folder. If the change can only break by looking wrong — markup, Tailwind, layout, responsive behaviour, an `aria-label`, a presentational component — it is **UI** and goes to `agy`. If it can break by fetching the wrong thing, invalidating the wrong cache key, entering the wrong state, or taking the wrong route — it is **frontend logic** and goes to `sol`. A task that does both is split into two briefs before dispatch.

## Accessibility and layout

- Every control is keyboard reachable, and every icon-only button has an `aria-label`.
- Colour is never the only signal for status; pair it with a label.
- Test at 390px and 1440px before review. A table that only works at desktop is a finding.
