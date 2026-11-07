#!/usr/bin/env python3
"""The mechanical part of the conventions gate. Necessary, not sufficient.

  python3 tools/conventions_check.py <task-id>
  python3 tools/conventions_check.py --files path/to/a.ts path/to/b.ts
"""
import fnmatch
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = (".agents/", "context/", "AGENTS.md", "node_modules/", ".git/", "dist/", "coverage/")
CODE = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".json", ".yaml", ".yml")
ENV_TEMPLATES = (".env.example", ".env.sample", ".env.template")
ATTRIBUTION = re.compile(r"co-authored-by|generated with|claude|anthropic", re.I)
CONSOLE = re.compile(r"\bconsole\.(log|debug|info)\(")
ANY_TYPE = re.compile(r"(:\s*any\b|as\s+any\b)")
TODO = re.compile(r"\b(TODO|FIXME|XXX)\b")


def changed_files():
    result = subprocess.run(["git", "-C", ROOT, "status", "--porcelain"], capture_output=True, text=True)
    paths = []
    for line in result.stdout.splitlines():
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ")[1]
        paths.append(path)
    return paths


def report(fail, warn, message):
    (fail if message.startswith("FAIL") else warn).append(message)


def main(files):
    fails, warns = [], []
    for rel in sorted(set(files)):
        if any(rel.startswith(prefix) for prefix in SKIP) or not os.path.exists(os.path.join(ROOT, rel)):
            continue
        if os.path.basename(rel).startswith(".env") and os.path.basename(rel) not in ENV_TEMPLATES:
            fails.append(f"FAIL {rel}: environment file changed")
            continue
        if not rel.endswith(CODE):
            continue
        path = os.path.join(ROOT, rel)
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
        lines = text.splitlines()

        for number, line in enumerate(lines, 1):
            if ATTRIBUTION.search(line):
                fails.append(f"FAIL {rel}:{number}: attribution or assistant name")
            if CONSOLE.search(line) and (rel.startswith(("apps/", "packages/"))) and "/src/" in rel:
                fails.append(f"FAIL {rel}:{number}: console call; use the logger")
            if ANY_TYPE.search(line) and rel.startswith("packages/core/"):
                fails.append(f"FAIL {rel}:{number}: any in core; parse at the boundary")
            if TODO.search(line):
                warns.append(f"WARN {rel}:{number}: leftover marker")
        if len(lines) > 800:
            warns.append(f"WARN {rel}: {len(lines)} lines; consider splitting")

    attribution = subprocess.run(
        ["git", "-C", ROOT, "log", "--format=%H %s%n%b", "-20"], capture_output=True, text=True
    ).stdout
    for line in attribution.splitlines():
        if ATTRIBUTION.search(line):
            fails.append("FAIL recent commit message contains attribution")

    for message in fails + warns:
        print(message)
    print(f"conventions: {len(fails)} fail, {len(warns)} warn")
    return 1 if fails else 0


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--files":
        sys.exit(main(sys.argv[2:]))
    if len(sys.argv) == 2:
        sys.exit(main(changed_files()))
    raise SystemExit(__doc__)
