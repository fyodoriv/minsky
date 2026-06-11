// <!-- scope: human-approved phase-11b-delete-tick-loop-multistep step 1 — ports the model catalog data + validation helper out of `novel/tick-loop/src/model-catalog.ts` (deletion target) to `scripts/lib/` (canonical home). Same 3 rows, same validation semantics; TypeScript types translated to JSDoc. -->
// Per-machine model catalog and validation — the source-of-truth data
// table for which Anthropic / local models Minsky's strategic-router
// considers when picking a tier per iteration.
//
// History: originally `novel/tick-loop/src/model-catalog.ts`. Ported to
// .mjs / JSDoc in phase-11b step 1 when the TS daemon
// (`novel/tick-loop/`) was deleted. NOTE: this catalog IS a production
// runtime input — `bin/minsky-run.sh` executes
// `scripts/runany-resolve-model.mjs` every iteration, which walks this
// table via `pickStrategicModel`; the dynamic pick OVERRIDES the
// config-sourced model for claude spawns. (An earlier header here
// claimed "LINT-ONLY: no production runtime path reads from it" — stale
// since the bash runner wired the resolver in; that claim hid a
// stale-opus pin for weeks. Keep this header truthful.)
//
// Worker-model policy (operator directive 2026-06-11): all
// Minsky-spawned workers run `claude-sonnet-4-6`. Opus rows are
// deliberately absent — orchestration brains are pinned outside this
// catalog, and a worker must never silently escalate to a 5x-cost
// model just because budget headroom is full. Re-add an opus row only
// with an explicit operator decision recorded in the row comment.
//
// Source: parent task `claude-usage-aware-strategic-model-router`
// slice 3; recency-anchored 2026-05-10 per Anthropic Q2 pricing +
// local-model leaderboard refresh (`docs/strategic-model-router.md`).
//
// Pattern: pure data table + pure validation function — testable
// without mocking, exported for the self-diagnose CHECK
// `model-catalog-invariants-hold` and the runany-model-audit lint
// `runany-provider-decision-vs-catalog`.

/**
 * One row of the model catalog. Pure data; no logic.
 *
 * @typedef {Object} ModelCatalogEntry
 * @property {string} id Provider/model id consumed by the dispatch layer.
 * @property {"claude" | "local"} agent Which agent shape dispatches this model.
 * @property {1 | 2 | 3 | 4} qualityTier Quality tier (1 = highest, 4 = lowest); picker walks ascending.
 * @property {number} costPer1MtokInput Cost per 1M input tokens in USD (`0` = electricity-only / local).
 * @property {number} costPer1MtokOutput Cost per 1M output tokens in USD.
 * @property {number} fivehourFloor Min 5h-remaining fraction at which this row is selectable.
 * @property {number} weeklyFloor Min weekly remaining fraction at which this row is selectable.
 * @property {number} monthlyFloor Min monthly remaining fraction at which this row is selectable.
 * @property {string} recordedAt ISO-8601 UTC date the row's pricing/availability was last verified.
 */

/**
 * The catalog. Recency-checked June 2026.
 *
 * - **Sonnet 4.6 (`claude-sonnet-4-6`)** — the canonical worker model
 *   (operator directive 2026-06-11). Input $3 / output $15 per Mtok.
 *   Tier 1; gates at 30% / 20% / 15%.
 * - **local (`local`)** — operator's machine (aider+Qwen3-Coder or
 *   opencode+LM-Studio+Qwen3.6-27B). $0 per Mtok (electricity).
 *   Tier 2; gates at 0% (always selectable as last-resort).
 *
 * **Why Opus is intentionally absent (operator 2026-06-11):** workers
 * run sonnet-4-6, period. The dynamic walk previously picked
 * `claude-opus-4-7` at full budget headroom, silently overriding the
 * operator's configured sonnet model on every iteration at 5x cost.
 *
 * **Why Haiku is intentionally absent (operator 2026-05-10):** local
 * Qwen3.6-27B Dense (Terminal-Bench 2.0 = 59.3, Opus-parity per
 * TokenMix May 2026 review; SWE-bench Verified 77.2 per Buildfast)
 * AND Qwen3-14B (~64% SWE-bench Verified) BOTH outperform Claude
 * Haiku 4.5 on agentic-coding benchmarks. Minsky's daemon ONLY does
 * coding work — routing to Haiku when the budget can't afford
 * Opus/Sonnet is strictly worse than routing to local.
 *
 * Pivot threshold (rule #9): if a future Haiku release closes the
 * coding-benchmark gap with local Qwen variants (≤2pp delta on
 * SWE-bench Verified), re-add the row at qualityTier 3 between
 * sonnet and local.
 *
 * @type {readonly ModelCatalogEntry[]}
 */
export const MODEL_CATALOG = Object.freeze([
  {
    id: "claude-sonnet-4-6",
    agent: "claude",
    qualityTier: 1,
    costPer1MtokInput: 3,
    costPer1MtokOutput: 15,
    fivehourFloor: 0.3,
    weeklyFloor: 0.2,
    monthlyFloor: 0.15,
    recordedAt: "2026-06-11",
  },
  {
    id: "local",
    agent: "local",
    qualityTier: 2,
    costPer1MtokInput: 0,
    costPer1MtokOutput: 0,
    fivehourFloor: 0,
    weeklyFloor: 0,
    monthlyFloor: 0,
    recordedAt: "2026-06-11",
  },
]);

/**
 * Validation helper — pins the catalog invariants (sorted by qualityTier
 * ascending; floors monotone descending). Pure function.
 *
 * @otel-exempt pure validation; trivial, no side-effects
 *
 * @param {readonly ModelCatalogEntry[]} catalog
 * @returns {{ readonly ok: boolean, readonly errors: readonly string[] }}
 */
export function validateModelCatalog(catalog) {
  const errors = [];
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
 * @param {ModelCatalogEntry} entry
 * @param {number} i
 * @returns {readonly string[]}
 */
function validateEntryShape(entry, i) {
  const errors = [];
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
 * @param {ModelCatalogEntry} prev
 * @param {ModelCatalogEntry} entry
 * @param {number} i
 * @returns {readonly string[]}
 */
function validatePairOrder(prev, entry, i) {
  const errors = [];
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
