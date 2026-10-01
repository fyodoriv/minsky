"""Tests for scripts/gh_issue_task_source.py — `TaskSource` GitHub-Issues adapter.

The adapter satisfies `pick_task.TaskSource` (rule #2 — every dependency
through an interface) and adds the daemon-side `claim` / `close_verify`
verbs from the task spec. All cases use an injected `gh` stub so the
suite has no network or auth surface.

≥8 paired cases (4 verbs × success/error) per the task's Measurement.

Run: `python3 -m pytest tests/test_gh_issue_task_source.py -v`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Callable, Sequence

import pytest

# Allow importing scripts/* without installing the package.
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import gh_issue_task_source as gits  # noqa: E402
import pick_task  # noqa: E402


# --- Test helpers --------------------------------------------------------


def _issue(
    number: int,
    *,
    title: str,
    body: str = "",
    labels: Sequence[str] = (),
    state: str = "OPEN",
    assignees: Sequence[str] = (),
) -> dict:
    return {
        "number": number,
        "title": title,
        "body": body,
        "labels": [{"name": n} for n in labels],
        "state": state,
        "assignees": [{"login": a} for a in assignees],
    }


def _make_runner(issues: list[dict]) -> Callable[[Sequence[str]], gits.GhResult]:
    """Mutable in-memory `gh` stub. Mutates `issues` on edits."""

    def runner(argv: Sequence[str]) -> gits.GhResult:
        argv = list(argv)
        if argv[:3] == ["issue", "list", "--state"]:
            label = argv[argv.index("--label") + 1]
            filtered = [
                {
                    "number": i["number"],
                    "title": i["title"],
                    "body": i["body"],
                    "labels": i["labels"],
                }
                for i in issues
                if i["state"] == "OPEN"
                and any(lbl["name"] == label for lbl in i["labels"])
            ]
            return gits.GhResult(0, json.dumps(filtered), "")
        if argv[:2] == ["issue", "view"]:
            number = int(argv[2])
            match = next((i for i in issues if i["number"] == number), None)
            if match is None:
                return gits.GhResult(1, "", "not found")
            wanted = argv[argv.index("--json") + 1].split(",")
            payload = {k: match.get(k) for k in wanted if k in match}
            return gits.GhResult(0, json.dumps(payload), "")
        if argv[:2] == ["issue", "edit"] and "--add-assignee" in argv:
            number = int(argv[2])
            agent = argv[argv.index("--add-assignee") + 1]
            match = next((i for i in issues if i["number"] == number), None)
            if match is None:
                return gits.GhResult(1, "", "not found")
            if agent not in [a["login"] for a in match["assignees"]]:
                match["assignees"].append({"login": agent})
            return gits.GhResult(0, "", "")
        return gits.GhResult(2, "", f"unsupported: {argv}")

    return runner


def _broken_runner(rc: int = 1, stderr: str = "gh exploded") -> Callable[[Sequence[str]], gits.GhResult]:
    def runner(_argv: Sequence[str]) -> gits.GhResult:
        return gits.GhResult(rc, "", stderr)

    return runner


_FULL_BODY = (
    "**ID**: probe-the-loop\n"
    "**Tags**: stability\n"
    "**Hypothesis**: HEAD probe surfaces idle workers.\n"
    "**Success**: probe <200ms p95.\n"
    "**Pivot**: probe overhead >500ms p95.\n"
    "**Measurement**: pytest -q\n"
    "**Anchor**: rule #9.\n"
)


# --- list_open_tasks -----------------------------------------------------


class TestListOpenTasks:
    def test_p0_before_p1_in_returned_order(self) -> None:
        # SUCCESS: priority ordering matches the P0→P3 walk (task acceptance e).
        issues = [
            _issue(
                10,
                title="P1 thing",
                body=_FULL_BODY.replace("probe-the-loop", "p1-thing"),
                labels=["priority/P1"],
            ),
            _issue(
                11,
                title="P0 thing",
                body=_FULL_BODY.replace("probe-the-loop", "p0-thing"),
                labels=["priority/P0"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        tasks = src.list_open_tasks()
        assert [t.priority for t in tasks] == ["P0", "P1"]
        assert [t.id for t in tasks] == ["p0-thing", "p1-thing"]

    def test_list_raises_on_gh_failure(self) -> None:
        # ERROR: a broken `gh` must fail loud — silent [] starves the daemon.
        src = gits.GhIssueTaskSource(runner=_broken_runner())
        with pytest.raises(RuntimeError, match="gh issue list failed"):
            src.list_open_tasks()

    def test_labels_become_tags(self) -> None:
        issues = [
            _issue(
                1,
                title="t",
                body=_FULL_BODY,
                labels=["priority/P0", "stability", "milestone-m1"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        tasks = src.list_open_tasks()
        # Body's `**Tags**: stability` + labels minus priority/* prefix.
        assert "stability" in tasks[0].tags
        assert "milestone-m1" in tasks[0].tags
        assert not any(t.startswith("priority/") for t in tasks[0].tags)

    def test_blocked_label_propagates(self) -> None:
        issues = [
            _issue(
                2,
                title="blocked one",
                body=_FULL_BODY.replace("probe-the-loop", "blocked-one"),
                labels=["priority/P0", "blocked"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        task = src.list_open_tasks()[0]
        assert task.blocked is not None and task.blocked.strip() != ""


# --- get_task ------------------------------------------------------------


class TestGetTask:
    def test_get_by_issue_number(self) -> None:
        issues = [_issue(7, title="seven", body=_FULL_BODY, labels=["priority/P0"])]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        task = src.get_task("#7")
        assert task is not None and task.id == "probe-the-loop"

    def test_get_by_bare_number_works(self) -> None:
        issues = [_issue(8, title="eight", body=_FULL_BODY, labels=["priority/P1"])]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        task = src.get_task("8")
        assert task is not None

    def test_get_returns_none_when_issue_missing(self) -> None:
        src = gits.GhIssueTaskSource(runner=_make_runner([]))
        assert src.get_task("#999") is None

    def test_get_by_slug_when_present_in_open_list(self) -> None:
        issues = [
            _issue(
                3,
                title="slug-target",
                body=_FULL_BODY.replace("probe-the-loop", "the-slug"),
                labels=["priority/P0"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        assert src.get_task("the-slug") is not None


# --- find ----------------------------------------------------------------


class TestFind:
    def test_find_by_exact_slug(self) -> None:
        issues = [_issue(1, title="t", body=_FULL_BODY, labels=["priority/P0"])]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        result = src.find("probe-the-loop")
        assert result.ok and result.task is not None
        assert result.task.id == "probe-the-loop"

    def test_find_by_title_substring(self) -> None:
        issues = [
            _issue(
                2,
                title="Implement OTEL backfill",
                body=_FULL_BODY.replace("probe-the-loop", "otel-backfill"),
                labels=["priority/P0"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        result = src.find("otel backfill")
        assert result.ok and result.task is not None

    def test_find_returns_not_ok_when_no_match(self) -> None:
        issues = [_issue(1, title="t", body=_FULL_BODY, labels=["priority/P0"])]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        result = src.find("nothing-named-like-this")
        assert not result.ok
        assert "probe-the-loop" in result.available_ids


# --- claim ---------------------------------------------------------------


class TestClaim:
    def test_claim_adds_assignee(self) -> None:
        issues = [_issue(5, title="t", body=_FULL_BODY, labels=["priority/P0"])]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        src.claim("#5", "agent-alpha")
        assert any(a["login"] == "agent-alpha" for a in issues[0]["assignees"])

    def test_claim_is_idempotent(self) -> None:
        issues = [_issue(5, title="t", body=_FULL_BODY, labels=["priority/P0"])]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        src.claim("#5", "agent-alpha")
        src.claim("#5", "agent-alpha")  # second call must not raise / double-add
        assignees = [a["login"] for a in issues[0]["assignees"]]
        assert assignees == ["agent-alpha"]

    def test_claim_raises_when_gh_fails(self) -> None:
        # Use a stub that succeeds list_open_tasks (so resolve is OK) but
        # fails on edit. Simpler: bare numeric ID + a runner that fails edit only.
        def runner(argv: Sequence[str]) -> gits.GhResult:
            if argv[:2] == ["issue", "edit"]:
                return gits.GhResult(2, "", "permission denied")
            return gits.GhResult(0, "[]", "")

        src = gits.GhIssueTaskSource(runner=runner)
        with pytest.raises(RuntimeError, match="add-assignee failed"):
            src.claim("#5", "agent-alpha")


# --- close_verify --------------------------------------------------------


class TestCloseVerify:
    def test_returns_true_for_closed_issue(self) -> None:
        issues = [_issue(9, title="done", body=_FULL_BODY, labels=["priority/P0"], state="CLOSED")]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        assert src.close_verify("#9") is True

    def test_returns_false_for_open_issue(self) -> None:
        issues = [_issue(9, title="open", body=_FULL_BODY, labels=["priority/P0"], state="OPEN")]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        assert src.close_verify("#9") is False

    def test_returns_false_when_issue_missing(self) -> None:
        src = gits.GhIssueTaskSource(runner=_make_runner([]))
        assert src.close_verify("#404") is False


# --- TaskSource Protocol conformance + picker integration ---------------


class TestProtocolConformance:
    def test_satisfies_task_source_protocol(self) -> None:
        src = gits.GhIssueTaskSource(runner=_make_runner([]))
        assert isinstance(src, pick_task.TaskSource)

    def test_pick_from_source_walks_p0_before_p1(self) -> None:
        # Acceptance (e) — priority ordering matches the P0→P3 walk via
        # the shared `_pick_from_tasks` core in pick_task.py.
        issues = [
            _issue(
                1,
                title="p1",
                body=_FULL_BODY.replace("probe-the-loop", "p1-task"),
                labels=["priority/P1"],
            ),
            _issue(
                2,
                title="p0",
                body=_FULL_BODY.replace("probe-the-loop", "p0-task"),
                labels=["priority/P0"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        chosen = pick_task.pick_from_source(src)
        assert chosen is not None and chosen.id == "p0-task"

    def test_blocked_issue_is_filtered_by_picker(self) -> None:
        issues = [
            _issue(
                1,
                title="blocked",
                body=_FULL_BODY.replace("probe-the-loop", "blocked-task"),
                labels=["priority/P0", "blocked"],
            ),
            _issue(
                2,
                title="fine",
                body=_FULL_BODY.replace("probe-the-loop", "fine-task"),
                labels=["priority/P1"],
            ),
        ]
        src = gits.GhIssueTaskSource(runner=_make_runner(issues))
        chosen = pick_task.pick_from_source(src)
        # blocked-by-label P0 must be filtered; fine-task P1 wins.
        assert chosen is not None and chosen.id == "fine-task"


# --- Self-test smoke ----------------------------------------------------


def test_selftest_round_trips_exit_0() -> None:
    """The CLI self-test wraps the same fixtures and must exit 0.

    Pins the **Measurement** clause: `python3 scripts/gh_issue_task_source.py
    --self-test` round-trips a fixture issue and exits 0.
    """
    assert gits.run_selftest(verbose=False) == 0


# --- rule #2 seam: no `gh` invocations outside the adapter --------------


def test_no_gh_issue_calls_outside_adapter() -> None:
    """Adaptor invariant: the `gh issue`/`gh api` surface stays inside the adapter.

    Pins the **Measurement** clause:
    `grep -rE "gh issue|gh api" scripts/ | grep -v gh_issue_task_source.py
     | grep -v pick_task.py | wc -l` returns 0 (rule #2 — gh only inside the adapter).

    Reads scripts/ source files directly so the gate runs in any
    environment without shelling out.
    """
    import re

    scripts_dir = Path(__file__).parent.parent / "scripts"
    pattern = re.compile(r"\bgh\s+(issue|api)\b")
    offenders: list[tuple[str, int, str]] = []
    allowed = {"gh_issue_task_source.py", "pick_task.py"}
    for path in scripts_dir.rglob("*.py"):
        if path.name in allowed:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            # Skip comments + docstrings: rule #2 is about call sites, not prose.
            stripped = line.lstrip()
            if stripped.startswith("#"):
                continue
            if pattern.search(line):
                offenders.append((str(path.relative_to(scripts_dir.parent)), lineno, line.strip()))
    assert not offenders, f"`gh issue`/`gh api` outside adapter: {offenders}"
