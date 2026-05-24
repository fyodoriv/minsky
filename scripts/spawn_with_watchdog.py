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

Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
Anchor:   rule #1 (Python stdlib is the existing solution); rule #6
          (let-it-crash at the right boundary — the iteration, not the
          whole walker).
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


def _die(code: int, message: str) -> NoReturn:
    """Print to stderr and exit with the given code."""
    print(f"spawn_with_watchdog: {message}", file=sys.stderr)
    sys.exit(code)


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
