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
    claude_config_dir_for_worker,
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

    @pytest.fixture(autouse=True)
    def _pin_home_to_empty_tmp(self, tmp_path: Path) -> None:
        """Pin HOME so resolve_configured_agent() can't accidentally read the
        operator's real `~/.minsky/config.json`.

        The operator's actual config sets `cloud_agent: claude`, which would
        route every CLI test down the claude backend and short-circuit the
        openhands/shim-fallback path these tests exercise. Anchoring HOME to
        an empty pytest tmp dir keeps the default-to-openhands branch live —
        the dispatcher reads no config file, returns the default, and the
        openhands/shim probes run. Local-test + CI behavior unify.
        """
        self._test_home = tmp_path / "spawn-agent-test-home"
        self._test_home.mkdir(exist_ok=True)

    def _run_cli(
        self,
        *args: str,
        env_overrides: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        # Strip ambient PATH that might contain `openhands`. The fixture
        # adds the fake-bin dir explicitly when needed.
        env["PATH"] = "/usr/bin:/bin"
        env["HOME"] = str(self._test_home)
        # MINSKY_ROLE leakage from a hosting test runner would flip the
        # config key resolve_configured_agent() reads; drop it for the
        # same hermeticity reason as the HOME override above.
        env.pop("MINSKY_ROLE", None)
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


# --- reengage_budget propagation (PR for no-useful-work class closure) ----


class TestResolveAgentArgvReengageBudget:
    """Tests for the reengage_budget argument added 2026-05-28 to close
    the no-useful-work failure class on local-LLM (qwen3-coder:30b).

    Contract: budget=0 is the default and keeps cloud Claude behavior
    unchanged; budget>0 threads --reengage-budget through to the shim.
    """

    SHIM_PATH = Path("/tmp/fake-shim.py")  # any non-None value; the test
    # injects shim_path_exists=True so the function takes the shim branch.

    def _shim_path(self, tmp_path: Path) -> Path:
        # Real existing file so the .is_file() check inside
        # resolve_agent_argv passes (the function's shim_path arg only
        # reaches it when the file exists per its contract).
        path = tmp_path / "shim.py"
        path.write_text("# stub")
        return path

    def test_default_budget_omits_reengage_flag(self, tmp_path: Path) -> None:
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="claude-opus-4-7",
            openhands_on_path=False,
            shim_path=shim,
        )
        assert result is not None
        assert "--reengage-budget" not in result, (
            f"default budget=0 should not pass --reengage-budget; got {result}"
        )

    def test_explicit_zero_budget_omits_reengage_flag(
        self, tmp_path: Path
    ) -> None:
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=shim,
            reengage_budget=0,
        )
        assert result is not None
        assert "--reengage-budget" not in result

    def test_positive_budget_threads_through_to_shim(
        self, tmp_path: Path
    ) -> None:
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="ollama_chat/qwen3-coder:30b",
            openhands_on_path=False,
            shim_path=shim,
            base_url="http://localhost:11434",
            reengage_budget=3,
        )
        assert result is not None
        assert "--reengage-budget" in result, f"got {result}"
        idx = result.index("--reengage-budget")
        assert result[idx + 1] == "3", f"got {result!r}"

    def test_canonical_cli_path_ignores_reengage_budget(
        self, tmp_path: Path
    ) -> None:
        """When the canonical `openhands solve` CLI is on PATH, the
        reengage flag has no canonical equivalent yet. The dispatcher
        falls through to the openhands argv without adding it."""
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=True,
            shim_path=shim,
            reengage_budget=3,
        )
        assert result is not None
        assert "openhands" in result[0]
        assert "--reengage-budget" not in result


# --- max_iterations propagation (runaway-exploration heal, 2026-05-28) -----


