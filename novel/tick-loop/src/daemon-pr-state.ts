// <!-- scope: human-approved P0 task `daemon-fix-own-pr-on-ci-failure` (TASKS.md, operator-flagged 2026-05-05) -->

/**
 * P0 watchdog: when the daemon's own PR for the current task is failing CI,
 * the next iteration must FIX the failures rather than redo the task or
 * brief-refresh.
 *
 * Empirical observation 2026-05-05: with the `cross-repo-ci-action` task
 * block in TASKS.md (PR #167 open), the daemon iterated 80+ times producing
 * brief refreshes / noops because the PR couldn't merge while CI failed,
 * the task block couldn't be removed while the PR was open, and the daemon
 * had no path to fix CI on its own PR. **Deadlock pattern.**
 *
 * `decideDaemonPrState({ taskId, prs, attemptsSoFar })` is the pure
 * decision the daemon consults BEFORE building the iteration brief:
 *
 *   - `kind: 'no-pr'` — no open PR matches the task; iterate normally
 *     (the brief becomes the standard task brief).
 *   - `kind: 'pr-clean'` — open PR exists, no failing checks; iterate
 *     normally (the next iteration ships the next slice / waits on review).
 *   - `kind: 'pr-failing'` — open PR with ≥1 failing check; the brief
 *     becomes "Fix the failing CI checks on PR #N" with the failed-check
 *     names forwarded.
 *   - `kind: 'pr-retries-exhausted'` — `attemptsSoFar` ≥ `maxAttempts`
 *     (default 3); escalate by labelling the PR `Blocked: daemon-stuck`
 *     and synthesising a TASKS.md `Blocked: daemon-stuck` entry instead
 *     of looping forever (rule #6 — let-it-crash AT the boundary).
 *
 * The decision is **pure** (no I/O). Caller wraps with `gh pr list --head
 * <branch> --json number,title,state,statusCheckRollup` and `gh pr view
 * --json statusCheckRollup` (slice 2+). Title-based naming-convention
 * matching mirrors `decideDuplicate` in `duplicate-pr-detector.ts`.
 *
 * Pivot threshold (rule #9, TASKS.md `daemon-fix-own-pr-on-ci-failure`):
 * if >20% of failing PRs need >3 retries, the failure classes aren't
 * fixable by `claude --print` alone — switch the cap to 1 and label
 * `needs-operator` instead of looping. Slice 1 ships the cap as a
 * configurable arg so the pivot is a one-line change.
 *
 * @otel-exempt pure decision; the I/O wrapper feeds `gh pr list` results
 * in and runs the verdict at the call-site span.
 */

import { prTitleNamesTask } from "./duplicate-pr-detector.js";

// ---- Types ----------------------------------------------------------------

/**
 * Status of a single check run, as surfaced by `gh pr view --json
 * statusCheckRollup`. `conclusion` is `null` while the check is in flight
 * (status === "IN_PROGRESS" / "QUEUED" / "PENDING"); a `null` conclusion
 * is treated as **not failing** (the daemon waits rather than redo-ing).
 *
 * Conclusion values mirror GitHub's `CheckConclusionState` GraphQL enum.
 */
export type CheckRunSnapshot = {
  readonly name: string;
  readonly conclusion:
    | "SUCCESS"
    | "FAILURE"
    | "CANCELLED"
    | "TIMED_OUT"
    | "ACTION_REQUIRED"
    | "STARTUP_FAILURE"
    | "SKIPPED"
    | "NEUTRAL"
    | null;
};

/**
 * Open daemon-authored PR snapshot. Caller filters `gh pr list` to
 * `--author "@me"` (or the daemon's bot identity) so the verdict only
 * applies to PRs the daemon owns. Branch-name-based matching is also
 * acceptable upstream — the decision uses `title` for the actual match
 * (mirrors `prTitleNamesTask` in `duplicate-pr-detector.ts`).
 */
export type DaemonOwnPrSnapshot = {
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN";
  readonly checks: readonly CheckRunSnapshot[];
};

