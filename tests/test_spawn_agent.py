"""Tests for ``scripts/spawn_agent.py``.

The dispatcher has two backends — the future canonical ``openhands
solve`` CLI (ships June 1, 2026) and the existing Python shim at
``novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py``.

These tests exercise the pure ``resolve_agent_argv`` function directly
for every backend × flag combination, then the CLI end-to-end via a
fake-shim fixture (so we don't need OpenHands installed).
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

from spawn_agent import (  # noqa: E402  (after sys.path tweak)
    DEFAULT_SHIM_PATH,
    resolve_agent_argv,
)


class TestResolveAgentArgvCanonical:
    """When ``openhands`` is on PATH, use the canonical CLI shape."""

    def test_minimal_call_returns_openhands_solve_invocation(
        self, tmp_path: Path
    ) -> None:
        brief = tmp_path / "brief.md"
        brief.write_text("dummy")
        result = resolve_agent_argv(
            brief_file=str(brief),
            repo="/host/repo",
            model="claude-opus-4-7",
            openhands_on_path=True,
        )
        assert result == [
            "openhands",
            "solve",
            "--task-file",
            str(brief),
            "--workspace",
            "/host/repo",
            "--model",
            "claude-opus-4-7",
        ]

    def test_canonical_ignores_shim_only_flags(self) -> None:
        """The canonical CLI doesn't take --api-key-env / --base-url /
        --reasoning-effort / --no-extended-thinking. They're silently
        dropped (canonical CLI resolves auth from env directly)."""
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=True,
            api_key_env="ANTHROPIC_API_KEY",
            base_url="http://localhost:11434",
            reasoning_effort="none",
            no_extended_thinking=True,
        )
        # No shim-only flags leak into the canonical argv.
        assert result is not None
        assert "--api-key-env" not in result
        assert "--base-url" not in result
        assert "--reasoning-effort" not in result
        assert "--no-extended-thinking" not in result

    def test_canonical_ignores_shim_path_when_openhands_present(self) -> None:
        """openhands-on-PATH wins even if a shim_path is also given."""
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=True,
            shim_path=Path("/some/shim.py"),
        )
        assert result is not None
        assert result[0] == "openhands"


class TestResolveAgentArgvShim:
    """When ``openhands`` is NOT on PATH, fall back to the shim."""

    @pytest.fixture
    def fake_shim(self, tmp_path: Path) -> Path:
        """Create a placeholder file the dispatcher will treat as the
        shim. The contents don't matter — the dispatcher uses
        ``is_file()`` to detect existence, then execs via ``python3``."""
        shim = tmp_path / "fake-shim.py"
        shim.write_text("#!/usr/bin/env python3\nprint('fake')\n")
        return shim

    def test_minimal_call_returns_shim_invocation(
        self, tmp_path: Path, fake_shim: Path
    ) -> None:
        result = resolve_agent_argv(
            brief_file="/brief.md",
            repo="/host/repo",
            model="claude-opus-4-7",
            openhands_on_path=False,
            shim_path=fake_shim,
        )
        assert result == [
            sys.executable,
            str(fake_shim),
            "--brief-file",
            "/brief.md",
            "--repo",
            "/host/repo",
            "--model",
            "claude-opus-4-7",
        ]

    def test_shim_uses_correct_flag_names(self, fake_shim: Path) -> None:
        """The flag-name translation is THE point of this dispatcher:
        canonical uses --task-file / --workspace, shim uses
        --brief-file / --repo. Test the names are right."""
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=fake_shim,
        )
        assert result is not None
        # Shim uses --brief-file (NOT --task-file).
        assert "--brief-file" in result
        assert "--task-file" not in result
        # Shim uses --repo (NOT --workspace).
        assert "--repo" in result
        assert "--workspace" not in result

    def test_shim_with_all_optional_flags(self, fake_shim: Path) -> None:
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=fake_shim,
            api_key_env="OPENAI_API_KEY",
            base_url="http://localhost:11434",
            reasoning_effort="none",
            no_extended_thinking=True,
        )
        assert result is not None
        assert "--api-key-env" in result
        idx = result.index("--api-key-env")
        assert result[idx + 1] == "OPENAI_API_KEY"
        assert "--base-url" in result
        idx = result.index("--base-url")
        assert result[idx + 1] == "http://localhost:11434"
        assert "--reasoning-effort" in result
        idx = result.index("--reasoning-effort")
        assert result[idx + 1] == "none"
        assert "--no-extended-thinking" in result

    def test_shim_with_only_some_optional_flags(self, fake_shim: Path) -> None:
        """Partial flag set — only base_url, no api_key_env or
        reasoning_effort."""
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=fake_shim,
            base_url="http://localhost:11434",
        )
        assert result is not None
        assert "--base-url" in result
        assert "--api-key-env" not in result
        assert "--reasoning-effort" not in result
        assert "--no-extended-thinking" not in result


class TestResolveAgentArgvFailures:
    """Edge cases that should return None (caller fails fast)."""

    def test_no_openhands_and_no_shim_path_returns_none(self) -> None:
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=None,
        )
        assert result is None

    def test_no_openhands_and_shim_path_does_not_exist_returns_none(
        self, tmp_path: Path
    ) -> None:
        """The dispatcher uses Path.is_file() — a missing path is
        treated as "no shim" rather than crashing."""
        missing = tmp_path / "does-not-exist.py"
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=missing,
        )
        assert result is None

    def test_no_openhands_and_shim_path_is_directory_returns_none(
        self, tmp_path: Path
    ) -> None:
        """A directory is not a shim file — should treat as missing."""
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=tmp_path,
        )
        assert result is None


class TestDefaultShimPath:
    """The DEFAULT_SHIM_PATH constant should point at the real shim."""

    def test_default_shim_path_exists_in_repo(self) -> None:
        """If this fails, the in-repo shim moved and the dispatcher's
        fallback is broken."""
        assert DEFAULT_SHIM_PATH.is_file(), (
            f"DEFAULT_SHIM_PATH does not exist: {DEFAULT_SHIM_PATH}. "
            "If the shim moved, update DEFAULT_SHIM_PATH in spawn_agent.py."
        )

    def test_default_shim_path_is_executable_python(self) -> None:
        """Smoke check: the in-repo shim has the right shebang."""
        first_line = DEFAULT_SHIM_PATH.read_text(encoding="utf-8").splitlines()[0]
        assert first_line.startswith("#!"), (
            f"Shim {DEFAULT_SHIM_PATH} lacks a shebang"
        )
        assert "python" in first_line.lower()


class TestCli:
    """End-to-end CLI tests via a fake-shim fixture.

    The fake shim emits a sentinel string and exits with a known code
    so we can verify (a) the dispatcher chose the right backend, (b)
    the right flags reached the backend, (c) exit code propagation.
    """

    @pytest.fixture
    def fake_openhands_dir(self, tmp_path: Path) -> tuple[Path, Path]:
        """Stand up a tmp dir containing a fake ``openhands`` binary
        that records its args to a known path. Returns (path-to-dir,
        path-to-args-dump)."""
        bin_dir = tmp_path / "fake-bin"
        bin_dir.mkdir()
        args_dump = tmp_path / "openhands-args.txt"
        openhands = bin_dir / "openhands"
        openhands.write_text(
            f"""#!/usr/bin/env bash
