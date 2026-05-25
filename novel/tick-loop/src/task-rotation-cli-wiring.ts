// <!-- scope: human-approved 2026-05-25 wire-in slice of TASKS.md `daemon-task-rotation-on-completion` (P0) — § Details (b) "Daemon iteration runs this after each merge it observes; emits a TASKS.md edit + commit". The pure decision + I/O wrapper shipped earlier (`task-completion-detector.ts` + `daemon-task-rotation.ts`); this module is the CLI-side production binding for the `TaskRotationSeam` the daemon's `RunDaemonOpts` exposes. Twin of `metrics-render-cli-wiring.ts` and `snapshot-cli-wiring.ts`. -->
/**
 * `@minsky/tick-loop/task-rotation-cli-wiring` — CLI-side construction of
 * the `TaskRotationSeam` `runDaemon` dispatches into. Twin of
 * `metrics-render-cli-wiring.ts`: the bin script (`bin/tick-loop.mjs`)
 * is the I/O boundary; this module is the smallest unit-testable
 * surface above it.
 *
 * Three primitives, one per seam slot:
 *   - `createFileBackedGetTasksMd(tasksMdPath)` — a `GetTasksMd` that
 *     wraps `fs.readFile`. ENOENT propagates (a missing TASKS.md is the
 *     `missing-tasks-md` iteration shape the daemon already filters on
 *     and would never reach this wire-in).
 *   - `createGhMergedPrList(opts?)` — a `ListMergedPrs` that spawns
 *     `gh pr list --state merged --json number,title --limit <N>`,
 *     parses the JSON, returns `MergedPrSnapshot[]`. Non-zero exit OR
 *     malformed JSON rejects the promise (rule #6 let-it-crash at the
 *     supervisor boundary — a broken `gh` install is a real crash).
 *   - `createGitBackedApplyRemoval({ tasksMdPath, cwd, execFn })` — an
 *     `ApplyRemoval` that writes the block-stripped TASKS.md via
 *     `fs.writeFile`, then commits ONLY the TASKS.md path with the
 *     supplied commit message via `git commit --only TASKS.md`.
 *     Failures (write error, git error) propagate — the daemon's
 *     `tick-loop.task-rotation` span will not emit `outcome: "removed"`
 *     if the underlying I/O failed.
 *
 * Pattern (rule #2): pure factories above the file-system + subprocess
 * primitives. The `GetTasksMd`, `ListMergedPrs`, `ApplyRemoval` types
 * live in `daemon-task-rotation.ts` so this module only supplies the
 * I/O implementation; tests drive a temp-dir + injected `execFn`
 * without touching the OS subprocess machinery.
 *
 * Pivot (rule #9, TASKS.md `daemon-task-rotation-on-completion`): if
 * `gh pr list --limit <N>` is too coarse (legitimate task IDs span >N
 * merged PRs of history), parametrise the limit per call rather than
 * retiring the rotation — manual TASKS.md curation does not keep up
 * with the daemon's pickTask rate.
 *
 * @module tick-loop/task-rotation-cli-wiring
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import type { ApplyRemoval, GetTasksMd, ListMergedPrs } from "./daemon-task-rotation.js";
import type { MergedPrSnapshot } from "./task-completion-detector.js";

// ---- Constants ------------------------------------------------------------

/**
 * Default `gh pr list --limit` for the merged-PR query. 50 is a 10×
 * safety factor over the typical 1-2 merges per task — the rotation
 * only fires on iteration's `taskId`, so the matching set is
 * effectively `O(matching merges for one task)`, not `O(all merges)`.
 */
const DEFAULT_GH_LIMIT = 50;

// ---- File-backed TASKS.md reader ------------------------------------------

/**
 * Build a `GetTasksMd` rooted at `tasksMdPath`. Reads the file as UTF-8
 * on every call so a concurrent agent's TASKS.md edit between
 * iterations is observed by the next rotation.
 *
 * ENOENT propagates as the documented `fs.readFile` rejection — the
 * daemon's `runOneIteration` already filters on the `missing-tasks-md`
 * status BEFORE `maybeRunTaskRotation` would fire, so this code path
 * is never reached for a missing file. Should a logic regression let
 * it through, the let-it-crash boundary (rule #6) is correct: the
 * supervisor restart surfaces the misconfiguration.
 *
 * @otel-exempt pure factory; the I/O call site is the
 *   `tick-loop.task-rotation` span emitted by `emitTaskRotationSpan`
 *   in `daemon.ts`.
 */