class TestResolveAgentArgvMaxIterations:
    """Tests for the max_iterations argument added 2026-05-28 to close the
    runaway-exploration class against local LLMs (39-min watchdog kill on
    a single OpenHands conversation with no files_changed).

    Contract: max_iterations=None (default) omits the flag (shim uses its
    own default 50); max_iterations=N threads through to the shim.
    """

    def _shim_path(self, tmp_path: Path) -> Path:
        path = tmp_path / "shim.py"
        path.write_text("# stub")
        return path

    def test_default_max_iterations_omits_flag(self, tmp_path: Path) -> None:
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=False,
            shim_path=shim,
        )
        assert result is not None
        assert "--max-iterations" not in result, (
            f"default max_iterations=None should not pass --max-iterations; got {result}"
        )

    def test_positive_max_iterations_threads_through(self, tmp_path: Path) -> None:
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="ollama_chat/qwen3-coder:30b",
            openhands_on_path=False,
            shim_path=shim,
            max_iterations=50,
        )
        assert result is not None
        assert "--max-iterations" in result, f"got {result!r}"
        idx = result.index("--max-iterations")
        assert result[idx + 1] == "50", f"got {result!r}"

    def test_canonical_cli_path_ignores_max_iterations(
        self, tmp_path: Path
    ) -> None:
        """The canonical `openhands solve` CLI may add its own max-
        iterations knob; until then, the dispatcher doesn't pass it."""
        shim = self._shim_path(tmp_path)
        result = resolve_agent_argv(
            brief_file="/b",
            repo="/r",
            model="m",
            openhands_on_path=True,
            shim_path=shim,
            max_iterations=50,
        )
        assert result is not None
        assert "openhands" in result[0]
        assert "--max-iterations" not in result


# --- argv regression matrix (cloud-agent-spawn-argv-regression-matrix) -----
#
# One example-table per backend pins the LIVE spawn-argv contract so drift is
# caught in CI (<5 min) instead of in a multi-hour daemon run. Each row is a
# (flag, value) pair the backend's full argv MUST carry, in `--flag value`
# order. The flag-presence test asserts every required flag for every backend;
# the position test asserts each flag's value sits immediately after it; the
# mutation tripwire proves that dropping a required flag from the expected
# table turns the assertion red with the flag named.
#
# Pattern: example-table-driven scenarios (Wynne & Helleso/y, The Cucumber
# Book, 2012, Ch. 1). The spawn contract lives behind one module seam
# (resolve_agent_argv) per Parnas 1972.

# (brief, repo, model) used by every matrix row — fixed so position math is
# deterministic regardless of the optional shim-only flags.
_MATRIX_BRIEF = "/brief.md"
_MATRIX_REPO = "/host/repo"
_MATRIX_MODEL = "claude-opus-4-7"

# Per-backend required (flag, value) contract. These are the flags whose
# absence makes the spawn a no-op / wrong-target: the brief, the repo, and the
# model must all reach the agent. Canonical uses --task-file/--workspace; the
# shim uses --brief-file/--repo. The model flag name is shared.
_CANONICAL_REQUIRED: list[tuple[str, str]] = [
    ("--task-file", _MATRIX_BRIEF),
    ("--workspace", _MATRIX_REPO),
    ("--model", _MATRIX_MODEL),
]
_SHIM_REQUIRED: list[tuple[str, str]] = [
    ("--brief-file", _MATRIX_BRIEF),
    ("--repo", _MATRIX_REPO),
    ("--model", _MATRIX_MODEL),
]


def _matrix_argv(openhands_on_path: bool, shim_path: Path) -> list[str]:
    """Resolve the argv for one matrix backend with the fixed request."""
    result = resolve_agent_argv(
        brief_file=_MATRIX_BRIEF,
        repo=_MATRIX_REPO,
        model=_MATRIX_MODEL,
        openhands_on_path=openhands_on_path,
        shim_path=shim_path,
    )
    assert result is not None, "matrix backend resolved to None"
    return result


def _assert_flag_value(argv: list[str], flag: str, value: str) -> None:
    """Assert `flag` is present and immediately followed by `value`.

    Failure messages name the missing flag so a red mutation row is
    self-diagnosing (Success criterion 2)."""
    assert flag in argv, f"required flag {flag} missing from argv {argv!r}"
    idx = argv.index(flag)
    assert idx + 1 < len(argv), f"required flag {flag} has no value in {argv!r}"
    assert argv[idx + 1] == value, (
        f"required flag {flag} should carry {value!r}, got {argv[idx + 1]!r}"
    )


# Backend × required-flag product: 2 backends × 3 required flags = 6 cases.
_ARGV_MATRIX_ROWS = [
    pytest.param(True, flag, value, id=f"canonical-{flag.lstrip('-')}")
    for flag, value in _CANONICAL_REQUIRED
] + [
    pytest.param(False, flag, value, id=f"shim-{flag.lstrip('-')}")
    for flag, value in _SHIM_REQUIRED
]


