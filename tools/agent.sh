#!/usr/bin/env bash
# Dispatch a brief to its lane. See context/agents-dispatch.md.
#   tools/agent.sh .agents/tasks/<id>.md
# Lane: sol | grok | cmd | agy | fe      Mode: write | read
# Tier: S | A | B | C | D | UI | FE      Model: agy only, optional
# `fe` resolves to sol while Codex has 5-hour headroom, grok below the floor.
set -euo pipefail

# UI lane model chain. Flash first and always; Argon only after Gemini's pool is spent;
# Claude (its own quota group) only after Argon is gone or absent on this account.
AGY_CHAIN=("gemini-3.8-flash-high" "gemini-4-argon-high" "claude-sonnet-5-5-high" "claude-opus-5-5-high")
AGY_DEFAULT="gemini-3.8-flash-high"
QUOTA_RE='quota|rate.?limit|429|usage limit|limit reached|exhausted|out of credits'

main() {

brief="${1:?task brief path required: tools/agent.sh .agents/tasks/<id>.md}"
root="$(cd "$(dirname "$0")/.." && pwd)"
brief="${brief#$root/}"
id="$(basename "$brief" .md)"
mkdir -p "$root/.agents/logs" "$root/.agents/reports" "$root/.agents/locks"
log="$root/.agents/logs/$id.log"
report="$root/.agents/reports/$id.md"
[[ -f "$root/$brief" ]] || { echo "[agent] no brief at $brief" >&2; return 2; }

field() { grep -iE "^$1:" "$root/$brief" | head -1 | sed -E "s/^$1:[[:space:]]*//I" | sed -E 's/[[:space:]]*(←.*)?$//' | tr '[:upper:]' '[:lower:]' || true; }

lane="$(field Lane)"
mode="$(field Mode)"; mode="${mode:-write}"
tier="$(field Tier)"; tier="${tier:-C}"
effort="$(field Effort)"; effort="${effort:-high}"
requested_model="$(field Model)"

case "$lane" in sol|grok|cmd|agy|fe) ;; *) echo "[agent] 'Lane:' must be sol | grok | cmd | agy | fe (got '$lane')" >&2; return 2 ;; esac
case "$mode" in write|read) ;; *) echo "[agent] 'Mode:' must be write or read (got '$mode')" >&2; return 2 ;; esac
case "$tier" in s|a|b|c|d|ui|fe) ;; *) echo "[agent] 'Tier:' must be S | A | B | C | D | UI | FE (got '$tier')" >&2; return 2 ;; esac
case "$effort" in off|low|medium|high|max) ;; *) echo "[agent] 'Effort:' must be off | low | medium | high | max" >&2; return 2 ;; esac

# Claude is disabled everywhere except the agy UI lane's last-resort fallback.
if [[ "$lane" != "agy" ]] && grep -qiE '(claude-|-m +claude|model: *claude)' "$root/$brief"; then
  echo "[agent] Claude is disabled outside the agy UI fallback (see gl-decisions)" >&2; return 9
fi
if [[ -n "$requested_model" && "$lane" != "agy" ]]; then
  echo "[agent] 'Model:' is only supported on the agy lane" >&2; return 2
fi

if [[ "$mode" == "read" ]]; then
  paths="$(grep -iE '^Paths:' "$root/$brief" | head -1 | sed -E 's/^Paths:[[:space:]]*//I' | tr -d '`[:space:]')"
  [[ "$paths" == ".agents/reports/$id.md" ]] || { echo "[agent] a read brief's Paths must be only .agents/reports/$id.md" >&2; return 2; }
fi

requested="$lane"
if [[ -f "$root/.agents/reroute" ]]; then
  to="$(grep -E "^$lane=" "$root/.agents/reroute" | head -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
  [[ -n "$to" ]] && lane="$to"
fi

