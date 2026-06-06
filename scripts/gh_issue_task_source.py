#!/usr/bin/env python3
"""scripts/gh_issue_task_source.py — `TaskSource` adapter backed by GitHub Issues.

Second adapter behind the `TaskSource` Protocol in `scripts/pick_task.py`
(`TasksMdTaskSource` is the first). The daemon picks the backend through
the same port; switching a host from TASKS.md to GitHub Issues is an
additive impl, not a rewrite of the picker.

Original task spec referenced a TypeScript file under
`novel/adapters/task-source.github-issues.ts`. That path was deleted in
the 2026-05-24 Path-A aggressive cut along with the rest of
`novel/cross-repo-runner/`; the picker is now Python
(`scripts/pick_task.py`). Re-scoped here per the task's own Status line.

Mapping issue → ParsedTask
--------------------------

* `title` ← issue title
* `id` ← `**ID**:` line in the issue body when present; otherwise
  `issue-<number>` (the `gh issue view` URL is recoverable from the number)
* `priority` ← `priority/P0` / `priority/P1` label (Pivot path: spec said
  Projects v2 single-select; labels are simpler, equally orderable, and
  documented as the fallback in the task's Pivot threshold)
* `tags` ← all labels minus the `priority/*` family
* rule-#9 fields ← parsed from issue body using the same `**Field**:`
  regexes the TASKS.md parser uses (FIELD_REGEXES in pick_task.py),
  so any markdown shape a human writes in a TASKS.md block parses
  identically in an issue body.
* `blocked` ← `**Blocked**:` body line OR a `blocked` label

`gh` invocation
---------------

All subprocess calls go through a constructor-injected `runner` callable.
The default runner shells out to `gh`. Tests inject a deterministic stub
so no network or auth is required. This is the rule-#2 seam — every
dependency through an interface. No other module imports `gh` directly;
the only `gh issue` / `gh api` callsites in the daemon live in this file.

Anchor: GitHub docs "Linking a pull request to an issue" (default-branch
close keywords); "Using the built-in automations" (Projects v2 "PR merged
→ Done"); Cockburn 2005 *Hexagonal Architecture*; rule #2 (every
dependency through an interface).
"""

from __future__ import annotations

import json
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

# Reuse the existing parser + record type. The adapter's job is to render
# `gh issue list` JSON as `ParsedTask`s; the field regexes that recognise
# rule-#9 metadata in TASKS.md apply unchanged to issue bodies.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

import pick_task  # noqa: E402

# Runner shape: (argv list) -> (returncode, stdout, stderr). The default
# implementation calls `subprocess.run` on the host's `gh` binary; tests
# inject a stub that returns canned JSON.
GhRunner = Callable[[Sequence[str]], "GhResult"]


@dataclass
class GhResult:
    """Result of one `gh` subprocess call."""

    returncode: int
    stdout: str
    stderr: str


# Priority label convention. Pivot from the task spec: rather than the
# Projects v2 GraphQL single-select (brittle in CI per the task's own
# Pivot threshold), order by `priority/P0..P3` labels. P0 first, P1 next;
# P2/P3 mirror the picker's "never auto-pick" rule for parity.
_PRIORITY_LABEL_PREFIX = "priority/"
_PRIORITY_ORDER = ("P0", "P1", "P2", "P3")


def _default_gh_runner(argv: Sequence[str]) -> GhResult:
    """Default runner: shell out to `gh` on PATH."""
    if shutil.which("gh") is None:
        return GhResult(
            returncode=127,
            stdout="",
            stderr=f"gh not on PATH (cmd: {shlex.join(argv)})",
        )
    proc = subprocess.run(
        ["gh", *argv],
        capture_output=True,
        text=True,
        check=False,
    )
    return GhResult(returncode=proc.returncode, stdout=proc.stdout, stderr=proc.stderr)