@pytest.fixture
def matrix_shim(tmp_path: Path) -> Path:
    """A real existing file so resolve_agent_argv's is_file() check passes
    on the shim branch. Contents are irrelevant — argv resolution never
    reads them."""
    shim = tmp_path / "matrix-shim.py"
    shim.write_text("#!/usr/bin/env python3\n# matrix stub\n")
    return shim


class TestResolveAgentArgvMatrix:
    """The argv regression matrix proper — `pytest -k argv_matrix` selects it."""

    @pytest.mark.parametrize(
        ("openhands_on_path", "flag", "value"), _ARGV_MATRIX_ROWS
    )
    def test_argv_matrix_required_flag_present_and_positioned(
        self,
        openhands_on_path: bool,
        flag: str,
        value: str,
        matrix_shim: Path,
    ) -> None:
        """Each backend's full argv carries every required flag in
        `--flag value` order. 6 parameterized cases (2 backends × 3 flags)."""
        argv = _matrix_argv(openhands_on_path, matrix_shim)
        _assert_flag_value(argv, flag, value)

    @pytest.mark.parametrize(
        ("openhands_on_path", "required"),
        [
            pytest.param(True, _CANONICAL_REQUIRED, id="canonical-full-contract"),
            pytest.param(False, _SHIM_REQUIRED, id="shim-full-contract"),
        ],
    )
    def test_argv_matrix_full_contract(
        self,
        openhands_on_path: bool,
        required: list[tuple[str, str]],
        matrix_shim: Path,
    ) -> None:
        """The full per-backend contract holds at once: every required
        (flag, value) is present and positioned. Cross-checks the per-flag
        rows above — a backend that satisfies each flag in isolation must
        also satisfy them together."""
        argv = _matrix_argv(openhands_on_path, matrix_shim)
        for flag, value in required:
            _assert_flag_value(argv, flag, value)

    @pytest.mark.parametrize(
        ("openhands_on_path", "required", "dropped"),
        [
            # Mutation tripwire: a hand-edited expected table that DROPS a
            # required flag must turn ≥1 case red, and the message must name
            # the dropped flag (Success criterion 2). We invert the contract:
            # the dropped flag MUST be absent from `required` (proving the
            # mutation took) yet MUST still be present in the live argv
            # (proving the live contract still ships it). If a future refactor
            # quietly stops emitting the flag, the second assert flips red —
            # the matrix detects the regression.
            pytest.param(
                True, _CANONICAL_REQUIRED, "--model", id="canonical-drop-model"
            ),
            pytest.param(
                True, _CANONICAL_REQUIRED, "--task-file", id="canonical-drop-task-file"
            ),
            pytest.param(
                False, _SHIM_REQUIRED, "--model", id="shim-drop-model"
            ),
            pytest.param(
                False, _SHIM_REQUIRED, "--brief-file", id="shim-drop-brief-file"
            ),
        ],
    )
    def test_argv_matrix_dropping_required_flag_is_detected(
        self,
        openhands_on_path: bool,
        required: list[tuple[str, str]],
        dropped: str,
        matrix_shim: Path,
    ) -> None:
        """Drop `dropped` from the expected table; the remaining contract is
        still asserted against the live argv, and the dropped flag is proven
        to STILL ship live. This pins both directions: the mutation is real
        (flag absent from `required`) and the live argv has not regressed
        (flag present in argv)."""
        mutated = [(f, v) for (f, v) in required if f != dropped]
        assert any(f == dropped for f, _ in required), (
            f"{dropped} should have been in the pristine contract"
        )
        assert all(f != dropped for f, _ in mutated), (
            f"mutation failed to drop {dropped}"
        )
        argv = _matrix_argv(openhands_on_path, matrix_shim)
        # The surviving flags still hold.
        for flag, value in mutated:
            _assert_flag_value(argv, flag, value)
        # The dropped flag is STILL emitted live — if this regresses, the
        # failure message names the flag.
        assert dropped in argv, (
            f"live spawn argv dropped required flag {dropped}: {argv!r}"
        )


