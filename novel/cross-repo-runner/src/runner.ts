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
    /**
     * The POSIX signal that terminated the child, if any. Surfaced-by
     * `spawn-failed-exit-minus-one-silent-empty-stderr` (2026-05-19) —
     * lets the runner distinguish `exit=-1 from clean null code` vs
     * `exit=-1 from SIGTERM/SIGKILL/SIGHUP` when the cloud agent is
     * silently killed by the OS / parent process / EPM hook. Optional
     * to keep test fakes back-compatible.
     */
    readonly signal?: NodeJS.Signals;
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
 * Structural subset of the gh-CLI surface the runner needs to implement
 * the post-spawn PR-creation backstop (`devin-spawn-no-pr-opened` pivot,
 * 2026-05-18). The hypothesis-fix is in `spawn-plan.ts` (the brief now
 * includes `gh pr create` instructions); this seam is the pivot
 * threshold's safety net for when the spawned agent honours the commit
 * + push steps but skips `gh pr create` (the field-reported failure
 * mode on devin --print runs).
 *
 * Production wires a `child_process.execFile("gh", …)` wrapper in
 * `minsky-run.mjs`; tests inject an in-memory fake. The interface is
 * intentionally optional on {@link RunLiveInputs} — when omitted, the
 * runner falls back to the pre-pivot behaviour (extract from stdout only).
 *
 * Pattern: dependency-injection-via-structural-typing (Martin 2003 — depend
 * on interfaces, not implementations) + rule #2 (vision.md § 2 — every
 * external dep behind an interface; `gh` is the dep, this is the seam).
 */
export interface GhLike {
  /**
   * Returns the URL of an open PR on the host repo whose `headRefName`
   * matches `branch`, or `null` when no such PR exists. Used to short-
   * circuit the create-step when devin opened a PR but the URL was
   * truncated from stdout (typical for long-running iterations whose
   * stdout cap is hit before the PR-create line lands).
   */
  findOpenPr(args: {
    readonly hostRepo: string;
    readonly branch: string;
  }): Promise<string | null>;
  /**
   * Opens a PR on the host repo from `branch` against `base`. Returns the
   * PR URL on success, `null` on any failure (network, gh auth, branch
   * not pushed, branch lacks commits, etc.). Failures are silent — the
   * runner treats this as best-effort, never let-it-crash.
   *
   * The runner-side backstop is the LAST line of defence: it runs only
   * after the spawn exited 0 with no scope leak AND no PR URL was found
   * in stdout. Logging the failure is the caller's responsibility (the
   * CLI surfaces it via `notes` in the iteration record).
   */
  createPr(args: {
    readonly hostRepo: string;
    readonly branch: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
    readonly workingDir: string;
  }): Promise<string | null>;
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
  /**
   * Optional gh-CLI seam for the post-spawn PR-creation backstop
   * (`devin-spawn-no-pr-opened` pivot, 2026-05-18). When provided, the
   * runner attempts to find or open a PR for `plan.branchName` if the
   * spawn exited 0 with no scope leak AND no PR URL was extracted from
   * stdout. When omitted, the runner falls back to extract-from-stdout-
   * only behaviour. The seam is optional so existing tests continue to
   * pass without an injected fake.
   */
  readonly gh?: GhLike;
  /**
   * The fully-qualified host repo identifier (`owner/repo`) the backstop
   * uses when calling `gh.findOpenPr` / `gh.createPr`. Required when `gh`
   * is provided; ignored otherwise.
   */
  readonly hostRepo?: string;
  /**
   * The default branch to target when the backstop opens a PR. Required
   * when `gh` is provided; ignored otherwise.
   */
  readonly defaultBranch?: string;
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
  /**
   * POSIX signal that killed the child, if any. Threaded from the
   * underlying `SpawnLike` so the iteration record can log
   * `signal=SIGKILL`/`SIGTERM`/`SIGHUP` instead of the meaningless
   * `exit=-1` collapse. Surfaced-by
   * `spawn-failed-exit-minus-one-silent-empty-stderr` (2026-05-19).
   */
  readonly signal?: NodeJS.Signals;
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
 * Step 4 (PR URL resolution — three-stage cascade) — first extract the LAST
 * `https://github.com/.+/pull/\d+` URL from stdout if present (the spawn
 * typically prints the PR URL as its last line; we take the last match so
 * any earlier matches inside example output don't shadow the real one).
 * If that returns null AND `gh` is injected, ask whether an open PR
 * already exists for the plan's branch (handles bounded-stdout-tail
 * truncation). If still null, ask `gh` to open the PR — the
 * `devin-spawn-no-pr-opened` pivot, 2026-05-18, when the agent commits
 * + pushes but skips `gh pr create`.
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
      // Thread the POSIX signal so the iteration log can show *why*
      // the spawn died (SIGKILL from watchdog vs SIGTERM from parent
      // vs SIGHUP from terminal vs null = exited with code).
      // `spawn-failed-exit-minus-one-silent-empty-stderr` (2026-05-19).
      ...(result.signal !== undefined ? { signal: result.signal } : {}),
    };
  }
  const scopeLeakPaths = await detectScopeLeak(inputs, baselineRef);
  // Smart scope-leak handling (2026-05-19 operator directive):
  // Working on a task naturally touches more files than planned.
  // Instead of discarding ALL work (old behavior), we:
  //   - Still try to find/create the PR (preserve the work)
  //   - Record the out-of-scope paths in the verdict (for follow-up)
  //   - The host-loop decides whether to halt (hard) or continue (warn)
  // The scope-leak paths become a follow-up signal ("these files
  // changed — should they be in a separate PR?"), not a kill switch.
  const prUrl = await ensurePrUrl(inputs, result.stdoutTail);
  return {
    verdict: scopeLeakPaths.length > 0 ? "scope-leak" : "validated",
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    scopeLeakPaths,
    prUrl,
    baselineRef,
  };
}

