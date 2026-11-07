#!/usr/bin/env python3
"""Account-scoped model availability and quota for the agy lane.

  python3 tools/lane_models.py list agy [--refresh]
  python3 tools/lane_models.py has agy <model> [--refresh]     exit 0 yes, 1 no, 2 probe failed
  python3 tools/lane_models.py quota agy

`agy models` is per account: switching Google accounts can remove Gemini 4 Argon and the
Claude models while Gemini 3.8 Flash stays. The cache keys on GEMINI_CLI_HOME and expires,
because a re-login in the same home cannot be detected otherwise.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".agents", "lane-models.json")
TTL_SECONDS = 300
QUOTA_URL = "http://127.0.0.1:3456/status/agy"


def cache_key():
    return os.environ.get("GEMINI_CLI_HOME", "default")


def load_cache():
    if not os.path.exists(CACHE):
        return {}
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_cache(data):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def probe(force=False):
    cache = load_cache()
    entry = cache.get("agy")
    key = cache_key()
    if entry and not force and entry.get("account") == key and time.time() - entry.get("checked_at", 0) < TTL_SECONDS:
        return entry.get("models", [])
    result = subprocess.run(["agy", "models"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        return None
    models = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("fetching"):
            continue
        model_id = line.split()[0]
        if model_id and all(ch.isalnum() or ch in "._-" for ch in model_id):
            models.append(model_id)
    if not models:
        return None
    cache["agy"] = {"account": key, "checked_at": time.time(), "models": models}
    save_cache(cache)
    return models


def quota():
    try:
        with urllib.request.urlopen(QUOTA_URL, timeout=2) as response:
            payload = json.load(response)
    except Exception:
        print("quota: unknown (no local tracker at 127.0.0.1:3456)")
        return 0
    for window in payload.get("windows", []):
        print(f"{window.get('model')}\t{window.get('type')}\t{window.get('remaining_percent')}%\t{window.get('resets_at')}")
    return 0


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    command, lane = argv[1], argv[2]
    force = "--refresh" in argv
    if lane != "agy":
        raise SystemExit("only the agy lane needs an availability probe")
    if command == "list":
        models = probe(force)
        if models is None:
            print("probe failed: `agy models` did not return a list", file=sys.stderr)
            return 2
        print("\n".join(models))
        return 0
    if command == "has":
        if len(argv) < 4:
            raise SystemExit("usage: lane_models.py has agy <model>")
        wanted = argv[3]
        models = probe(force)
        if models is None:
            print("probe failed: `agy models` did not return a list", file=sys.stderr)
            return 2
        return 0 if wanted in models else 1
    if command == "quota":
        return quota()
    raise SystemExit(__doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
