// <!-- scope: human-approved operator-machine-budget-autoscale slice 3 — runtime OS-throttle detector (operator directive 2026-05-17) -->

/**
 * `@minsky/tick-loop/os-throttle-detect` — pure runtime detector for the
 * OS-level throttles that make the operator's machine-utilisation budget
 * (vision.md rule #15 / operator directive 2026-05-17) *physically
 * unreachable* no matter what the autoscaler computes.
 *
 * Slice 1 of this task (PR #621) shipped `machine-budget-autoscaler.ts`
 * — the pure controller that turns the operator's budget % into a
 * worker target. Slice 2 shipped `scripts/check-machine-budget.mjs` —
 * a *static* CI gate that fails a PR whose repo-tracked launchd
 * template ships `ProcessType=Background`. Neither catches a throttle
 * applied to the *live* host after the plist was vetted: a hand
 * `renice`, a 256-FD soft `ulimit` (the macOS default — famously too
 * low for fan-out), a stale `MINSKY_MAX_WORKERS=4` left in the
 * operator's shell from last week's debugging, or a launchctl-loaded
 * agent whose effective `ProcessType` is `Background` even though the
 * repo template now says `Standard`.
 *
 * This module is the *detect + recommend* core of task part (c). It is
 * pure: the caller (a later bin-wiring slice) gathers the live machine
 * facts (effective launchd `ProcessType`, process `nice`, soft
 * `RLIMIT_NOFILE`, the live `MINSKY_*` env) and feeds them in; this
 * function decides which of them contradict the budget and emits an
 * ordered, idempotent correction list. *Applying* the corrections
 * (launchctl, renice, `~/apps/dotfiles` mirror tasks) is I/O and lands
 * in the wiring slice — same detect-pure / apply-impure split as
 * slice 1's controller vs. its bin wiring.
 *
 * Pattern conformance (rule #8):
 *   - **Strategy** (Gamma 1994) — `detectOsThrottles` is the seam; the
 *     daemon injects live machine facts, tests inject synthetic ones.
 *     Conformance: full.
 *   - **Pre-registered HDD** (rule #9) — every throttle verdict is
 *     keyed by a frozen constant in `OS_THROTTLE_POLICY`; the operator
 *     can read the constant and predict the detector's output for any
 *     machine state. Each throttle kind has a paired test.
 *   - **Fail-safe defaults** (Saltzer & Schroeder 1975) — a non-finite
 *     or out-of-range fact is treated as *absent*, never as a throttle
 *     and never as "definitely reachable": absence of evidence is not
 *     evidence of a throttle, but the budget is only declared reachable
 *     when every fact we *did* observe is clean.
 *   - **Little's Law / queueing theory** — a low FD ceiling caps the
 *     real concurrency below the budget's worker target exactly the way
 *     `ProcessType=Background` caps CPU/IO; both are budget-defeating
 *     throttles, surfaced uniformly.
 *
 * @otel-exempt pure detector; the caller (bin wiring, later slice)
 *   emits the `tick-loop.machine-budget.throttle` span with the verdict.
 *
 * @module tick-loop/os-throttle-detect
 */

/**
 * Budget percentages at or below this idle the box on purpose, so an
 * OS throttle is not a contradiction (a deliberately tiny budget *wants*
 * `Background` QoS). Kept in deliberate parity with
 * `TRIVIAL_BUDGET_PCT` in `scripts/check-machine-budget.mjs` (slice 2):
 * the static gate and the runtime detector must agree on what "trivial"
 * means, or a PR could pass the gate while the daemon flags the live
 * host (or vice-versa). A wording/value change updates both in the same
 * PR (rule #2 — single source of truth in spirit; the value is small
 * and frozen, so a shared import is over-coupling two layers).
 */
export const TRIVIAL_BUDGET_PCT = 10;

/**
 * Pre-registered OS-throttle policy constants (rule #9 — the constant
 * IS the spec; a paired test asserts each boundary). The operator can
 * read these and predict every verdict.
 */