export function createFileBackedGetTasksMd(tasksMdPath: string): GetTasksMd {
  return async (): Promise<string> => readFile(tasksMdPath, "utf-8");
}

// ---- gh-backed merged-PR list ---------------------------------------------

/**
 * Configuration for `createGhMergedPrList`. Defaults pick the canonical
 * `gh pr list --state merged --json number,title --limit 50`. Tests
 * inject `spawnFn` to drive the wrapper without forking a real
 * subprocess.
 */
export interface GhMergedPrListOptions {
  /** Command to spawn. Default `"gh"`. */
  readonly command?: string;
  /** Working directory for the spawn. Default inherits from parent. */
  readonly cwd?: string;
  /** Merged-PR limit. Default `50` (see `DEFAULT_GH_LIMIT`). */
  readonly limit?: number;
  /**
   * Optional spawn override — a seam tests use to inject a fake
   * `child_process.spawn` without touching the OS. Production omits.
   */
  readonly spawnFn?: typeof nodeSpawn;
}

/**
 * Build a `ListMergedPrs` that spawns
 * `gh pr list --state merged --json number,title --limit <N>` and
 * parses the JSON array into `MergedPrSnapshot[]`.
 *
 * Let-it-crash boundary (rule #6, Armstrong 2007): a non-zero exit or
 * malformed JSON REJECTS the promise — a broken `gh` install or
 * unexpected schema is a real misconfiguration the supervisor should
 * see, not a silent "no merged PRs" loop that masks the root cause.
 *
 * @otel-exempt pure factory; the spawn itself is captured by
 *   `tick-loop.task-rotation` span in `daemon.ts`.
 */
export function createGhMergedPrList(opts: GhMergedPrListOptions = {}): ListMergedPrs {
  const command = opts.command ?? "gh";
  const limit = opts.limit ?? DEFAULT_GH_LIMIT;
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const cwd = opts.cwd;

  return (): Promise<readonly MergedPrSnapshot[]> => {
    const args = [
      "pr",
      "list",
      "--state",
      "merged",
      "--json",
      "number,title",
      "--limit",
      String(limit),
    ];
    return new Promise((resolveResult, rejectResult) => {
      const child: ChildProcess = spawnFn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...(cwd === undefined ? {} : { cwd }),
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.on("error", rejectResult);
      child.on("close", (code) =>
        finalizeGhMergedPrList(code, stdoutChunks, stderrChunks, resolveResult, rejectResult),
      );
    });
  };
}

/**
 * Resolve / reject the `createGhMergedPrList` promise based on the
 * subprocess exit code + buffered stdout. Extracted from the spawn
 * callback so the factory's body stays under biome's
 * `noExcessiveCognitiveComplexity` ceiling (max 10) — the close handler
 * had two early-return branches + a try/catch over `JSON.parse`, which
 * pushed the lambda's complexity into error territory.
 *
 * @otel-exempt internal helper of `createGhMergedPrList`.
 */
function finalizeGhMergedPrList(
  code: number | null,
  stdoutChunks: readonly Buffer[],
  stderrChunks: readonly Buffer[],
  resolveResult: (v: readonly MergedPrSnapshot[]) => void,
  rejectResult: (e: Error) => void,
): void {
  if (code !== 0) {
    const stderr = Buffer.concat(stderrChunks as Buffer[]).toString("utf8");
    rejectResult(new Error(`gh pr list exited ${code}: ${stderr.trim() || "(no stderr)"}`));
    return;
  }
  const stdout = Buffer.concat(stdoutChunks as Buffer[]).toString("utf8");
  // rule-6: handled-locally — JSON.parse can throw on malformed `gh`
  // output; convert to a rejected promise so the daemon sees a clean
  // async error rather than an unhandled exception.
  try {
    const parsed = JSON.parse(stdout) as ReadonlyArray<{
      readonly number: number;
      readonly title: string;
    }>;
    if (!Array.isArray(parsed)) {
      rejectResult(new Error(`gh pr list returned non-array JSON: ${stdout.slice(0, 200)}`));
      return;
    }
    resolveResult(parsed);
    // rule-6: handled-locally — JSON.parse can throw on malformed `gh` output; convert to a rejected promise so the daemon sees a clean async error rather than an unhandled exception at the spawn boundary.
  } catch (err) {
    rejectResult(new Error(`gh pr list returned malformed JSON: ${(err as Error).message}`));
  }
}

