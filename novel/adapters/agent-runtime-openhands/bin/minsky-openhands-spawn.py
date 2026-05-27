#!/usr/bin/env python3
# <!-- scope: human-approved 2026-05-24 operator directive "Let's work on completely integrating with openhands today" — Path C reshape phase 1 -->
# <!-- pattern: not-applicable — instance of the Adapter pattern row already in vision.md § "Pattern conformance index" row 3 (`novel/adapters/`); this Python shim is the OpenHands-side half of the same adapter the TS spawner.ts implements -->
"""Minsky's OpenHands runtime spawner — Python shim over the OpenHands SDK.

This script is the OpenHands half of the rule-#2 adapter pattern. The TS
side (`@minsky/agent-runtime-openhands` in this same package) builds the
subprocess invocation; this Python script consumes the brief + repo path
on argv, runs the OpenHands SDK in-process via `openhands.sdk.Conversation`,
and emits a deterministic single-line JSON result envelope on stdout.

Why a Python shim and not the OpenHands CLI? The June-1-2026 Agent Canvas
Initiative will ship a stable single-shot `openhands solve --task-file X`
CLI. Until that ships, the SDK is the only way to run OpenHands headless
against a local repo without standing up a long-lived REST server. The
shim is therefore explicitly throwaway code — when the canonical CLI
lands on `2026-06-01`, this file is replaced with a direct subprocess
invocation of `openhands solve …` and the TS adapter shape stays the
same. See `docs/plans/2026-05-22-path-c-openhands-reshape.md` for the
full migration plan.

Wire shape (matches the existing claude/devin spawn contracts in
`novel/cross-repo-runner/bin/minsky-run.mjs`):

  - stdin:        unused (Python argparse owns argv; brief comes via --brief-file)
  - argv:         --brief-file <path>   --model <name>   --repo <dir>
                  [--api-key-env <name>] [--max-iterations <n>]
  - stdout:       streaming agent transcript + final JSON result envelope on
                  the LAST LINE. The TS caller reads `process.stdout` for the
                  PR brief but parses ONLY the last line as JSON for the
                  structured result.
  - stderr:       operator-visible diagnostics (warnings, errors)
  - exit code:    0 on success, 64 on bad input (EX_USAGE), 1 on agent failure
"""

import argparse
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path


