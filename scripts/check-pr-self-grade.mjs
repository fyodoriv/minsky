#!/usr/bin/env node
// Pattern: deterministic gate over a PR-body convention.
// Source: AGENTS.md § "Orchestrator discipline" rule (2);
//   rule #9 (pre-registered HDD — pre-registration *plus* observation
//   is what closes the loop, per Munafò et al. 2017).
// Conformance: full — pure shape check on the PR body, no LLM in the chain.
//
// Why this gate exists: the post-batch audit of #22-#26 found that 5 of 5
// sub-agent PRs reported "validated" without comparing predicted-vs-observed.
// That is rule #9's "post-hoc metrics" anti-pattern in soft form: the
// hypothesis was declared, but the closing comparison was skipped. This
// gate makes the comparison structurally unavoidable.
//
// Required PR-body shape (case-insensitive, must appear in this order
// inside a single contiguous block, headed by "Hypothesis self-grade"):
//
//   Hypothesis self-grade
//   Predicted: …
//   Observed: …
//   Match: yes | no | partial
//   Lesson: …
//
// All four cell values must be non-empty (≥3 characters of substantive
// text). Missing block, missing line, or empty cell → exit 1 with a
// pointer to AGENTS.md § "Orchestrator discipline".
//
// Pivot (rule #9): if this gate produces ≥3 false positives in its first
// month (e.g., multi-line `Predicted:` values that span paragraphs), pivot
// to a YAML-block convention (a fenced ```self-grade YAML``` block parsed
// by a structured parser).

// `[ \t]*` (NOT `\s*`) to keep matches on a single line — `\s*` would span
// newlines and accidentally match the *next* line's value when the current
// line's value is empty.
const HEADER_RE = /^#+[ \t]*hypothesis self-grade\b/im;
const FIELD_RES = {
  Predicted: /^[ \t]*[-*•]?[ \t]*(?:\*\*)?predicted(?:\*\*)?[ \t]*[:-][ \t]*(.+)$/im,
  Observed: /^[ \t]*[-*•]?[ \t]*(?:\*\*)?observed(?:\*\*)?[ \t]*[:-][ \t]*(.+)$/im,
  Match: /^[ \t]*[-*•]?[ \t]*(?:\*\*)?match(?:\*\*)?[ \t]*[:-][ \t]*(yes|no|partial)\b/im,
  Lesson: /^[ \t]*[-*•]?[ \t]*(?:\*\*)?lesson(?:\*\*)?[ \t]*[:-][ \t]*(.+)$/im,
};

const MIN_VALUE_LEN = 3;

// The rule-#9 task-pre-registration form (Hypothesis / Success / Pivot /
// Measurement / Anchor). Agents bypassing .github/PULL_REQUEST_TEMPLATE.md
// via `gh pr create --body-file …` tend to write this form by reflex — the
// gate wants the PR-template form (Predicted / Observed / Match / Lesson).
// Detected as their own list bullets (`- **Hypothesis**:`) — per the task's
// Pivot, NOT as embedded prose — to avoid firing on a quoted "Hypothesis:".
const ALT_FORM_FIELD_RES = {
  Hypothesis: /^[ \t]*[-*•][ \t]*(?:\*\*)?hypothesis(?:\*\*)?[ \t]*[:-]/im,
  Success: /^[ \t]*[-*•][ \t]*(?:\*\*)?success(?:\*\*)?[ \t]*[:-]/im,
  Pivot: /^[ \t]*[-*•][ \t]*(?:\*\*)?pivot(?:\*\*)?[ \t]*[:-]/im,
  Measurement: /^[ \t]*[-*•][ \t]*(?:\*\*)?measurement(?:\*\*)?[ \t]*[:-]/im,
  Anchor: /^[ \t]*[-*•][ \t]*(?:\*\*)?anchor(?:\*\*)?[ \t]*[:-]/im,
};

// ≥3 of the 5 task-pre-reg fields present ⇒ the author used the wrong form.
const ALT_FORM_MIN_FIELDS = 3;

