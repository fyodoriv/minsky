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

import json
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
    # `Blocked-because` is an accepted alias for `Blocked` — operators
    # used both in TASKS.md before the supervisor's picker recognized
    # only the latter (observed 2026-05-28: persona-rule task was
    # `Blocked-because:` and looped because the picker ignored it).
    # See `scripts/check-tasks-blocked-field-canonical.mjs` for the
    # lint that nudges new tasks toward the canonical `**Blocked**:`.
    "blocked": re.compile(r"^\*\*Blocked(?:-because)?\*\*:\s*(.+)$"),
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


# The set of priority tags a task may carry (`p0`/`p1`), case-normalised.
# A task in `## P0` is misfiled when its tags carry a DIFFERENT priority
# tag from this set — e.g. `p1` while sitting in `## P0`.
_PRIORITY_TAGS = frozenset(p.lower() for p in PRIORITY_ORDER)


def tags_match_section(task: ParsedTask) -> bool:
    """True unless the task carries a priority tag that contradicts its section.

    Section invariant (Liskov & Wing 1994): a block physically placed in
    `## P0` must satisfy the P0 contract — and an explicit priority tag IS
    that contract. A `p1`-tagged block sitting in `## P0` (a misfile) would
    otherwise shadow every genuine `p0`-tagged block below it, because the
    picker walks `PRIORITY_ORDER` by section header only. Gating eligibility
    on tag/section agreement makes the misplaced block ineligible.

    The check is deliberately narrow to stay back-compatible: it rejects a
    task ONLY when its tags contain a recognised priority token (`p0`/`p1`,
    case-insensitive) that DISAGREES with the task's section. A task with no
    priority tag at all is NOT rejected — absence of a declaration is not a
    contradiction, and many legitimate blocks omit the redundant tag. Tasks
    in sections outside `PRIORITY_ORDER` pass through (the caller filters on
    priority afterwards anyway).
    """
    section = task.priority.lower()
    if section not in _PRIORITY_TAGS:
        return True
    tag_priorities = {t.strip().lower() for t in task.tags} & _PRIORITY_TAGS
    if not tag_priorities:
        return True  # no priority tag declared → not a contradiction
    return section in tag_priorities


# --- Duplicate-PR detection (parity port of decideDuplicate) ---------------
# Parity port of `novel/tick-loop/src/duplicate-pr-detector.ts` (`decideDuplicate`
# + `prTitleNamesTask`). Closes the daemon-duplicate-work-detection gap in
# the bash runner: branch-based detection (`open_pr_branches` above) only
# catches `feat/<id>` shapes and only OPEN PRs. Title-based detection
# catches daemon-authored close-out PRs (`daemon/<id>/<task-id>-...`
# timestamps) AND merged-recently PRs (re-creation guard).

# Matches the TS regex: word-boundary around the task ID, accepting
# common separators (space, colon, paren, bracket, slash). The daemon's
# commit convention `feat(<task-id>): …` always trips this; a title
# that just mentions the ID in prose also matches (conservative).
_TASK_ID_BOUNDARY = re.compile(r"[\s:()/\[\]]")


def pr_title_names_task(title: str, task_id: str) -> bool:
    """True when `title` contains `task_id` as a whole token."""
    if not title or not task_id:
        return False
    if task_id not in title:
        return False
    # Whole-token check: chars before/after the match must be word
    # boundaries (start/end of string or a separator char).
    idx = title.find(task_id)
    while idx != -1:
        before_ok = idx == 0 or bool(_TASK_ID_BOUNDARY.match(title[idx - 1]))
        end = idx + len(task_id)
        after_ok = end == len(title) or bool(_TASK_ID_BOUNDARY.match(title[end]))
        if before_ok and after_ok:
            return True
        idx = title.find(task_id, idx + 1)
    return False


def decide_duplicate(
    task_id: str,
    prs: Iterable[dict],
    *,
    now_ms: int | None = None,
    recent_merged_window_days: int = 7,
) -> dict | None:
    """Pure decision: should the daemon open a new PR for `task_id`?

    Parity contract: matches `decideDuplicate` in
    `novel/tick-loop/src/duplicate-pr-detector.ts`.

    `prs` is an iterable of dicts with `number`, `title`, `state`, and
    optional `closedAt` keys — the shape `gh pr list --json
    number,title,state,closedAt` emits, and what `parse_gh_pr_list`
    below produces from that JSON.

    Returns:
        - None when no matching PR (clear to open)
        - {"kind": "open", "pr_number": N} when a matching OPEN PR exists
        - {"kind": "merged-recent", "pr_number": N, "days_ago": float}
          when a matching MERGED PR closed within the window
    """
    import time

    matching = [p for p in prs if pr_title_names_task(p.get("title", ""), task_id)]
    if not matching:
        return None
    open_pr = next((p for p in matching if p.get("state") == "OPEN"), None)
    if open_pr is not None:
        return {"kind": "open", "pr_number": open_pr["number"]}
    # No open match; look for merged-recent
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    merged = [
        p
        for p in matching
        if p.get("state") == "MERGED" and p.get("closedAt")
    ]
    if not merged:
        return None
    # Pick most recent merge (smallest days_ago)
    best: dict | None = None
    for p in merged:
        try:
            ts_ms = _parse_iso_to_ms(p["closedAt"])
        except (ValueError, TypeError):
            continue
        days_ago = (now - ts_ms) / (24 * 3_600_000)
        if best is None or days_ago < best["days_ago"]:
            best = {"pr_number": p["number"], "days_ago": days_ago}
    if best is None or best["days_ago"] > recent_merged_window_days:
        return None
    return {"kind": "merged-recent", "pr_number": best["pr_number"], "days_ago": best["days_ago"]}


