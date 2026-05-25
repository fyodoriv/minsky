"""Tests for ``scripts/build_cto_brief.py``.

Parity oracle: ``novel/cross-repo-runner/src/host-cto-audit.test.ts``.
Mirror the test assertions case-by-case to ensure the bash daemon's
CTO brief is byte-equivalent to the TS substrate's brief — operator
prompt-tuning happens on BOTH surfaces in lockstep.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))

from build_cto_brief import (  # noqa: E402  (after sys.path tweak)
    HOST_CTO_AUDIT_PR_LABEL,
    HOST_CTO_PROMPT_HEADER,
    HostCtoSignals,
    build_host_cto_brief,
)


class TestHostCtoPromptHeader:
    """Parity with TS ``HOST_CTO_PROMPT_HEADER`` constant.

    The TS test (``host-cto-audit.test.ts``) asserts the header contains
    specific substrings — same assertions here so the prompts stay
    byte-equivalent across substrates.
    """

    def test_header_contains_all_five_rule_9_fields(self) -> None:
        # TS: "expect(HOST_CTO_PROMPT_HEADER).toContain(field)" for each
        # of the 5 rule-#9 fields. The header must enumerate them so
        # the agent files compliant tasks.
        for field in [
            "**ID**",
            "**Hypothesis**",
            "**Success**",
            "**Pivot**",
            "**Measurement**",
            "**Anchor**",
        ]:
            assert field in HOST_CTO_PROMPT_HEADER, (
                f"rule-#9 field {field} missing from CTO prompt header"
            )

    def test_header_mentions_vanity_metric_refusal(self) -> None:
        # TS: explicit anti-vanity-metric clause + Ries 2011 anchor.
        assert "vanity" in HOST_CTO_PROMPT_HEADER
        assert "Ries 2011" in HOST_CTO_PROMPT_HEADER

    def test_header_mentions_pr_label(self) -> None:
        # The PR label is the load-bearing identifier for the audit's
        # ship-rate metric. The header MUST cite it.
        assert HOST_CTO_AUDIT_PR_LABEL in HOST_CTO_PROMPT_HEADER

    def test_header_mentions_no_fabrication(self) -> None:
        # The "don't fabricate work" clause prevents vanity audits.
        assert "DO NOT" in HOST_CTO_PROMPT_HEADER
        assert "fabricate" in HOST_CTO_PROMPT_HEADER

    def test_pr_label_constant_is_canonical(self) -> None:
        """The label constant must match the TS substrate's canonical
        value. If this changes, audit-PRs filed by the bash daemon
        won't match the metric collector's gh-query."""
        assert HOST_CTO_AUDIT_PR_LABEL == "minsky:cto-audit"


class TestBuildHostCtoBriefPostIteration:
    """Tests for the ``post-iteration`` reason path.

    Mirror TS ``host-cto-audit.test.ts`` § "buildHostCtoBrief —
    post-iteration".
    """

    def _signals(self, **overrides) -> HostCtoSignals:
        defaults = dict(
            host_repo="test-org/test-host",
            host_root="/abs/path/to/test-host",
            tasks_md_path="TASKS.md",
            reason="post-iteration",
            utc_date="2026-05-11",
            completed_task_id="proj-840-slash-command-labels",
            pr_url="https://github.com/test-org/test-host/pull/42",
            files_changed=("a.ts", "b.ts", "c.ts"),
        )
        defaults.update(overrides)
        return HostCtoSignals(**defaults)

    def test_brief_contains_host_repo(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "test-org/test-host" in brief

    def test_brief_contains_completed_task_id(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "proj-840-slash-command-labels" in brief

    def test_brief_contains_pr_url(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "https://github.com/test-org/test-host/pull/42" in brief

    def test_brief_uses_post_iteration_header(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "Just-completed iteration" in brief

    def test_brief_uses_post_iteration_branch_naming(self) -> None:
        # TS: audit branch = "audit/<UTC-date>-<completed-task-id>"
        brief = build_host_cto_brief(self._signals())
        assert "audit/2026-05-11-proj-840-slash-command-labels" in brief

    def test_brief_includes_3_changed_files(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "Files changed (3)" in brief
        assert "  - a.ts" in brief
        assert "  - b.ts" in brief
        assert "  - c.ts" in brief

    def test_brief_includes_no_high_leverage_task_escape_hatch(self) -> None:
        # The agent must know it can exit without filing tasks.
        brief = build_host_cto_brief(self._signals())
        assert "no high-leverage task" in brief


class TestBuildHostCtoBriefQueueEmpty:
    """Tests for the ``queue-empty`` reason path.

    Mirror TS ``host-cto-audit.test.ts`` § "buildHostCtoBrief —
    queue-empty".
    """

    def _signals(self, **overrides) -> HostCtoSignals:
        defaults = dict(
            host_repo="test-org/test-host",
            host_root="/abs/path/to/test-host",
            tasks_md_path="TASKS.md",
            reason="queue-empty",
            utc_date="2026-05-11",
            completed_task_id=None,
            pr_url=None,
            files_changed=(),
        )
        defaults.update(overrides)
        return HostCtoSignals(**defaults)

    def test_brief_uses_queue_empty_header(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "Queue-empty seed audit" in brief

    def test_brief_uses_queue_empty_branch_naming(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "audit/2026-05-11-cross-repo-seed" in brief

    def test_brief_uses_queue_empty_task_instruction(self) -> None:
        brief = build_host_cto_brief(self._signals())
        assert "Seed it with 1-3 rule-#9-compliant task blocks" in brief

    def test_brief_handles_empty_files_changed(self) -> None:
        # TS: when no files changed (queue-empty case), the section
        # reads "Files changed: (none — first audit OR queue-empty seed run)"
        brief = build_host_cto_brief(self._signals())
        assert "Files changed: (none" in brief

    def test_brief_handles_no_completed_task(self) -> None:
        # When completed_task_id is None, the brief reads
        # "Completed task: (none — this is a seed audit; ...)"
        brief = build_host_cto_brief(self._signals())
        assert "Completed task: (none" in brief
        assert "seed audit" in brief

    def test_brief_handles_no_pr_url(self) -> None:
        # When pr_url is None, the brief reads "PR: (no PR opened)".
        brief = build_host_cto_brief(self._signals())
        assert "PR: (no PR opened)" in brief


class TestHostCtoSignalsImmutability:
    """The TS interface uses ``readonly``. The Python dataclass is
    frozen — assert assignment raises."""

    def test_dataclass_is_frozen(self) -> None:
        signals = HostCtoSignals(
            host_repo="a/b",
            host_root="/",
            tasks_md_path="TASKS.md",
            reason="queue-empty",
            utc_date="2026-05-11",
        )
        with pytest.raises(Exception):  # FrozenInstanceError → AttributeError
            signals.host_repo = "c/d"  # type: ignore[misc]


class TestCli:
    """End-to-end CLI tests."""

    def _run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "build_cto_brief.py"), *args],
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_cli_queue_empty(self) -> None:
        result = self._run_cli(
            "--host-repo", "team/repo",
            "--host-root", "/host",
            "--reason", "queue-empty",
            "--utc-date", "2026-05-25",
        )
        assert result.returncode == 0, result.stderr
        assert "Queue-empty seed audit" in result.stdout
        assert "team/repo" in result.stdout
        assert "audit/2026-05-25-cross-repo-seed" in result.stdout

    def test_cli_post_iteration(self) -> None:
        result = self._run_cli(
            "--host-repo", "team/repo",
            "--host-root", "/host",
            "--reason", "post-iteration",
            "--utc-date", "2026-05-25",
            "--completed-task-id", "fix-the-thing",
            "--pr-url", "https://github.com/team/repo/pull/99",
            "--files-changed", "src/a.ts",
            "--files-changed", "src/b.ts",
        )
        assert result.returncode == 0, result.stderr
        assert "Just-completed iteration" in result.stdout
        assert "fix-the-thing" in result.stdout
        assert "https://github.com/team/repo/pull/99" in result.stdout
        assert "Files changed (2)" in result.stdout
        assert "  - src/a.ts" in result.stdout
        assert "  - src/b.ts" in result.stdout
        assert "audit/2026-05-25-fix-the-thing" in result.stdout

    def test_cli_rejects_unknown_reason(self) -> None:
        result = self._run_cli(
            "--host-repo", "a/b",
            "--host-root", "/h",
            "--reason", "totally-made-up",
            "--utc-date", "2026-05-25",
        )
        assert result.returncode != 0
        assert "totally-made-up" in result.stderr or "invalid choice" in result.stderr

    def test_cli_requires_host_repo(self) -> None:
        result = self._run_cli(
            "--host-root", "/h",
            "--reason", "queue-empty",
            "--utc-date", "2026-05-25",
        )
        assert result.returncode != 0
        assert "host-repo" in result.stderr.lower()

    def test_cli_default_tasks_md_path(self) -> None:
        """When --tasks-md-path isn't provided, defaults to 'TASKS.md'."""
        result = self._run_cli(
            "--host-repo", "a/b",
            "--host-root", "/h",
            "--reason", "queue-empty",
            "--utc-date", "2026-05-25",
        )
        assert result.returncode == 0
        assert "Host TASKS.md: TASKS.md" in result.stdout

    def test_cli_custom_tasks_md_path(self) -> None:
        result = self._run_cli(
            "--host-repo", "a/b",
            "--host-root", "/h",
            "--reason", "queue-empty",
            "--utc-date", "2026-05-25",
            "--tasks-md-path", "docs/TASKS.md",
        )
        assert result.returncode == 0
        assert "Host TASKS.md: docs/TASKS.md" in result.stdout
