"""Tests for ``scripts/resolve_gh_host.py``.

Mirrors ``novel/cross-repo-runner/src/gh-host-resolve.test.ts`` test case
for test case, then adds Python-specific CLI-integration tests against
the thin shell binding.

The TS suite is the parity oracle. If a TS test case ever changes shape,
update the corresponding test here in the same PR to keep the bash and
TS substrates byte-equivalent at the resolver level.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"

# Add scripts/ to import path so we can import resolve_gh_host as a module.
sys.path.insert(0, str(SCRIPTS_DIR))

from resolve_gh_host import (  # noqa: E402  (must come after sys.path tweak)
    ResolveGhHostResult,
    _parse_hostname_from_remote,
    _parse_scheme_url,
    _parse_scp_style_ssh,
    resolve_gh_host,
)


class TestResolveGhHostParity:
    """Byte-for-byte parity with ``gh-host-resolve.test.ts``."""

    def test_explicit_env_wins_over_everything(self) -> None:
        # TS: "explicit GH_HOST env wins over everything"
        assert resolve_gh_host(
            env_gh_host="github.example.com",
            git_remote_url="https://github.com/fyodoriv/minsky.git",
        ) == ResolveGhHostResult(host="github.example.com", source="env")

    def test_https_github_com_remote(self) -> None:
        # TS: "https github.com remote → github.com"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="https://github.com/fyodoriv/minsky.git",
        ) == ResolveGhHostResult(host="github.com", source="git-remote")

    def test_ssh_github_com_remote(self) -> None:
        # TS: "ssh github.com remote → github.com"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="git@github.com:fyodoriv/minsky.git",
        ) == ResolveGhHostResult(host="github.com", source="git-remote")

    def test_https_github_intuit_com_remote(self) -> None:
        # TS: "https github.intuit.com remote → github.intuit.com"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="https://github.intuit.com/team/repo.git",
        ) == ResolveGhHostResult(host="github.intuit.com", source="git-remote")

    def test_ssh_github_intuit_com_remote(self) -> None:
        # TS: "ssh github.intuit.com remote → github.intuit.com"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="git@github.intuit.com:team/repo.git",
        ) == ResolveGhHostResult(host="github.intuit.com", source="git-remote")

    def test_git_scheme_parsed(self) -> None:
        # TS: "git:// scheme is parsed"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="git://github.com/fyodoriv/minsky.git",
        ) == ResolveGhHostResult(host="github.com", source="git-remote")

    def test_https_with_port_returns_host_only(self) -> None:
        # TS: "https with port → host only (no port)"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="https://github.example.com:8443/team/repo.git",
        ) == ResolveGhHostResult(host="github.example.com", source="git-remote")

    def test_env_empty_string_treated_as_unset(self) -> None:
        # TS: "env=empty-string is treated as unset (matches gh's own behaviour)"
        assert resolve_gh_host(
            env_gh_host="",
            git_remote_url="https://github.com/fyodoriv/minsky.git",
        ) == ResolveGhHostResult(host="github.com", source="git-remote")

    def test_malformed_remote_url_returns_fallback(self) -> None:
        # TS: "malformed remote URL → null host + fallback source"
        # Note: TS returns host=null; Python returns host="" (empty string)
        # so the shell caller has a natural sentinel for "do not set".
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="not-a-url",
        ) == ResolveGhHostResult(host="", source="fallback")

    def test_missing_remote_url_returns_fallback(self) -> None:
        # TS: "missing remote URL (e.g. fresh clone, no remote) → null host"
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url=None,
        ) == ResolveGhHostResult(host="", source="fallback")

    def test_trailing_dotgit_stripped(self) -> None:
        # TS: "trailing /.git is stripped from path, hostname intact"
        # Path doesn't carry into hostname so this is effectively a smoke
        # test that the URL without .git suffix still resolves.
        assert resolve_gh_host(
            env_gh_host=None,
            git_remote_url="https://github.com/fyodoriv/minsky",
        ) == ResolveGhHostResult(host="github.com", source="git-remote")

    def test_env_github_com_overrides_intuit_remote(self) -> None:
        # TS: "env GH_HOST 'github.com' is treated as explicit override"
        # This is the operator-escape-hatch scenario.
        assert resolve_gh_host(
            env_gh_host="github.com",
            git_remote_url="https://github.intuit.com/team/repo.git",
        ) == ResolveGhHostResult(host="github.com", source="env")


class TestParseHostnameFromRemote:
    """Internal helper tests — exercises the private parser directly."""

    def test_empty_url_returns_none(self) -> None:
        assert _parse_hostname_from_remote("") is None

    def test_none_url_returns_none(self) -> None:
        assert _parse_hostname_from_remote(None) is None

    def test_whitespace_only_returns_none(self) -> None:
        assert _parse_hostname_from_remote("   \n  ") is None

    def test_trims_surrounding_whitespace(self) -> None:
        assert _parse_hostname_from_remote(
            "  https://github.com/owner/repo  "
        ) == "github.com"


class TestParseSchemeUrl:
    """``https?://`` and ``git://`` scheme parser."""

    def test_https_returns_hostname(self) -> None:
        assert _parse_scheme_url("https://github.com/a/b") == "github.com"

    def test_http_returns_hostname(self) -> None:
        assert _parse_scheme_url("http://example.com/a/b") == "example.com"

    def test_git_scheme_returns_hostname(self) -> None:
        assert _parse_scheme_url("git://example.com/a/b") == "example.com"

    def test_ftp_scheme_returns_none(self) -> None:
        # We only handle three schemes; anything else is "unknown remote".
        assert _parse_scheme_url("ftp://example.com/a/b") is None

    def test_no_scheme_returns_none(self) -> None:
        assert _parse_scheme_url("example.com/a/b") is None

    def test_with_port_strips_port(self) -> None:
        assert _parse_scheme_url("https://example.com:8443/a/b") == "example.com"


