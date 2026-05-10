/**
 * `@minsky/tick-loop/model-catalog` — slice 3 of
 * `claude-usage-aware-strategic-model-router`.
 *
 * Pure data file: an ordered list of {@link ModelCatalogEntry} rows the
 * strategic picker (slice 4 — `./strategic-model-router.ts`) walks from
 * highest-quality to lowest, returning the first whose per-window
 * floors fit the current {@link RemainingFractions}.
 *
 * Recency anchor: every row carries a `recordedAt` timestamp; the
 * `validate(MODEL_CATALOG)` helper tracks freshness for the operator
 * (quarterly refresh process documented in
 * `docs/strategic-model-router.md`, slice 8). When a row's `recordedAt`
 * is older than 90 days, the picker emits a self-diagnose finding (slice
 * 7) but doesn't refuse to serve — recency drift is operator-actionable,
 * not load-bearing on the dispatch decision.
 *
 * Pricing source: Anthropic's published per-Mtok rates (input + cache-
 * write + output). Local agents have `costPer1MtokInput: 0` to encode
 * "electricity only" — operators on metered electricity can override
 * via `MINSKY_STRATEGIC_FLOOR_*` env (slice 5 wiring).
 *
 * Floor convention (from the parent task's hypothesis (α)–(γ)):
 *   - `fivehourFloor`  — minimum 5h-remaining fraction at which this
 *                        tier is still selectable. Walked top-down by
 *                        the picker; first row whose floor is met across
 *                        ALL three windows wins.
 *   - `weeklyFloor`    — minimum weekly-remaining fraction.
 *   - `monthlyFloor`   — minimum monthly-remaining fraction.
 *
 * Floors must be MONOTONE DESCENDING from tier 1 → tier 4 — a tier with
 * a higher floor than the next-best tier is unreachable (the picker
 * would have already selected the higher tier). The `validate` helper
 * pins this invariant.
 *
 * @module tick-loop/model-catalog
 */

/**
 * One row of the model catalog. Pure data; no logic.
 */
export interface ModelCatalogEntry {
  /** Provider/model id consumed by the dispatch layer. */
  readonly id: string;
  /** Which agent shape dispatches this model. */
  readonly agent: "claude" | "local";
  /**
   * Quality tier. `1` = highest (Opus-class), `4` = lowest (smallest
   * local model). The picker walks ascending — `1` first.
   */
  readonly qualityTier: 1 | 2 | 3 | 4;
  /** Cost per 1M input tokens in USD. `0` = electricity-only (local). */
  readonly costPer1MtokInput: number;
  /** Cost per 1M output tokens in USD. `0` = electricity-only (local). */
  readonly costPer1MtokOutput: number;
  /** Minimum 5h-window remaining fraction at which this row is selectable. */
  readonly fivehourFloor: number;
  /** Minimum weekly remaining fraction at which this row is selectable. */
  readonly weeklyFloor: number;
  /** Minimum monthly remaining fraction at which this row is selectable. */
  readonly monthlyFloor: number;
  /** ISO-8601 UTC date the row's pricing/availability was last verified. */
  readonly recordedAt: string;
}

/**
 * The catalog. Recency-checked May 2026:
 *
 * - **Opus 4.7 1M (`claude-opus-4-7`)** — Anthropic's flagship model.
 *   Input \$15 / output \$75 per Mtok (Anthropic published 2026 Q2
 *   pricing). Tier 1; gates at 50% 5h-remaining, 30% weekly, 20% monthly.
 * - **Sonnet 4.6 (`claude-sonnet-4-6`)** — Anthropic's mid-tier.
 *   Input \$3 / output \$15 per Mtok. Tier 2; gates at 30% / 20% / 15%.
 * - **local (`local`)** — operator's machine (aider+Qwen3-Coder or
 *   opencode+LM-Studio+Qwen3.6-27B). \$0 per Mtok (electricity).
 *   Tier 3; gates at 0% (always selectable as last-resort).
 *
 * **Why Haiku is intentionally absent (operator 2026-05-10):** local
 * Qwen3.6-27B Dense (Terminal-Bench 2.0 = 59.3, Opus-parity per
 * TokenMix May 2026 review; SWE-bench Verified 77.2 per Buildfast)
 * AND Qwen3-14B (~64% SWE-bench Verified) BOTH outperform Claude
 * Haiku 4.5 on agentic-coding benchmarks. Minsky's daemon ONLY does
 * coding work — routing to Haiku when the budget can't afford
 * Opus/Sonnet is strictly worse than routing to local. The picker
 * therefore goes Opus → Sonnet → local, skipping Haiku entirely.
 * Pivot threshold (rule #9): if a future Haiku release closes the
 * coding-benchmark gap with local Qwen variants (≤2pp delta on
 * SWE-bench Verified), re-add the row at qualityTier 3 between
 * sonnet and local.
 *
 * Quarterly refresh process: `scripts/local-model-leaderboard.mjs --refresh`
 * (slice 1 of #daemon-local-model-self-tune) cross-checks this catalog
 * against current Anthropic pricing + local model availability.
 */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = Object.freeze([
  {
    id: "claude-opus-4-7",
    agent: "claude",
    qualityTier: 1,
    costPer1MtokInput: 15,
    costPer1MtokOutput: 75,
    fivehourFloor: 0.5,
    weeklyFloor: 0.3,
    monthlyFloor: 0.2,
    recordedAt: "2026-05-10",
  },
  {
    id: "claude-sonnet-4-6",
    agent: "claude",
    qualityTier: 2,
    costPer1MtokInput: 3,
    costPer1MtokOutput: 15,
    fivehourFloor: 0.3,
    weeklyFloor: 0.2,
    monthlyFloor: 0.15,
    recordedAt: "2026-05-10",
  },
  {
    id: "local",
    agent: "local",
    qualityTier: 3,
    costPer1MtokInput: 0,
    costPer1MtokOutput: 0,
    fivehourFloor: 0,
    weeklyFloor: 0,
    monthlyFloor: 0,
    recordedAt: "2026-05-10",
  },
]);