class GhIssueTaskSource:
    """`TaskSource` adapter backed by GitHub Issues.

    Satisfies the runtime-checkable `pick_task.TaskSource` Protocol:

    * `list_open_tasks` → `gh issue list --state open --json …` then
      parses each issue body for rule-#9 fields.
    * `get_task` → `gh issue view <id> --json …`.
    * `find` → resolves a query to an issue by exact ID, `#N` shorthand,
      or case-insensitive substring on title (delegates to
      `pick_task.find_task` after rendering to TASKS.md-shaped text).

    Plus the daemon-side verbs from the task spec:

    * `claim` → `gh issue edit <number> --add-assignee <agent_id>`.
    * `close_verify` → `gh issue view <number> --json state` confirms
      `CLOSED`. The actual close happens automatically when the daemon's
      PR carrying `Closes #N` merges (GitHub default-branch close
      keywords); this is the safety-net verification.
    """

    def __init__(
        self,
        repo: str | None = None,
        *,
        runner: GhRunner | None = None,
        default_priority_labels: Sequence[str] = ("P0", "P1"),
    ) -> None:
        self._repo = repo  # `owner/name` (None ⇒ gh inferred from cwd)
        self._runner: GhRunner = runner if runner is not None else _default_gh_runner
        # `priority/P0,priority/P1` by default — matches PRIORITY_ORDER in
        # pick_task.py (P2/P3 are never auto-picked). Tests override to
        # exercise edge cases without touching the production policy.
        self._priority_labels = tuple(default_priority_labels)

    # ---- list_open_tasks --------------------------------------------------

    def list_open_tasks(self) -> list[pick_task.ParsedTask]:
        """All open issues with a `priority/P0` or `priority/P1` label, P0 first.

        The Project's priority field is mirrored by `priority/Pn` labels so
        ordering survives without a Projects v2 GraphQL query (Pivot of the
        task spec — labels are equally orderable and far simpler).
        """
        # One `gh issue list` per priority to preserve P0-before-P1 order
        # without depending on `--sort` (gh's default order is `updated`
        # within a state, not by label). Two calls is fine: the daemon
        # invokes this once per tick.
        all_tasks: list[pick_task.ParsedTask] = []
        for label_suffix in self._priority_labels:
            args = [
                "issue",
                "list",
                "--state",
                "open",
                "--label",
                f"{_PRIORITY_LABEL_PREFIX}{label_suffix}",
                "--json",
                "number,title,body,labels",
                "--limit",
                "100",
            ]
            if self._repo is not None:
                args.extend(["--repo", self._repo])
            result = self._runner(args)
            if result.returncode != 0:
                # Fail loud: a daemon that silently returns [] when `gh`
                # is broken would re-pick nothing and starve forever. The
                # runner-level error message already includes the argv.
                raise RuntimeError(
                    f"gh issue list failed (rc={result.returncode}): {result.stderr.strip()}"
                )
            try:
                issues = json.loads(result.stdout) if result.stdout.strip() else []
            except json.JSONDecodeError as e:
                raise RuntimeError(f"gh issue list: malformed JSON ({e})") from e
            for issue in issues:
                task = _issue_to_parsed_task(issue, default_priority=label_suffix)
                if task is not None:
                    all_tasks.append(task)
        return all_tasks

    # ---- get_task ---------------------------------------------------------

    def get_task(self, task_id: str) -> pick_task.ParsedTask | None:
        """Resolve a task by its ID or by `#N` / numeric issue reference.

        Tries the issue-number shortcut first (`gh issue view <N>`),
        falling back to a list scan when the ID isn't a number.
        """
        number = _parse_issue_number(task_id)
        if number is not None:
            return self._fetch_issue(number)
        # Slug-shaped ID: scan the open list and match on the body's `**ID**:`.
        for task in self.list_open_tasks():
            if task.id == task_id:
                return task
        return None

    def _fetch_issue(self, number: int) -> pick_task.ParsedTask | None:
        args = [
            "issue",
            "view",
            str(number),
            "--json",
            "number,title,body,labels,state",
        ]
        if self._repo is not None:
            args.extend(["--repo", self._repo])
        result = self._runner(args)
        if result.returncode != 0:
            return None  # not-found / closed / wrong-repo all collapse here
        try:
            issue = json.loads(result.stdout)
        except json.JSONDecodeError:
            return None
        return _issue_to_parsed_task(issue, default_priority="P1")

    # ---- find -------------------------------------------------------------

    def find(self, query: str) -> pick_task.FindTaskResult:
        """Exact-ID match (case-sensitive) then case-insensitive title substring.

        `#N` / pure-number queries resolve via the issue-number shortcut.
        Mirrors `pick_task.find_task`'s public shape.
        """
        number = _parse_issue_number(query)
        if number is not None:
            task = self._fetch_issue(number)
            if task is not None:
                return pick_task.FindTaskResult(ok=True, task=task)
        open_tasks = self.list_open_tasks()
        for task in open_tasks:
            if task.id == query:
                return pick_task.FindTaskResult(ok=True, task=task)
        query_lower = query.lower()
        for task in open_tasks:
            if query_lower in task.title.lower():
                return pick_task.FindTaskResult(ok=True, task=task)
        return pick_task.FindTaskResult(
            ok=False,
            reason=f'task "{query}" not found in open GitHub Issues',
            available_ids=[t.id for t in open_tasks if t.id is not None],
        )

    # ---- claim ------------------------------------------------------------

    def claim(self, task_id: str, agent_id: str) -> None:
        """Self-assign the issue to `agent_id`.

        Mirrors the agentbrew `gh-issues` task backend contract — claim ≡
        assignee. Idempotent at GitHub's edge: re-assigning a user who's
        already in the list is a no-op.
        """
        number = _resolve_to_number(self, task_id)
        if number is None:
            raise RuntimeError(f"cannot claim {task_id!r}: no matching open issue")
        args = [
            "issue",
            "edit",
            str(number),
            "--add-assignee",
            agent_id,
        ]
        if self._repo is not None:
            args.extend(["--repo", self._repo])
        result = self._runner(args)
        if result.returncode != 0:
            raise RuntimeError(
                f"gh issue edit --add-assignee failed (rc={result.returncode}): "
                f"{result.stderr.strip()}"
            )

    # ---- close_verify -----------------------------------------------------

    def close_verify(self, task_id: str) -> bool:
        """Confirm the issue is CLOSED (safety net after PR merge).

        The actual close happens automatically when the daemon's PR
        carrying `Closes #N` merges (GitHub default-branch close
        keywords). This is a no-network-effect verifier — it returns
        True iff the issue is CLOSED.
        """
        number = _resolve_to_number(self, task_id)
        if number is None:
            return False
        args = [
            "issue",
            "view",
            str(number),
            "--json",
            "state",
        ]
        if self._repo is not None:
            args.extend(["--repo", self._repo])
        result = self._runner(args)
        if result.returncode != 0:
            return False
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            return False
        return str(payload.get("state", "")).upper() == "CLOSED"


