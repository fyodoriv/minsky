// Live-spawn runner — orchestrates the v1 path: capture baseline → spawn
// Claude --print against the host worktree → diff against baseline → classify
// out-of-scope writes as scope-leak. Pure-function-with-I/O-at-edge per
// Martin 2017 + Strategy seam (Gamma 1994) for both the spawn boundary and
// the git probe so tests inject fixtures and production wires the real
// `@minsky/tick-loop` `ProcessSpawnStrategy` + a `child_process.execFile`
// git wrapper.
//
// Pattern: command-orchestrator (Gamma 1994 Command — the `LiveSpawnOutcome`
//   is data the CLI walks) + supervisor-wrapped-spawn (Armstrong 2007 — the
//   runner never catches mid-spawn; non-zero exit codes surface as
//   `spawn-failed` verdict, scope-leak is the post-spawn boundary check).
// Source: TASKS.md `cross-repo-runner-v1-live-spawn`; rule #1 (don't reinvent
//   — `ProcessSpawnStrategy` already exists in `@minsky/tick-loop`); rule #7
//   (chaos row 7 — sandbox-leak detection needs a real spawn to exercise);
//   user-stories/006-runner-on-any-repo.md § "Failure modes" rows 4 (budget
//   pause), 7 (scope leak).
// Conformance: full — pure function over typed inputs with two injected I/O
//   seams (`SpawnLike`, `GitLike`).

import type { RunnerPlan } from "./spawn-plan.js";

/**
 * Structural subset of `@minsky/tick-loop`'s `SpawnStrategy` interface — the
 * runner only calls `spawn()`, so depending on the full export would force
 * tests to pull the tick-loop's runtime. Production wires `ProcessSpawnStrategy`
 * from `@minsky/tick-loop`; tests inject an in-memory fake. Same shape as
 * `daemon.ts`'s `BudgetGuardLike` pattern (rule #2 — every dep behind an
 * interface; the structural subtype IS the seam).
 */