def _baseline_sha(repo_root: Path) -> str:
    """Capture HEAD SHA before the agent runs (for post-run diff).

    Returns the empty string if not in a git repo — the TS caller treats
    this as 'no diff captured' and falls back to its own baseline.
    """
    result = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def _capture_diff_stats(repo_root: Path, baseline_sha: str) -> dict[str, int]:
    """Return file-change stats since baseline_sha, including uncommitted edits AND new untracked files.

    The agent may either commit (full git diff baseline..HEAD) or leave
    edits uncommitted (git diff baseline plus working-tree diff), or
    create brand-new untracked files (`git status --porcelain`). We
    capture all three so the TS caller sees the full union — anything
    less misses common agent behaviour like "create a new file" which
    git diff alone reports as zero changes (because the new file is
    untracked, not modified).
    """
    if baseline_sha == "":
        return {"files_changed": 0, "diff_bytes": 0}
    committed = subprocess.run(
        ["git", "-C", str(repo_root), "diff", f"{baseline_sha}..HEAD"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    uncommitted = subprocess.run(
        ["git", "-C", str(repo_root), "diff", "HEAD"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    # Untracked files don't show in `git diff` — get them from porcelain.
    # Format: `?? path/to/file` per untracked entry. We count entries and
    # add a rough byte-size from the working tree.
    untracked = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    untracked_paths = [p for p in (untracked.stdout or "").splitlines() if p.strip()]
    untracked_byte_count = 0
    for rel_path in untracked_paths:
        abs_path = repo_root / rel_path
        try:
            untracked_byte_count += abs_path.stat().st_size
        except OSError:
            # Path disappeared between ls-files and stat — skip
            pass

    combined = (committed.stdout or "") + (uncommitted.stdout or "")
    diff_files = combined.count("diff --git ")
    return {
        "files_changed": diff_files + len(untracked_paths),
        "diff_bytes": len(combined) + untracked_byte_count,
    }


def _resolve_api_key(env_name: str) -> str | None:
    """Look up the API key under the requested env var name. Returns None if absent."""
    return os.getenv(env_name)


def _build_agent(
    model: str,
    api_key: str,
    base_url: str | None,
    reasoning_effort: str | None,
    disable_extended_thinking: bool,
):
    """Construct an OpenHands Agent with the canonical 3-tool kit.

    Tools: terminal + file_editor + task_tracker. This matches the
    OpenHands SDK README hello-world (context7 /openhands/software-agent-sdk).
    Additional tools (web search, MCP integrations) are out of scope for
    the v0 adapter — file follow-up tasks if a workload needs them.

    LLM-config knobs:

    - `base_url` — non-None routes through a custom LiteLLM endpoint
      (e.g. `http://localhost:11434` for Ollama). Required for any
      `ollama_chat/<model>` or `lm_studio/<model>` id.
    - `reasoning_effort` — `'none'` disables OpenHands' default
      reasoning-token request (Anthropic/OpenAI feature). Ollama and
      most non-thinking providers fail the request with
      `does-not-support-thinking` if this isn't `'none'`.
    - `disable_extended_thinking` — sets `extended_thinking_budget=None`,
      otherwise OpenHands defaults to 200000 budget tokens which
      Ollama rejects with the same `does-not-support-thinking` error.
    """
    from openhands.sdk import LLM, Agent, Tool  # local import keeps banner suppressible
    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.task_tracker import TaskTrackerTool
    from openhands.tools.terminal import TerminalTool

    llm_kwargs: dict[str, object] = {"model": model, "api_key": api_key}
    if base_url is not None:
        llm_kwargs["base_url"] = base_url
    if reasoning_effort is not None:
        llm_kwargs["reasoning_effort"] = reasoning_effort
    if disable_extended_thinking:
        llm_kwargs["extended_thinking_budget"] = None
    llm = LLM(**llm_kwargs)
    return Agent(
        llm=llm,
        tools=[
            Tool(name=TerminalTool.name),
            Tool(name=FileEditorTool.name),
            Tool(name=TaskTrackerTool.name),
        ],
    )


def _run_conversation(agent, brief: str, repo_root: Path, max_iterations: int) -> None:
    """Send the brief to OpenHands and run the conversation to completion.

    Streams agent activity to stdout as it happens (OpenHands' default
    callback writes to stdout) so the TS caller can show the operator
    real-time progress.
    """
    from openhands.sdk import Conversation

    conversation = Conversation(agent=agent, workspace=str(repo_root))
    conversation.send_message(brief)
    conversation.run()


def main() -> int:
    """Entry point — see module docstring for the contract."""
    parser = argparse.ArgumentParser(
        prog="minsky-openhands-spawn",
        description="Run an OpenHands SDK agent against a local repo (Minsky adapter shim).",
    )
    parser.add_argument(
        "--brief-file",
        required=True,
        help="Path to the task brief markdown.",
    )
    parser.add_argument(
        "--model",
        required=True,
        help="LiteLLM model name (e.g. claude-sonnet-4-20250514).",
    )
    parser.add_argument(
        "--repo",
        required=True,
        help="Path to the host git repo (will be used as OpenHands workspace).",
    )
    parser.add_argument(
        "--api-key-env",
        default="ANTHROPIC_API_KEY",
        help="Env var name that holds the LLM API key. Default: ANTHROPIC_API_KEY.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help=(
            "Optional LiteLLM endpoint base URL. Required for Ollama / LM Studio "
            "/ any non-default provider, e.g. 'http://localhost:11434' for "
            "ollama_chat/* models. Omit for Anthropic/OpenAI/Gemini cloud endpoints."
        ),
    )
    parser.add_argument(
        "--reasoning-effort",
        default=None,
        choices=[None, "none", "low", "medium", "high", "xhigh"],
        help=(
            "OpenHands reasoning-effort knob. Set 'none' for non-thinking providers "
            "(Ollama, LM Studio, most local models) which reject the default 'high' "
            "with 'does-not-support-thinking'. Omit for Anthropic/OpenAI/Gemini."
        ),
    )
    parser.add_argument(
        "--no-extended-thinking",
        action="store_true",
        help=(
            "Disable OpenHands' default extended_thinking_budget (200000 tokens). "
            "Required for Ollama and other non-thinking providers. Has no effect "
            "for providers that support thinking; set it whenever --base-url points "
            "at a local endpoint."
        ),
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=50,
        help="Reserved for future use; OpenHands SDK does not currently expose this knob.",
    )
    args = parser.parse_args()

    # Validate inputs before doing any SDK work — fast fail at the boundary.
    brief_path = Path(args.brief_file)
    if not brief_path.is_file():
        sys.stderr.write(f"[openhands-spawn] brief-file not found: {brief_path}\n")
        return 64
    repo_root = Path(args.repo)
    if not repo_root.is_dir():
        sys.stderr.write(f"[openhands-spawn] repo dir not found: {repo_root}\n")
        return 64
    api_key = _resolve_api_key(args.api_key_env)
    if api_key is None:
        # Local-LLM bypass — when `--base-url` points at a local endpoint
        # (Ollama / LM Studio / vLLM), the API key is a no-op. LiteLLM
        # accepts any non-empty string (or `"ollama"` literally) and the
        # local server doesn't validate it. Skipping the check here is
        # what makes `local_llm_enabled: true` in `~/.minsky/config.json`
        # actually work — pre-fix, the operator had to set
        # `ANTHROPIC_API_KEY=anything` as a workaround.
        #
        # Source: 2026-05-27 operator session — 30 consecutive iterations
        # spawn-failed with "missing API key: ANTHROPIC_API_KEY unset"
        # because the shim required the cloud-credential env var even
        # when routing to a local model. user-stories/015 (local models
        # are the default until we're stable) is the load-bearing rule.
        if args.base_url:
            api_key = "ollama"  # litellm sentinel for local endpoints
        else:
            sys.stderr.write(
                f"[openhands-spawn] missing API key: env var '{args.api_key_env}' is unset. "
                f"Either export it (`export {args.api_key_env}=sk-...`) for cloud models, "
                f"OR pass `--base-url http://localhost:11434` for local Ollama / LM Studio "
                f"(api key is then a no-op).\n"
            )
            return 64

    brief = brief_path.read_text(encoding="utf-8")
    baseline = _baseline_sha(repo_root)

    try:
        agent = _build_agent(
            model=args.model,
            api_key=api_key,
            base_url=args.base_url,
            reasoning_effort=args.reasoning_effort,
            disable_extended_thinking=args.no_extended_thinking,
        )
        _run_conversation(
            agent=agent,
            brief=brief,
            repo_root=repo_root,
            max_iterations=args.max_iterations,
        )
    except Exception as exc:  # noqa: BLE001 — boundary catch
        sys.stderr.write(f"[openhands-spawn] agent run failed: {exc}\n")
        sys.stderr.write(traceback.format_exc())
        return 1

    # Emit the structured result envelope on the LAST stdout line. The TS
    # caller parses only this line; everything before it is the human-
    # visible transcript already streamed by OpenHands' default callback.
    stats = _capture_diff_stats(repo_root, baseline)
    envelope = {
        "agent": "openhands",
        "sdk_version": _detect_sdk_version(),
        "baseline_sha": baseline,
        "files_changed": stats["files_changed"],
        "diff_bytes": stats["diff_bytes"],
        "ok": True,
    }
    sys.stdout.write("\n")  # separator before the envelope line
    sys.stdout.write(json.dumps(envelope))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


def _detect_sdk_version() -> str:
    """Best-effort version capture for the iteration ledger. Returns 'unknown' on miss."""
    try:
        from importlib.metadata import version

        return version("openhands-ai")
    except Exception:  # noqa: BLE001 — version capture is best-effort
        return "unknown"


if __name__ == "__main__":
    sys.exit(main())
