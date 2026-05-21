// <!-- scope: human-approved P0 task `daemon-task-rotation-on-completion`
//      (TASKS.md, surfaced-by 9h monitoring window 2026-05-07) -->

/**
 * P0 watchdog — I/O wrapper (slice b/c of `daemon-task-rotation-on-completion`).
 *
 * Slice a (`task-completion-detector.ts`, PR #350) shipped the pure
 * `decideTaskCompletion` decision + the `**Status**` field schema. This
 * module is the daemon-side I/O wrapper that:
 *   1. reads TASKS.md (`getTasksMd` seam),
 *   2. splices the current task's block out of it (pure `spliceTaskBlock`),
 *   3. lists recent merged PRs (`listMergedPrs` seam — only when a block
 *      actually exists, see the round-trip-elimination note below),
 *   4. runs `decideTaskCompletion`,
 *   5. on a `remove` verdict, writes the block-stripped TASKS.md + commits
 *      via the `applyRemoval` seam, with a commit message that names the
 *      criteria-checker decision (visible-not-silent — Helland 2007).
 *
 * Mirror of `metrics-render-runner.ts` (rule #2 — the daemon orchestrates,
 * this module decides + applies). Pure decision stays in
 * `task-completion-detector.ts`; this layer is the seam-injected wrapper so
 * tests drive it without filesystem, `gh`, or git.
 *
 * Why a separate runner from the detector (and not folded into it): the
 * detector is a pure function of `(taskBlock, mergedPrs)`; the wrapper owns
 * the read → decide → write → commit round-trip and its observable outcome
 * shape. Folding the I/O into the detector would make the verdict logic
 * untestable without stubbing a filesystem — rule #2's whole point.
 *
 * Round-trip elimination (optimization, this iteration): the `listMergedPrs`
 * seam is a `gh pr list` subprocess. It is only invoked when the task block
 * is still present in TASKS.md. Once a prior iteration rotates the block
 * out, every subsequent iteration that still carries the stale `taskId`
 * short-circuits at `block-absent` BEFORE the `gh` round-trip — which is
 * exactly the steady state this watchdog creates (N workers, one removed
 * block, N-1 iterations that would otherwise each spawn a redundant
 * `gh pr list`).
 *
 * Pivot (rule #9, TASKS.md `daemon-task-rotation-on-completion`): if
 * auto-removal mis-fires, tighten `decideTaskCompletion` to require an
 * explicit `**Status**: shipped` field (already supported by the detector)
 * — don't retire the rotation; manual TASKS.md curation doesn't keep up
 * with the daemon pickTask rate.
 *
 * @otel-exempt module doc; `runTaskRotation` carries the span.
 */

import { type MergedPrSnapshot, decideTaskCompletion } from "./task-completion-detector.js";

/**
 * Pure: splice the task block for `taskId` out of TASKS.md.
 *
 * Mirrors `extractTaskBlock`'s block-boundary grammar in `daemon.ts` (block
 * runs from the `- [ ] \`<id>\`` heading to the next `- [ ] ` heading, the
 * next `## ` section heading, or EOF) but is kept independent so the
 * modules don't cross-import — the same deliberate-duplication pattern as
 * `titleNamesTask` ↔ `prTitleNamesTask`. A daemon.ts → here → daemon.ts
 * import cycle would otherwise form once the wire-in slice lands.
 *
 * Returns `undefined` when the ID isn't present (the common steady-state
 * after a prior iteration already rotated the block out). On a hit returns
 * the extracted `block` (trimmed, for the detector) and `without` — the
 * TASKS.md content with the block (and its trailing blank line) removed.
 *
 * @otel-exempt pure helper of `runTaskRotation`.
 */