const ALT_FORM_POINTER =
  "looks like you used the rule-#9 task-pre-registration form " +
  "(Hypothesis / Success / Pivot / Measurement / Anchor); the PR-self-grade gate " +
  "wants the simpler 4-field PR-template form (Predicted / Observed / Match / Lesson) " +
  "per .github/PULL_REQUEST_TEMPLATE.md.";

/**
 * Detect the rule-#9 task-pre-registration form in a PR body. Returns true
 * when ≥3 of the 5 field markers appear as their own list bullets.
 *
 * @param {string} body
 * @returns {boolean}
 */
export function isAlternativeForm(body) {
  let count = 0;
  for (const re of Object.values(ALT_FORM_FIELD_RES)) {
    if (re.test(body)) count += 1;
  }
  return count >= ALT_FORM_MIN_FIELDS;
}

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Check one named field's regex against the body. Returns null if OK,
 * else a human-readable error string.
 *
 * @param {string} name
 * @param {RegExp} re
 * @param {string} body
 * @returns {string | null}
 */
function checkField(name, re, body) {
  const m = body.match(re);
  if (!m) return `missing or malformed line: \`${name}: …\``;
  // `Match` is an enum (yes / no / partial) — the regex already
  // constrains the value, so the min-length check is N/A.
  if (name === "Match") return null;
  const captured = m[1];
  if (captured === undefined) return `missing or malformed line: \`${name}: …\``;
  const value = captured
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .trim();
  if (value.length < MIN_VALUE_LEN) {
    return `\`${name}:\` value is too short (≥${MIN_VALUE_LEN} chars required); got "${value}"`;
  }
  return null;
}

/**
 * Pure function: given a PR body (string), return either { ok: true }
 * or { ok: false, errors: string[] }. Errors are human-readable lines.
 *
 * @param {string} body
 * @returns {CheckResult}
 */
export function checkPrSelfGrade(body) {
  /** @type {string[]} */
  const errors = [];
  if (!HEADER_RE.test(body)) {
    errors.push(
      "missing `Hypothesis self-grade` header. Add the block per AGENTS.md § Orchestrator discipline.",
    );
    // Without a header, the field-level checks below would all fire too.
    // Keep them — the contributor benefits from seeing the full shape.
  }
  for (const [name, re] of Object.entries(FIELD_RES)) {
    const err = checkField(name, re, body);
    if (err !== null) errors.push(err);
  }
  // When the author used the task-pre-reg form AND a required PR-template
  // field is missing, lead with a pointer to the right form so they can
  // self-correct without re-reading the template. Additive — only changes
  // the error wording, never the pass/fail decision.
  if (errors.length > 0 && isAlternativeForm(body)) {
    errors.unshift(ALT_FORM_POINTER);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * CLI: reads PR body from a file path passed as the first argument, OR
 * from stdin if no argument is given. The CI workflow writes the PR body
 * to a file and passes its path.
 *
 * @returns {Promise<number>}
 */
async function main() {
  const arg = process.argv[2];
  /** @type {string} */
  let body;
  if (arg !== undefined && arg !== "-") {
    const { readFile } = await import("node:fs/promises");
    body = await readFile(arg, "utf8");
  } else {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    body = Buffer.concat(chunks).toString("utf8");
  }
  const result = checkPrSelfGrade(body);
  if (result.ok) {
    process.stdout.write("pr-self-grade ok: all four fields present and non-empty.\n");
    return 0;
  }
  process.stderr.write("pr-self-grade violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Required block (paste into PR description):",
      "",
      "  ## Hypothesis self-grade",
      "",
      "  - Predicted: <re-state the hypothesis from the EXPERIMENT.yaml or PR body>",
      "  - Observed: <the actual measurement output>",
      "  - Match: yes | no | partial",
      "  - Lesson: <one-sentence takeaway; what changes for the next experiment>",
      "",
      'See AGENTS.md § "Orchestrator discipline" for the rule and rule #9 for the anchor.',
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-pr-self-grade.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