# --- Helpers -------------------------------------------------------------


def _resolve_to_number(source: GhIssueTaskSource, task_id: str) -> int | None:
    """Map a task_id (number, `#N`, or slug) to an issue number."""
    number = _parse_issue_number(task_id)
    if number is not None:
        return number
    # Slug lookup: scan list, match on `**ID**:`, return embedded issue number.
    for task in source.list_open_tasks():
        if task.id != task_id:
            continue
        # We stored the issue number on the ParsedTask via the
        # `_issue_to_parsed_task` mapper's id format when there was no
        # `**ID**:` in the body (`issue-<N>`); when there IS an `**ID**:`,
        # the issue number isn't on the record. The slug-claim path is
        # rare in practice — file the issue with `**ID**: <slug>` AND
        # match the slug to the URL slug to recover it. For now we
        # don't support this path; explicit `#N` is the supported claim.
        return None
    return None


def _parse_issue_number(token: str) -> int | None:
    """Extract an integer issue number from `123`, `#123`, or None for slugs."""
    stripped = token.lstrip("#").strip()
    if not stripped:
        return None
    if stripped.isdigit():
        return int(stripped)
    return None


def _issue_to_parsed_task(
    issue: dict, *, default_priority: str
) -> pick_task.ParsedTask | None:
    """Render one `gh issue list` element into a `ParsedTask`.

    Returns None when the issue is missing both a number and a title (a
    corrupt response shape — refuse to silently invent a record).
    """
    title = str(issue.get("title", "")).strip()
    number = issue.get("number")
    if not title or number is None:
        return None
    body = str(issue.get("body") or "")
    labels = issue.get("labels") or []
    label_names = [
        str(lbl.get("name", "")) if isinstance(lbl, dict) else str(lbl)
        for lbl in labels
    ]

    priority = _priority_from_labels(label_names, default=default_priority)
    tag_labels = [n for n in label_names if not n.startswith(_PRIORITY_LABEL_PREFIX)]
    blocked_via_label = "blocked" in (n.lower() for n in label_names)

    # The body parser is reused verbatim: a fake TASKS.md snippet with a
    # checkbox header + the body keeps the regex contract intact (the
    # checkbox is required for `parse_tasks_md` to enter task scope).
    synthetic = _render_synthetic_tasks_md(priority=priority, title=title, body=body)
    parsed = pick_task.parse_tasks_md(synthetic)
    if not parsed:
        # Body has no rule-#9 fields — synthesize an empty record so the
        # adapter still surfaces the issue (the picker will reject it via
        # `is_rule_9_compliant`, which is the correct outcome — visible
        # but ineligible).
        task = pick_task.ParsedTask(title=title, priority=priority)
    else:
        task = parsed[0]
        # The body's `**ID**:` wins; otherwise synthesize a stable ID
        # from the issue number so the picker has something to key on.
        if task.id is None:
            task.id = f"issue-{number}"
    # The body may not declare `**Tags**:` at all — labels are the
    # canonical tag carrier for issues. Merge so both surfaces work.
    merged_tags = list(dict.fromkeys([*task.tags, *tag_labels]))
    task.tags = merged_tags
    if blocked_via_label and (task.blocked is None or not task.blocked.strip()):
        task.blocked = "blocked label"
    if task.id is None:
        task.id = f"issue-{number}"
    return task