echo "OPENHANDS_INVOKED" > {args_dump}
for arg in "$@"; do echo "ARG=$arg" >> {args_dump}; done
exit 42
"""
        )
        openhands.chmod(0o755)
        return bin_dir, args_dump

    @pytest.fixture
    def fake_shim(self, tmp_path: Path) -> tuple[Path, Path]:
        """Stand up a fake shim that also records its args."""
        shim_path = tmp_path / "fake-shim.py"
        args_dump = tmp_path / "shim-args.txt"
        shim_path.write_text(
            f"""#!/usr/bin/env python3
import sys
with open("{args_dump}", "w") as f:
    f.write("SHIM_INVOKED\\n")
    for arg in sys.argv[1:]:
        f.write(f"ARG={{arg}}\\n")
sys.exit(7)
"""
        )
        shim_path.chmod(0o755)
        return shim_path, args_dump

    def _run_cli(
        self,
        *args: str,
        env_overrides: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        # Strip ambient PATH that might contain `openhands`. The fixture
        # adds the fake-bin dir explicitly when needed.
        env["PATH"] = "/usr/bin:/bin"
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "spawn_agent.py"), *args],
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )

    def test_cli_uses_canonical_when_openhands_on_path(
        self, fake_openhands_dir: tuple[Path, Path], tmp_path: Path
    ) -> None:
        bin_dir, args_dump = fake_openhands_dir
        result = self._run_cli(
            "--brief-file",
            "/brief.md",
            "--repo",
            "/host/repo",
            "--model",
            "claude-opus-4-7",
            env_overrides={"PATH": f"{bin_dir}:/usr/bin:/bin"},
        )
        # Exit code propagated from the fake openhands (42).
        assert result.returncode == 42, result.stderr
        # The fake openhands was invoked with the canonical argv.
        recorded = args_dump.read_text()
        assert "OPENHANDS_INVOKED" in recorded
        assert "ARG=solve" in recorded
        assert "ARG=--task-file" in recorded
        assert "ARG=/brief.md" in recorded
        assert "ARG=--workspace" in recorded
        assert "ARG=/host/repo" in recorded
        assert "ARG=--model" in recorded
        assert "ARG=claude-opus-4-7" in recorded

    def test_cli_uses_shim_when_openhands_missing(
        self, fake_shim: tuple[Path, Path]
    ) -> None:
        shim_path, args_dump = fake_shim
        result = self._run_cli(
            "--brief-file",
            "/brief.md",
            "--repo",
            "/host/repo",
            "--model",
            "claude-opus-4-7",
            "--shim-path",
            str(shim_path),
        )
        # Exit code propagated from the fake shim (7).
        assert result.returncode == 7, result.stderr
        recorded = args_dump.read_text()
        assert "SHIM_INVOKED" in recorded
        # Shim got the translated flags.
        assert "ARG=--brief-file" in recorded
        assert "ARG=/brief.md" in recorded
        assert "ARG=--repo" in recorded
        assert "ARG=/host/repo" in recorded
        assert "ARG=--model" in recorded
        assert "ARG=claude-opus-4-7" in recorded

    def test_cli_exits_127_when_no_backend_available(
        self, tmp_path: Path
    ) -> None:
        """Neither openhands on PATH nor a valid shim — fail loud."""
        result = self._run_cli(
            "--brief-file",
            "/b",
            "--repo",
            "/r",
            "--model",
            "m",
            "--shim-path",
            str(tmp_path / "does-not-exist.py"),
        )
        assert result.returncode == 127
        assert "no agent backend available" in result.stderr

    def test_cli_passes_shim_optional_flags_through(
        self, fake_shim: tuple[Path, Path]
    ) -> None:
        shim_path, args_dump = fake_shim
        result = self._run_cli(
            "--brief-file",
            "/b",
            "--repo",
            "/r",
            "--model",
            "m",
            "--shim-path",
            str(shim_path),
            "--api-key-env",
            "OPENAI_API_KEY",
            "--base-url",
            "http://localhost:11434",
            "--reasoning-effort",
            "none",
            "--no-extended-thinking",
        )
        assert result.returncode == 7
        recorded = args_dump.read_text()
        assert "ARG=--api-key-env" in recorded
        assert "ARG=OPENAI_API_KEY" in recorded
        assert "ARG=--base-url" in recorded
        assert "ARG=http://localhost:11434" in recorded
        assert "ARG=--reasoning-effort" in recorded
        assert "ARG=none" in recorded
        assert "ARG=--no-extended-thinking" in recorded

    def test_cli_requires_brief_file(self) -> None:
        result = self._run_cli("--repo", "/r", "--model", "m")
        assert result.returncode != 0
        assert "brief-file" in result.stderr.lower()

    def test_cli_requires_repo(self) -> None:
        result = self._run_cli(
            "--brief-file", "/b", "--model", "m"
        )
        assert result.returncode != 0
        assert "repo" in result.stderr.lower()

    def test_cli_requires_model(self) -> None:
        result = self._run_cli(
            "--brief-file", "/b", "--repo", "/r"
        )
        assert result.returncode != 0
        assert "model" in result.stderr.lower()

    def test_cli_honors_minsky_openhands_shim_path_env(
        self, fake_shim: tuple[Path, Path]
    ) -> None:
        """MINSKY_OPENHANDS_SHIM_PATH env var overrides the default
        shim path when --shim-path isn't passed. Same precedence as
        bin/minsky-run.sh § invariant_openhands_in_path."""
        shim_path, args_dump = fake_shim
        result = self._run_cli(
            "--brief-file",
            "/brief.md",
            "--repo",
            "/host/repo",
            "--model",
            "claude-opus-4-7",
            env_overrides={"MINSKY_OPENHANDS_SHIM_PATH": str(shim_path)},
        )
        assert result.returncode == 7, result.stderr
        recorded = args_dump.read_text()
        assert "SHIM_INVOKED" in recorded

    def test_cli_flag_wins_over_env_var(
        self, fake_shim: tuple[Path, Path], tmp_path: Path
    ) -> None:
        """When both --shim-path and MINSKY_OPENHANDS_SHIM_PATH are
        set, the flag wins (matches the docstring precedence)."""
        flag_shim_path, flag_args_dump = fake_shim
        env_args_dump = tmp_path / "env-shim-args.txt"
        env_shim_path = tmp_path / "env-shim.py"
        env_shim_path.write_text(
            f"""#!/usr/bin/env python3
import sys
with open("{env_args_dump}", "w") as f:
    f.write("ENV_SHIM\\n")
sys.exit(99)
"""
        )
        env_shim_path.chmod(0o755)
        result = self._run_cli(
            "--brief-file",
            "/b",
            "--repo",
            "/r",
            "--model",
            "m",
            "--shim-path",
            str(flag_shim_path),
            env_overrides={"MINSKY_OPENHANDS_SHIM_PATH": str(env_shim_path)},
        )
        # Flag shim ran (exit 7), not env shim (exit 99).
        assert result.returncode == 7, result.stderr
        assert flag_args_dump.read_text().startswith("SHIM_INVOKED")
        assert not env_args_dump.exists()
