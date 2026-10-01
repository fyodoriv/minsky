// <!-- scope: human-approved task `tick-loop-transient-gh-401-must-not-crash-daemon` (TASKS.md, P1/M1) — the pure decision seam its **Files** field calls for ("the gh pr list/gh api call sites in novel/tick-loop/**, their error classification") -->
// Pattern: Circuit Breaker classifier (Nygard, *Release It!*, 2007 — fail-fast
//   only on *persisted* faults; absorb transient ones) + the let-it-crash
//   carve-out (Armstrong, *Programming Erlang*, 2007 — "let it crash" is for
//   UNEXPECTED faults; a known-recoverable remote status is handled-locally,
//   not a crash). Pure decision seam over a GitHub call's exit signal; the I/O
//   (the `gh` / `gh api` spawn itself) lives in the call sites under
//   scripts/orchestrate.mjs and scripts/local-gate-merge.mjs — this package is
//   the pure, unit-testable core they import (rule #2 — single seam).
// Source: TASKS.md `tick-loop-transient-gh-401-must-not-crash-daemon` (P1, M1);
//   vision.md rule #6 (stay alive — never process.exit(1) on a recoverable
//   GitHub status); rule #7 (chaos — every failure mode has a declared
//   disposition + chaos test); Beyer et al., *SRE*, 2016 Ch. 22 (retry/skip
//   budget for transient dependency errors, with a cap so a persisted fault
//   still surfaces loudly).
// <!-- pattern: not-applicable — Circuit-Breaker classifier + let-it-crash carve-out; pattern grounding lives in this header + the package README "Pattern conformance" section, not the vision.md index (vision.md is MAPE-K-owned and out of this task's scope) -->

/**
 * The disposition the daemon must take when a per-iteration `gh` / `gh api`
 * call fails. The whole point of this module: a transient GitHub auth blip
 * (token-refresh window, keychain momentarily unavailable, rate-limit-adjacent
 * 401) must NEVER propagate to `process.exit(1)` and take the whole worker
 * daemon down. It is classified, the sub-step is skipped (or the single
 * iteration fails), and the daemon stays up.
 *
 * - `"skip-substep"` — a recoverable status on a non-load-bearing sub-step
 *   (e.g. the touches-collision PR-list fetch, which already documents
 *   "set MINSKY_TOUCHES_GLOB_CHECK=0 … the claim layer stands alone"). The
 *   iteration continues without that sub-step's data.
 * - `"fail-iteration"` — a recoverable status on a load-bearing sub-step (the
 *   iteration can't meaningfully proceed without it), so this ONE iteration is
 *   abandoned, but the daemon process stays alive for the next tick.
 * - `"crash"` — a genuinely-fatal, non-recoverable error (the spawn itself
 *   failed, `gh` is not installed, a 4xx that is not an auth/rate status, or a
 *   *persisted* auth failure per the Pivot clause). Let-it-crash: the
 *   supervisor restart is the correct response.
 */
export type GhCallDisposition = "skip-substep" | "fail-iteration" | "crash";

/**
 * The failure-class label emitted as the `failure_class` span/log field when a
 * recoverable GitHub status is absorbed. The measurement clause of the task
 * greps for this exact token to confirm a 401 was absorbed WITH the daemon
 * still up (`grep -c '"failure_class":"gh-transient-auth"'`). Keep it stable —
 * a rename would silently break that measurement.
 */
export const GH_TRANSIENT_AUTH_FAILURE_CLASS = "gh-transient-auth";

/**
 * HTTP statuses that are RECOVERABLE when seen on a per-iteration GitHub call:
 *
 * - `401 Unauthorized` — token refresh window, keychain momentarily
 *   unavailable, or a rate-limit-adjacent de-auth blip (the observed symptom:
 *   `non-200 OK status code: 401 Unauthorized body: {"message":"Requires
 *   authentication"}`).
 * - `403 Forbidden` — GitHub returns 403 (not 429) for secondary rate limits
 *   and abuse-detection cool-downs; both are transient.
 * - `429 Too Many Requests` — primary rate limit; transient by definition.
 *
 * A genuinely-fatal de-auth ALSO surfaces as 401, so a single 401 is absorbed
 * but a *persisted* run of them escalates to `crash` — see
 * {@link classifyGhFailure}'s `consecutiveAuthFailures` handling and
 * {@link PERSISTED_AUTH_FAILURE_THRESHOLD}.
 */
