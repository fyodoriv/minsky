#!/usr/bin/env python3
"""scripts/build_brief.py — Phase 7 brief builder (parity port of spawn-plan.ts § renderBrief).

Replaces the 4-line stub `bin/minsky-run.sh` had been writing to the
openhands brief file. Builds the full TS-parity brief: task metadata
section + system-prompt overlay with constitution, deliverables
checklist, and the FINAL STEP block that converts analysis-mode tails
into action-mode tails (the `claude-print-must-ship-pr` regression).

Source-of-truth: `novel/cross-repo-runner/src/spawn-plan.ts` §
`renderBrief` and `renderSystemPromptOverlay`. The Python output is
byte-equivalent to the TypeScript output for the same task block + host
config — see `tests/test_build_brief.py` for the fixture pin.

CLI:
    python3 scripts/build_brief.py <task-id> <host-dir> [--vision-md <path>] [--max-tokens <N>]

Prints the brief to stdout. Reads:
    <host-dir>/TASKS.md             — picks up the task block (must exist)
    <host-dir>/.minsky/repo.yaml    — picks up host_repo + pre_commit_command
                                       (optional; defaults degrade gracefully)

`--max-tokens <N>` clamps the brief to ≤ N tokens (~4 bytes/token
heuristic — sufficient for English; no tokenizer dependency). When
the full brief exceeds N×4 bytes, the system-prompt overlay (the
constitution + deliverables checklist) is truncated first, then the
task description's narrative is trimmed; the rule-9 fields (Hypothesis,
Success, Pivot, Measurement, Anchor) and the FINAL STEP block are
never dropped — they're the load-bearing parts of the brief.

Source for `--max-tokens`: heal-brief-too-long-for-context-window
(M1.13 self-heal helper; PRs #938 + this PR's
build-brief-supports-max-tokens follow-up).

Exit codes:
    0 — brief printed
    1 — task not found in host TASKS.md
    2 — bad CLI args
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NamedTuple

# Allow importing pick_task as a sibling module without installing the package.
sys.path.insert(0, str(Path(__file__).parent))

import pick_task  # noqa: E402  pylint: disable=wrong-import-position

DEFAULT_VISION_MD_PATH = ".minsky/vision.md"
DEFAULT_BRANCH_PREFIX = "feat/"


class HostConfig(NamedTuple):
    """Subset of `.minsky/repo.yaml` we use when building the brief.

    Parity contract: matches `HostConfig` in `spawn-plan.ts` minus
    fields we don't need for the brief.
    """

    host_repo: str
    branch_prefix: str
    pre_commit_command: str
    default_branch: str


def load_host_config(host_dir: Path) -> HostConfig:
    """Load `.minsky/repo.yaml` if present; otherwise return safe defaults.

    Defaults: host_repo = basename(host_dir), branch_prefix = "feat/",
    pre_commit_command = "" (no host hooks), default_branch = "main".
    """
    repo_yaml = host_dir / ".minsky" / "repo.yaml"
    # Resolve `.` → absolute basename so the brief shows a real name.
    host_repo = host_dir.resolve().name
    branch_prefix = DEFAULT_BRANCH_PREFIX
    pre_commit_command = ""
    # default_branch defaults to "main" — matches the GitHub-default
    # for new repos and the TS substrate's `loadRepoConfig` fallback.
    default_branch = "main"
    if repo_yaml.is_file():
        # Minimal hand-roll parser — we only need 4 fields and don't
        # want to add a yaml dependency. Format is one `key: value` per
        # line, no nesting.
        for raw in repo_yaml.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            value = value.strip().strip('"').strip("'")
            if key.strip() == "host_repo":
                host_repo = value
            elif key.strip() == "branch_prefix":
                branch_prefix = value
            elif key.strip() == "pre_commit_command":
                pre_commit_command = value
            elif key.strip() == "default_branch":
                default_branch = value
    return HostConfig(host_repo=host_repo, branch_prefix=branch_prefix,
                      pre_commit_command=pre_commit_command,
                      default_branch=default_branch)


def render_brief(task: pick_task.ParsedTask, host_repo: str, branch_name: str) -> str:
    """Render the task-block section of the brief.

    Parity contract: matches `renderBrief` in `spawn-plan.ts`. Same
    section order: ID, host, branch, priority, tags, title, details,
    rule-9 fields. Empty lines are filtered out (matches TS `.filter`).
    """
    tags_line = f"Tags: {', '.join(task.tags)}" if task.tags else ""
    lines = [
        f"# Task: {task.id}",
        "",
        f"Host repo: {host_repo}",
        f"Branch: {branch_name}",
        f"Priority: {task.priority}",
        tags_line,
        "",
        "## Title",
        task.title,
        "",
        "## Details" if task.details is not None else "",
        task.details or "",
        "",
        "## Hypothesis (rule #9)",
        task.hypothesis or "",
        "",
        "## Success threshold",
        task.success or "",
        "",
        "## Pivot threshold",
        task.pivot or "",
        "",
        "## Measurement",
        task.measurement or "",
        "",
        "## Anchor",
        task.anchor or "",
    ]
    return "\n".join(line for line in lines if line != "")


def render_system_prompt_overlay(
    *,
    vision_md_path: str,
    task_id: str,
    host_repo: str,
    pre_commit_command: str,
) -> str:
    """Render the constitution + deliverables overlay.

    Parity contract: matches `renderSystemPromptOverlay` in spawn-plan.ts.
    The FINAL STEP block (claude-print-must-ship-pr regression fix) is
    non-negotiable — without it the agent has been observed to make
    every edit but never call `gh pr create`.
    """
    line_3 = (
        f"3. Run `{pre_commit_command}` and confirm zero errors before committing."
        if pre_commit_command
        else "3. Run the host's pre-commit hooks (if any) before committing."
    )
    lines = [
        "You are working under minsky's full constitution.",
        f"Read {vision_md_path} (also linked at .minsky/vision.md from the host).",
        f"The task is {task_id} in host repo {host_repo}.",
        "",
        "Required deliverables (rule #9 is iron):",
        "1. Cut a branch from the host's default_branch.",
        "2. Ship the code change matching the task's acceptance criteria.",
        line_3,
        f"4. Remove the shipped task block (`{task_id}`) from `TASKS.md` in the SAME commit that ships the code — the runner unions `TASKS.md` + `AGENTS.md` into the task's declared scope so this cleanup never triggers scope-leak. History lives in git log; never mark the block `[x]`, delete it entirely.",
        "5. Open a PR whose body carries a `Hypothesis self-grade` block:",
        "   - Predicted: <re-state the hypothesis>",
        "   - Observed: <the actual measurement output>",
        "   - Match: yes | no | partial",
        "   - Lesson: <one-sentence takeaway>",
        "",
        "Failure to include the self-grade block fails the minsky-side CI check.",
        "Failure to remove the shipped task block from TASKS.md re-spawns the same task on the next tick (rule #9 — ship-off-the-queue is a sweep-completion invariant, not a soft preference).",
        "",
        "FINAL STEP — once your edits land, you MUST invoke the following",
        "shell commands in order (the Bash tool is permitted for these exact",
        "commands; do NOT exit before opening a PR):",
        "",
        "  git checkout -b `feat/<task-id>`",
        "  git add <files-you-edited>",
        '  git commit -m "<conventional-commit-subject> <task-id>"',
        "  git push -u origin HEAD",
        "  gh pr create --base <default-branch> --head HEAD \\",
        '    --title "<commit subject>" --body "<task body + self-grade>"',
        "",
        "After `gh pr create` succeeds, print the PR URL on its own line then",
        "exit. Do NOT leave uncommitted work in the working tree — minsky's",
        "scope-leak detector will attribute it to you and verdict=scope-leak.",
        "",
        "If a step fails (lint error, hook rejection, push conflict), report",
        "the error verbatim and STOP — do not silently retry or leave the",
        "tree dirty. The operator will read your stdout tail and decide.",
        "",
        "TOOL-CALL DISCIPLINE (load-bearing, observed-2026-05-27 disengagement",
        "fix for non-Claude models): EVERY reply you emit must include a tool",
        "call — `terminal`, `file_editor`, `task_tracker`, or `finish`. The",
        "OpenHands SDK treats a reply containing only prose (no tool call) as",
        "the conversation-end signal and TERMINATES the conversation",
        "immediately, regardless of whether you've shipped the work.",
        "",
        "Specifically forbidden: emitting `Let me examine X` / `Now I'll do Y`",
        "/ `Let me check Z` AS PROSE WITHOUT THE ATTACHED TOOL CALL. The",
        "system has caught 13+ iterations of `qwen3-coder:30b` doing this on",
        "2026-05-27 — exiting after a single `ls -la` with no commits, no PR,",
        "no push. Each such iteration cost ~60–180s of agent time and",
        "produced zero progress.",
        "",
        "Correct pattern: every planning sentence is followed (in the SAME",
        "reply) by the tool call that executes the plan. Use the `think` tool",
        "for pure deliberation. Use `finish` ONLY when (a) the PR is open and",
        "the URL is printed, OR (b) you've hit an irrecoverable blocker that",
        "you've reported verbatim.",
    ]
    return "\n".join(lines)


# Bytes-per-token heuristic for English LLM input (rough average across
# Anthropic / OpenAI / Llama tokenizers). When `--max-tokens=N` is set,
# the brief is clamped to ≤ N × BYTES_PER_TOKEN bytes. Picked deliberately
# loose (4 vs the tokenizer-accurate ~3.5) — we'd rather under-fill than
# overshoot the LLM context window. Pivot per the heal task body: a real
# tokenizer dependency is overkill for this gate.
BYTES_PER_TOKEN = 4

# Hard upper bound on the FINAL STEP block + rule-9 fields — the
# load-bearing parts of the brief that must never be truncated. If the
# operator passes a `--max-tokens` value so small that even the
# load-bearing parts exceed it, fail loudly rather than silently produce
# an incomplete brief.
MIN_TOKENS_FOR_LOAD_BEARING = 1000


def clamp_brief_to_tokens(brief: str, max_tokens: int) -> str:
    """Clamp `brief` to ≤ max_tokens (~max_tokens × 4 bytes).

    Strategy (preserves rule-9 fields + FINAL STEP block):
      1. If the full brief fits under the budget, return unchanged.
      2. Otherwise, truncate the system-prompt overlay (the second `---`-separated
         half of the brief). The task block (which contains the rule-9 fields)
         is preserved fully.
      3. If even the task block alone exceeds the budget, truncate it with an
         explicit `[truncated by build_brief.py --max-tokens=N — heal-brief]`
         marker at the cut.
    """
    if max_tokens <= 0:
        return brief
    if max_tokens < MIN_TOKENS_FOR_LOAD_BEARING:
        raise ValueError(
            f"--max-tokens={max_tokens} is below MIN_TOKENS_FOR_LOAD_BEARING="
            f"{MIN_TOKENS_FOR_LOAD_BEARING}; the rule-9 fields + FINAL STEP "
            "block alone need more room. Pick a larger budget."
        )
    budget_bytes = max_tokens * BYTES_PER_TOKEN
    if len(brief) <= budget_bytes:
        return brief
    parts = brief.split("\n---\n", 1)
    task_block = parts[0]
    overlay = parts[1] if len(parts) == 2 else ""
    marker = "\n\n[truncated by build_brief.py --max-tokens=" + str(max_tokens) + " — heal-brief]\n"
    task_block_with_separator = task_block + "\n---\n"
    if len(task_block_with_separator) + len(marker) <= budget_bytes:
        remaining = budget_bytes - len(task_block_with_separator) - len(marker)
        return task_block_with_separator + overlay[:remaining] + marker
    cut = budget_bytes - len(marker)
    return brief[:cut] + marker


def build_brief(
    task: pick_task.ParsedTask,
    host_config: HostConfig,
    vision_md_path: str = DEFAULT_VISION_MD_PATH,
    max_tokens: int = 0,
) -> str:
    """Compose the full brief (task block + overlay separated by `---`).

    Parity contract: matches `RunnerPlan.brief` in spawn-plan.ts § buildSpawnPlan.

    When max_tokens > 0, the brief is clamped to ≤ max_tokens × 4 bytes via
    `clamp_brief_to_tokens` (preserving the rule-9 fields and the FINAL STEP
    block). max_tokens = 0 (the default) means no clamping.
    """
    assert task.id is not None, "build_brief called with task lacking an ID"
    branch_name = f"{host_config.branch_prefix}{task.id}"
    full = "\n".join([
        render_brief(task, host_config.host_repo, branch_name),
        "",
        "---",
        "",
        render_system_prompt_overlay(
            vision_md_path=vision_md_path,
            task_id=task.id,
            host_repo=host_config.host_repo,
            pre_commit_command=host_config.pre_commit_command,
        ),
    ])
    return clamp_brief_to_tokens(full, max_tokens)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: build_brief.py <task-id> <host-dir> "
            "[--vision-md <path>] [--max-tokens <N>]",
            file=sys.stderr,
        )
        return 2
    task_id = argv[1]
    host_dir = Path(argv[2])
    vision_md_path = DEFAULT_VISION_MD_PATH
    max_tokens = 0
    i = 3
    while i < len(argv):
        if argv[i] == "--vision-md" and i + 1 < len(argv):
            vision_md_path = argv[i + 1]
            i += 2
        elif argv[i] == "--max-tokens" and i + 1 < len(argv):
            try:
                max_tokens = int(argv[i + 1])
            except ValueError:
                print(f"--max-tokens expects an integer, got: {argv[i + 1]}", file=sys.stderr)
                return 2
            i += 2
        elif argv[i].startswith("--max-tokens="):
            try:
                max_tokens = int(argv[i].split("=", 1)[1])
            except ValueError:
                print(f"--max-tokens=N expects an integer, got: {argv[i]}", file=sys.stderr)
                return 2
            i += 1
        else:
            print(f"unknown arg: {argv[i]}", file=sys.stderr)
            return 2

    tasks_md = host_dir / "TASKS.md"
    if not tasks_md.is_file():
        print(f"TASKS.md not found at {tasks_md}", file=sys.stderr)
        return 1
    result = pick_task.find_task(tasks_md.read_text(encoding="utf-8"), task_id)
    if not result.ok or result.task is None:
        print(result.reason or f"task '{task_id}' not found", file=sys.stderr)
        return 1
    host_config = load_host_config(host_dir)
    try:
        brief = build_brief(result.task, host_config, vision_md_path, max_tokens)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    sys.stdout.write(brief + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