def _priority_from_labels(label_names: Iterable[str], *, default: str) -> str:
    for name in label_names:
        if not name.startswith(_PRIORITY_LABEL_PREFIX):
            continue
        suffix = name[len(_PRIORITY_LABEL_PREFIX) :].strip()
        if suffix in _PRIORITY_ORDER:
            return suffix
    return default


def _render_synthetic_tasks_md(*, priority: str, title: str, body: str) -> str:
    """Build a minimal TASKS.md snippet so `parse_tasks_md` can reuse its regexes."""
    lines = [
        f"## {priority}",
        "",
        f"- [ ] {title}",
    ]
    # Indent each body line so it sits inside the checkbox's scope. The
    # parser strips one leading bullet, so an existing leading `- ` on a
    # metadata line is preserved.
    for raw in body.splitlines():
        lines.append(f"  {raw}")
    lines.append("")
    return "\n".join(lines)


# --- Self-test (round-trip with a stub runner) ---------------------------


def _selftest_runner_factory() -> GhRunner:
    """A deterministic in-memory `gh` stub for the self-test.

    Simulates a 3-issue fixture repo: #1 P0 with full rule-#9 metadata,
    #2 P1 with rule-#9 metadata, #3 P1 blocked-by-label. The stub
    handles `issue list` / `issue view` / `issue edit` and tracks
    claim + close state across calls.
    """
    state: dict = {
        "issues": [
            {
                "number": 1,
                "title": "Wire the supervisor probe",
                "state": "OPEN",
                "assignees": [],
                "labels": [{"name": "priority/P0"}, {"name": "stability"}],
                "body": (
                    "**ID**: wire-supervisor-probe\n"
                    "**Tags**: stability, p0\n"
                    "**Hypothesis**: a per-iteration HEAD probe surfaces idle workers.\n"
                    "**Success**: probe runs <200ms p95.\n"
                    "**Pivot**: probe overhead >500ms p95.\n"
                    "**Measurement**: pytest tests/test_supervisor_probe.py -q\n"
                    "**Anchor**: rule #9; Forsgren 2018 Accelerate.\n"
                ),
            },
            {
                "number": 2,
                "title": "Backfill OTEL coverage for the picker",
                "state": "OPEN",
                "assignees": [],
                "labels": [{"name": "priority/P1"}, {"name": "observability"}],
                "body": (
                    "**ID**: backfill-otel-picker\n"
                    "**Tags**: observability\n"
                    "**Hypothesis**: OTEL spans on pick_task surface starvation.\n"
                    "**Success**: every pick emits one span.\n"
                    "**Pivot**: pick latency rises >5% with spans on.\n"
                    "**Measurement**: pytest tests/test_pick_task.py -q\n"
                    "**Anchor**: rule #9; OTEL spec.\n"
                ),
            },
            {
                "number": 3,
                "title": "Investigate flake in chaos suite",
                "state": "OPEN",
                "assignees": [],
                "labels": [{"name": "priority/P1"}, {"name": "blocked"}],
                "body": (
                    "**ID**: flake-chaos-suite\n"
                    "**Tags**: chaos\n"
                    "**Blocked**: waiting on chaos-sandbox-run.mjs landing.\n"
                    "**Hypothesis**: a race in tmpdir teardown causes the flake.\n"
                    "**Success**: chaos suite green 30 runs in a row.\n"
                    "**Pivot**: flake persists after teardown fix.\n"
                    "**Measurement**: pytest tests/chaos -q\n"
                    "**Anchor**: rule #9.\n"
                ),
            },
        ],
    }

    def runner(argv: Sequence[str]) -> GhResult:
        argv = list(argv)
        # `gh issue list --state open --label priority/<X> --json … --limit N`
        if argv[:3] == ["issue", "list", "--state"]:
            label_idx = argv.index("--label")
            label = argv[label_idx + 1]
            filtered = [
                {
                    "number": i["number"],
                    "title": i["title"],
                    "body": i["body"],
                    "labels": i["labels"],
                }
                for i in state["issues"]
                if i["state"] == "OPEN"
                and any(lbl["name"] == label for lbl in i["labels"])
            ]
            return GhResult(0, json.dumps(filtered), "")
        # `gh issue view <N> --json …`
        if argv[:2] == ["issue", "view"]:
            number = int(argv[2])
            match = next((i for i in state["issues"] if i["number"] == number), None)
            if match is None:
                return GhResult(1, "", f"issue {number} not found")
            wanted = argv[argv.index("--json") + 1].split(",")
            payload = {k: match.get(k) for k in wanted if k in match}
            return GhResult(0, json.dumps(payload), "")
        # `gh issue edit <N> --add-assignee <agent>`
        if argv[:2] == ["issue", "edit"] and "--add-assignee" in argv:
            number = int(argv[2])
            agent = argv[argv.index("--add-assignee") + 1]
            match = next((i for i in state["issues"] if i["number"] == number), None)
            if match is None:
                return GhResult(1, "", f"issue {number} not found")
            if agent not in match["assignees"]:
                match["assignees"].append(agent)
            return GhResult(0, "", "")
        return GhResult(2, "", f"unsupported gh argv in self-test: {argv}")

    return runner


