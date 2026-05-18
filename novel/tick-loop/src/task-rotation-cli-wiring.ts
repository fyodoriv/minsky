// <!-- scope: human-approved P0 task `daemon-task-rotation-on-completion`
//      (TASKS.md, surfaced-by 9h monitoring window 2026-05-07) — production
//      CLI-side binding slice; twin of `metrics-render-cli-wiring`. -->

/**
 * `@minsky/tick-loop/task-rotation-cli-wiring` — CLI-side construction of
 * the `TaskRotationSeam` `runDaemon` dispatches into. Twin of
 * `metrics-render-cli-wiring` / `snapshot-cli-wiring`: the bin script
 * (`bin/tick-loop.mjs`) is the I/O boundary; this module is the smallest
 * unit-testable surface above it.
 *
 * Without this slice the watchdog shipped in slices a/b/c is dead code in
 * production — `RunDaemonOpts.taskRotation` is an optional seam and the bin
 * never constructed it, so `maybeRunTaskRotation` early-returns at
 * `opts.taskRotation === undefined` every iteration and the 9h-dogfood
 * re-pick-waste the task targets is never actually prevented. This module
 * binds the three seam legs to real fs / `gh` / `git`:
 *
 *   - `createFileBackedGetTasksMd(tasksMdPath)` — a `GetTasksMd` that wraps
 *     `fs.readFile`. ENOENT degrades to `""` (genesis / no-TASKS.md case)
 *     rather than throwing: `spliceTaskBlock("", id)` returns `undefined`,
 *     so the wrapper short-circuits at `block-absent` BEFORE the `gh`
 *     round-trip. This composes the ENOENT degrade with the wrapper's
 *     existing cheapest-gate-first ladder to eliminate the `gh pr list`
 *     subprocess entirely for any repo with no TASKS.md (round-trip
 *     elimination). Non-ENOENT errors (EACCES, EISDIR) propagate so the
 *     supervisor sees a misconfigured repo as a real crash — rule #6
 *     let-it-crash at the right boundary (Armstrong 2007). Mirrors
 *     `createFileBackedChangelogReader`'s ENOENT graceful-degrade.
 *   - `createGhMergedPrList(opts?)` — a `ListMergedPrs` that calls
 *     `gh pr list --state merged --json number,title,state --limit <N>`
 *     and maps the parsed rows to the `MergedPrSnapshot` shape the
 *     detector consumes. Reuses the battle-tested
 *     `parseGhPrListForDuplicateDetection` parser (dependency policy —
 *     prefer existing tested code; same `gh pr list` JSON grammar,
 *     graceful-degrade `[]` on malformed/absent output). A `gh` outage
 *     yields `[]` → the detector returns `no-merged-pr` → NOTHING is
 *     auto-removed on a transient `gh` failure (conservative — the task's
 *     Risk/Mitigation requires an explicit merged PR to ever fire).
 *   - `createGitBackedApplyRemoval(tasksMdPath, opts?)` — an `ApplyRemoval`
 *     that writes the block-stripped TASKS.md then commits it with
 *     `git commit --only <tasksMdPath> -m <message>` (the multi-agent-safe
 *     commit form — never `git add -A`). The commit message is supplied
 *     pre-formatted by the wrapper so the git log names the
 *     criteria-checker decision (visible-not-silent, Helland 2007). Hooks
 *     are NOT bypassed: a TASKS.md-only commit is markdown and allowed
 *     even under a pipeline-managed repo; the commit-msg hook's agent
 *     footer is the wanted audit trail.
 *
 * Pattern (rule #2): pure factories above the file-system + subprocess
 * primitives. The `GetTasksMd` / `ListMergedPrs` / `ApplyRemoval` types
 * live in `daemon-task-rotation.ts` so this module only supplies the I/O
 * implementation; tests drive a temp dir + injected `runGhPrList` /
 * `runGit` without touching the OS subprocess machinery.
 *
 * Pivot (rule #9, TASKS.md `daemon-task-rotation-on-completion`): if
 * auto-removal mis-fires, tighten `decideTaskCompletion` to require an
 * explicit `**Status**: shipped` field (already supported by the detector)
 * — don't retire the rotation; manual TASKS.md curation doesn't keep up
 * with the daemon pickTask rate.
 *
 * @module tick-loop/task-rotation-cli-wiring
 */

