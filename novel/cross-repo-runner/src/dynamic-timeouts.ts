// Dynamic timeout calculator — computes watchdog + tick-interval from
// actual iteration history instead of hardcoded constants.
//
// Pattern: adaptive threshold (Astrom & Wittenmark 1997 — same anchor
//   budget-guard uses for its adaptive homeostasis); rule #4 (everything
//   measurable — the timeout IS measured from real data, not guessed).
// Source: 2026-05-18 operator directive "make timeouts dynamic so they
//   adjust to various machines". The 15min hardcoded watchdog killed 4
//   productive devin iterations (900s watchdog on iterations that needed
//   10-15min); the 30min manual bump was better but still a guess.
// Conformance: full — pure function, no I/O. The caller reads jsonl.

/**
 * A single iteration's timing data, extracted from experiment-store jsonl.
 */
export interface IterationTiming {
  readonly durationMs: number;
  readonly verdict: "validated" | "scope-leak" | "spawn-failed";
}

/**
 * Computed dynamic settings for the current machine + agent combination.
 */
export interface DynamicSettings {
  /** Watchdog timeout in ms — kills spawns that exceed this. */
  readonly spawnTimeoutMs: number;
  /** Sleep between iterations in ms. */
  readonly tickIntervalMs: number;
  /** How the values were computed. */
  readonly source: "history" | "default";
  /** Number of data points used. */
  readonly sampleSize: number;
  /** p95 of successful iteration durations (ms), if computed from history. */
  readonly p95Ms: number | null;
}

/** Minimum watchdog — never lower than 2 min even with fast history. */
const MIN_WATCHDOG_MS = 2 * 60 * 1000;
/** Maximum watchdog — never higher than 45 min even with slow history. */
const MAX_WATCHDOG_MS = 45 * 60 * 1000;
/** Default when no history — conservative 20 min. */
const DEFAULT_WATCHDOG_MS = 20 * 60 * 1000;
/** Headroom multiplier above p95. */
const HEADROOM = 1.5;
/** Minimum history to trust — below this, use defaults. */
const MIN_SAMPLE_SIZE = 5;

/** Default tick interval — 5 min. */
const DEFAULT_TICK_MS = 5 * 60 * 1000;
/** Minimum tick interval — 30s (don't hammer). */
const MIN_TICK_MS = 30 * 1000;

/**
 * Compute percentile from a sorted array of numbers.
 * @param sorted Ascending-sorted array.
 * @param p Percentile (0-1).
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? sorted[sorted.length - 1]!;
}

/**
 * Compute dynamic timeouts from iteration history. Pure function.
 *
 * Watchdog = p95(successful durations) × 1.5, clamped to [2min, 45min].
 * Tick interval = p50(successful durations) × 0.1, clamped to [30s, 5min].
 *
 * With <5 data points, returns conservative defaults.
 */
export function computeDynamicSettings(
  history: readonly IterationTiming[],
): DynamicSettings {
  // Filter to successful iterations only (validated + scope-leak are
  // "completed work" for timing purposes; spawn-failed at <10s are
  // config errors, at ≥10s are watchdog kills — exclude both).
  const successful = history
    .filter(
      (h) =>
        (h.verdict === "validated" || h.verdict === "scope-leak") &&
        h.durationMs > 10_000, // exclude sub-10s no-ops
    )
    .map((h) => h.durationMs)
    .sort((a, b) => a - b);

  if (successful.length < MIN_SAMPLE_SIZE) {
    return {
      spawnTimeoutMs: DEFAULT_WATCHDOG_MS,
      tickIntervalMs: DEFAULT_TICK_MS,
      source: "default",
      sampleSize: successful.length,
      p95Ms: null,
    };
  }

  const p95 = percentile(successful, 0.95);
  const p50 = percentile(successful, 0.5);

  const watchdog = Math.min(
    MAX_WATCHDOG_MS,
    Math.max(MIN_WATCHDOG_MS, Math.round(p95 * HEADROOM)),
  );

  // Tick interval: ~10% of median iteration time, clamped.
  // Fast machines get faster ticks; slow machines don't hammer.
  const tick = Math.min(
    DEFAULT_TICK_MS,
    Math.max(MIN_TICK_MS, Math.round(p50 * 0.1)),
  );

  return {
    spawnTimeoutMs: watchdog,
    tickIntervalMs: tick,
    source: "history",
    sampleSize: successful.length,
    p95Ms: p95,
  };
}

/**
 * Parse iteration timings from a jsonl string (one JSON object per line).
 * Extracts durationMs from the `notes` field ("loop iteration=N; <ms>ms; live")
 * and verdict from the `verdict` field.
 */
export function parseTimingsFromJsonl(jsonl: string): IterationTiming[] {
  const timings: IterationTiming[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const d = JSON.parse(line) as {
        verdict?: string;
        notes?: string;
      };
      const verdict = d.verdict;
      if (
        verdict !== "validated" &&
        verdict !== "scope-leak" &&
        verdict !== "spawn-failed"
      )
        continue;
      const msMatch = d.notes?.match(/(\d+)ms/);
      if (!msMatch) continue;
      timings.push({
        durationMs: Number.parseInt(msMatch[1]!, 10),
        verdict,
      });
    } catch {
      // skip malformed lines
    }
  }
  return timings;
}