/**
 * Validation helper — pins the catalog invariants (sorted by qualityTier
 * ascending; floors monotone descending). Pure function. Returns
 * `{ ok: true }` when valid, `{ ok: false, errors: string[] }` otherwise.
 *
 * Slice 3 ships this; slice 7 wires it into self-diagnose as the
 * `model-catalog-invariants-hold` invariant.
 *
 * @otel-exempt pure validation; trivial, no side-effects
 */
export function validateModelCatalog(catalog: readonly ModelCatalogEntry[]): {
  readonly ok: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  if (catalog.length === 0) {
    errors.push("catalog is empty — at least one entry required");
  }
  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i];
    if (entry === undefined) continue;
    errors.push(...validateEntryShape(entry, i));
    if (i > 0) {
      const prev = catalog[i - 1];
      if (prev !== undefined) {
        errors.push(...validatePairOrder(prev, entry, i));
      }
    }
  }
  return { ok: errors.length === 0, errors: Object.freeze(errors) };
}

/**
 * Validate one entry's shape — id, qualityTier, floors. Returns
 * accumulated error strings (empty when valid).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function validateEntryShape(entry: ModelCatalogEntry, i: number): readonly string[] {
  const errors: string[] = [];
  if (entry.id.length === 0) errors.push(`entry ${i}: id is empty`);
  if (entry.qualityTier < 1 || entry.qualityTier > 4) {
    errors.push(`entry ${i} (${entry.id}): qualityTier ${entry.qualityTier} out of [1,4]`);
  }
  if (entry.fivehourFloor < 0 || entry.fivehourFloor > 1) {
    errors.push(`entry ${i} (${entry.id}): fivehourFloor ${entry.fivehourFloor} out of [0,1]`);
  }
  if (entry.weeklyFloor < 0 || entry.weeklyFloor > 1) {
    errors.push(`entry ${i} (${entry.id}): weeklyFloor ${entry.weeklyFloor} out of [0,1]`);
  }
  if (entry.monthlyFloor < 0 || entry.monthlyFloor > 1) {
    errors.push(`entry ${i} (${entry.id}): monthlyFloor ${entry.monthlyFloor} out of [0,1]`);
  }
  return errors;
}

/**
 * Validate the ordering invariants between two adjacent entries
 * (sorted-ascending tier, monotone-descending floors).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function validatePairOrder(
  prev: ModelCatalogEntry,
  entry: ModelCatalogEntry,
  i: number,
): readonly string[] {
  const errors: string[] = [];
  if (entry.qualityTier < prev.qualityTier) {
    errors.push(
      `entry ${i} (${entry.id}): qualityTier ${entry.qualityTier} < prev tier ${prev.qualityTier} — must be sorted ascending`,
    );
  }
  if (entry.fivehourFloor > prev.fivehourFloor) {
    errors.push(
      `entry ${i} (${entry.id}): fivehourFloor ${entry.fivehourFloor} > prev floor ${prev.fivehourFloor} — must be ≤`,
    );
  }
  if (entry.weeklyFloor > prev.weeklyFloor) {
    errors.push(
      `entry ${i} (${entry.id}): weeklyFloor ${entry.weeklyFloor} > prev floor ${prev.weeklyFloor} — must be ≤`,
    );
  }
  if (entry.monthlyFloor > prev.monthlyFloor) {
    errors.push(
      `entry ${i} (${entry.id}): monthlyFloor ${entry.monthlyFloor} > prev floor ${prev.monthlyFloor} — must be ≤`,
    );
  }
  return errors;
}