export const RECOVERABLE_GH_STATUSES: ReadonlySet<number> = Object.freeze(new Set([401, 403, 429]));

/**
 * The Pivot threshold from the task block: keep the crash for *persisted* auth
 * failure (≥3 consecutive recoverable-status failures across iterations) but
 * absorb single / transient ones. At or above this count, a recoverable status
 * is reclassified `"crash"` — a genuinely-revoked token must still surface
 * loudly (Beyer SRE 2016 — a retry/skip budget with a cap, not an infinite
 * absorb).
 */
export const PERSISTED_AUTH_FAILURE_THRESHOLD = 3;

/**
 * Regexes that recover an HTTP status code from a `gh` / `gh api` stderr buffer
 * when the structured exit code isn't available (the daemon often only has the
 * captured stderr text). Ordered most-specific first. Each captures the status
 * in group 1.
 *
 * `gh api` emits e.g.:
 *   `gh: Requires authentication (HTTP 401)`
 *   `non-200 OK status code: 401 Unauthorized body: {"message":"Requires authentication"}`
 *   `HTTP 403: API rate limit exceeded`
 */
const STATUS_FROM_STDERR_RES: readonly RegExp[] = Object.freeze([
  /\bHTTP\s+(\d{3})\b/i,
  /\bstatus\s+code:?\s+(\d{3})\b/i,
  /\b(\d{3})\s+(?:Unauthorized|Forbidden|Too\s+Many\s+Requests)\b/i,
]);

/**
 * Extract an HTTP status code from a `gh` stderr buffer, or `null` when none of
 * the known shapes match. Pure — deterministic for a given input.
 *
 * @otel gh-auth-classifier.extract-status
 * @param stderr the captured stderr text from the failed `gh` call
 * @returns the parsed 3-digit status, or `null` if absent
 */
export function extractHttpStatus(stderr: string): number | null {
  for (const re of STATUS_FROM_STDERR_RES) {
    const m = re.exec(stderr);
    if (m?.[1] !== undefined) {
      const code = Number.parseInt(m[1], 10);
      if (Number.isInteger(code) && code >= 100 && code <= 599) return code;
    }
  }
  return null;
}

/** Input to {@link classifyGhFailure}. */
export interface GhFailureInput {
  /**
   * The HTTP status, if the caller already parsed it (e.g. from `gh api
   * --include` headers). When absent, it is recovered from {@link stderr} via
   * {@link extractHttpStatus}.
   */
  readonly status?: number | null;
  /** Captured stderr from the failed `gh` call. Defaults to "" when omitted. */
  readonly stderr?: string;
  /**
   * Whether the sub-step that made this call is load-bearing for the
   * iteration. A non-load-bearing sub-step (e.g. the touches-collision
   * PR-list fetch) is `skip-substep`-able; a load-bearing one fails the
   * iteration. Defaults to `false` (the safer default — most per-iteration
   * `gh` calls are advisory, and skipping is less disruptive than abandoning
   * the iteration).
   */
  readonly loadBearing?: boolean;
  /**
   * How many CONSECUTIVE recoverable-status failures the caller has observed
   * across iterations, INCLUDING this one. The caller tracks the running count
   * (reset to 0 on any successful `gh` call). At or above
   * {@link PERSISTED_AUTH_FAILURE_THRESHOLD} the status is reclassified
   * `"crash"` (Pivot clause — a persisted de-auth must surface loudly).
   * Defaults to `1` (treat as the first transient blip).
   */
  readonly consecutiveAuthFailures?: number;
}

/** Result of {@link classifyGhFailure}. */
export interface GhFailureClassification {
  /** What the daemon must do — see {@link GhCallDisposition}. */
  readonly disposition: GhCallDisposition;
  /** True when the status is in {@link RECOVERABLE_GH_STATUSES}. */
  readonly recoverable: boolean;
  /** The resolved HTTP status, or `null` when none could be determined. */
  readonly status: number | null;
  /**
   * The `failure_class` field the caller emits on the span/log line. Set to
   * {@link GH_TRANSIENT_AUTH_FAILURE_CLASS} when a recoverable status is
   * absorbed; `"gh-fatal"` when it crashes; `null` for a non-GitHub failure
   * the caller should classify itself.
   */
  readonly failureClass: string | null;
  /** One-line human-readable reason, suitable for a log line. */
  readonly reason: string;
}

