---
id: agents-dispatch
when: running tools/agent.sh, reading an exit code, debugging a lane
holds: Commands, exit codes, lane flags, installed CLIs
links: agents-workflow, agents-lanes
---

# Dispatch

```bash
tools/agent.sh .agents/tasks/<id>.md              # lane, mode and tier come from the brief
python3 tools/agent_guard.py status               # running tasks and their claimed paths
python3 tools/conventions_check.py <id>           # the mechanical gate, by hand
python3 tools/context_map.py --check              # node budgets, links, anchors
```

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | Done; review next |
| 1 | The lane reported an error of its own; read the log |
| 2 | Bad brief: missing or invalid `Lane`, `Mode`, `Tier`, a missing context node, or a read brief with extra `Paths` |
| 4 | Out of scope, or a commit, reset, branch switch or stash happened: revert or re-brief before review |
| 5 | Lock clash with a running task |
| 6 | Guard state missing; check the diff scope by hand |
| 7 | Conventions gate failed |
| 8 | No report written |
| 9 | A Claude model or the `claude` CLI was requested; refused |

## Invocations

| Lane | Command |
|---|---|
| `sol` write | `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s workspace-write -c sandbox_workspace_write.network_access=true -C <root> "<prompt>"` |
| `sol` read | same with `-s read-only -o <report>`; the final message becomes the report |
| `grok` | `cursor-agent -p --trust --force --model grok-4.7-high --output-format stream-json "<prompt>"` |
| `cmd` | `cmd -p "<prompt>" --yolo --trust --skip-onboarding --output-format json --max-turns 400 -m deepseek/deepseek-v4.1-flash --effort high` |
| `agy` | `agy -p "<prompt>" --model <resolved> --output-format json --dangerously-skip-permissions --disable-slash-commands` |

`cmd` blocks file writes and shell commands in headless mode unless `--yolo` is passed. `--permission-mode yolo` does **not** lift that block. `agy` needs `--dangerously-skip-permissions` for the same reason, and `--disable-slash-commands` so a `/` in the prompt is never expanded.

## Model resolution (`agy` only)

1. Default `gemini-3.8-flash-high`. A brief may set `Model:` to any id in the approved chain; omitting it or writing `auto` keeps the default.
2. Before dispatch, `tools/lane_models.py has agy <model>` checks the **current account**. Argon and the Claude models are not guaranteed after an account switch; Gemini 3.8 Flash is.
3. On a quota error with no report written, the dispatcher retries once per model in order: `gemini-3.8-flash-high` → `gemini-4-argon-high` → `claude-sonnet-5-5-high` → `claude-opus-5-5-high`, skipping any model the account does not list.
4. The model actually used is the last column of `.agents/ledger.tsv`. Any fallback is also printed in the run log.

Check the pools by hand with `python3 tools/lane_models.py quota agy` (needs a local tracker on `127.0.0.1:3456`; prints `unknown` otherwise) or `/usage` inside `agy`. The three groups are independent: Gemini, Gemini 4 Argon (weekly only), and Claude and GPT.

## Codex usage (`fe` only)

Codex records a `rate_limits` snapshot on every turn under `~/.codex/sessions/**/*.jsonl`. `primary` is the 5-hour window (`window_minutes: 300`); `secondary` is the weekly one (`10080`). That is the same data `/status` shows, and it is the first source `lane_usage.py` reads.

Heavy frontend logic uses `Lane: fe`, resolved at dispatch time:

| Codex 5-hour usage | Lane |
|---|---|
| ≤ `CODEX_FE_CEILING` (default 70) | `sol` |
| > the ceiling | `grok` |
| unknown | `sol`, with a warning |

"Above 70% used" is the same boundary as "under 30% left"; the code expresses it as used so it matches `/status`.

Sources are ordered by freshness, not by type: the rollout snapshot, then a local tracker (`$USAGE_TRACKER_URL`, default `http://127.0.0.1:3456/status/codex`), then a manual value. A window whose `resets_at` has passed is reported as 0% used, because it rolled over.

```bash
tools/lane_usage.py get codex          # {"used_percent":8.0,"weekly_used_percent":18.0,"source":"rollout",...}
tools/lane_usage.py set codex used=72  # manual override when the snapshot is stale
tools/lane_usage.py clear codex
```

A manual value expires after 30 minutes. `DRY_RUN=1 tools/agent.sh .agents/tasks/<id>.md` prints the resolved lane and model without dispatching.

Briefs use one effort vocabulary, `off | low | medium | high | max`, and the dispatcher maps it per harness: `cmd` accepts only `off | low | high | max` (so `medium` becomes `high`), and `sol` accepts `minimal | low | medium | high` (so `off` becomes `minimal` and `max` becomes `high`). Passing a harness value that does not exist fails the run before it starts.

## Operational rules

- **One dispatch per background shell.** No `a && b` chains; the task panel labels a run after its first step.
- Wait for the completion notification. Do not poll.
- Logs stream. A quiet log means a stalled run, not buffering.
- **Never `pkill -f` a pattern containing a task id or brief name**: the wrapper's own command line contains the brief path. Kill by PID from `agent_guard.py status`.
- A run that writes no report still consumed quota. Read the log before re-dispatching.
- `agy` opens a project on first use. If it prompts, set `--project` once in the brief's `Notes:` and record it here.