export const OS_THROTTLE_POLICY = Object.freeze({
  /**
   * launchd `ProcessType` value that throttles CPU/IO. macOS clamps
   * `Background` agents to a low QoS class — `launchd.plist(5)`. Any
   * other value (`Standard`, `Interactive`, `Adaptive`, or absent) is
   * not a budget-defeating throttle.
   */
  throttlingProcessType: "Background",
  /**
   * A positive `nice` value de-prioritises the process on the CPU run
   * queue. `0` is normal; the daemon should never run niced when the
   * operator has allocated it a non-trivial budget.
   */
  maxAllowedNice: 0,
  /**
   * Soft `RLIMIT_NOFILE` each concurrent worker needs headroom for: a
   * model subprocess (claude/aider), its `node` parent, a `git`
   * child, and the pipes wiring them. Empirically a fan-out worker
   * touches a few hundred FDs at peak; 512 is a conservative,
   * pre-registered floor (the macOS default soft limit is 256 — below
   * this for even a single worker, the canonical fan-out throttle).
   */
  fdsPerWorker: 512,
  /**
   * `MINSKY_*` environment variables that cap worker concurrency. A
   * value here that resolves below the budget's worker target is a
   * stale hand-set cap (operator directive 2026-05-17 — "stale
   * `MINSKY_*` caps"). Frozen list: adding a new concurrency env var
   * means adding it here in the same PR (rule #9 — the list is the
   * spec).
   */
  concurrencyCapEnvVars: Object.freeze([
    "MINSKY_MAX_WORKERS",
    "MINSKY_SPAWN_ADDITIONAL_WORKERS",
    "MINSKY_WORKER_CONCURRENCY",
  ]),
});

/** A single kind of detected, budget-contradicting OS throttle. */
export type OsThrottleKind =
  | "launchd-process-type-background"
  | "process-nice"
  | "low-ulimit-nofile"
  | "stale-minsky-cap";

/**
 * One detected throttle: what was observed, why it contradicts the
 * budget, and the single idempotent correction that removes it. The
 * `correction` string is operator-facing (it is mirrored verbatim into
 * the `~/apps/dotfiles` / `~/apps/agentbrew` task by the later
 * cross-repo-propagation slice — task part (d)).
 */
export interface DetectedThrottle {
  readonly kind: OsThrottleKind;
  /** Human-readable observed value, e.g. `"ProcessType=Background"`. */
  readonly observed: string;
  /** Why this makes the budget physically unreachable. */
  readonly reason: string;
  /** The single idempotent fix; safe to apply more than once. */
  readonly correction: string;
}

/**
 * Live machine facts the caller gathers. Every field is optional: a
 * fact the caller could not read (e.g. the agent is not launchd-loaded,
 * so there is no effective `ProcessType`) is `undefined` and the
 * detector treats it as *absent*, not as a throttle (fail-safe).
 */
