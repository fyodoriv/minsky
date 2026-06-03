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
        [--persona <role>] [--prior-artifact <path>]

`--persona <role>` front-loads the matching brief template from
`novel/personas/<role>.md` (one of researcher/planner/developer/qa/reviewer)
so the spawned persona reads its role before the task. `--prior-artifact
<path>` appends the previous persona's handoff payload under the overlay,
forming the researcher → … → reviewer artifact chain. Both are used by the
M2 multi-persona pipeline driver (`bin/minsky-multi-persona.sh`).

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

import os
import sys
from pathlib import Path
from typing import NamedTuple

# Allow importing pick_task as a sibling module without installing the package.
sys.path.insert(0, str(Path(__file__).parent))

import pick_task  # noqa: E402  pylint: disable=wrong-import-position

DEFAULT_VISION_MD_PATH = ".minsky/vision.md"
DEFAULT_BRANCH_PREFIX = "feat/"

# The five personas of the M2 multi-persona A2A pipeline, in pipeline order.
# Each maps to a brief template at `novel/personas/<role>.md`. The order is the
# load-bearing contract: persona N consumes persona N-1's handoff artifact.
# Source: user-stories/008-per-task-backend-and-personas.md § "M2 milestone";
# competitors/metagpt.md § "SOP pattern" (the researcher→…→reviewer SOP);
# novel/personas/README.md (the A2A-mapping doc).
PIPELINE_PERSONAS = ("researcher", "planner", "developer", "qa", "reviewer")

# `novel/personas/` relative to the repo root that ships `build_brief.py`. The
# persona templates live alongside the source-of-truth pipeline driver, not in
# the host repo (the host repo gets the rendered brief, never the templates).
PERSONAS_DIR = Path(__file__).resolve().parent.parent / "novel" / "personas"


def load_persona_overlay(role: str, personas_dir: Path = PERSONAS_DIR) -> str:
    """Return the persona brief template for `role`.

    Reads `novel/personas/<role>.md`. Raises ValueError for an unknown role so
    the pipeline driver fails LOUDLY (rule #6 — never silently spawn a persona
    whose template is missing). `role` must be one of `PIPELINE_PERSONAS`.
    """
    if role not in PIPELINE_PERSONAS:
        valid = ", ".join(PIPELINE_PERSONAS)
        raise ValueError(f"unknown persona role '{role}'; valid roles: {valid}")
    template = personas_dir / f"{role}.md"
    if not template.is_file():
        raise ValueError(f"persona template not found at {template}")
    return template.read_text(encoding="utf-8").rstrip("\n")


def render_persona_overlay(role: str, prior_artifact: str = "") -> str:
    """Render the persona section that front-loads the brief.

    The persona template comes first so the spawned agent reads its role before
    the task. When `prior_artifact` is non-empty (the previous persona's handoff
    payload), it is appended under an explicit heading — this is the artifact
    chain (researcher → planner → … → reviewer) that makes persona N+1 build on
    persona N's output rather than re-deriving context.
    """
    overlay = load_persona_overlay(role)
    if not prior_artifact.strip():
        return overlay
    return "\n".join([
        overlay,
        "",
        "## Prior persona artifact (your input — build on this, do not re-derive)",
        "",
        prior_artifact.rstrip("\n"),
    ])


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


def _render_tool_call_discipline() -> list[str]:
    """The tool-call discipline block — load-bearing for qwen3-coder:30b
    and other non-Claude models that disengage on prose-only replies.

    Extracted to a helper so `--local-llm-mode` can front-load it
    (the model sees it BEFORE the task, not buried at line 60+).
    """
    return [
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
        "reply) by the tool call that executes the plan — `terminal` or",
        "`file_editor`. These are the only tools that produce side effects",
        "the operator can observe. Use `finish` ONLY when (a) the PR is open",
        "and the URL is printed, OR (b) you've hit an irrecoverable blocker",
        "that you've reported verbatim.",
        "",
        "EXPLICITLY FORBIDDEN: calling the `think` tool more than ONCE per",
        "task. The `think` tool produces zero observation by design — every",
        "call burns one turn against the 50-iteration cap without changing",
        "anything in the worktree. Observed 2026-05-28: an iteration hit the",
        "max_iteration_per_run cap (50) with files_changed=1 (carry-over from",
        "the prior iteration) and 0 new commits, because the model called",
        "`think` 44 times to satisfy the discipline above without ever",
        "calling `file_editor` or `terminal` to actually do work. If you",
        "feel the urge to think, call `terminal` to `ls` or `cat` a relevant",
        "file instead — that gives you observable context AND counts as a",
        "real tool call. Or call `file_editor` to view a file. Either way,",
        "produce a side effect.",
    ]