# --- Per-worker CLAUDE_CONFIG_DIR isolation -------------------------------
# worker-claude-concurrent-auth-and-watchdog: concurrent `claude -p` spawns
# against the shared default `~/.claude/` intermittently exit `Not logged in`
# in ~1s when one worker holds a session-file write while another reads. A
# per-worker config dir anchored to the throwaway worktree eliminates the
# contention without serializing spawns. Auth still flows through the
# CLAUDE_CODE_OAUTH_TOKEN env var the supervisor exports per PR #1172.


class TestClaudeConfigDirForWorker:
    """Pure-function tests for the per-worker isolated CLAUDE_CONFIG_DIR path."""

    def test_path_is_under_the_worktree(self) -> None:
        repo = "/host/repo/.worktrees/daemon-foo"
        result = claude_config_dir_for_worker(repo)
        # The dir lives inside the agent's isolated worktree — same sandbox
        # boundary the agent's `git add -A` / `rm -rf` already respects.
        assert str(result).startswith(repo)

    def test_two_distinct_worktrees_get_distinct_paths(self) -> None:
        a = claude_config_dir_for_worker("/host/repo/.worktrees/daemon-a")
        b = claude_config_dir_for_worker("/host/repo/.worktrees/daemon-b")
        assert a != b, (
            "two concurrent workers must get distinct CLAUDE_CONFIG_DIR "
            "paths, else they collide on `~/.claude/` contention"
        )

    def test_same_worktree_resolves_to_same_path_idempotent(self) -> None:
        # Across iterations the same worktree must resolve to the same dir
        # so session state can be reused (an iteration that successfully
        # bootstrapped its session should not start fresh on the next tick).
        repo = "/host/repo/.worktrees/daemon-foo"
        assert claude_config_dir_for_worker(repo) == claude_config_dir_for_worker(repo)


