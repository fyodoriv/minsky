// Heal-helper registry.
//
// Each automated heal helper exports `detect()`, `apply()`, `verify()`
// with helper-specific seam types. This file re-exports them plus a
// `catalogue` map for the chaos test's `test.each` iteration.
//
// Adding a new heal helper: add its module here AND a Given/When/Then
// scenario block to user-stories/007-agent-self-heals-catalogued-failures.md
// BEFORE writing the helper's test file (AGENTS.md rule #3).

export * as healStalePid from "./heal-stale-pid.js";
export * as healWorktreeMissingNodeModules from "./heal-worktree-missing-node-modules.js";
export * as healStaleTsbuildinfo from "./heal-stale-tsbuildinfo.js";
export * as healStuckCommand from "./heal-stuck-command.js";

export type { ApplyResult, DetectResult, HealEvent, HealOutcome, VerifyResult } from "./types.js";

/** Catalogue of automated heal helpers. The chaos test iterates this list. */
export const automatedHealCatalogue = [
  { id: "stale-pid", signal: "stale-pid", helperModule: "heal-stale-pid" },
  {
    id: "missing-node-modules",
    signal: "missing-node-modules",
    helperModule: "heal-worktree-missing-node-modules",
  },
  {
    id: "stale-tsbuildinfo",
    signal: "stale-tsbuildinfo",
    helperModule: "heal-stale-tsbuildinfo",
  },
  { id: "stuck-command", signal: "stuck-command", helperModule: "heal-stuck-command" },
] as const;

export type AutomatedHealEntry = (typeof automatedHealCatalogue)[number];
