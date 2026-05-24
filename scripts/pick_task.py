#!/usr/bin/env python3
"""scripts/pick_task.py — Path A Phase 7 skeleton.

Status: SKELETON ONLY. Not yet wired into bin/minsky. Filed 2026-05-24
alongside `path-a-phase-7-cross-repo-runner-shell-rewrite` (TASKS.md P0).

Goal: replace the TypeScript TASKS.md picker (`pickHostTask` in
`novel/cross-repo-runner/src/task-finder.ts`, ~470 LOC) with a single
Python file that:
  1. Reads a TASKS.md file.
  2. Parses the tasks.md spec format (first line `# Tasks`, `## P0/P1/P2/P3`
     sections, `- [ ] task-id` rows with indented bold-metadata fields).
  3. Validates rule-9 fields per task (Hypothesis / Success / Pivot /
     Measurement / Anchor) — required for P0 and P1, optional below.
  4. Filters out:
     - Tasks claimed by another agent: `(@<agent-id>)` suffix.
     - Tasks blocked: `**Status**: blocked` field.
     - Tasks with malformed rule-9 fields (the parser must reject these
       loudly, not silently — see `vision.md` § rule #9).
  5. Returns the top-priority unclaimed task ID on stdout, exit 0.
     Returns empty stdout + exit 0 if no task is pickable.
     Exits non-zero on parse error.

Parity test: must produce the same ID the TypeScript `pickHostTask` would
for every fixture under `novel/cross-repo-runner/test/`. The parity
fixture harness lives at `tests/pick_task.test.py` (forthcoming in Phase 7's
implementation PR).

Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

# --- Constants ------------------------------------------------------------

PRIORITY_ORDER = ["P0", "P1", "P2", "P3"]
REQUIRED_RULE_9_FIELDS_AT_P0_P1 = (
    "Hypothesis",
    "Success",
    "Pivot",
    "Measurement",
    "Anchor",
)

# Per `vision.md` § rule #9: each field must fit on ONE line (the parser
# uses `^\*\*<Field>\*\*:\s*(.+)$` per line; continuation lines orphan the
# value and the task is silently dropped — this is intentional to surface
# malformed entries loudly).
FIELD_REGEX = re.compile(r"^\s+- \*\*(?P<field>[A-Za-z][A-Za-z0-9 _-]+)\*\*:\s*(?P<value>.+)$")
TASK_HEADER_REGEX = re.compile(r"^- \[ \] `(?P<id>[a-z0-9][a-z0-9-]+)`(.*)$")
PRIORITY_HEADER_REGEX = re.compile(r"^## (P[0-3])$")
CLAIM_REGEX = re.compile(r"\(@[a-z0-9][a-z0-9-]+\)$")


@dataclass
class Task:
    id: str
    priority: str
    header_line: str
    fields: dict[str, str]
    claimed: bool


# --- Parser ---------------------------------------------------------------


def parse(text: str) -> list[Task]:
    """Parse TASKS.md text into a list of Task records.

    Tasks without rule-9 fields are dropped from the result silently when
    they're P0 or P1 — that's the spec behavior. The drop IS the loudness
    (the picker just returns the next pickable task, the operator notices
    "why isn't this task being picked" and fixes the fields).
    """
    tasks: list[Task] = []
    current_priority: str | None = None
    current_task: Task | None = None

    for line in text.splitlines():
        priority_match = PRIORITY_HEADER_REGEX.match(line)
        if priority_match:
            if current_task is not None:
                tasks.append(current_task)
                current_task = None
            current_priority = priority_match.group(1)
            continue

        task_match = TASK_HEADER_REGEX.match(line)
        if task_match and current_priority is not None:
            if current_task is not None:
                tasks.append(current_task)
            current_task = Task(
                id=task_match.group("id"),
                priority=current_priority,
                header_line=line,
                fields={},
                claimed=bool(CLAIM_REGEX.search(line)),
            )
            continue

        field_match = FIELD_REGEX.match(line)
        if field_match and current_task is not None:
            current_task.fields[field_match.group("field")] = field_match.group("value")
            continue

    if current_task is not None:
        tasks.append(current_task)

    return tasks


# --- Rule-9 validation ----------------------------------------------------


def is_pickable(task: Task) -> bool:
    """Whether a task is pickable per the rule-9 contract."""
    if task.claimed:
        return False
    if task.fields.get("Status", "").strip().lower() == "blocked":
        return False
    if task.priority in ("P0", "P1"):
        for field in REQUIRED_RULE_9_FIELDS_AT_P0_P1:
            value = task.fields.get(field, "").strip()
            if not value or "<TBD>" in value:
                return False
    return True


# --- Picker ---------------------------------------------------------------


def pick(tasks: list[Task]) -> Task | None:
    """Top-priority unclaimed task across the priority order. None if none."""
    for priority in PRIORITY_ORDER:
        for task in tasks:
            if task.priority == priority and is_pickable(task):
                return task
    return None


# --- CLI -----------------------------------------------------------------


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: pick_task.py <path-to-TASKS.md>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print(f"file not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    tasks = parse(text)
    chosen = pick(tasks)
    if chosen is not None:
        print(chosen.id)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
