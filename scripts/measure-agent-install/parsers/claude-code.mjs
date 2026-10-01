// Per-provider transcript parser for the `claude-code` agent.
//
// Conforming pattern: Strategy (Gamma et al. 1994) — one parser module
// per provider, selected by name at the `--live` call site. Adding a 4th
// provider is a one-file addition (parent task Acceptance #6).
//
// Contract: given a captured stdout transcript of an agent following
// INSTALL.md, return how many times the agent PROMPTED THE OPERATOR. A
// conforming run prompts exactly once (the verbatim Step-5 consent). Any
// other count is a contract violation the harness reports as a failed run.
//
// Counting strategy (shared shape across providers): a single operator
// prompt spans several transcript lines (the verbatim consent text is
// multi-line). Counting raw line matches would over-count one prompt as
// many. Instead each provider has a PRIMARY marker emitted exactly once
// per prompt (here: the `[AskUserQuestion]` tool-use header). We count the
// primary marker, and ONLY fall back to the verbatim-consent text when the
// primary marker is absent (older CLI versions / plain-text rendering).

/** @type {"claude-code"} */
export const PROVIDER = "claude-code";

/**
 * The CLI binary this provider is invoked as (resolved on PATH by the
 * harness). Live mode skips gracefully when this is not installed.
 * @type {string}
 */
export const BINARY = "claude";

// Primary marker: Claude Code emits exactly one `[AskUserQuestion]` header
// per operator prompt.
const PRIMARY_MARKER = /\[AskUserQuestion\]/;
// Fallback: the verbatim Step-5 consent question (one per prompt). Used
// only when no primary marker is present.
const FALLBACK_MARKER = /Do you agree to submit/i;

/**
 * Count operator-facing prompts in a claude-code transcript.
 *
 * Pure: no I/O, no clock. Same input → same output (rule #11 anti-flake).
 *
 * @param {string} transcript - captured agent stdout
 * @returns {number} number of distinct operator prompts (0 = ran fully
 *   autonomously and never asked; 1 = the single expected consent prompt)
 */
export function parsePromptCount(transcript) {
  if (typeof transcript !== "string" || transcript.length === 0) return 0;
  const lines = transcript.split("\n");
  const primary = lines.filter((l) => PRIMARY_MARKER.test(l)).length;
  if (primary > 0) return primary;
  return lines.filter((l) => FALLBACK_MARKER.test(l)).length;
}
