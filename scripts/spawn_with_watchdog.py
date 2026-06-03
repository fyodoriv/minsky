#!/usr/bin/env python3
"""scripts/spawn_with_watchdog.py — Phase 7 portable spawn watchdog.

Wraps `subprocess.Popen` + `wait(timeout=)` around an arbitrary command.
Used by `bin/minsky-run.sh` on platforms where GNU `timeout`/`gtimeout`
are not present (e.g. a fresh macOS install without
`brew install coreutils`).

Rule #1: this is a 60-line Python stdlib wrapper, not a reinvented
timeout daemon. `subprocess.Popen.wait(timeout=...)` ships with every
Python ≥3.3 and uses the OS's POSIX signal infrastructure under the
hood. The new process-group plumbing ensures every descendant gets
SIGTERM when the watchdog fires (not just the immediate child).

CLI shape — must compose with bash:
    python3 scripts/spawn_with_watchdog.py <timeout-seconds> <cmd> [<args>...]

Exit codes — mirror GNU `timeout(1)` so the caller can use the same
check (`if [[ $? -eq 124 ]]`):
    0     — command exited 0 within the timeout
    124   — command was killed because the watchdog fired (timeout)
    125   — usage error (bad args)
    126   — command not found / cannot execute (mirrors timeout(1) 126)
    other — passthrough of the wrapped command's exit code

stdout / stderr — passthrough. The wrapper inherits stdin/stdout/stderr
file descriptors so the bash caller can `>"$stdout_log" 2>&1` exactly
the way it does with `timeout`.

Pre-SIGKILL WIP stash (spawn-strategy-pre-sigkill-stash) — when the
watchdog fires, the worker's uncommitted implementation is dropped
because the Stage-0 auto-commit backstop in `bin/minsky-run.sh` runs
only on exit 0. Before escalating SIGTERM→SIGKILL, the wrapper does a
bounded, best-effort `git stash push -u` of the spawn cwd so the WIP is
recoverable via `git stash list`. Controlled by two env vars:
    MINSKY_TIMEOUT_STASH      — "0" disables (default on, rule #16).
    MINSKY_TIMEOUT_STASH_DIR  — dir to stash (default cwd); minsky-run.sh
                                points it at the isolated worktree.
The stash is skipped cleanly for a non-git cwd and never blocks SIGKILL.

Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
Anchor:   rule #1 (Python stdlib is the existing solution); rule #6
          (let-it-crash at the right boundary — the iteration, not the
          whole walker); Stevens & Rago, APUE 3rd ed. Ch. 10
          (SIGTERM-grace-then-SIGKILL — the grace window exists to let
          the child save work; the stash does that on its behalf).
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from typing import NoReturn

# Mirror GNU timeout(1) exit codes — see `man 1 timeout` § "EXIT STATUS".
EXIT_TIMEOUT = 124
EXIT_BAD_USAGE = 125
EXIT_CMD_NOT_FOUND = 126

# Grace period after SIGTERM before we escalate to SIGKILL.
SIGKILL_GRACE_SECONDS = 2

# Bound on the best-effort pre-SIGKILL `git stash` so a wedged git index
# can't itself become an unbounded hang inside the watchdog. Stevens & Rago,
# APUE 3rd ed. Ch. 10: the SIGTERM-grace window is finite; everything we do
# inside it must be finite too.
STASH_GIT_TIMEOUT_SECONDS = 10


def _die(code: int, message: str) -> NoReturn:
    """Print to stderr and exit with the given code."""
    print(f"spawn_with_watchdog: {message}", file=sys.stderr)
    sys.exit(code)


def _stash_dir() -> str:
    """Resolve the directory whose WIP should be stashed on timeout.

    Defaults to the wrapper's own cwd (the wrapped command inherits it).
    `bin/minsky-run.sh` sets MINSKY_TIMEOUT_STASH_DIR to the isolated
    worktree (`--repo "$worktree"`) so the stash captures the tree the
    agent actually edits, not the bash caller's cwd.
    """
    return os.environ.get("MINSKY_TIMEOUT_STASH_DIR") or os.getcwd()


def _stash_enabled() -> bool:
    """Auto-stash is on by default (rule #16); MINSKY_TIMEOUT_STASH=0 disables.

    Burden of proof is "why ISN'T this the default" — losing 1000+ LOC of
    working WIP on every timeout is the failure this guards against, so the
    opt-out is the debugging escape hatch, not the steady state.
    """
    return os.environ.get("MINSKY_TIMEOUT_STASH", "1") != "0"


def _is_git_worktree(cwd: str) -> bool:
    """True iff `cwd` is inside a git work tree (best-effort, bounded).

    Skips cleanly (returns False) when git is absent, the dir is not a
    repo, or the probe itself errors — a non-git spawn cwd must never make
    the watchdog noisy or slow.
    """
    try:
        result = subprocess.run(  # noqa: S603, S607 — fixed argv, no shell
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=STASH_GIT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip() == "true"


def _stash_timeout_wip(cwd: str) -> None:
    """Best-effort `git stash push -u` of the spawn cwd before SIGKILL.

    Bounded (its own subprocess timeout) and fully error-swallowing: a
    failed stash must never block the SIGKILL escalation that follows.
    Recoverable afterwards via `git stash list` (label carries an ISO
    timestamp so the operator can identify the timed-out iteration).

    Hooks are neutralised (`core.hooksPath=/dev/null`) so a global
    pre-commit / post-* hook on the host can't slow or fail the stash —
    same neutralise-hooks shape bin/minsky-run.sh uses for supervisor
    auto-commits.

    Anchor: Stevens & Rago, *Advanced Programming in the UNIX Environment*,
    3rd ed., Ch. 10 — the canonical graceful-shutdown pattern is
    SIGTERM-grace-then-SIGKILL; this is the work the grace window exists to
    let the child save, performed on the child's behalf when it can't.
    """
    if not _stash_enabled():
        return
    if not _is_git_worktree(cwd):
        return
    label = f"minsky-timeout-stash {time.strftime('%Y-%m-%dT%H:%M:%S')}"
    try:
        subprocess.run(  # noqa: S603, S607 — fixed argv, no shell
            ["git", "-c", "core.hooksPath=/dev/null", "stash", "push", "-u", "-m", label],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=STASH_GIT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        # Let-it-crash boundary (rule #6): the iteration is already lost to
        # the timeout. A stash failure degrades gracefully — we proceed to
        # SIGKILL rather than wedge the watchdog on a broken git index.
        return


def _kill_process_group(pid: int) -> None:
    """Send SIGTERM to the entire process group, then SIGKILL after a grace.

    POSIX-only. On Windows we'd fall back to `proc.kill()` instead — but
    `bin/minsky-run.sh` doesn't run on Windows so this path is unreachable.
    """
    try:
        pgid = os.getpgid(pid)
    except (ProcessLookupError, PermissionError):
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            return
        # Give the children a chance to flush before escalating.
        if sig == signal.SIGTERM:
            time.sleep(SIGKILL_GRACE_SECONDS)


def run_with_timeout(cmd: list[str], seconds: int) -> int:
    """Spawn `cmd` with a watchdog. Returns the GNU-`timeout`-compatible exit code.

    Pure-ish — has the side effect of spawning a subprocess and writing
    to stdout/stderr/stdin via inheritance. Returns an integer the bash
    caller can check against `EXIT_TIMEOUT` (124).
    """
    try:
        proc = subprocess.Popen(  # noqa: S603 — we ARE the spawn wrapper
            cmd,
            stdin=sys.stdin,
            stdout=sys.stdout,
            stderr=sys.stderr,
            # New session → new process group; SIGTERM hits every descendant.
            start_new_session=True,
        )
    except FileNotFoundError:
        return EXIT_CMD_NOT_FOUND

    try:
        return proc.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        # Preserve the worker's uncommitted WIP BEFORE escalating signals —
        # the SIGTERM→SIGKILL path never auto-commits (the Stage-0 backstop
        # in bin/minsky-run.sh runs only on exit 0), so without this the
        # timed-out iteration's implementation is dropped on the floor.
        _stash_timeout_wip(_stash_dir())
        _kill_process_group(proc.pid)
        # Drain the process so it doesn't become a zombie.
        try:
            proc.wait(timeout=SIGKILL_GRACE_SECONDS * 2)
        except subprocess.TimeoutExpired:
            pass
        return EXIT_TIMEOUT


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        _die(EXIT_BAD_USAGE,
             "usage: spawn_with_watchdog.py <timeout-seconds> <cmd> [<args>...]")

    try:
        seconds = int(argv[1])
    except ValueError:
        _die(EXIT_BAD_USAGE, f"timeout-seconds must be an integer, got: {argv[1]!r}")
        return EXIT_BAD_USAGE  # unreachable; appeases the type checker

    if seconds <= 0:
        _die(EXIT_BAD_USAGE, f"timeout-seconds must be > 0, got: {seconds}")

    return run_with_timeout(argv[2:], seconds)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
