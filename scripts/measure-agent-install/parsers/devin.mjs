// Per-provider transcript parser for the `devin` agent.
//
// Conforming pattern: Strategy (Gamma et al. 1994) — one parser module
// per provider, selected by name at the `--live` call site.
//
// Contract: given a captured stdout transcript of an agent following
// INSTALL.md, return how many times the agent PROMPTED THE OPERATOR. A
// conforming run prompts exactly once (the verbatim Step-5 consent).
//
// Counting strategy: see claude-code.mjs — count the PRIMARY marker (one
// per prompt), fall back to the verbatim consent text only when absent.
// Devin prefixes each user-directed question with an `asking user:` marker.

/** @type {"devin"} */
export const PROVIDER = "devin";

/**
 * The CLI binary this provider is invoked as (resolved on PATH by the
 * harness). Live mode skips gracefully when this is not installed.
 * @type {string}
 */
export const BINARY = "devin";

// Primary marker: Devin prefixes each operator question with `asking user:`.
const PRIMARY_MARKER = /asking user:/i;
// Fallback: the verbatim Step-5 consent question.
const FALLBACK_MARKER = /Do you agree to submit/i;

/**
 * Count operator-facing prompts in a devin transcript.
 *
 * Pure: no I/O, no clock. Same input → same output (rule #11 anti-flake).
 *
 * @param {string} transcript - captured agent stdout
 * @returns {number} number of distinct operator prompts
 */
export function parsePromptCount(transcript) {
  if (typeof transcript !== "string" || transcript.length === 0) return 0;
  const lines = transcript.split("\n");
  const primary = lines.filter((l) => PRIMARY_MARKER.test(l)).length;
  if (primary > 0) return primary;
  return lines.filter((l) => FALLBACK_MARKER.test(l)).length;
}