# Heavy frontend logic: sol is the default, grok takes over once Codex is 70% used.
CODEX_FE_CEILING="${CODEX_FE_CEILING:-70}"
if [[ "$lane" == "fe" ]]; then
  used="$(python3 "$root/tools/lane_usage.py" get codex --value 2>/dev/null || true)"
  if [[ ! "$used" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "[agent] codex 5h usage unknown; defaulting to sol. Record it with: tools/lane_usage.py set codex used=<pct>" >&2
    lane="sol"
  elif awk -v u="$used" -v c="$CODEX_FE_CEILING" 'BEGIN { exit !(u > c) }'; then
    echo "[agent] codex 5h usage ${used}% is above ${CODEX_FE_CEILING}%; routing FE to grok" >&2
    lane="grok"
  else
    echo "[agent] codex 5h usage ${used}%; routing FE to sol" >&2
    lane="sol"
  fi
  # A reroute for the resolved lane still applies (e.g. sol=grok while Codex is out).
  if [[ -f "$root/.agents/reroute" ]]; then
    to="$(grep -E "^$lane=" "$root/.agents/reroute" | head -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
    [[ -n "$to" ]] && lane="$to"
  fi
fi

# Brief vocabulary is off|low|medium|high|max. Each harness accepts a different subset.
case "$lane:$effort" in
  cmd:off) effort="off" ;;
  cmd:low) effort="low" ;;
  cmd:medium) effort="high" ;;
  cmd:high) effort="high" ;;
  cmd:max) effort="max" ;;
  sol:off) effort="minimal" ;;
  sol:low) effort="low" ;;
  sol:medium) effort="medium" ;;
  sol:high) effort="high" ;;
  sol:max) effort="high" ;;
esac

default_model() {
  case "$1" in
    sol) echo "gpt-6.1-sol" ;;
    grok) echo "grok-4.7-high" ;;
    cmd) echo "deepseek/deepseek-v4.1-flash" ;;
    agy) echo "$AGY_DEFAULT" ;;
    fe) echo "gpt-6.1-sol" ;;
  esac
}

model="$(default_model "$lane")"
if [[ "$lane" == "agy" ]]; then
  if [[ -n "$requested_model" && "$requested_model" != "auto" ]]; then
    model="$requested_model"
  fi
  allowed=0
  for candidate in "${AGY_CHAIN[@]}"; do [[ "$candidate" == "$model" ]] && allowed=1; done
  if [[ $allowed -eq 0 ]]; then
    echo "[agent] '$model' is not an approved agy model; use ${AGY_CHAIN[*]}" >&2; return 2
  fi
  probe=0
  python3 "$root/tools/lane_models.py" has agy "$model" >/dev/null 2>&1 || probe=$?
  if [[ $probe -eq 2 ]]; then
    echo "[agent] could not read the agy model list; check the account" >&2; return 2
  fi
  if [[ $probe -eq 1 ]]; then
    echo "[agent] '$model' is not available on this agy account; Gemini 3.8 Flash must be" >&2; return 2
  fi
fi

context="$(grep -iE '^Context:' "$root/$brief" | head -1 | sed -E 's/^Context:[[:space:]]*//I')"
node_list=""
IFS=',' read -ra nodes <<< "$context"
for node in "${nodes[@]}"; do
  node="$(echo "$node" | tr -d '[:space:]')"
  [[ -z "$node" ]] && continue
  [[ -f "$root/context/$node.md" ]] || { echo "[agent] brief names missing context node: $node" >&2; return 2; }
  node_list="$node_list
  $root/context/$node.md"
done

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "[agent] dry-run: lane=$lane model=$model tier=$tier mode=$mode"
  return 0
fi

prompt="You are working in the Memtavi workspace at $root. Before anything else, read these in full:
  $root/AGENTS.md
  $root/$brief
  every context node below, to its last line (they are the rules for this kind of work):$node_list