// ---- git-backed write + commit --------------------------------------------

/**
 * Function shape for the spawn-and-await helper used by
 * `createGitBackedApplyRemoval`. Production wires it to a tiny
 * `child_process.spawn`-based promise; tests inject a fake recorder.
 */
export type SpawnCheckedCallFn = (
  command: string,
  args: readonly string[],
  cwd?: string,
) => Promise<void>;

/**
 * Configuration for `createGitBackedApplyRemoval`.
 */
export interface GitBackedApplyRemovalOptions {
  /** Absolute or repo-relative path to TASKS.md. */
  readonly tasksMdPath: string;
  /** Working directory for `git commit`. Default `process.cwd()`. */
  readonly cwd?: string;
  /**
   * Optional `spawn-and-await` override. Production omits; tests
   * inject a recorder. Without this, the factory builds its own
   * `child_process.spawn`-based promise.
   */
  readonly execFn?: SpawnCheckedCallFn;
  /**
   * Optional `fs.writeFile` override. Production omits; tests inject
   * a recorder.
   */
  readonly writeFileFn?: (path: string, content: string) => Promise<void>;
}

/**
 * Build an `ApplyRemoval` that:
 *   1. Writes the block-stripped TASKS.md content to `tasksMdPath` via
 *      `fs.writeFile`.
 *   2. Commits the change with `git commit --only <tasksMdPath> -m
 *      "<commitMessage>"`. The `--only` flag keeps unrelated staged
 *      changes out of the rotation commit — the daemon's iteration may
 *      have other in-flight edits we don't want to coopt.
 *
 * Let-it-crash boundary (rule #6, Armstrong 2007): write failures
 * (EACCES, ENOSPC) and `git` failures (detached HEAD, no remote, …)
 * propagate as rejected promises. The daemon's
 * `tick-loop.task-rotation` span will not emit `outcome: "removed"`
 * if the underlying I/O failed — the criteria-checker decision was
 * `remove`, the I/O wrapper just couldn't land it. The supervisor
 * restart surfaces the misconfiguration.
 *
 * @otel-exempt pure factory; the I/O is captured by
 *   `tick-loop.task-rotation` span in `daemon.ts`.
 */
export function createGitBackedApplyRemoval(opts: GitBackedApplyRemovalOptions): ApplyRemoval {
  const tasksMdPath = opts.tasksMdPath;
  const cwd = opts.cwd ?? process.cwd();
  const execFn = opts.execFn ?? createDefaultSpawnCheckedCall();
  const writeFileFn = opts.writeFileFn ?? ((path, content) => writeFile(path, content, "utf-8"));

  return async (input) => {
    await writeFileFn(tasksMdPath, input.tasksMd);
    await execFn("git", ["commit", "--only", tasksMdPath, "-m", input.commitMessage], cwd);
  };
}

/**
 * Default `SpawnCheckedCallFn`: spawns the command, resolves on
 * exit-0, rejects on any other exit code with stderr included in the
 * error message. Used only when the caller does NOT inject an
 * `execFn` (tests always inject).
 *
 * @otel-exempt internal helper.
 */
function createDefaultSpawnCheckedCall(): SpawnCheckedCallFn {
  return (command, args, cwd) =>
    new Promise<void>((resolveResult, rejectResult) => {
      const child: ChildProcess = nodeSpawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        ...(cwd === undefined ? {} : { cwd }),
      });
      const stderrChunks: Buffer[] = [];
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      child.on("error", (err) => {
        rejectResult(err);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolveResult();
          return;
        }
        const stderr = Buffer.concat(stderrChunks as Buffer[]).toString("utf8");
        rejectResult(
          new Error(
            `${command} ${args.join(" ")} exited ${code}: ${stderr.trim() || "(no stderr)"}`,
          ),
        );
      });
    });
}
