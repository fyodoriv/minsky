"""Tests for scripts/spawn_with_watchdog.py — Python stdlib timeout wrapper.

Pins behavior to GNU `timeout(1)` exit-code parity so `bin/minsky-run.sh`
can use the same `$? -eq 124` check whether the wrapper is the Python
script or coreutils' `timeout`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPT = str(Path(__file__).parent.parent / "scripts" / "spawn_with_watchdog.py")


def run(args: list[str], capture: bool = False, timeout: float = 30) -> subprocess.CompletedProcess:
    """Shell out to the script; returns CompletedProcess (no check).

    The pre-SIGKILL WIP stash defaults to on; without MINSKY_TIMEOUT_STASH_DIR
    set explicitly, ``_stash_dir()`` falls back to ``os.getcwd()`` — which for
    a pytest run IS the repo root. Tests that exercise the timeout path
    (e.g. ``test_exits_124_when_command_exceeds_timeout``) would then stash
    the test author's own uncommitted edits into ``git stash`` mid-test.
    Disabling the stash here keeps these high-level tests hermetic; the
    stash-specific tests below explicitly opt back in via their own env.
    """
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        capture_output=capture,
        text=True,
        timeout=timeout,
        check=False,
        env={**os.environ, "MINSKY_TIMEOUT_STASH": "0"},
    )


# --- Exit code parity with GNU timeout(1) --------------------------------


def test_exits_0_when_command_succeeds_within_timeout() -> None:
    """Command exits 0 within the watchdog → wrapper exits 0."""
    result = run(["10", "true"])
    assert result.returncode == 0


def test_exits_124_when_command_exceeds_timeout() -> None:
    """Hung command → wrapper sends SIGTERM → exit 124 (matches GNU timeout)."""
    start = time.time()
    result = run(["1", "sleep", "99999"], timeout=10)
    elapsed = time.time() - start
    assert result.returncode == 124
    # Wall-clock must be small — well under 99999s.
    assert elapsed < 8, f"watchdog took too long: {elapsed}s"


def test_exits_125_on_no_args() -> None:
    """Bad usage → exit 125 (matches GNU timeout)."""
    result = run([], capture=True)
    assert result.returncode == 125
    assert "usage:" in result.stderr


def test_exits_125_on_non_integer_seconds() -> None:
    result = run(["abc", "true"], capture=True)
    assert result.returncode == 125
    assert "must be an integer" in result.stderr


def test_exits_125_on_non_positive_seconds() -> None:
    result = run(["0", "true"], capture=True)
    assert result.returncode == 125
    assert "must be > 0" in result.stderr


def test_exits_126_when_command_not_found() -> None:
    """Command-not-found → exit 126 (matches GNU timeout)."""
    result = run(["10", "no-such-binary-on-this-system-12345"])
    assert result.returncode == 126


def test_passes_through_arbitrary_exit_code() -> None:
    """When the command exits with code N, the wrapper also exits N."""
    result = run(["10", "sh", "-c", "exit 42"])
    assert result.returncode == 42


# --- Process-group kill behavior -----------------------------------------


def test_kills_grandchild_processes_when_watchdog_fires(tmp_path: Path) -> None:
    """SIGTERM must reach the entire process group, not just the parent.

    Spawn a wrapper script that forks a sleeping grandchild, then disowns
    itself so the wrapper has nothing to wait on. Without the
    `start_new_session=True` + `killpg` plumbing, the grandchild would
    survive the watchdog.
    """
    sentinel = tmp_path / "grandchild-alive"
    sentinel.write_text("yes")
    wrapper_script = tmp_path / "spawn-grandchild.sh"
    wrapper_script.write_text(
        f"""#!/usr/bin/env bash
