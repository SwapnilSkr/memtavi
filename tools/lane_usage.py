#!/usr/bin/env python3
"""Codex 5-hour usage, read from Codex's own session rollouts.

  python3 tools/lane_usage.py get codex [--value] [--json]
  python3 tools/lane_usage.py set codex used=72
  python3 tools/lane_usage.py clear codex

Codex writes a `rate_limits` snapshot on every turn under ~/.codex/sessions/:

  primary    window_minutes 300    the 5-hour limit
  secondary  window_minutes 10080  the weekly limit

That is the same data /status shows, and it needs no tracker and no TUI. If the
window's `resets_at` has passed, the window rolled over: usage is reported as 0.
Sources, in order: rollout snapshot, local tracker, manual value.

Exit: 0 known, 2 unknown. The number is USED percent, not remaining.
"""
import glob
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, ".agents", "usage", "codex.json")
TRACKER = os.environ.get("USAGE_TRACKER_URL", "http://127.0.0.1:3456/status/codex")
SESSIONS = os.path.expanduser("~/.codex/sessions/**/*.jsonl")
FIVE_HOUR = 300
WEEKLY = 10080
TAIL_BYTES = 512 * 1024
MANUAL_TTL_SECONDS = 1800
MAX_SNAPSHOT_AGE_SECONDS = 24 * 3600


def tail_lines(path, limit=TAIL_BYTES):
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - limit))
        data = f.read()
    return data.decode("utf-8", errors="replace").splitlines()


def extract(rate_limits):
    windows = {}
    for key in ("primary", "secondary"):
        window = rate_limits.get(key)
        if not isinstance(window, dict):
            continue
        minutes = window.get("window_minutes")
        if minutes in (FIVE_HOUR, WEEKLY):
            windows[minutes] = {
                "used_percent": float(window.get("used_percent", 0)),
                "resets_at": window.get("resets_at"),
            }
    return windows


def read_rollout():
    files = sorted(glob.glob(SESSIONS, recursive=True), key=os.path.getmtime, reverse=True)[:5]
    best = None
    for path in files:
        age = time.time() - os.path.getmtime(path)
        if age > MAX_SNAPSHOT_AGE_SECONDS:
            continue
        latest = None
        for line in tail_lines(path):
            if "rate_limits" not in line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            stack = [obj]
            while stack:
                node = stack.pop()
                if isinstance(node, dict):
                    if isinstance(node.get("rate_limits"), dict):
                        latest = node["rate_limits"]
                    stack.extend(node.values())
                elif isinstance(node, list):
                    stack.extend(node)
        if not latest:
            continue
        windows = extract(latest)
        five = windows.get(FIVE_HOUR)
        if not five:
            continue
        candidate = {
            "five_hour": five,
            "weekly": windows.get(WEEKLY),
            "plan_type": latest.get("plan_type"),
            "snapshot_age_minutes": round(age / 60, 1),
            "observed_at": os.path.getmtime(path),
        }
        if best is None or (five.get("resets_at") or 0) > (best["five_hour"].get("resets_at") or 0):
            best = candidate
    if not best:
        return None
    five = best["five_hour"]
    if five.get("resets_at") and time.time() >= five["resets_at"]:
        five["used_percent"] = 0.0
        five["rolled_over"] = True
    return {
        "used_percent": five["used_percent"],
        "resets_at": five.get("resets_at"),
        "weekly_used_percent": (best["weekly"] or {}).get("used_percent"),
        "plan_type": best.get("plan_type"),
        "snapshot_age_minutes": best["snapshot_age_minutes"],
        "observed_at": best["observed_at"],
        "source": "rollout",
    }


def read_tracker():
    try:
        with urllib.request.urlopen(TRACKER, timeout=2) as response:
            payload = json.load(response)
    except Exception:
        return None
    windows = payload.get("windows") or []
    for window in windows:
        kind = str(window.get("type", "")).lower()
        if ("five" in kind or "5h" in kind) and isinstance(window.get("remaining_percent"), (int, float)):
            return {
                "used_percent": 100 - float(window["remaining_percent"]),
                "observed_at": time.time(),
                "source": "tracker",
            }
    return None


def read_manual():
    try:
        with open(STATE, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        return None
    checked = state.get("checked_at", 0)
    if time.time() - checked > MANUAL_TTL_SECONDS:
        return None
    if not isinstance(state.get("used_percent"), (int, float)):
        return None
    return {"used_percent": float(state["used_percent"]), "observed_at": checked, "source": "manual"}


def resolve():
    candidates = [value for value in (read_rollout(), read_tracker(), read_manual()) if value]
    if not candidates:
        return None
    return max(candidates, key=lambda value: value.get("observed_at", 0))


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    command, lane = argv[1], argv[2]
    if lane != "codex":
        raise SystemExit("only codex usage is tracked here")
    if command == "set":
        if len(argv) < 4 or not argv[3].startswith("used="):
            raise SystemExit("usage: lane_usage.py set codex used=<percent>")
        try:
            used = float(argv[3].split("=", 1)[1])
        except ValueError:
            raise SystemExit("used percent must be a number")
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump({"window": "5h", "used_percent": used, "checked_at": time.time()}, f, indent=2)
        print(f"codex 5h used: {used}% (manual, expires in {MANUAL_TTL_SECONDS // 60} min)")
        return 0
    if command == "clear":
        if os.path.exists(STATE):
            os.remove(STATE)
        return 0
    if command == "get":
        resolved = resolve()
        if not resolved:
            print("unknown", file=sys.stderr)
            return 2
        if "--value" in argv:
            print(f"{resolved['used_percent']:.1f}")
        else:
            print(json.dumps(resolved))
        return 0
    raise SystemExit(__doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
