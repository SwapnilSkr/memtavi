---
id: agents-workflow
when: writing a brief, reviewing a diff, running a fix round
holds: The loop, the brief template, the review checklist, verdicts
links: agents-lanes, agents-dispatch
---

# Workflow

```
Orchestrator
  1. classify (agents-lanes) and write the contract into the brief or gl-decisions
  2. write .agents/tasks/<id>.md
  3. dispatch: tools/agent.sh .agents/tasks/<id>.md      (background shell)
        │
        ▼
  Agent reads AGENTS.md + its Context: nodes, works inside Paths:,
  runs Done when, writes .agents/reports/<id>.md
  Wrapper: guard verify → conventions check → ledger
        │
        ▼
Orchestrator
  4. read the report and the FULL diff
  5. re-run the Done when commands
  6. review line by line against the checklist
  7. write .agents/reviews/<id>-r<N>.md
       CHANGES REQUESTED → <id>-fix-N brief → back to step 3
       APPROVED          → only with zero open findings
  8. record in status / gl-changelog; commit only when asked
```

## Brief template (`.agents/tasks/<id>.md`)

```markdown
# <id>: <title>
Lane: sol | grok | cmd | agy
Mode: write | read
Tier: S | A | B | C | D | UI | FE
Effort: high
Paths: packages/core/compile/**, .agents/reports/<id>.md
Context: conv-compiler, conv-code, conv-tests

## Goal
One paragraph: what exists when this is done.

## Context
Files to read; the existing file whose pattern to copy; the contract;
decisions already made.

## Requirements
Numbered and testable. More than about eight means split the brief.

## Out of scope
What not to touch.

## Done when
Exact commands, and the behaviour to demonstrate.

## Report
.agents/reports/<id>.md: what changed by file; verification with real output;
the conventions that applied and how; the last heading of each context node read;
open questions; contract changes needed.
```

A **read** brief's `Paths:` is only its own report. The wrapper refuses anything else.

## Splitting

A brief that fits in one sitting passes review on its own. A brief covering a whole contract grows the lane's context until each step costs more than the last. Split by what can be reviewed independently: schema, then service, then route, then wiring.

## Review checklist

1. **Scope.** Only the brief's files. Nothing unrelated reformatted, renamed or tidied.
2. **Conventions.** Every applicable node, line by line. Code that works but breaks a convention fails.
3. **Reuse.** No new helper where one exists; no duplicated constant; no file that earns nothing.
4. **Correctness.** Error paths, partial failure, concurrency, transaction boundaries, and the worst case at the largest allowed input.
5. **Contract.** Shapes match the spec exactly. Nothing a client must not see is sent.
6. **Security.** Auth on every route, input validated, no secret in code or logs, fetch guarded.
7. **Verification.** Re-run `Done when` yourself. A green report is not proof.
8. **Evidence.** For compiler work, the metric moved or held, with numbers.
9. **UI.** Checked in the browser at 390px and 1440px, with a stub, then the stub removed.

## Verdicts

`.agents/reviews/<id>-r<N>.md`:

```markdown
# <id>, round <N>
Verdict: APPROVED | CHANGES REQUESTED

Re-ran: <commands and results>

## Findings
1. `file:line` — what is wrong, the rule it breaks, the required change.
```

- **Every finding blocks approval.** There are no optional nits.
- **Fixes go back to the agent**, never into the orchestrator's hands, so every line in the final diff has passed the gate.
- A fix brief names the review file, limits `Paths:` to the files the findings name, requires each finding answered by number as `fixed` (with how) or `disputed` (with evidence). Nothing else changes.
- An agent may dispute a finding; it may not skip one.
- **Re-review is complete, not incremental.** The whole task diff is read again after a fix.
- After two `CHANGES REQUESTED` rounds in one lane, escalate. Backend moves up (`cmd` → `grok` → `sol`) and a Tier S task never moves down. A UI task is re-briefed with the failing screenshots or split into UI and FE; it never goes to a backend lane. FE stays with `sol`.
- **Approved means:** a verdict file saying `APPROVED` with zero open findings, the conventions check green on the final state, and `Done when` green when the orchestrator runs it.

## Compiler-specific gate

A compiler, policy or prompt task is not approvable without its numbers. The review records the before and after of the named metric. If the metric was not measured, the verdict is `CHANGES REQUESTED` regardless of the diff quality.

## Housekeeping

- Update `status` when what is in flight changes.
- A shipped change goes in `gl-changelog`; a decision goes in `gl-decisions`. Both dated, absolute dates only.
- Stop every background process you started. Leave no port occupied.