export type DaemonPrStateVerdict =
  | { readonly kind: "no-pr" }
  | { readonly kind: "pr-clean"; readonly prNumber: number }
  | {
      readonly kind: "pr-failing";
      readonly prNumber: number;
      readonly failedChecks: readonly string[];
      readonly attemptNumber: number;
    }
  | {
      readonly kind: "pr-retries-exhausted";
      readonly prNumber: number;
      readonly failedChecks: readonly string[];
      readonly attemptsSoFar: number;
    };

export interface DecideDaemonPrStateInput {
  readonly taskId: string;
  readonly prs: readonly DaemonOwnPrSnapshot[];
  /**
   * How many fix iterations the daemon has already attempted on the
   * matching PR. Caller persists this across iterations (counter on the
   * PR via a label like `daemon-fix-attempt:<n>`, or a sidecar file
   * keyed by PR number — wiring TBD in slice 2+).
   *
   * Default 0. The first fix iteration emits `attemptNumber: 1`.
   */
  readonly attemptsSoFar?: number;
  /**
   * Maximum fix attempts before escalation. Default 3 (TASKS.md
   * `daemon-fix-own-pr-on-ci-failure` Detail d). Pivot to 1 if the >20%
   * pivot-threshold fires (rule #9 in the task block).
   */
  readonly maxAttempts?: number;
}

// ---- Pure decision --------------------------------------------------------

/**
 * Pure decision: should the next daemon iteration redo the task, fix CI
 * on the open PR, or escalate?
 *
 * Selection rule:
 *   1. Filter `prs` to titles matching `taskId` via `prTitleNamesTask`
 *      (the same word-boundary match the duplicate detector uses).
 *   2. If no match → `'no-pr'`.
 *   3. If matching PR has ≥1 check with a failing conclusion → either
 *      `'pr-failing'` (more retries left) or `'pr-retries-exhausted'`
 *      (cap reached).
 *   4. Otherwise (all checks passing or in-flight) → `'pr-clean'`.
 *
 * `attemptsSoFar` is the count of *prior* fix iterations the daemon has
 * run on this PR; the caller increments it and persists. The verdict's
 * `attemptNumber` is the 1-indexed attempt the daemon is about to start.
 *
 * @otel-exempt pure decision.
 */
export function decideDaemonPrState(input: DecideDaemonPrStateInput): DaemonPrStateVerdict {
  const attemptsSoFar = input.attemptsSoFar ?? 0;
  const maxAttempts = input.maxAttempts ?? 3;

  const matching = input.prs.find(
    (p) => p.state === "OPEN" && prTitleNamesTask(p.title, input.taskId),
  );
  if (matching === undefined) return { kind: "no-pr" };

  // Single-loop collection (slice-2 round-trip-elimination optimization):
  // `filter(...).map(...)` allocates an intermediate array of CheckRunSnapshot
  // before mapping to names. The decision runs every daemon iteration once
  // wired (slice 4+); skipping the intermediate array saves one allocation
  // per call on the hot path.
  const failedChecks: string[] = [];
  for (const c of matching.checks) {
    if (isFailingConclusion(c.conclusion)) failedChecks.push(c.name);
  }

  if (failedChecks.length === 0) {
    return { kind: "pr-clean", prNumber: matching.number };
  }

  if (attemptsSoFar >= maxAttempts) {
    return {
      kind: "pr-retries-exhausted",
      prNumber: matching.number,
      failedChecks,
      attemptsSoFar,
    };
  }

  return {
    kind: "pr-failing",
    prNumber: matching.number,
    failedChecks,
    attemptNumber: attemptsSoFar + 1,
  };
}

/**
 * Map a `CheckRunSnapshot.conclusion` to "is this failing the merge gate?"
 *
 * Failing conclusions block the merge (`FAILURE`, `CANCELLED`, `TIMED_OUT`,
 * `ACTION_REQUIRED`, `STARTUP_FAILURE`); the daemon must address them.
 * Non-failing conclusions (`SUCCESS`, `SKIPPED`, `NEUTRAL`) and `null`
 * (still in flight) do NOT trigger a fix iteration — `null` means the
 * daemon should wait, not redo.
 *
 * @otel-exempt pure helper of `decideDaemonPrState`.
 */
