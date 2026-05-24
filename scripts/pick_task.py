#!/usr/bin/env python3
"""scripts/pick_task.py — Path A Phase 7 picker (parity port of task-finder.ts).

Replaces the TypeScript `pickHostTask` / `parseTasksMd` / `findTask` in
`novel/cross-repo-runner/src/task-finder.ts` (473 LOC) with a single Python
file. Same semantics, same fixture-passing behavior.

The bash counterpart lives at `bin/minsky-run.sh` — see that file for the
round-robin loop logic.

Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7

CLI:
    python3 scripts/pick_task.py <path-to-TASKS.md>
        [--open-pr-branches=<comma-separated-branch-names>]
        [--branch-prefix=feat/]
        [--skip-task-ids=<comma-separated-task-ids>]
        [--find=<task-id-or-title-substring>]

Default mode (no --find): prints the top-priority pickable task ID on
stdout, or empty if none. Exit codes: 0 on success (whether or not a
task was picked); 1 on file not found or parse error; 2 on bad CLI args.

`--find <query>` mode: prints the matched task's ID on stdout (exit 0),
or a "task not found" message + the available IDs on stderr (exit 3).
Matches the TypeScript `findTask` return shape — exact-ID match
case-sensitive first, then case-insensitive substring on title.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# --- Constants ------------------------------------------------------------

PRIORITY_ORDER = ("P0", "P1")  # P2/P3 are NEVER auto-picked (matches TS)
REQUIRED_RULE_9_FIELDS = ("hypothesis", "success", "pivot", "measurement", "anchor")

# Per task-finder.ts: priority sections `## P0/P1/P2/P3`, checkbox rows
# `- [ ] title` or `- [x] title`, metadata bullets `  - **Field**:` or
# `  **Field**:` (leading `-` or `*` is stripped before field-match).
PRIORITY_RE = re.compile(r"^##\s+(P\d)\b")
CHECKBOX_RE = re.compile(r"^-\s+\[\s*[ x]\s*\]\s+(.*)$")
STRIP_BULLET_RE = re.compile(r"^[-*]\s+")
LEADING_WS_RE = re.compile(r"^[ \t]*")

# Field regexes — match against the line AFTER leading whitespace is
# stripped AND after any leading bullet (`- ` or `* `) is removed.
FIELD_REGEXES = {
    "id": re.compile(r"^\*\*ID\*\*:\s*(.+)$"),
    "tags": re.compile(r"^\*\*Tags\*\*:\s*(.+)$"),
    "details": re.compile(r"^\*\*Details\*\*:\s*(.+)$"),
    "hypothesis": re.compile(r"^\*\*Hypothesis\*\*:\s*(.+)$"),
    "success": re.compile(r"^\*\*Success\*\*:\s*(.+)$"),
    "pivot": re.compile(r"^\*\*Pivot\*\*:\s*(.+)$"),
    "measurement": re.compile(r"^\*\*Measurement\*\*:\s*(.+)$"),
    "anchor": re.compile(r"^\*\*Anchor\*\*:\s*(.+)$"),
    "blocked": re.compile(r"^\*\*Blocked\*\*:\s*(.+)$"),
}


@dataclass
class ParsedTask:
    """One parsed task block — mirrors the TypeScript `ParsedTask` interface."""

    title: str
    priority: str
    id: str | None = None
    tags: list[str] = field(default_factory=list)
    details: str | None = None
    hypothesis: str | None = None
    success: str | None = None
    pivot: str | None = None
    measurement: str | None = None
    anchor: str | None = None
    blocked: str | None = None


# --- Parser ---------------------------------------------------------------


def _leading_indent_width(line: str) -> int:
    """Number of leading whitespace chars (tabs + spaces). Mirrors TS."""
    match = LEADING_WS_RE.match(line)
    return len(match.group(0)) if match else 0


def parse_tasks_md(content: str) -> list[ParsedTask]:
    """Parse TASKS.md content into a list of ParsedTask records.

    Parity contract: must produce the same output the TypeScript
    `parseTasksMd` produces for any same input. The test suite at
    `tests/test_pick_task.py` pins this via fixtures lifted from
    `novel/cross-repo-runner/src/task-finder.test.ts`.
    """
    tasks: list[ParsedTask] = []
    current_priority = ""
    current: ParsedTask | None = None
    # Continuation tracking for multi-line metadata bullets. When a
    # `**Field**:` matches we remember the field's indent + a setter that
    # appends to the captured field. Subsequent lines whose indent is
    # STRICTLY greater get appended; siblings/headings close it.
    field_indent: int | None = None
    field_setter: object | None = None  # callable(extra: str) -> None

    def flush() -> None:
        nonlocal current
        if current is not None and current.id is not None:
            tasks.append(current)
        current = None

    for line in content.splitlines():
        # Priority section header.
        m = PRIORITY_RE.match(line)
        if m:
            flush()
            current_priority = m.group(1)
            field_indent = None
            field_setter = None
            continue

        # Checkbox row → start a new task.
        m = CHECKBOX_RE.match(line)
        if m:
            flush()
            current = ParsedTask(title=m.group(1).strip(), priority=current_priority)
            field_indent = None
            field_setter = None
            continue

        if current is None:
            continue

        # Metadata field bullet — strip leading whitespace + optional
        # leading bullet character before matching.
        indent = _leading_indent_width(line)
        stripped = line.strip()
        stripped = STRIP_BULLET_RE.sub("", stripped, count=1)

        matched_field = False
        for field_name, pattern in FIELD_REGEXES.items():
            m = pattern.match(stripped)
            if not m:
                continue
            value = m.group(1).strip()
            if field_name == "tags":
                current.tags = [t.strip() for t in value.split(",") if t.strip()]
                field_indent = indent
                # Tags don't support continuation in TS — keep matching but no setter.
                field_setter = None
            else:
                setattr(current, field_name, value)
                field_indent = indent

                def _append(extra: str, _name=field_name) -> None:  # noqa: ANN001
                    cur = getattr(current, _name)
                    if cur is not None:
                        setattr(current, _name, cur + " " + extra)

                field_setter = _append
            matched_field = True
            break

        if matched_field:
            continue

        # Continuation: a non-empty line indented STRICTLY MORE than the
        # active field's bullet → append to that field.
        if field_setter is not None and field_indent is not None and stripped:
            if indent > field_indent:
                field_setter(stripped)
                continue

        # Sibling line at <= field_indent → close the continuation.
        if field_indent is not None and indent <= field_indent and stripped:
            field_indent = None
            field_setter = None

    flush()
    return tasks


# --- Picker ---------------------------------------------------------------


def is_rule_9_compliant(task: ParsedTask) -> bool:
    """True when all 5 rule-#9 fields are present (any non-None value)."""
    return all(getattr(task, fn) is not None for fn in REQUIRED_RULE_9_FIELDS)