import { execFile as execFileCb } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { ApplyRemoval, GetTasksMd, ListMergedPrs } from "./daemon-task-rotation.js";
import { parseGhPrListForDuplicateDetection } from "./duplicate-pr-detector.js";

const execFile = promisify(execFileCb);

// ---- Constants ------------------------------------------------------------

/**
 * Default `--limit` for the merged-PR query. 50 is well above the daemon's
 * realistic merge rate within the detector's relevance window while keeping
 * the `gh` payload small (bytes-on-the-wire optimization vs. an unbounded
 * list — `gh pr list` defaults to 30 but the daemon swarm can merge faster
 * than that across a day, so 50 is the conservative floor that still names
 * any task its iteration could have shipped).
 */
const DEFAULT_MERGED_PR_LIMIT = 50;

// ---- File-backed TASKS.md reader ------------------------------------------

/**
 * Build a `GetTasksMd` rooted at `tasksMdPath`. Returns the file's UTF-8
 * contents; ENOENT degrades to `""` (genesis / no-TASKS.md case) so the
 * wrapper short-circuits at `block-absent` before the `gh` round-trip.
 *
 * Other read errors (EACCES, EISDIR, …) propagate so a misconfigured repo
 * surfaces as a real crash rather than a silent "no block → never rotate"
 * loop that masks the root cause. Mirrors
 * `createFileBackedChangelogReader`'s ENOENT graceful-degrade.
 *
 * @otel-exempt pure factory; the read's call site
 *   (`runTaskRotation` → `tick-loop.task-rotation` span) carries the
 *   observability surface.
 */