export function isFailingConclusion(conclusion: CheckRunSnapshot["conclusion"]): boolean {
  return (
    conclusion === "FAILURE" ||
    conclusion === "CANCELLED" ||
    conclusion === "TIMED_OUT" ||
    conclusion === "ACTION_REQUIRED" ||
    conclusion === "STARTUP_FAILURE"
  );
}

// ---- gh pr list JSON parser (slice 2/N) -----------------------------------

/**
 * Pure parser for `gh pr list --head <branch> --state open --json
 * number,title,state,statusCheckRollup` raw JSON output → the
 * `DaemonOwnPrSnapshot[]` shape `decideDaemonPrState` consumes.
 *
 * Slice 2/N for `daemon-fix-own-pr-on-ci-failure`. Splits the I/O surface
 * (executing `gh`) from the parse surface so the parser is unit-testable
 * against frozen JSON fixtures without spawning subprocesses (mirrors
 * `parseFilesChangedFromGit` / `parseRecentMainCommitsFromGit` in
 * `cto-audit-cli-wiring.ts`). Slice 3+ wires `execFile("gh", […])` and
 * feeds this parser; slice 4+ plumbs the verdict into `bin/tick-loop.mjs`.
 *
 * Graceful-degrade per rule #6/#7: invalid JSON, non-array root, or
 * malformed entries yield `[]` rather than throwing — a `gh` outage or
 * unexpected schema must not crash the daemon iteration.
 *
 * Schema mapping:
 *   - PR-level: `state !== "OPEN"` → entry dropped (the decision only
 *     consults open PRs anyway; filtering here keeps the snapshot lean).
 *   - `statusCheckRollup` entries with `__typename === "CheckRun"` are
 *     mapped to `CheckRunSnapshot` directly (the `conclusion` field is
 *     pre-shaped to match GitHub's `CheckConclusionState` enum).
 *   - Non-`CheckRun` rollup entries (`StatusContext`, etc.) are dropped.
 *     Minsky CI is GitHub Actions only — every check in the rollup is a
 *     `CheckRun`. If legacy commit statuses appear (e.g., a bot adds a
 *     `StatusContext`), the parser silently ignores them rather than
 *     misclassifying their conclusion. Slice 3+ revisits if observed.
 *   - Unknown `conclusion` values map to `null` (treated as in-flight by
 *     `isFailingConclusion`); the daemon waits rather than redo-ing.
 *
 * @otel-exempt pure parser; the I/O wrapper handles span emission.
 */
export function parseGhPrListForDaemonPrState(rawJson: string): readonly DaemonOwnPrSnapshot[] {
  const parsed = safeParseJson(rawJson);
  if (!Array.isArray(parsed)) return [];

  const result: DaemonOwnPrSnapshot[] = [];
  for (const entry of parsed) {
    const snapshot = snapshotFromGhEntry(entry);
    if (snapshot !== undefined) result.push(snapshot);
  }
  return result;
}

function safeParseJson(rawJson: string): unknown {
  try {
    return JSON.parse(rawJson);
    // rule-6: handled-locally — parser graceful-degrade contract documented in JSDoc.
  } catch {
    return undefined;
  }
}

function snapshotFromGhEntry(entry: unknown): DaemonOwnPrSnapshot | undefined {
  const validated = validatePrEntry(entry);
  if (validated === undefined) return undefined;
  return {
    number: validated.number,
    title: validated.title,
    state: "OPEN",
    checks: parseRollup(validated.rollup),
  };
}

function validatePrEntry(
  entry: unknown,
): { readonly number: number; readonly title: string; readonly rollup: unknown } | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  if (e["state"] !== "OPEN") return undefined;
  const number = e["number"];
  if (typeof number !== "number") return undefined;
  const title = e["title"];
  if (typeof title !== "string") return undefined;
  return { number, title, rollup: e["statusCheckRollup"] };
}

