#!/usr/bin/env python3
"""Path locks, scope verification and git-state checks for dispatched tasks.

  python3 tools/agent_guard.py acquire <id> <brief>
  python3 tools/agent_guard.py snapshot <id>
  python3 tools/agent_guard.py verify <id>
  python3 tools/agent_guard.py release <id>
  python3 tools/agent_guard.py status

Exit codes: 0 ok, 4 out of scope or git state changed, 5 lock clash, 6 no guard state.
"""
import fnmatch
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCKS = os.path.join(ROOT, ".agents", "locks")
ALWAYS_ALLOWED = (".agents/reports/", ".agents/logs/", ".agents/locks/", ".agents/ledger.tsv", ".agents/reroute")
SKIP_DIRS = {".git", "node_modules", "dist", "coverage", ".turbo", "__pycache__"}


def git(*args):
    result = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)
    return result.returncode, result.stdout.strip()


def git_state():
    _, head = git("rev-parse", "HEAD")
    _, branch = git("rev-parse", "--abbrev-ref", "HEAD")
    _, stash = git("stash", "list")
    return {"head": head, "branch": branch, "stash": stash}


def tracked_files():
    state = {}
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            if rel.startswith(ALWAYS_ALLOWED):
                continue
            try:
                stat = os.stat(path)
            except OSError:
                continue
            state[rel] = f"{stat.st_mtime_ns}:{stat.st_size}"
    return state


def lock_path(task_id):
    return os.path.join(LOCKS, f"{task_id}.json")


def read_lock(task_id):
    path = lock_path(task_id)
    if not os.path.exists(path):
        raise SystemExit(6)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def brief_paths(brief):
    with open(brief, encoding="utf-8") as f:
        for line in f:
            if line.lower().startswith("paths:"):
                raw = line.split(":", 1)[1].split("←")[0]
                return [p.strip().strip("`") for p in raw.split(",") if p.strip()]
    return []


def matches(path, patterns):
    for pattern in patterns:
        pattern = pattern.strip()
        if not pattern:
            continue
        if any(pattern.startswith(prefix) for prefix in ALWAYS_ALLOWED):
            return True
        if fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(path, pattern.rstrip("/") + "/**"):
            return True
        if pattern.endswith("/**") and path.startswith(pattern[:-3].rstrip("/") + "/"):
            return True
    return False


def acquire(task_id, brief):
    os.makedirs(LOCKS, exist_ok=True)
    for name in os.listdir(LOCKS):
        if not name.endswith(".json"):
            continue
        existing = json.load(open(os.path.join(LOCKS, name), encoding="utf-8"))
        if existing.get("pid") and int(existing["pid"]) != os.getpid():
            try:
                os.kill(int(existing["pid"]), 0)
            except OSError:
                continue
        if name == f"{task_id}.json":
            continue
        if set(existing.get("paths", [])) & set(brief_paths(brief)):
            print(f"[guard] lock clash: {name[:-5]} claims an overlapping path", file=sys.stderr)
            return 5
    payload = {
        "id": task_id,
        "pid": os.getpid(),
        "paths": brief_paths(brief),
        "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(lock_path(task_id), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return 0


def snapshot(task_id):
    lock = read_lock(task_id)
    lock["git"] = git_state()
    lock["files"] = tracked_files()
    with open(lock_path(task_id), "w", encoding="utf-8") as f:
        json.dump(lock, f, indent=2)
    return 0


def verify(task_id):
    lock = read_lock(task_id)
    problems = []
    before = lock.get("git", {})
    after = git_state()
    if before.get("head") != after.get("head"):
        problems.append(f"HEAD moved: {before.get('head')} -> {after.get('head')}")
    if before.get("branch") != after.get("branch"):
        problems.append(f"branch changed: {before.get('branch')} -> {after.get('branch')}")
    if before.get("stash") != after.get("stash"):
        problems.append("stash list changed")

    old = lock.get("files", {})
    new = tracked_files()
    changed = sorted({*old, *new} - {path for path in old.keys() & new.keys() if old[path] == new[path]})
    outside = [path for path in changed if not matches(path, lock.get("paths", []))]
    if outside:
        problems.append("changed outside Paths: " + ", ".join(outside[:20]))
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 4
    print(f"[guard] scope ok: {len(changed)} file(s) changed, all inside Paths")
    return 0


def release(task_id):
    path = lock_path(task_id)
    if os.path.exists(path):
        os.remove(path)
    return 0


def status():
    if not os.path.isdir(LOCKS):
        return 0
    for name in sorted(os.listdir(LOCKS)):
        if name.endswith(".json"):
            with open(os.path.join(LOCKS, name), encoding="utf-8") as f:
                lock = json.load(f)
            print(f"{lock['id']}\tpid {lock['pid']}\t{lock['started']}\t{', '.join(lock.get('paths', []))}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    command = sys.argv[1]
    if command == "status":
        raise SystemExit(status())
    if len(sys.argv) < 3:
        raise SystemExit(f"usage: agent_guard.py {command} <task-id>")
    task = sys.argv[2]
    if command == "acquire":
        if len(sys.argv) < 4:
            raise SystemExit("usage: agent_guard.py acquire <task-id> <brief>")
        raise SystemExit(acquire(task, sys.argv[3]))
    if command == "snapshot":
        raise SystemExit(snapshot(task))
    if command == "verify":
        raise SystemExit(verify(task))
    if command == "release":
        raise SystemExit(release(task))
    raise SystemExit(__doc__)