class TestParseScpStyleSsh:
    """``[user@]host:path`` parser."""

    def test_user_at_host_colon_path(self) -> None:
        assert _parse_scp_style_ssh("git@github.com:owner/repo.git") == "github.com"

    def test_no_user_host_colon_path(self) -> None:
        # SCP-style without user is uncommon but technically valid.
        assert _parse_scp_style_ssh("github.com:owner/repo.git") == "github.com"

    def test_scheme_prefixed_returns_none(self) -> None:
        # The TS contract: if it has a scheme, parseSchemeUrl owns it.
        assert _parse_scp_style_ssh("https://github.com/owner/repo") is None

    def test_no_colon_returns_none(self) -> None:
        assert _parse_scp_style_ssh("github.com") is None

    def test_colon_before_at_returns_none(self) -> None:
        # "host:user@path" → host_start=at+1, colon < host_start → None.
        assert _parse_scp_style_ssh("host:user@path") is None

    def test_host_with_slash_returns_none(self) -> None:
        # "git@host/extra:path" — the slash invalidates the host segment.
        assert _parse_scp_style_ssh("git@github.com/extra:path") is None

    def test_empty_host_returns_none(self) -> None:
        assert _parse_scp_style_ssh("git@:owner/repo.git") is None


class TestCli:
    """End-to-end tests against the CLI binding."""

    def _run_cli(
        self,
        *args: str,
        env_overrides: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        # Strip ambient GH_HOST so the test environment matches a fresh shell.
        env.pop("GH_HOST", None)
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "resolve_gh_host.py"), *args],
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )

    def test_cli_env_override(self, tmp_path: Path) -> None:
        """``--env-gh-host`` flag wins (test hook)."""
        result = self._run_cli(
            "--host-root", str(tmp_path),
            "--env-gh-host", "github.example.com",
            "--git-remote-url", "https://github.com/a/b.git",
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == ["github.example.com", "env"]

    def test_cli_remote_override(self, tmp_path: Path) -> None:
        """``--git-remote-url`` flag bypasses the git probe."""
        result = self._run_cli(
            "--host-root", str(tmp_path),
            "--git-remote-url", "git@github.intuit.com:team/repo.git",
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == ["github.intuit.com", "git-remote"]

    def test_cli_picks_up_real_env(self, tmp_path: Path) -> None:
        """When ``$GH_HOST`` is set in the process env, the CLI picks it
        up without an explicit ``--env-gh-host`` flag."""
        result = self._run_cli(
            "--host-root", str(tmp_path),
            "--git-remote-url", "https://github.com/a/b.git",
            env_overrides={"GH_HOST": "from-env.example.com"},
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == ["from-env.example.com", "env"]

    def test_cli_fallback_when_no_inputs(self, tmp_path: Path) -> None:
        """When no env and no remote, output is the empty-host fallback."""
        result = self._run_cli(
            "--host-root", str(tmp_path),
            "--git-remote-url", "",
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == ["", "fallback"]

    def test_cli_against_real_git_repo(self, tmp_path: Path) -> None:
        """Initialize a real git repo with a remote and verify the
        probe runs end-to-end (covers the ``probe_git_remote`` shell-out
        path that the unit tests can't reach)."""
        subprocess.run(
            ["git", "init", "--quiet", str(tmp_path)],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(tmp_path),
                "remote",
                "add",
                "origin",
                "git@github.com:test-org/test-repo.git",
            ],
            check=True,
            capture_output=True,
        )
        result = self._run_cli("--host-root", str(tmp_path))
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == ["github.com", "git-remote"]

    def test_cli_against_real_repo_with_no_remote(self, tmp_path: Path) -> None:
        """Real git repo but no `origin` remote → fallback."""
        subprocess.run(
            ["git", "init", "--quiet", str(tmp_path)],
            check=True,
            capture_output=True,
        )
        result = self._run_cli("--host-root", str(tmp_path))
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == ["", "fallback"]


class TestResolveResultIsImmutable:
    """The TS export uses ``readonly`` — the Python dataclass uses frozen."""

    def test_result_is_frozen(self) -> None:
        result = ResolveGhHostResult(host="x", source="env")
        with pytest.raises(Exception):  # FrozenInstanceError, subclass of AttributeError
            result.host = "y"  # type: ignore[misc]
