#!/usr/bin/env python3
"""Keeps the node table in AGENTS.md in step with context/, and enforces budgets.

  python3 tools/context_map.py            rebuild the table
  python3 tools/context_map.py --check    also fail on budget, link or anchor problems

Budgets exist because AGENTS.md is loaded into the system prompt on every turn.
A node is read only when a route names it, so it may be larger than the preamble
but never unbounded.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTX = os.path.join(ROOT, "context")
ALWAYS = ["AGENTS.md"]
ALWAYS_MAX = 7_000
NODE_MAX = 6_000
NODES_MAX = 20
START, END = "<!-- nodes:start -->", "<!-- nodes:end -->"
REQUIRED = ("id", "when", "holds")


def slug(heading):
    text = re.sub(r"[`*]", "", heading.strip().lower())
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def anchors(path):
    with open(path, encoding="utf-8") as f:
        return {slug(m.group(1)) for m in re.finditer(r"^#{1,6} (.+)$", f.read(), re.M)}


def parse_front_matter(text):
    if not text.startswith("---\n"):
        return {}
    head = text.split("---\n", 2)[1]
    meta = {}
    for line in head.strip().split("\n"):
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = value.strip()
    return meta


def read_node(name):
    path = os.path.join(CTX, name)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    meta = parse_front_matter(text)
    meta["size"] = len(text.encode("utf-8"))
    meta["file"] = name
    return meta


def graph():
    names = sorted(n for n in os.listdir(CTX) if n.endswith(".md"))
    return {n[:-3]: read_node(n) for n in names}


def table(nodes):
    rows = [
        "| Node | KB | Read when | Holds |",
        "|---|---|---|---|",
    ]
    for node_id, meta in nodes.items():
        kb = f"{meta['size'] / 1000:.1f}"
        rows.append(f"| [{node_id}](./context/{node_id}.md) | {kb} | {meta.get('when', '')} | {meta.get('holds', '')} |")
    return "\n".join(rows)


def build():
    path = os.path.join(ROOT, "AGENTS.md")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if START not in text or END not in text:
        raise SystemExit("AGENTS.md is missing the nodes markers")
    before, rest = text.split(START)
    after = rest.split(END)[1]
    rebuilt = f"{before}{START}\n{table(graph())}\n{END}{after}"
    with open(path, "w", encoding="utf-8") as f:
        f.write(rebuilt)


def check():
    problems = []
    nodes = graph()

    if len(nodes) > NODES_MAX:
        problems.append(f"{len(nodes)} nodes, over the {NODES_MAX} limit; consolidate before adding")

    for node_id, meta in nodes.items():
        if meta.get("id") != node_id:
            problems.append(f"{node_id}: front matter id is {meta.get('id')!r}, expected {node_id!r}")
        for key in REQUIRED:
            if not meta.get(key):
                problems.append(f"{node_id}: missing front matter '{key}:'")
        if meta["size"] > NODE_MAX:
            problems.append(f"{node_id}: {meta['size']} bytes, over {NODE_MAX}; split it or cut it")
        for link in filter(None, (x.strip() for x in meta.get("links", "").split(","))):
            if link not in nodes:
                problems.append(f"{node_id}: links to unknown node {link}")

    checked = [os.path.join(CTX, n) for n in os.listdir(CTX) if n.endswith(".md")]
    checked.append(os.path.join(ROOT, "AGENTS.md"))
    for path in checked:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for target in re.findall(r"\]\((\.{1,2}/[^)\s]*\.md(?:#[^)\s]*)?|#[^)\s]*)\)", text):
            file_part, _, anchor = target.partition("#")
            resolved = path if not file_part else os.path.normpath(os.path.join(os.path.dirname(path), file_part))
            if not os.path.exists(resolved):
                problems.append(f"{os.path.relpath(path, ROOT)}: no file for {target}")
            elif anchor and anchor not in anchors(resolved):
                problems.append(f"{os.path.relpath(path, ROOT)}: no anchor for {target}")

    loaded = sum(os.path.getsize(os.path.join(ROOT, name)) for name in ALWAYS)
    if loaded > ALWAYS_MAX:
        problems.append(f"always-loaded files are {loaded} bytes, over {ALWAYS_MAX}")
    for name in ALWAYS:
        if not os.path.exists(os.path.join(ROOT, name)):
            problems.append(f"always-loaded file missing: {name}")

    print(f"{len(nodes)} nodes; always loaded: {loaded} bytes (max {ALWAYS_MAX}); largest node: "
          f"{max((m['size'] for m in nodes.values()), default=0)} bytes (max {NODE_MAX})")
    return problems


if __name__ == "__main__":
    build()
    if "--check" in sys.argv:
        found = check()
        print("\n".join(found) if found else "graph ok")
        sys.exit(1 if found else 0)
