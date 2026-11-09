# @memtavi/cli

The `memtavi` command drives every Memtavi API operation from a terminal. It speaks only to the
HTTP API, so tenancy, RLS and API-key scoping stay in one place. Human-readable output is the
default; every command accepts `--json` for scripts.

## Install

```bash
bun install
# from the repo:
bun run --cwd packages/cli src/index.ts --help
# or link the bin on PATH:
bun link
```

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MEMTAVI_API_URL` | no | `http://localhost:3000` | Base URL of the Memtavi API |
| `MEMTAVI_API_KEY` | yes | — | Tenant-scoped API key (`mtv_live_...`) |
| `MEMTAVI_SUBJECT_ID` | yes | — | The end-user UUID whose brains are visible |
| `MEMTAVI_BRAIN_ID` | no | — | Default brain when `--brain` is omitted |

Configuration errors go to stderr and exit `1`. The key is never printed.

## Brain resolution

`--brain <brainId>` wins. Otherwise `MEMTAVI_BRAIN_ID` is used. Otherwise, if the subject has
exactly one brain, that brain is used. With more than one brain and neither the flag nor the
environment naming one, the command exits `2` and lists the available brains. It never guesses.

## Commands

Global flags: `--brain <brainId>` and `--json`.

| Command | Meaning |
|---|---|
| `brains` | List the brains visible to the subject |
| `capture note <text> [--label <label>]` | Capture an inline note |
| `capture url <url> [--label <label>]` | Capture a URL for the fetcher |
| `capture status <sourceId>` | Read a source and its compilation status |
| `index [--limit <n>]` | Read the compact brain index |
| `search <q> [--limit <n>] [--min-similarity <0-1>]` | Search a brain |
| `page get <slug>` | Read one page |
| `page edit <slug> [--title] [--summary] [--body-file] [--status] [--version]` | Apply a user edit |
| `page delete <slug> --permanent` | Permanently delete a page |
| `changes` | List the change feed |
| `change ack <id>` | Acknowledge a change event |
| `connections` | List semantic connections |
| `connection ack <id>` | Acknowledge a connection |
| `graph` | Show page nodes and connection edges |
| `score` | Show the latest brain health snapshot |
| `profile` | Read the subject profile |
| `profile set [--who-they-are] [--what-they-do] [--focus] [--goals] [--current-projects] [--stuck-on] [--vault-organization] [--directives <file>]` | Update the profile; `--directives` reads a JSON object file |
| `export [--out <file>]` | Export the whole brain to stdout or a file |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | API or configuration error |
| `2` | Usage error |

API errors print `HTTP <status>: <message>` on stderr, or `network error: ...` when the API is
unreachable. No stack trace is ever printed.

## Examples

Search a brain and pipe the raw hits into another tool:

```bash
MEMTAVI_API_KEY=mtv_live_... MEMTAVI_SUBJECT_ID=00000000-0000-0000-0000-000000000000 \
  memtavi --brain brn_... search "vector search" --limit 5 --json
```

Capture a note, wait for compilation, then read a page as a readable block:

```bash
memtavi capture note "The retry budget is five attempts." --label "ingestion"
memtavi capture status src_...
memtavi page get "retry-policy"
```

Export a brain to a file:

```bash
memtavi export --out ./brain.json
```

## Development

```bash
bun test packages/cli
bun run typecheck
bun run lint
```

Tests inject a fake client and call no network.
