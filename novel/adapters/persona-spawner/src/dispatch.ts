/**
 * Persona dispatch table — pure mapping from tasks.md task tags to the
 * OMC persona that should handle them. Role-based agent orchestration
 * (Wooldridge, *MultiAgent Systems*, 2009): each tag selects a role.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Strategy lookup table — `dispatchPersona`
 *                            is a pure function over a frozen table; no
 *                            I/O, no time, no globals beyond the table.
 *                            Wooldridge 2009 (role assignment); Gamma
 *                            1994 (the table is the Strategy selector).
 *                            Conformance: full.
 *   - Default fallback:      Open-recursion default (`engineer`) for
 *                            unknown tags so a brand-new tag never
 *                            crashes the daemon — graceful-degrade per
 *                            rule #7. Conformance: full.
 *
 * Why a separate file (not inline in `./omc.ts`): the dispatch logic is
 * pure and reusable across Strategies. A future native CrewAI /
 * Anthropic-Agent-Teams Strategy would re-use the same table. Splitting
 * also keeps `./omc.ts` focused on the subprocess seam.
 */

/**
 * Read-only mapping from tasks.md task tag to OMC persona name. Order
 * inside the same task's tag list matters: the first tag matched wins.
 * (Tasks.md tags are unordered in spec; we just walk the array
 * left-to-right.)
 *
 * Anchors (per cell): each persona name is a Wooldridge 2009 role.
 */
export type DispatchTable = Readonly<Record<string, string>>;

/**
 * v0 dispatch table. Three tag→persona mappings — the brief's minimum.
 * Extend by adding rows; never overwrite (a tag that two callers want
 * to disagree on is a tasks.md spec issue, not a dispatch concern).
 *
 * Anchors:
 *   - `bug`        → `engineer`   — debugging is engineering work
 *   - `feature`    → `engineer`   — feature implementation is engineering
 *   - `research`   → `researcher` — investigation / literature review
 *   - `review`     → `reviewer`   — code review / spec review
 *   - `refactor`   → `engineer`   — refactoring is engineering
 */
export const PERSONA_DISPATCH_TABLE: DispatchTable = Object.freeze({
  bug: "engineer",
  feature: "engineer",
  research: "researcher",
  review: "reviewer",
  refactor: "engineer",
});

/**
 * Default persona for tasks whose tags don't match any table entry.
 * `engineer` because the most common unmatched task is "ship something
 * code-shaped" and that's the engineer's job.
 */
export const DEFAULT_PERSONA = "engineer" as const;

/**
 * Dispatch a list of tasks.md task tags to a single persona. Walks the
 * tags left-to-right, returning the first match in
 * {@link PERSONA_DISPATCH_TABLE}; falls back to {@link DEFAULT_PERSONA}
 * when no tag matches.
 *
 * Pure function — no I/O, no time, no globals beyond the frozen table.
 * The caller is responsible for normalising tag casing if needed (the
 * v0 contract is exact-match against lowercase keys; tasks.md spec is
 * lowercase by convention).
 *
 * @otel adapters.persona-spawner.dispatch-persona
 */
export function dispatchPersona(
  taskTags: readonly string[],
  table: DispatchTable = PERSONA_DISPATCH_TABLE,
): string {
  for (const tag of taskTags) {
    const persona = table[tag];
    if (persona !== undefined) return persona;
  }
  return DEFAULT_PERSONA;
}
