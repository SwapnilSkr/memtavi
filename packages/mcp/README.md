# @memtavi/mcp

A read-only [MCP](https://modelcontextprotocol.io) server that lets an agent read a Memtavi brain
over stdio. It speaks only to the HTTP API, so tenancy and row-level security stay in one place.

Writes are not available yet. This slice exposes reads only.

## Install

```bash
bun install
```

## Client configuration

Point any MCP client at the `memtavi-mcp` bin. The server reads its configuration from the
environment:

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MEMTAVI_API_URL` | no | `http://localhost:3000` | Base URL of the Memtavi API |
| `MEMTAVI_API_KEY` | yes | — | Tenant-scoped API key (`mtv_live_...`) |
| `MEMTAVI_SUBJECT_ID` | yes | — | The end-user UUID whose brains are visible |
| `MEMTAVI_BRAIN_ID` | no | — | Default brain, used when a tool call omits `brainId` |

```json
{
  "mcpServers": {
    "memtavi": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/memtavi/packages/mcp/src/index.ts"],
      "env": {
        "MEMTAVI_API_URL": "https://api.memtavi.com",
        "MEMTAVI_API_KEY": "mtv_live_...",
        "MEMTAVI_SUBJECT_ID": "00000000-0000-0000-0000-000000000000",
        "MEMTAVI_BRAIN_ID": "brn_..."
      }
    }
  }
}
```

If the package is linked on `PATH`, `"command": "memtavi-mcp"` with no `args` is enough.

The server exits non-zero with a message on stderr when `MEMTAVI_API_KEY` or
`MEMTAVI_SUBJECT_ID` is missing. Diagnostics always go to stderr; stdout carries the protocol.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `list_brains` | — | `id`, `name`, `slug` for each visible brain |
| `index` | `brainId?`, `limit?` (1–200, default 40) | Compact entries: `slug`, `title`, `summary`, `pageType`, `pinned` |
| `search` | `q` (required), `brainId?`, `limit?` (1–50, default 10), `minSimilarity?` (0–1) | Ranked hits: `slug`, `title`, `summary`, `similarity` |
| `read` | `slug` (required), `brainId?` | `title`, `summary`, `version`, `status`, and the markdown `body` |

Suggested use: orient with `index`, search before starting a task, then read only the pages the
task needs.

### Brain resolution

The `brainId` argument wins when present. Otherwise `MEMTAVI_BRAIN_ID` is used. Otherwise, if the
subject has exactly one brain, that brain is used. When more than one brain exists and neither the
argument nor the environment names one, the tool returns an error listing the available brains and
asks for a `brainId` or the environment variable. It never guesses.

### Errors

Tool failures come back as `isError: true` with the API message and an `HTTP <status>` prefix, or a
`network error` prefix when the API is unreachable. Stack traces and the API key are never
returned.

## Development

```bash
bun test packages/mcp
bun run typecheck
bun run lint
```

Tests use a fake API client and call no network.