export function createFileBackedGetTasksMd(tasksMdPath: string): GetTasksMd {
  return async (): Promise<string> => {
    try {
      return await readFile(tasksMdPath, "utf-8");
      // rule-6: handled-locally — ENOENT is the documented genesis case (no
      // TASKS.md yet); converting to "" IS the contract the wrapper's
      // `block-absent` short-circuit depends on (Armstrong 2007 — let it
      // crash AT the right boundary, which here is "anything but ENOENT").
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  };
}

// ---- gh-backed merged-PR lister -------------------------------------------

/**
 * Configuration for `createGhMergedPrList`. Tests inject `runGhPrList` to
 * drive the wrapper without forking a real `gh`.
 */
export interface GhMergedPrListOptions {
  /** `gh pr list --limit` value. Default {@link DEFAULT_MERGED_PR_LIMIT}. */
  readonly limit?: number;
  /**
   * Optional repo override (`<owner>/<name>`). When undefined, `gh`
   * resolves the repo from the current working directory's `origin`
   * remote (the daemon's worktree).
   */
  readonly repo?: string;
  /**
   * Injected I/O — defaults to a real `gh pr list` call via `execFile`.
   * Tests pass a stub that returns canned JSON.
   */
  readonly runGhPrList?: (args: readonly string[]) => Promise<string>;
}

/** Default `gh pr list` runner — calls `gh` via `execFile`. */
async function defaultRunGhPrList(args: readonly string[]): Promise<string> {
  const { stdout } = await execFile("gh", args.slice());
  return stdout;
}

/**
 * Build a `ListMergedPrs` that calls
 * `gh pr list --state merged --json number,title,state --limit <N>` and
 * maps the parsed rows to `MergedPrSnapshot` (`{ number, title }`).
 *
 * Reuses `parseGhPrListForDuplicateDetection` (the slice-2/N parser of
 * `daemon-duplicate-work-detection`) — same `gh pr list` JSON grammar,
 * already unit-tested against frozen fixtures with rule-#6/#7
 * graceful-degrade (malformed JSON / non-array / bad rows → `[]`). The
 * `state` field is requested + filtered defensively to `MERGED` so a
 * future `--state all` caller can't leak open/closed rows into the
 * detector.
 *
 * A `gh` failure (missing binary, auth expired, network, rate-limit)
 * resolves to `[]` rather than rejecting: the detector then returns
 * `no-merged-pr` and NOTHING is auto-removed. This is the conservative
 * default the task's Risk/Mitigation mandates — a transient `gh` outage
 * must never cause a TASKS.md block to be deleted.
 *
 * @otel-exempt pure factory; `runTaskRotation`'s
 *   `tick-loop.task-rotation` span carries the observability surface.
 */
export function createGhMergedPrList(opts: GhMergedPrListOptions = {}): ListMergedPrs {
  const limit = opts.limit ?? DEFAULT_MERGED_PR_LIMIT;
  const runGhPrList = opts.runGhPrList ?? defaultRunGhPrList;
  const args = [
    "pr",
    "list",
    "--state",
    "merged",
    "--json",
    "number,title,state",
    "--limit",
    String(limit),
  ];
  if (opts.repo !== undefined) {
    args.push("--repo", opts.repo);
  }
  return async () => {
    let stdout: string;
    try {
      stdout = await runGhPrList(args);
      // rule-6: handled-locally — a `gh` outage must NOT delete a TASKS.md
      // block. Degrade to no-merged-PRs (the detector then returns
      // `no-merged-pr`); the next iteration retries.
    } catch {
      return [];
    }
    return parseGhPrListForDuplicateDetection(stdout)
      .filter((p) => p.state === "MERGED")
      .map((p) => ({ number: p.number, title: p.title }));
  };
}

// ---- git-backed applyRemoval ----------------------------------------------

/**
 * Configuration for `createGitBackedApplyRemoval`. Tests inject
 * `writeFileFn` + `runGit` to record the write + commit without touching
 * the filesystem or forking `git`.
 */
export interface GitBackedApplyRemovalOptions {
  /**
   * Working directory for the `git commit`. Default `undefined` (inherit).
   * Production passes the daemon's repo / worktree root so the pathspec
   * resolves deterministically.
   */
  readonly cwd?: string;
  /** Injected file writer. Default `fs.writeFile`. */
  readonly writeFileFn?: (path: string, content: string) => Promise<void>;
  /** Injected git runner. Default `execFile("git", …)`. */
  readonly runGit?: (args: readonly string[], cwd: string | undefined) => Promise<void>;
}

/** Default file writer — `fs.writeFile` UTF-8. */
async function defaultWriteFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

/** Default git runner — `git <args>` via `execFile` at `cwd`. */
async function defaultRunGit(args: readonly string[], cwd: string | undefined): Promise<void> {
  await execFile("git", args.slice(), cwd === undefined ? {} : { cwd });
}

/**
 * Build an `ApplyRemoval` that writes the block-stripped TASKS.md to
 * `tasksMdPath` then commits ONLY that file with the wrapper's
 * pre-formatted message.
 *
 * `git commit --only <path> -m <message>` is the multi-agent-safe form
 * (Git Safety rule — never `git add -A`/`git add .`, which would sweep up
 * concurrent workers' changes): it commits exactly the working-tree state
 * of the named path regardless of the index. Hooks are NOT bypassed — a
 * TASKS.md-only commit is markdown (allowed even under a pipeline-managed
 * repo) and the commit-msg hook's agent footer is the audit trail the
 * task's Hypothesis ("removal commit message names the criteria-checker
 * decision") wants in `git log`.
 *
 * Write-then-commit ordering is load-bearing: the write strictly shrinks
 * TASKS.md (one block removed), so there is always a diff and the commit
 * never fails "nothing to commit". A genuine git failure (detached index
 * corruption, hook rejection) rejects the promise — rule #6 let-it-crash;
 * the supervisor restarts and the next iteration re-derives the verdict
 * from a now-consistent tree.
 *
 * @otel-exempt pure factory; `runTaskRotation`'s
 *   `tick-loop.task-rotation` span (`removed` outcome + `via_pr`) carries
 *   the observability surface.
 */
export function createGitBackedApplyRemoval(
  tasksMdPath: string,
  opts: GitBackedApplyRemovalOptions = {},
): ApplyRemoval {
  const writeFileFn = opts.writeFileFn ?? defaultWriteFile;
  const runGit = opts.runGit ?? defaultRunGit;
  return async (input) => {
    await writeFileFn(tasksMdPath, input.tasksMd);
    await runGit(["commit", "--only", tasksMdPath, "-m", input.commitMessage], opts.cwd);
  };
}