set -e
( sleep 30 ; rm -f {sentinel} ) &
# Don't exec — let the parent itself sleep so the watchdog has someone
# to SIGTERM. Without this, the parent exits and only the grandchild
# is left running.
sleep 30
"""
    )
    wrapper_script.chmod(0o755)
    start = time.time()
    result = run(["1", str(wrapper_script)], timeout=10)
    elapsed = time.time() - start
    assert result.returncode == 124
    # After the watchdog + grace period, the grandchild MUST be dead;
    # the sentinel file therefore still has the "yes" content (the
    # grandchild's `rm -f` never ran because SIGTERM killed it first).
    assert sentinel.exists(), "grandchild was killed before its 30s sleep elapsed"
    assert sentinel.read_text() == "yes"
    # Wall-clock includes SIGKILL_GRACE_SECONDS (2s) — generous upper bound.
    assert elapsed < 8


# --- pre-SIGKILL WIP stash (spawn-strategy-pre-sigkill-stash) ------------


def _git_init(repo: Path) -> None:
    """Initialise a throwaway git repo with one committed file.

    Hooks are neutralised (`core.hooksPath=/dev/null`) so a global
    commit-msg / pre-commit hook on the operator's machine can't fail the
    seed commit — same neutralise-hooks shape bin/minsky-run.sh uses for
    its supervisor auto-commits (not a `--no-verify` bypass).
    """
    no_hooks = ["-c", "core.hooksPath=/dev/null"]
    for cmd in (
        ["git", "init", "-q"],
        ["git", "config", "user.email", "test@minsky.local"],
        ["git", "config", "user.name", "minsky-test"],
        ["git", "config", "commit.gpgsign", "false"],
    ):
        subprocess.run(cmd, cwd=repo, check=True, capture_output=True)
    (repo / "seed.txt").write_text("seed")
    subprocess.run(["git", "add", "seed.txt"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", *no_hooks, "commit", "-q", "-m", "seed"],
        cwd=repo,
        check=True,
        capture_output=True,
    )


def _worker_that_writes_then_sleeps(repo: Path, n_files: int) -> Path:
    """A worker: write N WIP files into `repo`, then sleep past the timeout."""
    writes = "\n".join(f'echo wip{i} > "{repo}/wip{i}.txt"' for i in range(n_files))
    script = repo / "worker.sh"
    script.write_text(f"#!/usr/bin/env bash\nset -e\n{writes}\nsleep 30\n")
    script.chmod(0o755)
    return script


def test_stash_captures_files_on_timeout(tmp_path: Path) -> None:
    """Watchdog fires → uncommitted WIP is stashed before SIGKILL.

    The worker writes N files into a git worktree then hangs. After the
    timeout, `git stash list` must show a labeled stash and the working
    tree must be clean (the files moved INTO the stash, not lost).
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _git_init(repo)
    n = 3
    worker = _worker_that_writes_then_sleeps(repo, n)

    env = {**os.environ, "MINSKY_TIMEOUT_STASH_DIR": str(repo)}
    start = time.time()
    result = subprocess.run(
        [sys.executable, SCRIPT, "1", str(worker)],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        env=env,
    )
    elapsed = time.time() - start
    assert result.returncode == 124
    assert elapsed < 12

    stash_list = subprocess.run(
        ["git", "stash", "list"], cwd=repo, capture_output=True, text=True, check=True
    )
    assert "minsky-timeout-stash" in stash_list.stdout, (
        f"expected a labeled stash, got: {stash_list.stdout!r}"
    )
    # Working tree clean — the WIP files are inside the stash, not on disk.
    status = subprocess.run(
        ["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True, check=True
    )
    assert status.stdout.strip() == "", f"tree not clean after stash: {status.stdout!r}"
    # The stash content carries all N WIP files (pop them and count).
    subprocess.run(["git", "stash", "pop"], cwd=repo, capture_output=True, check=True)
    restored = sorted(p.name for p in repo.glob("wip*.txt"))
    assert restored == [f"wip{i}.txt" for i in range(n)], restored


def test_non_git_cwd_skips_stash_cleanly(tmp_path: Path) -> None:
    """A non-git spawn cwd must time out normally with no stash attempt/error."""
    plain = tmp_path / "plain"
    plain.mkdir()
    worker = plain / "worker.sh"
    worker.write_text("#!/usr/bin/env bash\nset -e\nsleep 30\n")
    worker.chmod(0o755)

    env = {**os.environ, "MINSKY_TIMEOUT_STASH_DIR": str(plain)}
    result = subprocess.run(
        [sys.executable, SCRIPT, "1", str(worker)],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        env=env,
    )
    assert result.returncode == 124
    # No git error noise leaked to stderr.
    assert "fatal:" not in result.stderr
    assert "minsky-timeout-stash" not in result.stderr
    assert not (plain / ".git").exists()


def test_stash_disabled_via_env(tmp_path: Path) -> None:
    """MINSKY_TIMEOUT_STASH=0 → no stash created even in a git worktree."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git_init(repo)
    worker = _worker_that_writes_then_sleeps(repo, 2)

    env = {
        **os.environ,
        "MINSKY_TIMEOUT_STASH_DIR": str(repo),
        "MINSKY_TIMEOUT_STASH": "0",
    }
    result = subprocess.run(
        [sys.executable, SCRIPT, "1", str(worker)],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        env=env,
    )
    assert result.returncode == 124
    stash_list = subprocess.run(
        ["git", "stash", "list"], cwd=repo, capture_output=True, text=True, check=True
    )
    assert stash_list.stdout.strip() == "", (
        f"stash created despite MINSKY_TIMEOUT_STASH=0: {stash_list.stdout!r}"
    )
    # The WIP files are still on disk (untouched), confirming no stash ran.
    assert (repo / "wip0.txt").exists()


# --- stdout/stderr passthrough -------------------------------------------


def test_passes_stdout_through() -> None:
    result = run(["10", "echo", "hello-from-child"], capture=True)
    assert result.returncode == 0
    assert "hello-from-child" in result.stdout


def test_passes_stderr_through() -> None:
    # `sh -c 'echo X 1>&2'` writes to stderr only.
    result = run(["10", "sh", "-c", "echo err-from-child 1>&2"], capture=True)
    assert result.returncode == 0
    assert "err-from-child" in result.stderr