def is_not_blocked(task: ParsedTask) -> bool:
    """True when the `Blocked` field is absent or empty."""
    return task.blocked is None or task.blocked.strip() == ""


def pick_host_task(
    content: str,
    open_pr_branches: Iterable[str] = (),
    branch_prefix: str = "feat/",
    skip_task_ids: Iterable[str] = (),
) -> ParsedTask | None:
    """Top-priority unclaimed rule-#9-compliant task across P0 then P1.

    Parity contract: matches `pickHostTask` in task-finder.ts.
    """
    open_branches = set(open_pr_branches)
    skip_ids = set(skip_task_ids)
    tasks = parse_tasks_md(content)
    eligible = [
        t for t in tasks
        if is_rule_9_compliant(t)
        and is_not_blocked(t)
        and t.id is not None
        and f"{branch_prefix}{t.id}" not in open_branches
        and t.id not in skip_ids
    ]
    for priority in PRIORITY_ORDER:
        for task in eligible:
            if task.priority == priority:
                return task
    return None


# --- Finder ---------------------------------------------------------------


@dataclass
class FindTaskResult:
    """Result of a `find_task` lookup. Mirrors the TS `FindTaskResult` union.

    `ok=True` means we found a task; `task` is populated. `ok=False` means
    we didn't; `reason` and `available_ids` describe why.
    """

    ok: bool
    task: ParsedTask | None = None
    reason: str | None = None
    available_ids: list[str] = field(default_factory=list)


def find_task(content: str, query: str) -> FindTaskResult:
    """Find a task by ID (exact, case-sensitive) or title (substring, case-insensitive).

    Parity contract: matches `findTask` in task-finder.ts. First pass
    matches `task.id == query` exactly. Second pass falls through to
    case-insensitive substring on title. Returns `ok=False` with the
    available IDs when neither matches.
    """
    tasks = parse_tasks_md(content)
    query_lower = query.lower()
    # First pass — exact ID match (case-sensitive; kebab-IDs are lower-case by convention).
    for task in tasks:
        if task.id == query:
            return FindTaskResult(ok=True, task=task)
    # Second pass — case-insensitive substring on title.
    for task in tasks:
        if query_lower in task.title.lower():
            return FindTaskResult(ok=True, task=task)
    return FindTaskResult(
        ok=False,
        reason=f'task "{query}" not found in TASKS.md (matched neither **ID**: nor title)',
        available_ids=[t.id for t in tasks if t.id is not None],
    )


# --- CLI -----------------------------------------------------------------


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: pick_task.py <path-to-TASKS.md> [--branch-prefix=feat/]"
              " [--open-pr-branches=<csv>] [--skip-task-ids=<csv>] [--find=<query>]",
              file=sys.stderr)
        return 2
    path = Path(argv[1])
    branch_prefix = "feat/"
    open_pr_branches: list[str] = []
    skip_task_ids: list[str] = []
    find_query: str | None = None
    for arg in argv[2:]:
        if arg.startswith("--branch-prefix="):
            branch_prefix = arg.split("=", 1)[1]
        elif arg.startswith("--open-pr-branches="):
            open_pr_branches = [s for s in arg.split("=", 1)[1].split(",") if s]
        elif arg.startswith("--skip-task-ids="):
            skip_task_ids = [s for s in arg.split("=", 1)[1].split(",") if s]
        elif arg.startswith("--find="):
            find_query = arg.split("=", 1)[1]
        else:
            print(f"unknown flag: {arg}", file=sys.stderr)
            return 2
    if not path.is_file():
        print(f"file not found: {path}", file=sys.stderr)
        return 1
    content = path.read_text(encoding="utf-8")
    if find_query is not None:
        result = find_task(content, find_query)
        if result.ok and result.task is not None and result.task.id is not None:
            print(result.task.id)
            return 0
        print(result.reason or "not found", file=sys.stderr)
        if result.available_ids:
            print("available IDs:", ", ".join(result.available_ids), file=sys.stderr)
        return 3
    chosen = pick_host_task(
        content,
        open_pr_branches=open_pr_branches,
        branch_prefix=branch_prefix,
        skip_task_ids=skip_task_ids,
    )
    if chosen is not None and chosen.id is not None:
        print(chosen.id)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