def render_system_prompt_overlay(
    *,
    vision_md_path: str,
    task_id: str,
    host_repo: str,
    pre_commit_command: str,
    local_llm_mode: bool = False,
    wait_after_pr_open: bool = False,
) -> str:
    """Render the constitution + deliverables overlay.

    Parity contract: matches `renderSystemPromptOverlay` in spawn-plan.ts.
    The FINAL STEP block (claude-print-must-ship-pr regression fix) is
    non-negotiable — without it the agent has been observed to make
    every edit but never call `gh pr create`.

    `local_llm_mode=True` (set by bin/minsky-run.sh when
    `local_llm_enabled: true` in `~/.minsky/config.json`) reorders the
    overlay so the TOOL-CALL DISCIPLINE block is the FIRST thing the
    agent reads. Observation 2026-05-28: with the discipline buried at
    line 60+ of the brief, the model reads constitution + deliverables
    + FINAL STEP first, then hits the discipline warning AFTER its
    behavioural pattern is already primed. Front-loading the warning
    forces the model to internalise "every reply needs a tool call"
    before any other instruction lands. The constitution preamble
    ("Read .minsky/vision.md") is also dropped in local mode — the
    local model can't hold a 1MB constitution document in its context
    window and ends up either ignoring the instruction or wasting
    tokens trying to load it.

    `wait_after_pr_open=True` (set by bin/minsky-run.sh when the env var
    `MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true` is exported) reverts the
    FINAL STEP exit instruction to the legacy "run until something
    happens" behaviour: the agent is told it MAY stay alive after
    `gh pr create` to react to red CI. The default (False) tells the
    agent to exit cleanly with code 0 the moment the PR URL prints,
    because the next minsky iteration owns the CI-fix loop. Source:
    TASKS.md `brief-instructs-exit-after-pr-open` — devin was observed
    opening PR #614 14min into an iteration then idling to the 15min
    SIGKILL, wasting compute; the exit-when-done instruction cuts the
    typical-case wall-clock cost. The env var is the documented opt-out
    for the Pivot case (operators discover CI-fix loops need the wait).
    """
    line_3 = (
        f"3. Run `{pre_commit_command}` and confirm zero errors before committing."
        if pre_commit_command
        else "3. Run the host's pre-commit hooks (if any) before committing."
    )

    # The exit-after-PR instruction. Default (wait_after_pr_open=False)
    # tells the agent to exit code 0 the instant the PR URL prints — the
    # next minsky iteration owns the CI-fix loop, so idling here only
    # burns compute until the spawn watchdog SIGKILLs at the timeout
    # ceiling (the brief-instructs-exit-after-pr-open bug class). When
    # MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true is exported, the legacy
    # "run until something happens" behaviour returns (the documented
    # opt-out for the Pivot case — operators who need to react to red CI
    # within the same iteration).
    if wait_after_pr_open:
        exit_after_pr_lines = [
            "After `gh pr create` succeeds, print the PR URL on its own line.",
            "You MAY stay alive after the PR opens to watch CI and react to",
            "red checks within this iteration (legacy mode — enabled via",
            "MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true). Do NOT leave uncommitted",
            "work in the working tree — minsky's scope-leak detector will",
            "attribute it to you and verdict=scope-leak.",
        ]
    else:
        exit_after_pr_lines = [
            "After `gh pr create` succeeds, print the PR URL on its own line",
            "then EXIT CLEANLY with exit code 0 immediately. Do NOT wait for",
            "CI feedback or watch the checks — the NEXT minsky iteration",
            "handles CI-fix loops. Idling here only burns compute until the",
            "spawn watchdog SIGKILLs you at the timeout ceiling. Do NOT leave",
            "uncommitted work in the working tree — minsky's scope-leak detector",
            "will attribute it to you and verdict=scope-leak.",
        ]

    preamble_lines = (
        []
        if local_llm_mode
        else [
            "You are working under minsky's full constitution.",
            f"Read {vision_md_path} (also linked at .minsky/vision.md from the host).",
            f"The task is {task_id} in host repo {host_repo}.",
            "",
        ]
    )

    deliverables_lines = [
        "Required deliverables (rule #9 is iron):",
        "1. Cut a branch from the host's default_branch.",
        "2. Ship the code change matching the task's acceptance criteria.",
        line_3,
        f"4. Remove the shipped task block (`{task_id}`) from `TASKS.md` in the SAME commit that ships the code — the runner unions `TASKS.md` + `AGENTS.md` into the task's declared scope so this cleanup never triggers scope-leak. History lives in git log; never mark the block `[x]`, delete it entirely.",
        f"   - If you discover this task's code is ALREADY SHIPPED (its PR is open or merged), your ONLY change in this iteration is to REMOVE the entire `- [ ] …` block for `{task_id}` from `TASKS.md`. Do NOT add `[x]` annotations to its acceptance items. Do NOT add a `**Status**:` line. Do NOT 'respect the existing structure' — per the tasks.md spec, a completed task's block is deleted, not annotated; leaving it intact (even ticked) re-picks the same task on the next tick.",
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
        *exit_after_pr_lines,
        "",
        "If a step fails (lint error, hook rejection, push conflict), report",
        "the error verbatim and STOP — do not silently retry or leave the",
        "tree dirty. The operator will read your stdout tail and decide.",
        "",
    ]

    discipline_lines = _render_tool_call_discipline()

    if local_llm_mode:
        # Front-load the discipline: model sees it BEFORE the task spec.
        lines = (
            discipline_lines
            + [""]
            + [
                f"The task is {task_id} in host repo {host_repo}.",
                "",
            ]
            + deliverables_lines
        )
    else:
        # Original (cloud-LLM) order: constitution preamble → deliverables → discipline.
        lines = preamble_lines + deliverables_lines + discipline_lines
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

    Strategy (default brief shape — preserves rule-9 fields + FINAL STEP block):
      1. If the full brief fits under the budget, return unchanged.
      2. Otherwise, truncate the system-prompt overlay (the second `---`-separated
         half of the brief). The task block (which contains the rule-9 fields)
         is preserved fully.
      3. If even the task block alone exceeds the budget, truncate it with an
         explicit `[truncated by build_brief.py --max-tokens=N — heal-brief]`
         marker at the cut.

    Caveat under `--persona` mode (build-brief-clamp-docstring-persona-mode):
    the split is on the FIRST `\\n---\\n`, so what `parts[0]` preserves depends
    on the brief's section order. `build_brief` front-loads the persona overlay
    under `--persona` (persona overlay → `---` → task block → `---` → system
    overlay), so the FIRST separator is the persona/task boundary. In that
    layout `parts[0]` is the PERSONA OVERLAY (not the task block), and the
    truncated tail (`parts[1]`) is the task block + system overlay — i.e. the
    rule-9 fields land in the truncatable tail, not the preserved head. This is
    benign today: the M2 pipeline driver (`bin/minsky-multi-persona.sh`) never
    combines `--persona` with `--max-tokens`, so the persona path is always
    rendered unclamped. A future caller that DOES combine them must not rely on
    the rule-9 fields surviving truncation under `--persona`; rsplit-on-last-`---`
    is the option (b) fix tracked in the task body if that combination ships.
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
    local_llm_mode: bool = False,
    persona: str | None = None,
    prior_artifact: str = "",
    wait_after_pr_open: bool = False,
) -> str:
    """Compose the full brief (task block + overlay separated by `---`).

    Parity contract: matches `RunnerPlan.brief` in spawn-plan.ts § buildSpawnPlan.

    When max_tokens > 0, the brief is clamped to ≤ max_tokens × 4 bytes via
    `clamp_brief_to_tokens` (preserving the rule-9 fields and the FINAL STEP
    block). max_tokens = 0 (the default) means no clamping.

    When local_llm_mode is True, the overlay is restructured (see
    `render_system_prompt_overlay`): the TOOL-CALL DISCIPLINE block moves to
    the top, the constitution preamble is dropped. This is set automatically
    by bin/minsky-run.sh when `local_llm_enabled: true` in
    `~/.minsky/config.json`.

    When wait_after_pr_open is True (set by bin/minsky-run.sh when the env
    var `MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true` is exported), the FINAL STEP
    exit instruction reverts to the legacy "run until something happens"
    behaviour. The default (False) tells the agent to exit cleanly with code
    0 the instant the PR URL prints — see `render_system_prompt_overlay` and
    TASKS.md `brief-instructs-exit-after-pr-open`.

    When persona is set (one of `PIPELINE_PERSONAS`), the matching brief
    template from `novel/personas/<role>.md` is front-loaded before the task
    block — the spawned persona reads its role before the task. `prior_artifact`
    (the previous persona's handoff payload) is appended under the persona
    overlay to form the researcher → … → reviewer artifact chain. This is the
    `--persona` overlay path the M2 multi-persona pipeline driver
    (`bin/minsky-multi-persona.sh`) uses for each persona transition.
    """
    assert task.id is not None, "build_brief called with task lacking an ID"
    branch_name = f"{host_config.branch_prefix}{task.id}"
    sections: list[str] = []
    if persona is not None:
        sections.extend([
            render_persona_overlay(persona, prior_artifact),
            "",
            "---",
            "",
        ])
    sections.extend([
        render_brief(task, host_config.host_repo, branch_name),
        "",
        "---",
        "",
        render_system_prompt_overlay(
            vision_md_path=vision_md_path,
            task_id=task.id,
            host_repo=host_config.host_repo,
            pre_commit_command=host_config.pre_commit_command,
            local_llm_mode=local_llm_mode,
            wait_after_pr_open=wait_after_pr_open,
        ),
    ])
    full = "\n".join(sections)
    return clamp_brief_to_tokens(full, max_tokens)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: build_brief.py <task-id> <host-dir> "
            "[--vision-md <path>] [--max-tokens <N>] [--local-llm-mode] "
            "[--persona <role>] [--prior-artifact <path>]",
            file=sys.stderr,
        )
        return 2
    task_id = argv[1]
    host_dir = Path(argv[2])
    vision_md_path = DEFAULT_VISION_MD_PATH
    max_tokens = 0
    local_llm_mode = False
    persona: str | None = None
    prior_artifact_path: Path | None = None
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
        elif argv[i] == "--persona" and i + 1 < len(argv):
            persona = argv[i + 1]
            i += 2
        elif argv[i].startswith("--persona="):
            persona = argv[i].split("=", 1)[1]
            i += 1
        elif argv[i] == "--prior-artifact" and i + 1 < len(argv):
            prior_artifact_path = Path(argv[i + 1])
            i += 2
        elif argv[i].startswith("--prior-artifact="):
            prior_artifact_path = Path(argv[i].split("=", 1)[1])
            i += 1
        elif argv[i] == "--local-llm-mode":
            local_llm_mode = True
            i += 1
        else:
            print(f"unknown arg: {argv[i]}", file=sys.stderr)
            return 2

    prior_artifact = ""
    if prior_artifact_path is not None and prior_artifact_path.is_file():
        prior_artifact = prior_artifact_path.read_text(encoding="utf-8")

    tasks_md = host_dir / "TASKS.md"
    if not tasks_md.is_file():
        print(f"TASKS.md not found at {tasks_md}", file=sys.stderr)
        return 1
    result = pick_task.find_task(tasks_md.read_text(encoding="utf-8"), task_id)
    if not result.ok or result.task is None:
        print(result.reason or f"task '{task_id}' not found", file=sys.stderr)
        return 1
    host_config = load_host_config(host_dir)
    # Env escape hatch (TASKS.md `brief-instructs-exit-after-pr-open` Pivot):
    # MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true reverts the FINAL STEP exit
    # instruction to the legacy "run until something happens" behaviour.
    # Read at the CLI boundary (mirrors how bin/minsky-run.sh exports env
    # to the build_brief.py subprocess) so the .sh shim needs no change.
    wait_after_pr_open = os.environ.get(
        "MINSKY_BRIEF_WAIT_AFTER_PR_OPEN", ""
    ).strip().lower() in ("1", "true", "yes")
    try:
        brief = build_brief(
            result.task,
            host_config,
            vision_md_path,
            max_tokens,
            local_llm_mode=local_llm_mode,
            persona=persona,
            prior_artifact=prior_artifact,
            wait_after_pr_open=wait_after_pr_open,
        )
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    sys.stdout.write(brief + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