Do not read context nodes that are not listed. Do not read .env files or secrets. Do not commit, push, stash, reset, rebase or switch branches.
Stay inside the Paths: in the brief; the guard fails the run otherwise.
Your report goes to $report and must contain: what changed by file; the exact commands you ran and their real output; a Conventions section naming each applicable rule and how you followed it; the last heading of each context node you read; open questions; contract changes needed."

if [[ "$mode" == "read" ]]; then
  prompt="$prompt

This is a READ-ONLY task: do not create, edit, format or delete any file except your report."
fi

guard="python3 $root/tools/agent_guard.py"
$guard acquire "$id" "$root/$brief" || return 5
trap '$guard release "$id"' RETURN
$guard snapshot "$id"

case "$lane" in
  sol)  label="codex · $model · $effort" ;;
  grok) label="cursor · $model" ;;
  cmd)  label="command-code · $model · $effort" ;;
  agy)  label="antigravity · $model" ;;
esac
[[ "$lane" != "$requested" ]] && label="$label (rerouted from $requested)"
echo "[agent] $mode ← $id  (tier $tier; lane: $label; log: ${log#$root/})"
started=$(date +%s)
rm -f "$report"
: > "$log"

agy_run() {
  (cd "$root" && agy -p "$prompt" --model "$1" --output-format json \
    --dangerously-skip-permissions --disable-slash-commands) </dev/null >>"$log" 2>&1
}

set +e
case "$lane:$mode" in
  sol:write)
    codex exec -m "$model" -c model_reasoning_effort="$effort" \
      -s workspace-write -c sandbox_workspace_write.network_access=true \
      --add-dir "$root/.agents" -C "$root" "$prompt" </dev/null >>"$log" 2>&1
    ;;
  sol:read)
    codex exec -m "$model" -c model_reasoning_effort="$effort" -s read-only -C "$root" \
      -o "$report" "$prompt

You cannot write files: make your FINAL message the complete report; it is saved to $report for you." </dev/null >>"$log" 2>&1
    ;;
  grok:*)
    (cd "$root" && cursor-agent -p --trust --force --model "$model" --output-format stream-json "$prompt") </dev/null >>"$log" 2>&1
    ;;
  cmd:*)
    (cd "$root" && cmd -p "$prompt" --yolo --trust --skip-onboarding --output-format json \
      --max-turns 400 -m "$model" --effort "$effort") </dev/null >>"$log" 2>&1
    ;;
  agy:*)
    agy_run "$model"
    status=$?
    # Fall back only when the run produced no report and the log says the quota ran out.
    if [[ $status -ne 0 && ! -s "$report" ]] && grep -qiE "$QUOTA_RE" "$log"; then
      for candidate in "${AGY_CHAIN[@]}"; do
        [[ "$candidate" == "$model" ]] && continue
        if ! python3 "$root/tools/lane_models.py" has agy "$candidate" >/dev/null 2>&1; then
          echo "[agent] skip $candidate: not available on this agy account" | tee -a "$log" >&2
          continue
        fi
        echo "[agent] quota exhausted on $model; retrying with $candidate" | tee -a "$log" >&2
        agy_run "$candidate"
        status=$?
        model="$candidate"
        [[ $status -eq 0 ]] && break
        grep -qiE "$QUOTA_RE" "$log" || break
      done
    fi
    ;;
esac
status=${status:-$?}

$guard verify "$id" || { [[ $status -eq 0 ]] && status=4; }
python3 "$root/tools/conventions_check.py" "$id" || { [[ $status -eq 0 ]] && status=7; }

[[ -f "$report" ]] && echo "[agent] report: ${report#$root/}" || { echo "[agent] no report written; see log"; [[ $status -eq 0 ]] && status=8; }
printf '%s\t%s\t%s\t%s\t%s\t%ss\texit %s\t%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$id" "$requested" "$lane" "$mode" \
  "$(( $(date +%s) - started ))" "$status" "$model" >> "$root/.agents/ledger.tsv"
return $status
}

main "$@"; exit $?
