#!/usr/bin/env python3
"""spawn_agent: resolve the right OpenHands agent invocation.

Why this exists
---------------

The bash runner used to hard-code ``openhands solve --task-file ...
--workspace ... --model ...``. That CLI **ships June 1, 2026** (per the
Agent Canvas Initiative roadmap in ``docs/plans/2026-05-22-path-c-
openhands-reshape.md``). On every operator machine that hasn't installed
the future CLI yet — which is **every machine today** — the runner's
spawn step fails with exit 127 (command not found), every iteration
records ``spawn-failed``, and the autonomous loop produces no PRs.

The working path TODAY is the Python shim at
``novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py``
which runs the OpenHands SDK in-process. That shim exists, is wired by
the TS substrate (``novel/adapters/agent-runtime-openhands/src/
spawner.ts``), and has been the actual code path for every OpenHands
spawn the TS runner does. The bash runner just doesn't know about it.

This dispatcher closes that gap by detecting at spawn time which path
to take:

1. If ``openhands`` is on PATH (the post-June-1 world), use the
   canonical CLI: ``openhands solve --task-file BRIEF --workspace
   REPO --model MODEL``.
2. Otherwise, fall back to the existing shim:
   ``python3 SHIM_PATH --brief-file BRIEF --repo REPO --model MODEL``.

The flag-name translation (``--task-file`` ↔ ``--brief-file``,
``--workspace`` ↔ ``--repo``) is hidden here so the bash runner never
needs to care which backend it's talking to.

Conformance
-----------

- **Rule #1** — port / don't reinvent. We don't write a new agent
  runtime; we wire the existing shim.
- **Rule #2** — every dependency behind an interface. The agent
  backend IS the dependency; the dispatcher IS the interface seam.
- **Rule #6** — let it crash AT the right boundary. If neither
  the canonical CLI nor the shim is available, we fail with a clear
  operator-actionable message (not a silent retry).
- **Rule #7** — graceful-degrade. Both paths are tried in order; the
  fallback is automatic.

CLI
---

::

    python3 scripts/spawn_agent.py \\
        --brief-file <path> \\
        --repo <dir> \\
        --model <name> \\
        [--api-key-env <NAME>] \\
        [--base-url <url>] \\
        [--reasoning-effort none|low|medium|high|xhigh] \\
        [--no-extended-thinking] \\
        [--shim-path <path>]   # test hook

Exits with the underlying agent's exit code. Streams stdout/stderr
transparently.

Special exit codes (set by this dispatcher, not the underlying agent):

- 64 (EX_USAGE): bad arguments
- 127: neither ``openhands`` on PATH nor the shim was found (and no
  ``--shim-path`` override was provided)

Cross-references
----------------

- ``novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py``
  — the actual SDK shim this dispatcher delegates to today
- ``novel/adapters/agent-runtime-openhands/src/spawner.ts``
  — the TS counterpart that builds the same invocation
- ``docs/plans/2026-05-22-path-c-openhands-reshape.md``
  — why the canonical CLI ships June 1 and what happens after
- ``bin/minsky-run.sh``
  — the bash caller that wraps this dispatcher under the watchdog
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional


# Default shim path relative to this script. The repo layout puts the shim
# at novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py;
# this constant keeps the path resolution boring and discoverable.
DEFAULT_SHIM_PATH = (
    Path(__file__).resolve().parent.parent
    / "novel"
    / "adapters"
    / "agent-runtime-openhands"
    / "bin"
    / "minsky-openhands-spawn.py"
)


def resolve_agent_argv(
    brief_file: str,
    repo: str,
    model: str,
    *,
    openhands_on_path: bool,
    shim_path: Optional[Path] = None,
    api_key_env: Optional[str] = None,
    base_url: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    no_extended_thinking: bool = False,
    reengage_budget: int = 0,
) -> Optional[list[str]]:
    """Return the argv list to spawn — or ``None`` if no backend exists.

    Pure function: takes the two probes (``openhands_on_path`` and the
    optional ``shim_path``) and the request (brief/repo/model + LLM
    knobs) and returns the right argv. No I/O — the caller wires
    ``shutil.which("openhands")`` and the env probe.

    Args:
        brief_file: Path to the task brief markdown.
        repo: Path to the host git repo.
        model: LiteLLM model name (e.g. ``claude-sonnet-4-20250514``).
        openhands_on_path: True iff the canonical ``openhands`` CLI is
            available (i.e. ``shutil.which("openhands")`` is non-None).
        shim_path: Optional override for the shim path. If None and
            ``openhands_on_path`` is False, returns ``None``.
        api_key_env: Optional env var name for the API key.
            Only passed to the shim path (canonical CLI uses
            backend-resolved auth).
        base_url: Optional LiteLLM endpoint URL. Shim path only.
        reasoning_effort: Optional reasoning-effort knob. Shim path only.
        no_extended_thinking: If True, sets ``--no-extended-thinking`` on
            the shim. Has no canonical-CLI equivalent yet.
        reengage_budget: How many re-engagement nudges to send when the
            conversation finishes with zero files_changed. 0 (default;
            cloud-LLM path) preserves the original single-shot behavior.
            >0 (set by bin/minsky-run.sh for local_llm_enabled=true)
            enables the nudge loop in the shim. Has no canonical-CLI
            equivalent yet — the canonical `openhands solve` ships
            June 1, 2026 and may add its own retry knob then.

    Returns:
        The argv list (e.g. ``["openhands", "solve", "--task-file", ...]``
        or ``["python3", "SHIM_PATH", "--brief-file", ...]``) or ``None``
        when no backend can be resolved (callers should fail-fast with
        exit 127).
    """
    if openhands_on_path:
        # Canonical CLI path (ships June 1, 2026). Matches the bash
        # runner's pre-existing call shape exactly.
        return [
            "openhands",
            "solve",
            "--task-file",
            brief_file,
            "--workspace",
            repo,
            "--model",
            model,
        ]
    # Shim fallback. The flag-name translation IS the work of this
    # function — bash callers never see the difference.
    if shim_path is None or not shim_path.is_file():
        return None
    argv: list[str] = [
        sys.executable,
        str(shim_path),
        "--brief-file",
        brief_file,
        "--repo",
        repo,
        "--model",
        model,
    ]
    if api_key_env is not None:
        argv.extend(["--api-key-env", api_key_env])
    if base_url is not None:
        argv.extend(["--base-url", base_url])
    if reasoning_effort is not None:
        argv.extend(["--reasoning-effort", reasoning_effort])
    if no_extended_thinking:
        argv.append("--no-extended-thinking")
    if reengage_budget > 0:
        argv.extend(["--reengage-budget", str(reengage_budget)])
    return argv


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="spawn_agent.py",
        description=(
            "Dispatch to the right OpenHands agent backend: canonical "
            "`openhands solve` CLI when available, else the existing "
            "Python shim under novel/adapters/agent-runtime-openhands/."
        ),
    )
    parser.add_argument("--brief-file", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument(
        "--api-key-env",
        default=None,
        help="Env var name holding the LLM API key (shim fallback only).",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="LiteLLM endpoint URL (shim fallback only).",
    )
    parser.add_argument(
        "--reasoning-effort",
        default=None,
        choices=[None, "none", "low", "medium", "high", "xhigh"],
        help="Reasoning-effort knob (shim fallback only).",
    )
    parser.add_argument(
        "--no-extended-thinking",
        action="store_true",
        help="Disable extended thinking budget (shim fallback only).",
    )
    parser.add_argument(
        "--reengage-budget",
        type=int,
        default=0,
        help=(
            "How many re-engagement nudges the shim should send when the "
            "conversation finishes with zero files_changed (shim fallback "
            "only). 0 preserves single-shot cloud-LLM behavior; >0 enables "
            "the local-LLM no-progress recovery loop."
        ),
    )
    parser.add_argument(
        "--shim-path",
        default=None,
        type=Path,
        help=(
            "Override the shim path (test hook). Defaults to the "
            "in-repo path under novel/adapters/agent-runtime-openhands/."
        ),
    )
    args = parser.parse_args(argv)

    # Probe the two backends. shutil.which honors PATH and is_executable;
    # is_file() on the shim path is the existence check.
    openhands_on_path = shutil.which("openhands") is not None
    # Precedence for the shim path: --shim-path flag > MINSKY_OPENHANDS_SHIM_PATH
    # env var (operator escape hatch + test hook) > DEFAULT_SHIM_PATH.
    if args.shim_path is not None:
        shim_path: Path = args.shim_path
    else:
        env_shim = os.environ.get("MINSKY_OPENHANDS_SHIM_PATH")
        shim_path = Path(env_shim) if env_shim else DEFAULT_SHIM_PATH

    resolved = resolve_agent_argv(
        brief_file=args.brief_file,
        repo=args.repo,
        model=args.model,
        openhands_on_path=openhands_on_path,
        shim_path=shim_path,
        api_key_env=args.api_key_env,
        base_url=args.base_url,
        reasoning_effort=args.reasoning_effort,
        no_extended_thinking=args.no_extended_thinking,
        reengage_budget=args.reengage_budget,
    )

    if resolved is None:
        # Rule #6 — fail loud, not silent. Operator-actionable message.
        print(
            "spawn_agent: no agent backend available — neither `openhands` "
            "on PATH nor a shim at "
            f"{shim_path}. Install OpenHands (https://docs.openhands.dev) "
            "or check the shim path.",
            file=sys.stderr,
        )
        return 127

    # Exec into the resolved backend. Streams stdout/stderr directly to
    # the caller (the bash watchdog + the iteration log).
    try:
        completed = subprocess.run(resolved, check=False)
    except FileNotFoundError as exc:
        # `openhands` was on PATH at probe time but execve failed. Rare —
        # only when PATH changes between the probe and the exec. Treat
        # the same as "no backend".
        print(f"spawn_agent: backend not executable: {exc}", file=sys.stderr)
        return 127
    return completed.returncode


if __name__ == "__main__":
    sys.exit(_main())
