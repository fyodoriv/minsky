#!/usr/bin/env node
// Pattern: deterministic CI gate over an advisory-Skill scope cap.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: when a deterministic linter is added the matching Skill check is
//   removed, AND the Skill itself stays bounded so it cannot grow back into
//   a primary enforcement mechanism); rule #6 (failure-mode discipline:
//   "did anyone notice?" is itself a failure mode — close it mechanically);
//   Beck, *Extreme Programming Explained*, 1999 (CI as the constraint
//   enforcer).
// Conformance: full — pure function + thin CLI wrapper, no LLM in the chain.
//
// Why this gate exists: `novel/spec-monitor/SKILL.md` declares a hard cap
// of ≤5 advisory rules (the rule-#10 ratchet applied to the Skill itself).
// The cap was stated in prose only; nothing prevented a future PR from
// adding A6, A7, … and silently re-broadening the Skill back into a
// primary enforcement mechanism. This gate counts the `### A<N>.` headings
// that mark the residual-judgement rules and fails when there are more
// than 5.
//
// Heading shape (locked to what `novel/spec-monitor/SKILL.md` uses today):
//
//   ### A1. Hypothesis vagueness
//   ### A2. Pivot threshold reuses the success threshold (or has zero margin)
//   ### A3. Anchor citation is not a primary source
//   ### A4. Measurement command runs but doesn't actually inspect output
//   ### A5. Pattern-conformance level doesn't match the source code
//
// The regex requires `^###`, optional whitespace, capital `A`, one or more
// digits, a period, then whitespace — anchored to a line start. Drift in
// heading shape is a deliberate cost: if SKILL.md changes the marker, this
// linter must be updated in the same PR (failure becomes loud, not silent).
//
// Pivot (rule #9): if the Skill is retired entirely (rule-#10 terminal
// state — "if everything is deterministic, the Skill has no remit"),
// retire this lint along with it. A missing SKILL.md is therefore treated
// as a pass: a retired Skill cannot violate its own scope cap.
//
// Hypothesis (this gate's reason for existing): a deterministic rule-cap
// check eliminates the audit-spec-monitor-coverage "did anyone notice?"
// failure mode. Success: the 5 unit tests pass + this PR's own SKILL.md
// (5 rules) passes. Pivot: see above. Measurement: `pnpm vitest run
// scripts/check-skill-rule-cap.test.mjs && node
// scripts/check-skill-rule-cap.mjs`. Anchor: rule #10, Beck 1999.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_PATH = resolve(HERE, "..", "novel", "spec-monitor", "SKILL.md");
const DEFAULT_MAX_RULES = 5;

// Anchored-to-line-start `### A<digits>.` heading marker. Multiline flag so
// `^` matches every line, not just the start of the buffer.
const RULE_HEADING_RE = /^###[ \t]+A\d+\.\s/m;
const RULE_HEADING_RE_GLOBAL = /^###[ \t]+A\d+\.\s/gm;

/**
 * @typedef {{ ruleCount: number, violation: string | null }} CheckResult
 */

/**
 * Pure function: count advisory-rule headings in `skillContent` and return
 * a violation message if the count exceeds `maxRules`. Returns
 * `{ ruleCount: 0, violation: null }` for empty / null content (treated
 * as a retired Skill — the rule-#10 terminal state).
 *
 * @param {{ skillContent: string | null, maxRules: number }} args
 * @returns {CheckResult}
 */
export function checkSkillRuleCap({ skillContent, maxRules }) {
  if (skillContent === null || skillContent === "") {
    return { ruleCount: 0, violation: null };
  }
  const matches = skillContent.match(RULE_HEADING_RE_GLOBAL) ?? [];
  const ruleCount = matches.length;
  if (ruleCount > maxRules) {
    return {
      ruleCount,
      violation: `spec-monitor SKILL.md has ${ruleCount} advisory-rule headings (\`### A<N>.\`); the rule-#10 ratchet caps it at ${maxRules}. Either retire one rule or ship a deterministic linter for the new concern in the same PR (vision.md § 10).`,
    };
  }
  return { ruleCount, violation: null };
}

// Re-exported for tests so they can lock the regex shape independently of
// the `checkSkillRuleCap` entry point.
export { RULE_HEADING_RE };

/**
 * CLI: reads `novel/spec-monitor/SKILL.md` (or the path passed as the
 * first argument) and exits 1 if rule count > max. Missing file is a pass
 * (retired Skill is the rule-#10 terminal state, not a violation).
 *
 * @returns {Promise<number>}
 */
async function main() {
  const skillPath = process.argv[2] ?? DEFAULT_SKILL_PATH;
  /** @type {string | null} */
  let skillContent;
  try {
    skillContent = readFileSync(skillPath, "utf8");
  } catch (err) {
    // ENOENT → retired Skill, terminal state per rule #10. Anything else
    // is unexpected I/O and should bubble (rule #6: let-it-crash with a
    // precise error).
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      process.stdout.write(
        `skill-rule-cap ok: ${skillPath} not found (treated as retired Skill, rule-#10 terminal state).\n`,
      );
      return 0;
    }
    throw err;
  }
  const result = checkSkillRuleCap({ skillContent, maxRules: DEFAULT_MAX_RULES });
  if (result.violation === null) {
    process.stdout.write(
      `skill-rule-cap ok: ${result.ruleCount} advisory rule(s) declared (cap ${DEFAULT_MAX_RULES}).\n`,
    );
    return 0;
  }
  process.stderr.write(`skill-rule-cap violation:\n  - ${result.violation}\n`);
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-skill-rule-cap.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