def _parse_iso_to_ms(iso: str) -> int:
    """Parse an ISO-8601 timestamp string into epoch milliseconds.

    Tolerates the `Z` suffix that `gh pr list --json closedAt` emits
    (Python's `datetime.fromisoformat` rejected `Z` pre-3.11; this
    normalises to the equivalent `+00:00` so both shapes parse).
    """
    from datetime import datetime

    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    return int(datetime.fromisoformat(s).timestamp() * 1000)


def pick_host_task(
    content: str,
    open_pr_branches: Iterable[str] = (),
    branch_prefix: str = "feat/",
    skip_task_ids: Iterable[str] = (),
    all_prs: Iterable[dict] | None = None,
) -> ParsedTask | None:
    """Top-priority unclaimed rule-#9-compliant task across P0 then P1.

    Parity contract: matches `pickHostTask` in task-finder.ts; the
    `all_prs` parameter is the title-based duplicate-PR filter added
    2026-05-25 (parity with `decideDuplicate` in the TS substrate).

    `all_prs` (optional): full PR snapshot list with `state`/`title`/
    `closedAt` keys. When supplied, tasks with a matching open OR
    merged-recently (≤7d) PR by title are filtered out. When omitted,
    only the branch-based filter applies (back-compat with callers
    that haven't wired the broader PR fetch yet).
    """
    open_branches = set(open_pr_branches)
    skip_ids = set(skip_task_ids)
    pr_snapshots = list(all_prs) if all_prs is not None else None
    tasks = parse_tasks_md(content)
    eligible = []
    for t in tasks:
        if not is_rule_9_compliant(t):
            continue
        if not is_not_blocked(t):
            continue
        if not tags_match_section(t):
            # Section invariant: a block in `## P0`/`## P1` whose `**Tags**:`
            # disagree with its section is a misfile — ineligible, so it can't
            # shadow genuine same-section work. See `tags_match_section`.
            continue
        if t.id is None:
            continue
        if f"{branch_prefix}{t.id}" in open_branches:
            continue
        if t.id in skip_ids:
            continue
        if pr_snapshots is not None and decide_duplicate(t.id, pr_snapshots) is not None:
            continue
        eligible.append(t)
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
        print(
            "usage: pick_task.py <path-to-TASKS.md> [--branch-prefix=feat/]"
            " [--open-pr-branches=<csv>] [--skip-task-ids=<csv>]"
            " [--all-prs-json=<path>] [--find=<query>]",
            file=sys.stderr,
        )
        return 2
    path = Path(argv[1])
    branch_prefix = "feat/"
    open_pr_branches: list[str] = []
    skip_task_ids: list[str] = []
    all_prs: list[dict] | None = None
    find_query: str | None = None
    for arg in argv[2:]:
        if arg.startswith("--branch-prefix="):
            branch_prefix = arg.split("=", 1)[1]
        elif arg.startswith("--open-pr-branches="):
            open_pr_branches = [s for s in arg.split("=", 1)[1].split(",") if s]
        elif arg.startswith("--skip-task-ids="):
            skip_task_ids = [s for s in arg.split("=", 1)[1].split(",") if s]
        elif arg.startswith("--all-prs-json="):
            # Path to a JSON file containing the output of
            # `gh pr list --state all --json number,title,state,closedAt`.
            # Enables the title-based duplicate-PR filter on top of the
            # branch-based one — closes the parity gap with the TS
            # `decideDuplicate` substrate (PR #309, TASKS.md
            # `daemon-duplicate-work-detection`). Missing/unreadable file
            # is non-fatal: degrade to branch-only filtering (rule #6 —
            # the watchdog must not crash the loop on a transient `gh`
            # outage).
            prs_path = Path(arg.split("=", 1)[1])
            try:
                all_prs = json.loads(prs_path.read_text(encoding="utf-8"))
                if not isinstance(all_prs, list):
                    print(
                        f"--all-prs-json: expected JSON array, got {type(all_prs).__name__}",
                        file=sys.stderr,
                    )
                    all_prs = None
            except (OSError, ValueError) as e:
                print(f"--all-prs-json: read failed ({e}); falling back to branch-only filter", file=sys.stderr)
                all_prs = None
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
        all_prs=all_prs,
    )
    if chosen is not None and chosen.id is not None:
        print(chosen.id)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