/**
 * Build the `"crash"` classification for a non-recoverable failure: either no
 * HTTP status at all (spawn-level fault → genuinely unexpected) or a status
 * outside {@link RECOVERABLE_GH_STATUSES}. Pure helper extracted so
 * {@link classifyGhFailure} stays under the cognitive-complexity ceiling
 * (biome `noExcessiveCognitiveComplexity`).
 *
 * @otel-exempt pure-function — internal branch builder; caller's span covers it.
 * @param status the resolved HTTP status, or `null` when none was found
 * @returns the crash classification
 */
function crashForNonRecoverable(status: number | null): GhFailureClassification {
  return {
    disposition: "crash",
    recoverable: false,
    status,
    failureClass: status === null ? null : "gh-fatal",
    reason:
      status === null
        ? "no HTTP status — spawn-level failure (gh missing / ENOENT / unreachable); let-it-crash"
        : `non-recoverable GitHub status ${status}; let-it-crash (supervisor restart)`,
  };
}

/**
 * Build the classification for a RECOVERABLE status: absorb a single/transient
 * blip (`skip-substep` / `fail-iteration` + `gh-transient-auth`), but escalate
 * to `"crash"` once it has persisted ≥ {@link PERSISTED_AUTH_FAILURE_THRESHOLD}
 * consecutive iterations (Pivot clause). Pure helper extracted for the same
 * complexity-ceiling reason as {@link crashForNonRecoverable}.
 *
 * @otel-exempt pure-function — internal branch builder; caller's span covers it.
 * @param status the resolved (recoverable) HTTP status
 * @param loadBearing whether the failing sub-step is load-bearing
 * @param consecutive consecutive recoverable-failure count, including this one
 * @returns the absorb-or-escalate classification
 */
function classifyRecoverable(
  status: number,
  loadBearing: boolean,
  consecutive: number,
): GhFailureClassification {
  if (consecutive >= PERSISTED_AUTH_FAILURE_THRESHOLD) {
    return {
      disposition: "crash",
      recoverable: true,
      status,
      failureClass: "gh-fatal",
      reason: `GitHub ${status} persisted ${consecutive}× consecutive (≥${PERSISTED_AUTH_FAILURE_THRESHOLD}) — treating as de-auth, not a blip; let-it-crash`,
    };
  }
  return {
    disposition: loadBearing ? "fail-iteration" : "skip-substep",
    recoverable: true,
    status,
    failureClass: GH_TRANSIENT_AUTH_FAILURE_CLASS,
    reason: loadBearing
      ? `transient GitHub ${status} on a load-bearing sub-step (#${consecutive}); failing this iteration only, daemon stays up`
      : `transient GitHub ${status} on an advisory sub-step (#${consecutive}); skipping the sub-step, iteration continues`,
  };
}

/**
 * Classify a failed per-iteration `gh` / `gh api` call into the disposition the
 * daemon must take. This is the load-bearing decision the task targets: a
 * transient GitHub 401/403/429 is absorbed (skip the sub-step or fail just the
 * iteration) and a `gh-transient-auth` failure class is emitted, so the daemon
 * stays up — it NEVER returns `"crash"` for a single recoverable status.
 *
 * The ONLY paths to `"crash"`:
 *   1. a non-recoverable status (a 4xx/5xx that isn't 401/403/429), OR
 *   2. no status at all (the spawn itself failed — `gh` missing, ENOENT,
 *      network unreachable: a genuinely-unexpected fault → let-it-crash), OR
 *   3. a recoverable status that has now *persisted* ≥
 *      {@link PERSISTED_AUTH_FAILURE_THRESHOLD} consecutive iterations (Pivot
 *      clause — a revoked token must surface loudly, not be absorbed forever).
 *
 * Pure — no I/O, deterministic for a given input.
 *
 * @otel gh-auth-classifier.classify
 * @param input the failed call's signal (status / stderr / context)
 * @returns the disposition + the failure-class label to emit
 */
export function classifyGhFailure(input: GhFailureInput): GhFailureClassification {
  const status = input.status ?? extractHttpStatus(input.stderr ?? "");
  if (status === null || !RECOVERABLE_GH_STATUSES.has(status)) {
    return crashForNonRecoverable(status);
  }
  return classifyRecoverable(
    status,
    input.loadBearing ?? false,
    input.consecutiveAuthFailures ?? 1,
  );
}