function parseRollup(rollup: unknown): readonly CheckRunSnapshot[] {
  if (!Array.isArray(rollup)) return [];
  const checks: CheckRunSnapshot[] = [];
  for (const raw of rollup) {
    const check = checkFromRollupEntry(raw);
    if (check !== undefined) checks.push(check);
  }
  return checks;
}

function checkFromRollupEntry(raw: unknown): CheckRunSnapshot | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r["__typename"] !== "CheckRun") return undefined;
  const name = r["name"];
  if (typeof name !== "string") return undefined;
  return { name, conclusion: normaliseConclusion(r["conclusion"]) };
}

function normaliseConclusion(value: unknown): CheckRunSnapshot["conclusion"] {
  switch (value) {
    case "SUCCESS":
    case "FAILURE":
    case "CANCELLED":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
    case "SKIPPED":
    case "NEUTRAL":
      return value;
    default:
      return null;
  }
}

// ---- gh pr list I/O wrapper (slice 3/N) -----------------------------------

/**
 * Subprocess surface this module's I/O wrapper depends on. Structurally
 * identical to `ExecFileLike` in `cto-audit-cli-wiring.ts`; defined locally
 * to keep `daemon-pr-state.ts` independent of the audit-wiring module.
 *
 * Production wires `node:child_process.execFile` (promisified) returning
 * trimmed stdout; tests pass a deterministic stub returning frozen JSON.
 * A non-zero exit / ENOENT must throw — the wrapper catches and graceful-
 * degrades to `[]`.
 */
export type DaemonPrStateExecFile = (file: string, args: readonly string[]) => Promise<string>;

/**
 * Pure command shape for `gh pr list` keyed to a branch. Exported so the
 * I/O wrapper and tests share the canonical argv (rule #2 — single source
 * of truth for the gh invocation; drift between the wrapper and the docs
 * surfaces in the ghPrListArgsForBranch test).
 *
 * `--limit 1` because the daemon's branch-naming convention guarantees at
 * most one open PR per branch (the duplicate-PR detector blocks duplicates
 * before `gh pr create`); pulling more wastes the round-trip.
 *
 * @otel-exempt pure helper; the I/O wrapper carries the call-site span.
 */
export function ghPrListArgsForBranch(branch: string): readonly string[] {
  return [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--limit",
    "1",
    "--json",
    "number,title,state,statusCheckRollup",
  ];
}

/**
 * I/O wrapper for slice 1+2: run `gh pr list --head <branch> ...` and feed
 * the raw JSON into `parseGhPrListForDaemonPrState`. Returns the open
 * daemon-authored PR snapshots `decideDaemonPrState` consumes.
 *
 * Slice 3/N for `daemon-fix-own-pr-on-ci-failure`. Branch-name filter
 * (`--head`) is the precision lever — the daemon's per-task branch
 * convention (`feat/<task-id>-slice-N`) means one branch maps to ≤1 open
 * PR, so the title-based match the pure decision performs is belt-and-
 * suspenders against branches that get re-used across tasks. Slice 4+
 * wires this into `bin/tick-loop.mjs`.
 *
 * Graceful-degrade per rule #6/#7: a `gh` failure (offline / rate-limit /
 * missing binary / auth missing) yields `[]` rather than crashing — the
 * `decideDaemonPrState` verdict on `[]` is `'no-pr'`, so the daemon
 * iterates the standard task brief instead of the fix-CI brief. A `gh`
 * outage must NOT push the daemon into the wrong code path.
 *
 * @otel tick-loop.daemon-pr-state.fetch — caller emits the span; the
 *   wrapper itself is `@otel-exempt` because the call site (`bin/tick-loop.mjs`)
 *   is the I/O boundary.
 */
export async function fetchDaemonOwnPrsFromGh(opts: {
  readonly execFile: DaemonPrStateExecFile;
  readonly branch: string;
}): Promise<readonly DaemonOwnPrSnapshot[]> {
  return (
    opts
      .execFile("gh", ghPrListArgsForBranch(opts.branch))
      .then(parseGhPrListForDaemonPrState)
      // rule-6: handled-locally — graceful-degrade contract documented above.
      .catch(() => [] as readonly DaemonOwnPrSnapshot[])
  );
}