export interface SpawnLike {
  spawn(input: {
    readonly taskId: string;
    readonly brief: string;
    readonly env: NodeJS.ProcessEnv;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly exitCode: number;
    readonly durationMs: number;
    readonly stdoutTail: string;
    readonly stderrTail: string;
  }>;
}

/**
 * Structural subset of the git probe surface the runner needs. Two pure
 * operations: capture a pre-spawn ref (so the diff has a baseline that
 * survives an aborted spawn) and list the host-relative paths that changed
 * since the baseline. Production wires a `child_process.execFile("git", …)`
 * wrapper; tests inject a fake that returns canned diffs.
 */
export interface GitLike {
  captureBaseline(args: { readonly hostRoot: string }): Promise<string>;
  changedFiles(args: {
    readonly hostRoot: string;
    readonly sinceRef: string;
  }): Promise<readonly string[]>;
}

/**
 * Inputs to {@link runLive}.
 */
export interface RunLiveInputs {
  /** The plan synthesised by `buildSpawnPlan` (working dir + brief + env). */
  readonly plan: RunnerPlan;
  /**
   * Globs of host-relative paths the spawn is permitted to modify. Parsed
   * from the task block's `**Touches**:` (or fallback `**Files**:`) field
   * by the caller; an empty array means "no scope declared" — the runner
   * skips the scope-leak check and records `verdict: validated` regardless
   * of which paths the spawn wrote. Matches the daemon's pre-spawn
   * collision check semantics (rule-7 graceful-degrade — declared scope
   * is opt-in, not enforced floor).
   */
  readonly allowedPaths: readonly string[];
  /** Spawn-step Strategy seam. */
  readonly spawn: SpawnLike;
  /** Git-probe seam. */
  readonly git: GitLike;
  /**
   * Pure glob matcher — production wires `globMatchesPath` from
   * `@minsky/tick-loop/touches-glob`; tests inject an inline fake. Same
   * minimal syntax the daemon's collision check uses (rule #1 — reuse
   * the parser, no new glob dialect).
   */
  readonly globMatchesPath: (glob: string, path: string) => boolean;
}

/**
 * Outcome verdicts the runner can record. The CLI writes the chosen value
 * to `experiment-store/cross-repo/<id>.jsonl` so the user-story-006 metric
 * (`cross_repo_runs_validated_pct`) can count `validated` over total.
 *
 *   - `validated`     — spawn exit 0, no scope-leak. Counts toward numerator.
 *   - `scope-leak`    — spawn exit 0 but wrote files outside `allowedPaths`.
 *   - `spawn-failed`  — spawn exit non-zero. The brief / env / tooling drove
 *                       the child to abort; the operator inspects stderr.
 */
export type LiveSpawnVerdict = "validated" | "scope-leak" | "spawn-failed";

export interface LiveSpawnOutcome {
  /** Final verdict the iteration-store records. */
  readonly verdict: LiveSpawnVerdict;
  /** Bounded stdout tail (the spawn's own cap; daemon-side typical 4KB). */
  readonly stdoutTail: string;
  /** Bounded stderr tail. */
  readonly stderrTail: string;
  /** Spawn exit code. -1 means the spawn was never reached. */
  readonly exitCode: number;
  /** Wall-clock duration in ms. */
  readonly durationMs: number;
  /** Host-relative paths that fell outside `allowedPaths` (verdict=scope-leak only). */
  readonly scopeLeakPaths: readonly string[];
  /** PR URL parsed from stdout if the spawn opened one; null otherwise. */
  readonly prUrl: string | null;
  /** Baseline ref captured before the spawn — useful for operator audit. */
  readonly baselineRef: string;
}

/**
 * Orchestrate the live-spawn boundary.
 *
 * Step 1 (baseline) — capture `git rev-parse HEAD` so the post-spawn diff has
 * a stable anchor even when the spawned Claude rebases / branches mid-run.
 *
 * Step 2 (spawn) — invoke the injected Strategy with the plan's brief on
 * stdin + env. Never catches; supervisor (or test harness) handles
 * exceptions per let-it-crash discipline (Armstrong 2007). Non-zero exit
 * codes surface as `spawn-failed` without proceeding to the scope check.
 *
 * Step 3 (scope-leak detection) — list paths changed since baseline. When
 * `allowedPaths` is non-empty, paths that match NO declared glob get
 * recorded as scope-leak. When `allowedPaths` is empty, the check
 * short-circuits and the run is `validated` regardless of the diff (the
 * operator opted out of scope enforcement by not declaring it).
 *
 * Step 4 (PR URL) — extract the LAST `https://github.com/.+/pull/\d+` URL
 * from stdout if present. The spawn typically prints the PR URL as its
 * last line; we take the last match so any earlier matches inside example
 * output (e.g. the brief's "see PR #N" prose) don't shadow the real one.
 *
 * @otel cross-repo-runner.run-live
 */
export async function runLive(inputs: RunLiveInputs): Promise<LiveSpawnOutcome> {
  const baselineRef = await inputs.git.captureBaseline({ hostRoot: inputs.plan.workingDirectory });
  const result = await inputs.spawn.spawn({
    taskId: inputs.plan.taskId,
    brief: inputs.plan.brief,
    env: { ...process.env, ...inputs.plan.env },
  });
  if (result.exitCode !== 0) {
    return {
      verdict: "spawn-failed",
      stdoutTail: result.stdoutTail,
      stderrTail: result.stderrTail,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      scopeLeakPaths: [],
      prUrl: null,
      baselineRef,
    };
  }
  const scopeLeakPaths = await detectScopeLeak(inputs, baselineRef);
  if (scopeLeakPaths.length > 0) {
    return {
      verdict: "scope-leak",
      stdoutTail: result.stdoutTail,
      stderrTail: result.stderrTail,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      scopeLeakPaths,
      prUrl: null,
      baselineRef,
    };
  }
  return {
    verdict: "validated",
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    scopeLeakPaths: [],
    prUrl: extractPrUrl(result.stdoutTail),
    baselineRef,
  };
}

/**
 * Internal helper: scan the diff for paths outside `allowedPaths`. Returns
 * the empty list when scope wasn't declared (graceful-degrade per rule #7).
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function detectScopeLeak(
  inputs: RunLiveInputs,
  baselineRef: string,
): Promise<readonly string[]> {
  if (inputs.allowedPaths.length === 0) return [];
  const changed = await inputs.git.changedFiles({
    hostRoot: inputs.plan.workingDirectory,
    sinceRef: baselineRef,
  });
  return changed.filter(
    (path) => !inputs.allowedPaths.some((glob) => inputs.globMatchesPath(glob, path)),
  );
}

/**
 * Extract the LAST GitHub PR URL from a stdout tail. Matches both
 * `github.com/<org>/<repo>/pull/<n>` and GHE-hosted forks. Returns null
 * when no URL is present (e.g. the spawn aborted before opening a PR).
 *
 * Public so the CLI can call it on a longer stdout buffer when the
 * iteration-store entry needs the PR URL but `result.stdoutTail` was
 * already truncated.
 *
 * @otel-exempt pure regex helper.
 */
export function extractPrUrl(stdoutTail: string): string | null {
  const pattern = /https:\/\/(?:[\w.-]+)\/[^\s/]+\/[^\s/]+\/pull\/\d+/g;
  const matches = stdoutTail.match(pattern);
  return matches === null ? null : (matches[matches.length - 1] ?? null);
}

/**
 * Extract the `**Touches**:` (or fallback `**Files**:`) globs from a parsed
 * task block. The runner uses these as `allowedPaths` when the operator
 * hasn't passed an explicit override. Matches the daemon's collision-check
 * parser semantics (rule #1 — single parser for the field across both
 * use sites).
 *
 * Note: we accept the raw task block text rather than a parsed object so
 * this function stays decoupled from `task-finder.ts`'s shape AND from
 * the daemon's `parseTouchesOrFiles` import path. The CLI can choose
 * either source.
 *
 * @otel-exempt pure parser helper.
 */
export function extractAllowedPathsFromTaskBlock(taskBlock: string): readonly string[] {
  const touches = parseTouchesField(taskBlock);
  if (touches.length > 0) return touches;
  return parseFilesField(taskBlock);
}

function parseTouchesField(taskBlock: string): readonly string[] {
  const match = taskBlock.match(/^\s*-\s*\*\*Touches\*\*:\s*(.+)$/m);
  if (match === null || match[1] === undefined) return [];
  return splitCommaGlobs(match[1]);
}

function parseFilesField(taskBlock: string): readonly string[] {
  const match = taskBlock.match(/^\s*-\s*\*\*Files\*\*:\s*(.+)$/m);
  if (match === null || match[1] === undefined) return [];
  return splitCommaGlobs(match[1]);
}

function splitCommaGlobs(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((token) => token.trim().replace(/^`/, "").replace(/`$/, ""))
    .filter((token) => token.length > 0);
}
