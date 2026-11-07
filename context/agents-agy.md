---
id: agents-agy
when: routing UI work, choosing an agy model, debugging a quota failure
holds: agy quota groups, model chain, per-account availability, fallback rules
links: agents-lanes, agents-dispatch
---

# The agy lane

UI work only: markup, styling, layout, responsive behaviour, presentational components. Frontend logic goes to `sol`.

## Quota groups

Three independent pools, confirmed 2026-11-06:

| Group | Models | Windows | Consumed by |
|---|---|---|---|
| Gemini Models | Gemini 3.8 Flash | five-hour + weekly | Flash |
| Gemini 4 Argon | Argon | **weekly only** | Argon only |
| Claude and GPT Models | Claude Opus/Sonnet 5.5, GPT-OSS | five-hour + weekly | Claude, GPT-OSS |

Spending one group leaves the other two untouched. Argon's bracket is weekly-only and runs out in hours of real work, which is why it is a fallback rather than a default.

## The chain

1. `gemini-3.8-flash-high` — default, and present on every account.
2. `gemini-4-argon-high` — only when Gemini's five-hour and weekly limits are spent.
3. `claude-sonnet-5-5-high` — when Argon is spent or absent on the account.
4. `claude-opus-5-5-high` — same condition, if the account lists it.

Never pick Argon or Claude pre-emptively to get a better result. Flash is the model that refills.

## Availability is per account

Switching Google accounts can remove Argon and the Claude models. Gemini 3.8 Flash is always there. `tools/lane_models.py` reads `agy models` and caches for five minutes, keyed on `GEMINI_CLI_HOME`; after a re-login in the same home, force it with `--refresh`.

```bash
python3 tools/lane_models.py list agy
python3 tools/lane_models.py has agy gemini-4-argon-high
python3 tools/lane_models.py quota agy     # prints "unknown" without a local tracker
```

Inside `agy`, `/usage` (alias `/quota`) shows each group's remaining percentage and reset countdown.

## Dispatcher behaviour

- A brief may set `Model:` to any id in the chain. Omitting it or writing `auto` keeps Flash.
- The dispatcher refuses a model the current account does not list, and refuses `Model:` on any lane other than `agy`.
- On a quota error with **no report written**, it retries once per model down the chain, skipping unavailable ones. The model actually used is the last column of `.agents/ledger.tsv`.
- If every group is spent, the run fails and waits. It does not fall back to a backend lane.

## The one Claude exception

`AGENTS.md` bans Claude everywhere except this chain's last two steps. That is deliberate: the Claude group is separate from Gemini, so it keeps the Gemini pools intact, and it is the only way to finish UI work when Argon is gone. It is never used when Argon is available and has quota.
