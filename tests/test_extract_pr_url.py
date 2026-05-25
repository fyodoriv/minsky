"""Tests for ``scripts/extract_pr_url.py``.

Mirrors the ``describe("extractPrUrl", …)`` block in
``novel/cross-repo-runner/src/runner.test.ts`` test-case for test-case
to ensure the bash runner extracts PR URLs identically to the TS
substrate. The TS suite is the parity oracle.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))

from extract_pr_url import extract_pr_url  # noqa: E402


class TestExtractPrUrlParity:
    """Byte-for-byte parity with ``runner.test.ts § describe("extractPrUrl")``."""

    def test_empty_string_returns_none(self) -> None:
        # TS: "returns null on empty / no-match stdout" (case 1)
        assert extract_pr_url("") is None

    def test_no_match_returns_none(self) -> None:
        # TS: "returns null on empty / no-match stdout" (case 2)
        assert extract_pr_url("nothing to see here") is None

    def test_extracts_single_url(self) -> None:
        # TS: "extracts the only PR URL on a clean stdout"
        assert (
            extract_pr_url("PR: https://github.com/test/repo/pull/1")
            == "https://github.com/test/repo/pull/1"
        )

    def test_returns_last_url_when_multiple(self) -> None:
        # TS: multiple URLs — last one wins. This is the subtle bug fix
        # vs the bash `head -1` one-liner the runner used to use.
        stdout = "\n".join(
            [
                "See related: https://github.com/old/repo/pull/1",
                "...",
                "Opened https://github.com/real/host/pull/999",
            ]
        )
        assert extract_pr_url(stdout) == "https://github.com/real/host/pull/999"

    def test_handles_ghe_style_hosts(self) -> None:
        # TS: "handles GHE-style hosts (not just github.com)". This is
        # the PRIMARY bug fix vs the bash regex that hard-codes
        # `github\.com`. Without this, every successful Intuit-host
        # iteration silently recorded pr_url=null.
        assert (
            extract_pr_url("Opened https://github.example.corp/team/proj/pull/42")
            == "https://github.example.corp/team/proj/pull/42"
        )

    def test_handles_github_intuit_com(self) -> None:
        # Specific regression — this is THE host the previous bash
        # regex was silently broken against. Explicit test so a future
        # tighten can't re-introduce the bug.
        assert (
            extract_pr_url("Created PR: https://github.intuit.com/team/repo/pull/123")
            == "https://github.intuit.com/team/repo/pull/123"
        )


class TestExtractPrUrlEdgeCases:
    """Python-side edge cases beyond the TS parity matrix."""

    def test_url_with_trailing_text(self) -> None:
        """The regex shouldn't gobble trailing non-URL text."""
        assert (
            extract_pr_url("Opened https://github.com/a/b/pull/7 successfully")
            == "https://github.com/a/b/pull/7"
        )

    def test_url_with_path_segments_in_owner_or_repo(self) -> None:
        """The pattern requires owner/repo to be single segments
        (``[^\\s/]+``). Multi-segment paths shouldn't match — protects
        against rogue strings like ``https://github.com/foo/bar/baz/pull/1``
        which is not a real PR URL."""
        # github.com/owner/repo/pull/N is the canonical shape. Anything
        # with extra slashes in the owner or repo segments isn't a PR URL.
        # This matches the TS regex [^\s/]+ semantic.
        assert extract_pr_url("https://github.com/foo/bar/baz/pull/1") is None

    def test_url_with_no_pull_number(self) -> None:
        assert extract_pr_url("https://github.com/a/b/pull/") is None

    def test_url_with_non_digit_pull_number(self) -> None:
        assert extract_pr_url("https://github.com/a/b/pull/abc") is None

    def test_multiple_same_repo_urls(self) -> None:
        """When the same PR URL appears multiple times, last wins (parity)."""
        text = "Opened https://x.y/a/b/pull/1\nUpdated https://x.y/a/b/pull/1\n"
        assert extract_pr_url(text) == "https://x.y/a/b/pull/1"

    def test_url_in_middle_of_line(self) -> None:
        assert (
            extract_pr_url(
                "Done [PR: https://github.com/a/b/pull/5] cleanup follows..."
            )
            == "https://github.com/a/b/pull/5"
        )

    def test_pure_function_no_side_effects(self) -> None:
        """Calling twice with the same input gives the same answer."""
        text = "https://github.com/a/b/pull/1"
        assert extract_pr_url(text) == extract_pr_url(text)


class TestCli:
    """End-to-end tests against the CLI binding."""

    def _run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "extract_pr_url.py"), *args],
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_cli_stdout_flag(self) -> None:
        result = self._run_cli("--stdout", "PR: https://github.com/a/b/pull/1")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "https://github.com/a/b/pull/1"

    def test_cli_stdout_flag_no_match(self) -> None:
        """No match ⇒ empty stdout, exit 0 (graceful-degrade contract)."""
        result = self._run_cli("--stdout", "nothing")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == ""

    def test_cli_file_flag(self, tmp_path: Path) -> None:
        log = tmp_path / "stdout.log"
        log.write_text(
            "Working...\nPR opened: https://github.intuit.com/team/repo/pull/42\nDone.\n"
        )
        result = self._run_cli("--stdout-file", str(log))
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "https://github.intuit.com/team/repo/pull/42"

    def test_cli_file_missing_returns_empty(self, tmp_path: Path) -> None:
        """Graceful-degrade: missing file ⇒ empty output, no crash."""
        result = self._run_cli("--stdout-file", str(tmp_path / "does-not-exist"))
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == ""

    def test_cli_requires_input_flag(self) -> None:
        """Either --stdout or --stdout-file is required."""
        result = self._run_cli()
        assert result.returncode != 0
        assert "stdout" in result.stderr.lower()

    def test_cli_picks_last_url_from_file(self, tmp_path: Path) -> None:
        log = tmp_path / "log.txt"
        log.write_text(
            "Related: https://github.com/old/repo/pull/1\n"
            "Created: https://github.com/new/repo/pull/999\n"
        )
        result = self._run_cli("--stdout-file", str(log))
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "https://github.com/new/repo/pull/999"