def run_selftest(verbose: bool = False) -> int:
    """Round-trip the four port verbs against the in-memory fixture.

    Returns 0 on success, non-zero on any verb failing its contract.
    Run from CLI: `python3 scripts/gh_issue_task_source.py --self-test`.
    """
    src = GhIssueTaskSource(runner=_selftest_runner_factory())

    # 1. list_open_tasks: P0 first, blocked-label task surfaces but is
    #    rule-9-compliant + flagged blocked (picker rejects via is_not_blocked).
    tasks = src.list_open_tasks()
    if [t.priority for t in tasks] != ["P0", "P1", "P1"]:
        print(f"selftest FAIL: priority order {[t.priority for t in tasks]}", file=sys.stderr)
        return 1
    if [t.id for t in tasks] != [
        "wire-supervisor-probe",
        "backfill-otel-picker",
        "flake-chaos-suite",
    ]:
        print(f"selftest FAIL: ids {[t.id for t in tasks]}", file=sys.stderr)
        return 1
    blocked_task = next(t for t in tasks if t.id == "flake-chaos-suite")
    if not blocked_task.blocked:
        print("selftest FAIL: blocked field not propagated", file=sys.stderr)
        return 1

    # 2. get_task by issue number
    task1 = src.get_task("#1")
    if task1 is None or task1.id != "wire-supervisor-probe":
        print(f"selftest FAIL: get_task(#1) -> {task1}", file=sys.stderr)
        return 1

    # 3. find by exact slug + by title substring
    by_slug = src.find("wire-supervisor-probe")
    if not by_slug.ok or by_slug.task is None:
        print("selftest FAIL: find(slug)", file=sys.stderr)
        return 1
    by_title = src.find("otel coverage")
    if not by_title.ok or by_title.task is None or by_title.task.id != "backfill-otel-picker":
        print(f"selftest FAIL: find(title) -> {by_title}", file=sys.stderr)
        return 1
    not_found = src.find("no-such-task")
    if not_found.ok:
        print("selftest FAIL: find(no-such) should be ok=False", file=sys.stderr)
        return 1

    # 4. claim (idempotent)
    src.claim("#1", "agent-007")
    src.claim("#1", "agent-007")  # second call must not raise
    # 5. close_verify on an open issue → False
    if src.close_verify("#1"):
        print("selftest FAIL: close_verify on open issue returned True", file=sys.stderr)
        return 1

    # 6. priority-walk via pick_from_source — P0 wins despite source order
    chosen = pick_task.pick_from_source(src)
    if chosen is None or chosen.id != "wire-supervisor-probe":
        print(f"selftest FAIL: pick_from_source -> {chosen}", file=sys.stderr)
        return 1

    if verbose:
        print("gh_issue_task_source self-test OK (6 round-trip cases)")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        verbose = "--verbose" in argv or "-v" in argv
        return run_selftest(verbose=verbose)
    print(
        "usage: gh_issue_task_source.py --self-test [--verbose]\n"
        "       (the adapter is otherwise imported as a library: "
        "`from gh_issue_task_source import GhIssueTaskSource`)",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