/**
 * Resolve the PR URL the iteration record will store. Three-stage cascade:
 *
 *   1. Extract from the spawn's stdout tail (the happy path — devin /
 *      claude printed the URL after `gh pr create`).
 *   2. If null and a `gh` seam is injected, ask whether an open PR
 *      already exists for the plan's branch (handles the case where the
 *      spawn opened a PR but its URL fell off the bounded stdout tail).
 *   3. If still null, ask the seam to open a PR. This is the
 *      `devin-spawn-no-pr-opened` pivot — when the agent commits + pushes
 *      but skips `gh pr create`, the runner backstop opens it.
 *
 * Any failure inside the seam returns null and the verdict stays
 * `validated` with `prUrl: null` (the legacy behaviour). The runner does
 * NOT let-it-crash on the backstop because the gh probe is best-effort:
 * gh-not-on-PATH / gh-auth-expired / branch-not-pushed are all
 * recoverable in the next iteration. (Per rule #7 graceful-degrade.)
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function ensurePrUrl(inputs: RunLiveInputs, stdoutTail: string): Promise<string | null> {
  const fromStdout = extractPrUrl(stdoutTail);
  if (fromStdout !== null) return fromStdout;
  if (inputs.gh === undefined) return null;
  if (inputs.hostRepo === undefined) return null;
  if (inputs.defaultBranch === undefined) return null;
  const branch = inputs.plan.branchName;
  const hostRepo = inputs.hostRepo;
  const existing = await inputs.gh.findOpenPr({ hostRepo, branch });
  if (existing !== null) return existing;
  return inputs.gh.createPr({
    hostRepo,
    branch,
    base: inputs.defaultBranch,
    title: defaultBackstopTitle(inputs.plan.taskId),
    body: defaultBackstopBody(inputs.plan.taskId),
    workingDir: inputs.plan.workingDirectory,
  });
}

/**
 * Title for the runner-opened backstop PR. Conventional-commit prefix
 * `chore:` so commit-style PR checks pass; the task id is suffixed for
 * traceability in `gh pr list` output.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function defaultBackstopTitle(taskId: string): string {
  return `chore: backstop PR for ${taskId} (agent did not run gh pr create)`;
}

/**
 * Body for the runner-opened backstop PR. Includes the
 * `Hypothesis self-grade` block required by `check-pr-self-grade.mjs`
 * (rule #9 — pre-registered hypothesis + observation). The values are
 * meta-statements about the runner's behaviour: the predicted outcome
 * was "agent ships its own PR", the observed outcome was "agent did
 * not call gh pr create", and the lesson is the runner's backstop is
 * required for the success metric (`pr_url != null`) to move.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function defaultBackstopBody(taskId: string): string {
  return [
    `Auto-opened by minsky-run.mjs's post-spawn PR-creation backstop because the`,
    "spawned agent finished with exit 0 but did not run `gh pr create` (or the",
    "URL did not appear in the bounded stdout tail).",
    "",
    `Task: \`${taskId}\``,
    "",
    `Review the commits on this branch carefully — the agent's edits are present,`,
    "but its PR description / self-grade is not. Edit this PR body to reflect",
    "the actual hypothesis / observation before requesting review.",
    "",
    "## Hypothesis self-grade",
    "",
    "- Predicted: agent runs to completion and opens a PR via `gh pr create`",
    "- Observed: agent finished cleanly but no PR URL appeared in stdout; runner-side backstop opened this PR",
    "- Match: partial",
    `- Lesson: the brief's \`gh pr create\` step is necessary but not always sufficient; the runner backstop is the durable safety net (devin-spawn-no-pr-opened pivot, 2026-05-18)`,
    "",
  ].join("\n");
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
