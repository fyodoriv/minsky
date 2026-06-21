#!/usr/bin/env python3
"""scripts/pick_task.py — Path A Phase 7 picker (parity port of task-finder.ts).

Replaces the TypeScript `pickHostTask` / `parseTasksMd` / `findTask` in
`novel/cross-repo-runner/src/task-finder.ts` (473 LOC) with a single Python
file. Same semantics, same fixture-passing behavior.

The bash counterpart lives at `bin/minsky-run.sh` — see that file for the
round-robin loop logic.

Rule-#9 `**Success**` aliases: `**Verification**` and `**Acceptance**`
populate the `success` field when no explicit `**Success**` line is present
(first-match wins; an explicit `**Success**` always takes precedence over an
alias). This mirrors `scripts/check-rule-9-tasksmd-fields.mjs`, which already
treats `**Success**` and `**Acceptance**` as equivalent — so a
tasks.md-spec-conventional host (or one of minsky's own Acceptance-only
blocks) parses as rule-9-compliant instead of being silently rejected.

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
from typing import Iterable, Protocol, runtime_checkable

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
    # `Verification` and `Acceptance` are accepted aliases that populate the
    # `success` field. They are matched into a separate parser key so the
    # precedence rule can be applied (explicit `**Success**` always wins; among
    # aliases, first-match wins). Mirrors the Success/Acceptance equivalence in
    # `scripts/check-rule-9-tasksmd-fields.mjs`.
    "verification": re.compile(r"^\*\*Verification\*\*:\s*(.+)$"),
    "acceptance": re.compile(r"^\*\*Acceptance\*\*:\s*(.+)$"),
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

# Parser keys that are NOT real `ParsedTask` attributes — they alias an
# existing field. `Verification`/`Acceptance` both feed the `success` field;
# an explicit `**Success**` line always wins, and among the aliases first-match
# wins (an earlier `**Verification**` is not clobbered by a later
# `**Acceptance**`). See the module docstring + the rule-9 lint.
SUCCESS_ALIAS_KEYS = ("verification", "acceptance")


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
    # True once the active task's `success` field was set by a literal
    # `**Success**` line. An explicit Success always wins, so once this is set
    # a later `**Verification**`/`**Acceptance**` alias is ignored. Reset on
    # every task boundary.
    success_is_explicit = False

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
            success_is_explicit = False
            continue

        # Checkbox row → start a new task.
        m = CHECKBOX_RE.match(line)
        if m:
            flush()
            current = ParsedTask(title=m.group(1).strip(), priority=current_priority)
            field_indent = None
            field_setter = None
            success_is_explicit = False
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
            elif field_name in SUCCESS_ALIAS_KEYS:
                # `Verification`/`Acceptance` feed `success`. Skip when an
                # explicit `**Success**` already won, or when an earlier alias
                # already populated the field (first-match wins among aliases).
                if success_is_explicit or current.success is not None:
                    matched_field = True
                    field_indent = indent
                    field_setter = None  # ignore continuation for a discarded alias
                    break
                current.success = value
                field_indent = indent

                def _append_success(extra: str) -> None:
                    if current.success is not None:
                        current.success = current.success + " " + extra

                field_setter = _append_success
            else:
                if field_name == "success":
                    # An explicit Success overrides any alias-captured value.
                    success_is_explicit = True
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
    return _pick_from_tasks(
        parse_tasks_md(content),
        open_pr_branches=open_pr_branches,
        branch_prefix=branch_prefix,
        skip_task_ids=skip_task_ids,
        all_prs=all_prs,
    )


def _pick_from_tasks(
    tasks: list[ParsedTask],
    open_pr_branches: Iterable[str] = (),
    branch_prefix: str = "feat/",
    skip_task_ids: Iterable[str] = (),
    all_prs: Iterable[dict] | None = None,
) -> ParsedTask | None:
    """Apply the pick filters + P0→P1 priority walk to a parsed task list.

    Shared core of `pick_host_task` (markdown-string entry) and
    `pick_from_source` (TaskSource-port entry) so the filter/priority
    logic lives in exactly one place — the backend only decides how the
    `tasks` list is produced.
    """
    open_branches = set(open_pr_branches)
    skip_ids = set(skip_task_ids)
    pr_snapshots = list(all_prs) if all_prs is not None else None
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


# --- TaskSource port (rule #2 — Ports & Adapters) ------------------------
# Pattern: Hexagonal Architecture / Ports & Adapters (Cockburn 2005). The
# picker reads work from a backend-agnostic port so a second backend
# (GitHub Issues, the next task) is an additive impl, not a rewrite of
# `pick_host_task`. The port is the seam; `TasksMdTaskSource` is the first
# adapter, wrapping the existing markdown parser with ZERO behavior change.


@runtime_checkable
class TaskSource(Protocol):
    """Backend-agnostic source of pickable tasks (the port).

    Implementations translate some external task store (a TASKS.md file
    today, a GitHub Issues / Projects v2 board next) into the picker's
    `ParsedTask` shape. The picker never names a backend — it depends only
    on these three verbs. Per vision.md rule #2: every dependency is
    accessed through an interface.
    """

    def list_open_tasks(self) -> list[ParsedTask]:
        """All open task records the backend knows about, in source order."""
        ...

    def get_task(self, task_id: str) -> ParsedTask | None:
        """The task whose `id` equals `task_id` exactly, or None."""
        ...

    def find(self, query: str) -> FindTaskResult:
        """Resolve a task by exact ID or case-insensitive title substring."""
        ...


class TasksMdTaskSource:
    """`TaskSource` adapter backed by a TASKS.md markdown file.

    Wraps the module-level `parse_tasks_md` / `find_task` parity port so
    the existing picker logic reads through the `TaskSource` interface
    instead of parsing TASKS.md inline. Behavior is unchanged — the same
    parser, the same records — this only relocates the dependency behind
    the port (rule #2).

    Construct from a path (the daemon's case — `TasksMdTaskSource('TASKS.md')`)
    or from already-loaded content (`TasksMdTaskSource(content=...)`, the
    test/fixture case). Exactly one of `path` / `content` must be given.
    """

    def __init__(self, path: str | Path | None = None, *, content: str | None = None) -> None:
        if (path is None) == (content is None):
            raise ValueError("TasksMdTaskSource needs exactly one of `path` or `content`")
        self._path = Path(path) if path is not None else None
        self._content = content

    def _read(self) -> str:
        if self._content is not None:
            return self._content
        assert self._path is not None  # narrowed by __init__ invariant
        return self._path.read_text(encoding="utf-8")

    def list_open_tasks(self) -> list[ParsedTask]:
        return parse_tasks_md(self._read())

    def get_task(self, task_id: str) -> ParsedTask | None:
        for task in self.list_open_tasks():
            if task.id == task_id:
                return task
        return None

    def find(self, query: str) -> FindTaskResult:
        return find_task(self._read(), query)


def pick_from_source(
    source: TaskSource,
    open_pr_branches: Iterable[str] = (),
    branch_prefix: str = "feat/",
    skip_task_ids: Iterable[str] = (),
    all_prs: Iterable[dict] | None = None,
) -> ParsedTask | None:
    """Top-priority pickable task obtained through a `TaskSource` port.

    Backend-agnostic counterpart of `pick_host_task`: it pulls the task
    list from the port (`list_open_tasks`) then applies the identical
    rule-#9 / blocked / open-PR / skip / duplicate filters. `pick_host_task`
    remains the markdown-string entry point used by the parity tests; this
    is the interface-routed entry the CLI uses.
    """
    return _pick_from_tasks(
        source.list_open_tasks(),
        open_pr_branches=open_pr_branches,
        branch_prefix=branch_prefix,
        skip_task_ids=skip_task_ids,
        all_prs=all_prs,
    )


# --- CLI -----------------------------------------------------------------


_TASK_SOURCES = ("tasks-md", "github-issues")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: pick_task.py <path-to-TASKS.md> [--branch-prefix=feat/]"
            " [--open-pr-branches=<csv>] [--skip-task-ids=<csv>]"
            " [--all-prs-json=<path>] [--find=<query>]"
            " [--task-source=tasks-md|github-issues]"
            " [--gh-issues-repo=<owner/name>]",
            file=sys.stderr,
        )
        return 2
    path = Path(argv[1])
    branch_prefix = "feat/"
    open_pr_branches: list[str] = []
    skip_task_ids: list[str] = []
    all_prs: list[dict] | None = None
    find_query: str | None = None
    # `task_source` selects which adapter satisfies the `TaskSource` port.
    # `tasks-md` is the default — every existing host stays unchanged.
    # `github-issues` routes through `scripts/gh_issue_task_source.py`.
    task_source_kind = "tasks-md"
    gh_issues_repo: str | None = None
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
        elif arg.startswith("--task-source="):
            task_source_kind = arg.split("=", 1)[1]
            if task_source_kind not in _TASK_SOURCES:
                print(
                    f"--task-source: {task_source_kind!r} is not one of {_TASK_SOURCES}",
                    file=sys.stderr,
                )
                return 2
        elif arg.startswith("--gh-issues-repo="):
            gh_issues_repo = arg.split("=", 1)[1] or None
        else:
            print(f"unknown flag: {arg}", file=sys.stderr)
            return 2
    # Resolve the TaskSource. For `tasks-md`, parse the positional path. For
    # `github-issues`, route through the gh-backed adapter — the positional
    # path is ignored (kept positional so the CLI shape stays parity-stable).
    source: TaskSource
    if task_source_kind == "github-issues":
        # Local import keeps the tasks-md path import-free of the gh adapter
        # (the github_issues_task_source module imports subprocess + reuses
        # the parser; it has no runtime cost when tasks-md is selected).
        from gh_issue_task_source import GhIssueTaskSource  # noqa: PLC0415
        source = GhIssueTaskSource(repo=gh_issues_repo)
    else:
        if not path.is_file():
            print(f"file not found: {path}", file=sys.stderr)
            return 1
        # Obtain tasks through the TaskSource port — not by parsing TASKS.md
        # inline (rule #2). `TasksMdTaskSource` is the markdown adapter; the
        # GitHub-Issues adapter above is the second impl behind the same port.
        source = TasksMdTaskSource(path)
    if find_query is not None:
        result = source.find(find_query)
        if result.ok and result.task is not None and result.task.id is not None:
            print(result.task.id)
            return 0
        print(result.reason or "not found", file=sys.stderr)
        if result.available_ids:
            print("available IDs:", ", ".join(result.available_ids), file=sys.stderr)
        return 3
    chosen = pick_from_source(
        source,
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