export interface MachineFacts {
  /** Operator budget %, the resolved value from slice 1's controller. */
  readonly budgetPct: number;
  /** Logical CPU count of the host (used to size the FD floor). */
  readonly cores: number;
  /** Effective launchd `ProcessType` of the running agent, or null. */
  readonly launchdProcessType?: string | null;
  /** Process `nice` value (0 = normal scheduling priority). */
  readonly niceValue?: number;
  /** Soft `RLIMIT_NOFILE` (open-file descriptor) ceiling. */
  readonly ulimitNofile?: number;
  /** Live environment — only the `MINSKY_*` caps are inspected. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The detector verdict. */
export interface OsThrottleReport {
  /** Every budget-contradicting throttle found, in policy order. */
  readonly throttles: readonly DetectedThrottle[];
  /**
   * True only when no observed fact contradicts the budget. A budget
   * at/below {@link TRIVIAL_BUDGET_PCT} is always reachable (throttles
   * are intended there).
   */
  readonly budgetReachable: boolean;
  /**
   * Ordered, de-duplicated correction strings — the apply slice walks
   * this list and the cross-repo-propagation slice mirrors it into the
   * dotfiles / agentbrew tasks. Empty when `budgetReachable` is true.
   */
  readonly corrections: readonly string[];
}

/** A finite, in-range number, else `undefined` (fail-safe). */
function finiteOr(
  value: number | null | undefined,
  predicate: (n: number) => boolean,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return predicate(value) ? value : undefined;
}

/**
 * The minimum soft `RLIMIT_NOFILE` the budget needs: one worker slot
 * per `fdsPerWorker`, sized by how many workers the budget targets on
 * this core count. Mirrors slice 1's "workers ≈ floor(cores · pct/100)"
 * intuition without importing it (standalone module — the caller passes
 * the already-resolved `budgetPct`). Floored at one worker so a tiny
 * box still demands a single worker's FD headroom.
 *
 * @otel-exempt pure arithmetic; no I/O. The caller (bin wiring, later
 *   slice) emits the `tick-loop.machine-budget.throttle` span.
 */
export function requiredFdFloor(cores: number, budgetPct: number): number {
  const safeCores = finiteOr(cores, (n) => n >= 1) ?? 1;
  const safePct = finiteOr(budgetPct, (n) => n > 0 && n <= 100) ?? 0;
  const targetWorkers = Math.max(1, Math.floor((safeCores * safePct) / 100));
  return targetWorkers * OS_THROTTLE_POLICY.fdsPerWorker;
}

/**
 * (1) launchd `ProcessType=Background` — the canonical, empirically
 * observed throttle (the 20→0 gridlock; operator directive
 * 2026-05-17). Compared case-insensitively: launchctl echoes the value
 * verbatim and a typo'd casing still throttles.
 */
function detectLaunchdBackground(
  facts: MachineFacts,
  effectiveBudget: number,
): DetectedThrottle | null {
  const pt = facts.launchdProcessType;
  if (typeof pt !== "string") return null;
  if (pt.trim().toLowerCase() !== OS_THROTTLE_POLICY.throttlingProcessType.toLowerCase()) {
    return null;
  }
  return {
    kind: "launchd-process-type-background",
    observed: `ProcessType=${pt}`,
    reason: `macOS clamps Background-QoS agents to a low CPU/IO priority class, so the budget (${effectiveBudget}%) is physically unreachable (launchd.plist(5); operator directive 2026-05-17 — the 20→0 worker gridlock).`,
    correction:
      "Set ProcessType=Standard on the loaded launchd agent (launchctl unload+load the corrected plist) and mirror the host change as a ~/apps/dotfiles TASKS.md task so the durable plist is the source of truth (rule #1).",
  };
}

/** (2) positive nice — the process is de-prioritised on the run queue. */
function detectPositiveNice(facts: MachineFacts, effectiveBudget: number): DetectedThrottle | null {
  const nice = finiteOr(facts.niceValue, (n) => Number.isInteger(n));
  if (nice === undefined || nice <= OS_THROTTLE_POLICY.maxAllowedNice) return null;
  return {
    kind: "process-nice",
    observed: `nice=${nice}`,
    reason: `A positive nice value de-prioritises the daemon on the CPU run queue under contention, so it cannot consume the ${effectiveBudget}% the operator allocated.`,
    correction:
      "renice the daemon process group back to 0 and mirror the change as a ~/apps/dotfiles TASKS.md task (drop the unintended `nice`/`Nice` from the shell or plist that introduced it).",
  };
}

/**
 * (3) low soft `RLIMIT_NOFILE` — caps real concurrency below the
 * budget's worker target exactly the way `Background` caps CPU/IO.
 */
function detectLowFdLimit(facts: MachineFacts, effectiveBudget: number): DetectedThrottle | null {
  const floor = requiredFdFloor(facts.cores, effectiveBudget);
  const nofile = finiteOr(facts.ulimitNofile, (n) => n >= 0);
  if (nofile === undefined || nofile >= floor) return null;
  return {
    kind: "low-ulimit-nofile",
    observed: `ulimit -n=${nofile} (need ≥${floor})`,
    reason: `The budget targets enough workers that ~${floor} file descriptors are needed; a ${nofile}-FD soft limit (the macOS default is 256) makes workers exhaust FDs before the budget is reached.`,
    correction: `Raise the soft RLIMIT_NOFILE to at least ${floor} (launchd <SoftResourceLimits><NumberOfFiles> / shell ulimit) and mirror the change as a ~/apps/dotfiles TASKS.md task.`,
  };
}

/**
 * (4) stale `MINSKY_*` concurrency cap left in the live environment
 * that resolves below the budget's worker target.
 */
function detectStaleMinskyCaps(facts: MachineFacts, effectiveBudget: number): DetectedThrottle[] {
  const env = facts.env;
  if (!env) return [];
  const targetWorkers = Math.max(
    1,
    Math.floor((finiteOr(facts.cores, (n) => n >= 1) ?? 1) * (effectiveBudget / 100)),
  );
  const found: DetectedThrottle[] = [];
  for (const name of OS_THROTTLE_POLICY.concurrencyCapEnvVars) {
    const raw = env[name];
    // `undefined` or empty/whitespace-only is *absent*, not a cap of
    // 0 (`Number("")` is 0 — would false-flag an unset-but-present
    // var). Fail-safe: absence of evidence is not a throttle.
    if (raw === undefined || raw.trim() === "") continue;
    const cap = Number(raw);
    if (!Number.isFinite(cap) || cap < 0 || cap >= targetWorkers) continue;
    found.push({
      kind: "stale-minsky-cap",
      observed: `${name}=${raw} (budget targets ≥${targetWorkers} workers)`,
      reason: `A live ${name}=${raw} caps worker concurrency below the ${targetWorkers}-worker target the ${effectiveBudget}% budget implies — a stale hand-set cap defeats the budget.`,
      correction: `Unset ${name} (or raise it to ≥${targetWorkers}) so the autoscaler — not a stale env var — owns concurrency, and mirror the durable shell change as a ~/apps/dotfiles TASKS.md task.`,
    });
  }
  return found;
}

/** De-duplicate correction strings preserving first-seen (policy) order. */
function dedupeCorrections(throttles: readonly DetectedThrottle[]): string[] {
  const seen = new Set<string>();
  const corrections: string[] = [];
  for (const t of throttles) {
    if (seen.has(t.correction)) continue;
    seen.add(t.correction);
    corrections.push(t.correction);
  }
  return corrections;
}

/**
 * Detect the OS-level throttles that contradict the operator's
 * machine-utilisation budget. Pure: no I/O, deterministic in its
 * inputs.
 *
 * Contract:
 *   - A budget at/below {@link TRIVIAL_BUDGET_PCT} → always reachable,
 *     no throttles (a deliberately idle box tolerates them).
 *   - A fact that is `undefined` / non-finite / out of range is treated
 *     as *absent* — not flagged, not assumed clean.
 *   - `budgetReachable` is `true` iff `throttles` is empty.
 *
 * @otel-exempt pure detector; no I/O. The caller (bin wiring, later
 *   slice) emits the `tick-loop.machine-budget.throttle` span with the
 *   verdict — instrumenting here would double-count.
 * @param facts live machine facts gathered by the caller
 * @returns the throttle verdict + ordered idempotent corrections
 */
export function detectOsThrottles(facts: MachineFacts): OsThrottleReport {
  const budgetPct = finiteOr(facts.budgetPct, (n) => n > 0 && n <= 100);

  // Fail-safe: an unreadable/garbage budget is conservatively the
  // slice-1 default (70) — non-trivial, so throttles still matter. We
  // never declare "reachable" just because we could not read the
  // budget.
  const effectiveBudget = budgetPct ?? 70;

  if (effectiveBudget <= TRIVIAL_BUDGET_PCT) {
    return Object.freeze({ throttles: [], budgetReachable: true, corrections: [] });
  }

  // Compose the four pre-registered detectors in policy order. Each is
  // a pure helper returning `null` (or `[]`) when its fact is absent or
  // clean; the orchestrator just collects what fired.
  const throttles: DetectedThrottle[] = [
    detectLaunchdBackground(facts, effectiveBudget),
    detectPositiveNice(facts, effectiveBudget),
    detectLowFdLimit(facts, effectiveBudget),
    ...detectStaleMinskyCaps(facts, effectiveBudget),
  ].filter((t): t is DetectedThrottle => t !== null);

  return Object.freeze({
    throttles: Object.freeze(throttles.slice()),
    budgetReachable: throttles.length === 0,
    corrections: Object.freeze(dedupeCorrections(throttles)),
  });
}
