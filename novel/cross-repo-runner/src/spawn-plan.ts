// Spawn plan — pure decision over what the runner would spawn given the
// host's repo config + the parsed task. The plan is the dry-run output; the
// live-spawn passes it to the existing `ProcessSpawnStrategy` from
// `@minsky/tick-loop` (rule #1 — wrap, don't replace).
//
// Pattern: command pattern (Gamma 1994 — actions inspectable as data) +
//   pure-function-with-I/O-at-edge (Martin 2017). Source: rule #2
//   (vision.md § 2 — every external dep behind an interface; the spawned
//   subprocess IS the dep, the plan is the contract); rule #6 (vision.md
//   § 6 — let-it-crash AT the boundary; the planner returns the plan, the
//   live-spawn executes it).
// Conformance: full — pure function over typed inputs.

import type { RepoConfig } from "@minsky/sidecar-bootstrap";

import type { ParsedTask } from "./task-finder.js";

export interface SpawnPlanInputs {
  /** Absolute path to the host repo root. */
  hostRoot: string;
  /** Per-host overlay parsed from .minsky/repo.yaml. */
  config: RepoConfig;
  /** The task the runner is shipping. */
  task: ParsedTask;
  /** Absolute path to the canonical minsky vision.md. */
  visionMdPath: string;
}

/**
 * The plan the runner would execute. The CLI prints it on `--dry-run`;
 * the live path passes it to `ProcessSpawnStrategy.spawn`.
 */
export interface RunnerPlan {
  /** The host repo root the spawn runs in. */
  workingDirectory: string;
  /** The task this spawn ships. */
  taskId: string;
  /** The branch the spawn cuts from `default_branch`. */
  branchName: string;
  /** Path the EXPERIMENT.yaml will be written to (under .minsky/experiments). */
  experimentYamlPath: string;
  /** Env passed to the spawned Claude Code process. */
  env: Record<string, string>;
  /** System-prompt overlay text (read by Claude Code at session start). */
  systemPromptOverlay: string;
  /** Brief sent on stdin to Claude Code. */
  brief: string;
  /** Pre-commit command from repo.yaml (empty when host has no step). */
  preCommitCommand: string;
}

/**
 * Pure function: build the runner plan.
 *
 * @otel cross-repo-runner.build-spawn-plan
 */
export function buildSpawnPlan(inputs: SpawnPlanInputs): RunnerPlan {
  const { hostRoot, config, task, visionMdPath } = inputs;
  const branchName = `${config.branch_prefix}${task.id}`;
  return {
    workingDirectory: hostRoot,
    taskId: task.id,
    branchName,
    experimentYamlPath: `${hostRoot}/.minsky/experiments/${task.id}.yaml`,
    env: {
      MINSKY_HOST_ROOT: `${hostRoot}/.minsky`,
      MINSKY_TASK_ID: task.id,
      MINSKY_BRANCH_NAME: branchName,
    },
    systemPromptOverlay: renderSystemPromptOverlay({
      visionMdPath,
      taskId: task.id,
      hostRepo: config.host_repo,
      preCommitCommand: config.pre_commit_command,
    }),
    brief: renderBrief({ task, hostRepo: config.host_repo, branchName }),
    preCommitCommand: config.pre_commit_command,
  };
}

interface OverlayInputs {
  visionMdPath: string;
  taskId: string;
  hostRepo: string;
  preCommitCommand: string;
}

function renderSystemPromptOverlay(inputs: OverlayInputs): string {
  return [
    "You are working under minsky's full constitution.",
    `Read ${inputs.visionMdPath} (also linked at .minsky/vision.md from the host).`,
    `The task is ${inputs.taskId} in host repo ${inputs.hostRepo}.`,
    "",
    "Required deliverables (rule #9 is iron):",
    "1. Cut a branch from the host's default_branch.",
    "2. Ship the code change matching the task's acceptance criteria.",
    inputs.preCommitCommand.length > 0
      ? `3. Run \`${inputs.preCommitCommand}\` and confirm zero errors before committing.`
      : "3. Run the host's pre-commit hooks (if any) before committing.",
    "4. Open a PR whose body carries a `Hypothesis self-grade` block:",
    "   - Predicted: <re-state the hypothesis>",
    "   - Observed: <the actual measurement output>",
    "   - Match: yes | no | partial",
    "   - Lesson: <one-sentence takeaway>",
    "",
    "Failure to include the self-grade block fails the minsky-side CI check.",
    "",
    // ─────────────────────────────────────────────────────────────────────
    // FINAL STEP — non-negotiable. Without this block claude --print has
    // been observed to make every edit but never call commit / push / PR
    // (see plugin task `claude-print-must-ship-pr` for the field report:
    // bulletproof-ux-dashboard iter 10 produced 348 lines and exited
    // verdict=validated, pr_url=null). The explicit ordered checklist
    // below converts the natural "analysis-mode" tail of the response
    // into an "action-mode" tail, by listing the exact tool calls the
    // session must perform before exit.
    // ─────────────────────────────────────────────────────────────────────
    "FINAL STEP — once your edits land, you MUST invoke the following",
    "shell commands in order (the Bash tool is permitted for these exact",
    "commands; do NOT exit before opening a PR):",
    "",
    `  git checkout -b ${inputs.preCommitCommand.length > 0 ? "`feat/<task-id>`" : "`feat/<task-id>`"}`,
    "  git add <files-you-edited>",
    `  git commit -m \"<conventional-commit-subject> <task-id>\"`,
    "  git push -u origin HEAD",
    "  gh pr create --base <default-branch> --head HEAD \\",
    `    --title \"<commit subject>\" --body \"<task body + self-grade>\"`,
    "",
    "After `gh pr create` succeeds, print the PR URL on its own line then",
    "exit. Do NOT leave uncommitted work in the working tree — minsky's",
    "scope-leak detector will attribute it to you and verdict=scope-leak.",
    "",
    "If a step fails (lint error, hook rejection, push conflict), report",
    "the error verbatim and STOP — do not silently retry or leave the",
    "tree dirty. The operator will read your stdout tail and decide.",
  ].join("\n");
}

interface BriefInputs {
  task: ParsedTask;
  hostRepo: string;
  branchName: string;
}

function renderBrief(inputs: BriefInputs): string {
  const { task, hostRepo, branchName } = inputs;
  return [
    `# Task: ${task.id}`,
    "",
    `Host repo: ${hostRepo}`,
    `Branch: ${branchName}`,
    `Priority: ${task.priority}`,
    task.tags.length > 0 ? `Tags: ${task.tags.join(", ")}` : "",
    "",
    "## Title",
    task.title,
    "",
    task.details !== null ? "## Details" : "",
    task.details ?? "",
    "",
    "## Hypothesis (rule #9)",
    task.hypothesis ?? "",
    "",
    "## Success threshold",
    task.success ?? "",
    "",
    "## Pivot threshold",
    task.pivot ?? "",
    "",
    "## Measurement",
    task.measurement ?? "",
    "",
    "## Anchor",
    task.anchor ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
