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
    python3 scripts/build_brief.py <task-id> <host-dir> [--vision-md <path>]

Prints the brief to stdout. Reads:
    <host-dir>/TASKS.md             — picks up the task block (must exist)
    <host-dir>/.minsky/repo.yaml    — picks up host_repo + pre_commit_command
                                       (optional; defaults degrade gracefully)

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
    ]
    return "\n".join(lines)


def build_brief(
    task: pick_task.ParsedTask,
    host_config: HostConfig,
    vision_md_path: str = DEFAULT_VISION_MD_PATH,
) -> str:
    """Compose the full brief (task block + overlay separated by `---`).

    Parity contract: matches `RunnerPlan.brief` in spawn-plan.ts § buildSpawnPlan.
    """
    assert task.id is not None, "build_brief called with task lacking an ID"
    branch_name = f"{host_config.branch_prefix}{task.id}"
    return "\n".join([
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


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: build_brief.py <task-id> <host-dir> [--vision-md <path>]",
              file=sys.stderr)
        return 2
    task_id = argv[1]
    host_dir = Path(argv[2])
    vision_md_path = DEFAULT_VISION_MD_PATH
    i = 3
    while i < len(argv):
        if argv[i] == "--vision-md" and i + 1 < len(argv):
            vision_md_path = argv[i + 1]
            i += 2
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
    sys.stdout.write(build_brief(result.task, host_config, vision_md_path) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
