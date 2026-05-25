// <!-- scope: human-approved phase-11b-delete-tick-loop-multistep step 1 — ports the model catalog data + validation helper out of `novel/tick-loop/src/model-catalog.ts` (deletion target) to `scripts/lib/` (canonical home). Same 3 rows, same validation semantics; TypeScript types translated to JSDoc. -->
// Per-machine model catalog and validation — the source-of-truth data
// table for which Anthropic / local models Minsky's strategic-router
// considers when picking a tier per iteration.
//
// History: originally `novel/tick-loop/src/model-catalog.ts`. Ported to
// .mjs / JSDoc in phase-11b step 1 because the TS daemon
// (`novel/tick-loop/`) is being deleted; the bash skeleton
// (`bin/minsky-run.sh`) hard-codes the agent invocation, so the
// model catalog is now LINT-ONLY: it documents the contract (3 rows,
// monotone-descending floors, opus → sonnet → local order) and
// the self-diagnose lint + runany-model-audit lint assert the
// design intent. No production runtime path reads from it.
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
 * The catalog. Recency-checked May 2026.
 *
 * - **Opus 4.7 1M (`claude-opus-4-7`)** — Anthropic's flagship.
 *   Input $15 / output $75 per Mtok (Anthropic published 2026 Q2
 *   pricing). Tier 1; gates at 50% 5h-remaining, 30% weekly,
 *   20% monthly.
 * - **Sonnet 4.6 (`claude-sonnet-4-6`)** — Anthropic's mid-tier.
 *   Input $3 / output $15 per Mtok. Tier 2; gates at 30% / 20% / 15%.
 * - **local (`local`)** — operator's machine (aider+Qwen3-Coder or
 *   opencode+LM-Studio+Qwen3.6-27B). $0 per Mtok (electricity).
 *   Tier 3; gates at 0% (always selectable as last-resort).
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