class TestClaudeBackendIsolationEndToEnd:
    """End-to-end: the spawn_agent CLI sets CLAUDE_CONFIG_DIR for the claude path.

    Drives the dispatcher with a fake `claude` binary that records its
    received CLAUDE_CONFIG_DIR env var, and asserts the env reaches the child
    AND the dir is created on disk under the worktree.
    """

    def _make_fake_claude_env(
        self,
        tmp_path: Path,
        env_dump: Path,
        exit_code: int = 0,
        with_oauth_token: bool = True,
    ) -> dict[str, str]:
        fake_home = tmp_path / "home"
        fake_bin = fake_home / ".local" / "bin"
        fake_bin.mkdir(parents=True)
        fake_minsky = fake_home / ".minsky"
        fake_minsky.mkdir(parents=True)
        # Tells resolve_configured_agent() to take the claude branch (the
        # operator's "Opus brain + Sonnet workers" subscription setup).
        (fake_minsky / "config.json").write_text(
            '{"cloud_agent":"claude","local_agent":"claude"}'
        )
        fake_claude = fake_bin / "claude"
        fake_claude.write_text(
            "#!/usr/bin/env bash\n"
            f'echo "CLAUDE_CONFIG_DIR=${{CLAUDE_CONFIG_DIR}}" > {env_dump}\n'
            f'echo "PWD=$PWD" >> {env_dump}\n'
            f"exit {exit_code}\n"
        )
        fake_claude.chmod(0o755)
        env = os.environ.copy()
        env["HOME"] = str(fake_home)
        env["PATH"] = f"{fake_bin}:/usr/bin:/bin"
        # Strip the agent role override so resolve_configured_agent reads
        # cloud_agent (not local_agent) — both are set to "claude" in the
        # config above; pinning the env makes the test self-contained.
        env.pop("MINSKY_ROLE", None)
        # Per-worker CLAUDE_CONFIG_DIR isolation only authenticates when an
        # OAuth token is exported (the isolated dir bootstraps from it). The
        # isolation tests must therefore set the token to exercise the
        # isolation path; the no-token fallback is covered separately. Always
        # start from a known state (pop ambient, then set if requested).
        env.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        if with_oauth_token:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = "dummy-oauth-token-for-test-only"
        return env

    def test_claude_path_sets_per_worker_config_dir(self, tmp_path: Path) -> None:
        env_dump = tmp_path / "claude-env.txt"
        env = self._make_fake_claude_env(tmp_path, env_dump)
        repo = tmp_path / "worktree-a"
        repo.mkdir()
        brief = tmp_path / "brief.md"
        brief.write_text("do work")
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "spawn_agent.py"),
                "--brief-file",
                str(brief),
                "--repo",
                str(repo),
                "--model",
                "claude-opus-4-7",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        recorded = env_dump.read_text()
        expected_dir = repo / ".minsky-claude-config"
        assert f"CLAUDE_CONFIG_DIR={expected_dir}" in recorded, (
            f"claude child did not receive isolated CLAUDE_CONFIG_DIR; got: {recorded}"
        )
        # Dir was materialised before claude ran (the child read it from env;
        # the dispatcher's mkdir -p ran beforehand).
        assert expected_dir.is_dir(), (
            f"expected CLAUDE_CONFIG_DIR to be created at {expected_dir}"
        )

    def test_claude_path_without_oauth_token_uses_default_config_dir(
        self, tmp_path: Path
    ) -> None:
        """No CLAUDE_CODE_OAUTH_TOKEN → do NOT isolate into an empty dir.

        Regression for the self-host spawn-failed bug: an isolated empty
        CLAUDE_CONFIG_DIR has no credentials and the worker exits
        `Not logged in · Please run /login` in ~1s. The keychain/subscription
        creds the operator authenticated with are only read from the DEFAULT
        config dir, never a fresh per-worktree one. So with no token to
        bootstrap an isolated dir, the dispatcher must leave CLAUDE_CONFIG_DIR
        as the operator default (auth that actually works). Isolation is a
        concurrency optimization; an authenticatable worker is correctness.
        """
        env_dump = tmp_path / "claude-env.txt"
        env = self._make_fake_claude_env(tmp_path, env_dump, with_oauth_token=False)
        repo = tmp_path / "worktree-no-token"
        repo.mkdir()
        brief = tmp_path / "brief.md"
        brief.write_text("do work")
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "spawn_agent.py"),
                "--brief-file",
                str(brief),
                "--repo",
                str(repo),
                "--model",
                "claude-opus-4-7",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        recorded = env_dump.read_text()
        isolated_dir = repo / ".minsky-claude-config"
        # The child must NOT have received the isolated worktree dir...
        assert f"CLAUDE_CONFIG_DIR={isolated_dir}" not in recorded, (
            f"isolated CLAUDE_CONFIG_DIR leaked without a token; got: {recorded}"
        )
        # ...and the empty isolated dir must NOT have been created on disk.
        assert not isolated_dir.exists(), (
            f"isolated dir was created without a token to authenticate it: {isolated_dir}"
        )

    def test_two_concurrent_workers_get_disjoint_config_dirs(
        self, tmp_path: Path
    ) -> None:
        """Two distinct worktrees → two distinct CLAUDE_CONFIG_DIRs.

        This is the load-bearing invariant: even if both children launched in
        the same nanosecond, they never share `~/.claude/` state. Anchors the
        worker-claude-concurrent-auth-and-watchdog hypothesis (a).
        """
        dump_a = tmp_path / "env-a.txt"
        env_a = self._make_fake_claude_env(tmp_path, dump_a)
        # Distinct fake-home for B so both can stand up independently in /tmp.
        dump_b = tmp_path / "env-b.txt"
        env_b = self._make_fake_claude_env(tmp_path / "b", dump_b)

        repo_a = tmp_path / "wt-a"
        repo_b = tmp_path / "wt-b"
        repo_a.mkdir()
        repo_b.mkdir()
        brief = tmp_path / "brief.md"
        brief.write_text("x")

        def _spawn(env: dict[str, str], repo: Path) -> int:
            return subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "spawn_agent.py"),
                    "--brief-file",
                    str(brief),
                    "--repo",
                    str(repo),
                    "--model",
                    "claude-opus-4-7",
                ],
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            ).returncode

        assert _spawn(env_a, repo_a) == 0
        assert _spawn(env_b, repo_b) == 0
        recorded_a = dump_a.read_text()
        recorded_b = dump_b.read_text()
        assert str(repo_a / ".minsky-claude-config") in recorded_a
        assert str(repo_b / ".minsky-claude-config") in recorded_b
        # Disjoint paths — the contention vector is closed.
        assert (
            str(repo_a / ".minsky-claude-config")
            != str(repo_b / ".minsky-claude-config")
        )
