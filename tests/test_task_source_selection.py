"""Tests for the `task_source` selector in `.minsky/repo.yaml`.

Covers the four acceptance criteria of `ghi-repo-yaml-task-source-field`:

  (a) `task_source` is validated and defaults to `tasks-md`.
  (b) The daemon's picker instantiates the github-issues adapter when set.
  (c) Existing tasks-md hosts are unaffected (defaulting + parity).
  (d) End-to-end: a host configured with `github-issues` picks an open
      issue tagged `priority/P1` through the runner's picker invocation.

The github-issues case uses an in-process `gh` stub so the suite has no
network or auth surface.

Run: `python3 -m pytest tests/test_task_source_selection.py -v`
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Callable, Sequence

import pytest

# Allow importing scripts/* without installing the package.
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import build_brief  # noqa: E402
import gh_issue_task_source as gits  # noqa: E402
import pick_task  # noqa: E402

REPO_ROOT = Path(__file__).parent.parent
PICK_TASK_PY = REPO_ROOT / "scripts" / "pick_task.py"


# --- HostConfig.task_source — schema + loader -----------------------------


def test_load_host_config_defaults_task_source_to_tasks_md(tmp_path: Path) -> None:
    """Acceptance (a): default is `tasks-md` when no repo.yaml exists."""
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.task_source == "tasks-md"


def test_load_host_config_defaults_task_source_when_field_omitted(tmp_path: Path) -> None:
    """Acceptance (a) + (c): an existing repo.yaml with no `task_source`
    key still defaults to `tasks-md` — every existing host is unaffected."""
    minsky_dir = tmp_path / ".minsky"
    minsky_dir.mkdir()
    (minsky_dir / "repo.yaml").write_text(
        'host_repo: "team/repo"\ndefault_branch: "main"\n',
        encoding="utf-8",
    )
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.task_source == "tasks-md"


def test_load_host_config_reads_task_source_github_issues(tmp_path: Path) -> None:
    """Acceptance (a): `task_source: github-issues` is accepted."""
    minsky_dir = tmp_path / ".minsky"
    minsky_dir.mkdir()
    (minsky_dir / "repo.yaml").write_text(
        'host_repo: "team/repo"\ntask_source: "github-issues"\n',
        encoding="utf-8",
    )
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.task_source == "github-issues"


def test_load_host_config_rejects_unknown_task_source(tmp_path: Path) -> None:
    """Acceptance (a): an unknown value fails loud — typos don't silently
    revert to `tasks-md` and starve the github-issues queue."""
    minsky_dir = tmp_path / ".minsky"
    minsky_dir.mkdir()
    (minsky_dir / "repo.yaml").write_text(
        'task_source: "linear"\n', encoding="utf-8",
    )
    with pytest.raises(ValueError, match="task_source"):
        build_brief.load_host_config(tmp_path)


# --- pick_task.py CLI — adapter routing -----------------------------------


def test_pick_task_cli_unknown_task_source_returns_2(tmp_path: Path) -> None:
    """`--task-source=<unknown>` is a CLI usage error."""
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(PICK_TASK_PY), str(tasks_md), "--task-source=linear"],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 2
    assert "linear" in result.stderr


def test_pick_task_cli_tasks_md_unchanged_when_flag_omitted(tmp_path: Path) -> None:
    """Acceptance (c): existing tasks-md hosts behave exactly as before
    when the new flag is omitted — the picker is path-compatible."""
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text(
        textwrap.dedent(
            """\
            # Tasks

            ## P1

            - [ ] Backend-agnostic test task
              **ID**: backend-agnostic-task
              **Tags**: p1, test
              **Hypothesis**: a TASKS.md host still picks without the new flag.
              **Success**: id printed on stdout.
              **Pivot**: <0.5
              **Measurement**: pytest -k tasks_md_unchanged
              **Anchor**: rule #2; rule #9
            """
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, str(PICK_TASK_PY), str(tasks_md)],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "backend-agnostic-task"


def _build_gh_runner(issues: list[dict]) -> Callable[[Sequence[str]], gits.GhResult]:
    """Read-only `gh` stub for the picker integration. Mirrors the shape
    used by tests/test_gh_issue_task_source.py — `issue list --label
    priority/P{0,1}` returns the matching open issues."""

    def runner(argv: Sequence[str]) -> gits.GhResult:
        argv = list(argv)
        if argv[:3] == ["issue", "list", "--state"]:
            label = argv[argv.index("--label") + 1]
            matched = [
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
            return gits.GhResult(0, json.dumps(matched), "")
        return gits.GhResult(2, "", f"unsupported in stub: {argv}")

    return runner


def test_picker_routes_through_gh_issues_adapter_when_selected() -> None:
    """Acceptance (b) + (d): when the selector is `github-issues`, the
    picker calls `list_open_tasks` on `GhIssueTaskSource` and returns the
    highest-priority open issue — no TASKS.md is read.

    End-to-end via the library entry (`pick_from_source`) using a stub
    runner so the suite has no `gh` / network dependency. The shell
    wiring in `bin/minsky-run.sh` calls the same code path."""
    body = textwrap.dedent(
        """\
        **ID**: drive-the-loop-from-issues
        **Tags**: p1, milestone-m1, github-issues
        **Hypothesis**: an issue-backed host is driven by the same picker.
        **Success**: pick prints the issue ID on stdout.
        **Pivot**: <0.5
        **Measurement**: pytest -k picker_routes_through_gh_issues
        **Anchor**: rule #2 (port + impl); rule #9
        """
    )
    issues = [
        {
            "number": 42,
            "title": "Drive the loop from issues",
            "body": body,
            "labels": [{"name": "priority/P1"}],
            "state": "OPEN",
            "assignees": [],
        },
    ]
    source = gits.GhIssueTaskSource(
        repo="fyodoriv/example-host",
        runner=_build_gh_runner(issues),
    )
    chosen = pick_task.pick_from_source(source)
    assert chosen is not None
    assert chosen.id == "drive-the-loop-from-issues"
    assert chosen.priority == "P1"


def test_picker_cli_routes_through_gh_issues_adapter(tmp_path: Path) -> None:
    """End-to-end: the `pick_task.py` CLI, called the same way bin/minsky-run.sh
    calls it, prints the picked task ID for an issue-backed host. The
    github-issues adapter is monkey-patched at module level so the
    out-of-process CLI doesn't shell out to a real `gh`.

    Pin shape: the positional path is still required for parity with the
    tasks-md call shape (bin/minsky-run.sh always passes $host/TASKS.md)
    but it is NOT read when `--task-source=github-issues`."""
    body = textwrap.dedent(
        """\
        **ID**: cli-routed-issue
        **Tags**: p1, github-issues
        **Hypothesis**: a github-issues host's picker prints the issue ID.
        **Success**: stdout = `cli-routed-issue`.
        **Pivot**: <0.5
        **Measurement**: pytest -k picker_cli_routes_through_gh_issues
        **Anchor**: rule #2; rule #9
        """
    )
    # The CLI process loads gh_issue_task_source which calls gh on PATH.
    # Inject a stub runner via a sitecustomize-style preload module that
    # monkey-patches `_default_gh_runner` before the CLI imports it.
    stub = tmp_path / "stub_runner.py"
    stub.write_text(
        textwrap.dedent(
            f"""
            import json
            import sys
            from pathlib import Path
            sys.path.insert(0, "{REPO_ROOT / 'scripts'}")
            import gh_issue_task_source as gits

            ISSUES = [
                {{
                    "number": 7,
                    "title": "CLI-routed issue",
                    "body": {body!r},
                    "labels": [{{"name": "priority/P1"}}],
                    "state": "OPEN",
                    "assignees": [],
                }},
            ]

            def _stub(argv):
                argv = list(argv)
                if argv[:3] == ["issue", "list", "--state"]:
                    label = argv[argv.index("--label") + 1]
                    matched = [
                        {{
                            "number": i["number"],
                            "title": i["title"],
                            "body": i["body"],
                            "labels": i["labels"],
                        }}
                        for i in ISSUES
                        if i["state"] == "OPEN"
                        and any(l["name"] == label for l in i["labels"])
                    ]
                    return gits.GhResult(0, json.dumps(matched), "")
                return gits.GhResult(2, "", f"unsupported: {{argv}}")

            gits._default_gh_runner = _stub
            """
        ),
        encoding="utf-8",
    )
    # Force the stub to load BEFORE pick_task.py imports gh_issue_task_source.
    env_pythonpath = f"{tmp_path}{':' + (REPO_ROOT / 'scripts').as_posix()}"
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n", encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import stub_runner; "
                "import runpy; "
                "import sys; "
                f"sys.argv = ['pick_task.py', '{tasks_md}', '--task-source=github-issues', '--gh-issues-repo=fyodoriv/example-host']; "
                f"runpy.run_path('{PICK_TASK_PY}', run_name='__main__')"
            ),
        ],
        capture_output=True, text=True, check=False,
        env={"PYTHONPATH": env_pythonpath, "PATH": ""},
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "cli-routed-issue"
