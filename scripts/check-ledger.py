#!/usr/bin/env python3
"""Fail when a tracked minsky item has no row in absorbed.md.

Items: repo-root entries, .claude/skills/*, bin/*, novel/*, novel/adapters/*,
docs/*, scripts/* (git-tracked). A row's first backticked cell is a glob;
the first matching row wins, so specific rows go above catch-alls.
"""
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
ledger = (root / "absorbed.md").read_text()
globs = re.findall(r"^\| `([^`]+)` \|", ledger, re.M)

files = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True,
                       text=True, check=True).stdout.split()
items = set()
for f in files:
    p = f.split("/")
    items.add(p[0])
    if p[0] in ("bin", "docs", "scripts") and len(p) > 1:
        items.add("/".join(p[:2]))
    if p[0] == "novel" and len(p) > 1:
        items.add("/".join(p[:2]))
        if p[1] == "adapters" and len(p) > 2:
            items.add("/".join(p[:3]))
    if p[:2] == [".claude", "skills"] and len(p) > 2:
        items.add("/".join(p[:3]))


def owner(item):
    for g in globs:
        if "/" not in g and "/" in item:
            continue  # root catch-alls cover root entries only
        if fnmatch.fnmatchcase(item, g) or item == g:
            return g
    return None


missing = sorted(i for i in items if owner(i) is None)
print(f"items={len(items)} disposed={len(items) - len(missing)} undisposed={len(missing)}")
for m in missing:
    print("  no row:", m)
sys.exit(1 if missing else 0)