export function spliceTaskBlock(
  tasksMd: string,
  taskId: string,
): { readonly block: string; readonly without: string } | undefined {
  const headingPattern = new RegExp(
    `^- \\[ \\] \`${taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``,
    "m",
  );
  const start = tasksMd.search(headingPattern);
  if (start < 0) return undefined;
  const after = tasksMd.slice(start);
  const endMatch = after.match(/\n(?:- \[ \] |## )/);
  if (endMatch === null || endMatch.index === undefined) {
    const block = after.trim();
    // Last block before EOF: drop it and collapse the now-trailing
    // whitespace to a single newline so TASKS.md stays lint-clean.
    const without = `${tasksMd.slice(0, start).replace(/\n+$/, "")}\n`;
    return { block, without };
  }
  const block = after.slice(0, endMatch.index).trim();
  // endMatch.index points at the `\n` that precedes the next heading; keep
  // that `\n` so the surviving heading stays at column 0 with no double
  // blank line ahead of it.
  const without = tasksMd.slice(0, start) + tasksMd.slice(start + endMatch.index + 1);
  return { block, without };
}

/** Seam: read the current TASKS.md content. Production binding does a
 * `fs.readFile`; tests inject a string. */
export type GetTasksMd = () => Promise<string>;

/** Seam: list recent merged PRs. Production binding wraps
 * `gh pr list --state merged --json number,title`; tests inject an array. */
export type ListMergedPrs = () => Promise<readonly MergedPrSnapshot[]>;

/** Seam: persist the block-stripped TASKS.md and commit it. Production
 * binding does `fs.writeFile` + `git commit --only TASKS.md`; tests record
 * the call. The commit message is supplied pre-formatted (visible-not-
 * silent — it names the criteria-checker decision). */
export type ApplyRemoval = (input: {
  readonly tasksMd: string;
  readonly taskId: string;
  readonly viaPrNumber: number;
  readonly commitMessage: string;
}) => Promise<void>;

export type RunTaskRotationOutcome =
  | {
      readonly outcome: "skipped";
      readonly reason: "env-off" | "no-task-id" | "block-absent";
    }
  | { readonly outcome: "kept"; readonly reason: string }
  | { readonly outcome: "no-merged-pr"; readonly reason: string }
  | {
      readonly outcome: "removed";
      readonly viaPrNumber: number;
      readonly reason: string;
    };

export interface RunTaskRotationArgs {
  /** The task ID the daemon iteration just worked on. */
  readonly taskId: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly getTasksMd: GetTasksMd;
  readonly listMergedPrs: ListMergedPrs;
  readonly applyRemoval: ApplyRemoval;
}

/**
 * Build the removal commit message. Names the task, the merged PR that
 * shipped its substrate, and the criteria-checker's reason — so the git
 * log is the audit trail for every auto-removal (rule #9 visible-not-
 * silent; the Hypothesis's "removal commit message names the
 * criteria-checker decision").
 *
 * @otel-exempt pure helper of `runTaskRotation`.
 */
export function rotationCommitMessage(input: {
  readonly taskId: string;
  readonly viaPrNumber: number;
  readonly reason: string;
}): string {
  return `chore(tasks): auto-remove \`${input.taskId}\` — shipped via #${input.viaPrNumber} (${input.reason})`;
}

/**
 * Run the task-rotation watchdog for the iteration's `taskId`.
 *
 * Skip order is observable + tested, cheapest gate first so the expensive
 * `listMergedPrs` `gh` round-trip is reached only when it can change the
 * outcome:
 *   1. `MINSKY_TASK_ROTATION=off` — operator veto, never reads TASKS.md.
 *   2. `taskId` absent/blank — nothing to rotate (e.g. the daemon picked
 *      no task this iteration).
 *   3. block absent from TASKS.md — already rotated out by a prior
 *      iteration (or never filed). Short-circuits BEFORE `listMergedPrs`.
 *
 * Only after all three pass do we list merged PRs and run the pure
 * `decideTaskCompletion`. The verdict maps 1:1 to the outcome; `remove`
 * additionally writes + commits via `applyRemoval`.
 *
 * @otel tick-loop.task-rotation
 */
export async function runTaskRotation(args: RunTaskRotationArgs): Promise<RunTaskRotationOutcome> {
  if (args.env["MINSKY_TASK_ROTATION"] === "off") {
    return { outcome: "skipped", reason: "env-off" };
  }
  const taskId = args.taskId?.trim();
  if (taskId === undefined || taskId === "") {
    return { outcome: "skipped", reason: "no-task-id" };
  }

  const tasksMd = await args.getTasksMd();
  const spliced = spliceTaskBlock(tasksMd, taskId);
  if (spliced === undefined) {
    return { outcome: "skipped", reason: "block-absent" };
  }

  // Block present → the `gh pr list` round-trip can change the outcome.
  const mergedPrs = await args.listMergedPrs();
  const verdict = decideTaskCompletion({
    taskId,
    taskBlock: spliced.block,
    mergedPrs,
  });

  if (verdict.kind === "keep") {
    return { outcome: "kept", reason: verdict.reason };
  }
  if (verdict.kind === "no-merged-pr") {
    return { outcome: "no-merged-pr", reason: verdict.reason };
  }

  const commitMessage = rotationCommitMessage({
    taskId,
    viaPrNumber: verdict.viaPrNumber,
    reason: verdict.reason,
  });
  await args.applyRemoval({
    tasksMd: spliced.without,
    taskId,
    viaPrNumber: verdict.viaPrNumber,
    commitMessage,
  });
  return {
    outcome: "removed",
    viaPrNumber: verdict.viaPrNumber,
    reason: verdict.reason,
  };
}
