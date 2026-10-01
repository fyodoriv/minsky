#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over `docs/security/privacy-data-egress.md` —
// the single-page operator answer to "where does my data go?". Pins the doc's
// six H2 sections (Threat model / Egress allow-list / Operator opt-out matrix
// / Performance-first carve-out / Verification / Sources), the explicit
// enumeration of every allowed egress destination, the STRIDE methodology
// citation, and the GDPR Article 25 anchor. Companion to
// `check-threat-model-section.mjs` (rule #13.8) and `check-pr-security-review.mjs`
// (rule #13 PR-body gate); together the three pin the prose substrate that
// rule #13.7 ("Privacy by default") rests on.
// Source: vision.md rule #13 minimum-bar item 7; TASKS.md
//   `security-privacy-priority-substrate` slice (e); rule #10 (deterministic
//   enforcement — drift detection is a CI lint, not a hope); GDPR Art. 25;
//   Howard & LeBlanc, *Writing Secure Code*, 2003 (STRIDE).
//   Conformance: full — pure function over the doc's text, no I/O in checks.
//
// Why this gate exists: PR #310 shipped the doc as slice 1 of rule #13.7,
// closing acceptance criterion #1 of `security-privacy-priority-substrate`'s
// privacy bullet. Without a deterministic pin, a future rewrite could quietly
// drop the egress allow-list rows (silent expansion of unenumerated
// destinations) or strip the STRIDE / GDPR anchors (loss of methodological
// grounding). The lint pins the load-bearing pieces; prose phrasing is left
// free.
//
// Pivot (rule #9): if the allow-list grows past ~10 destinations, switch from
// a hardcoded list of required hostnames here to a doc-side machine-readable
// table parsed by the lint — the requirement is enumeration, not the specific
// destinations of today.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const PRIVACY_DATA_EGRESS_PATH = "docs/security/privacy-data-egress.md";

/**
 * The six H2 sections the doc must carry, in order. Order is enforced because
 * the doc is meant to be readable top-to-bottom by a non-expert operator —
 * model first, allow-list second, opt-out third, carve-out fourth, then how
 * to verify, then citations. Reordering would weaken the operator-facing
 * narrative.
 */
export const REQUIRED_SECTIONS = Object.freeze([
  "## Threat model",
  "## Egress allow-list",
  "## Operator opt-out matrix",
  "## Performance-first carve-out",
  "## Verification",
  "## Sources",
]);

/**
 * Every outbound destination Minsky reaches by default at v0. Pinned so a
 * future edit cannot silently drop a row (which would leave the destination
 * still active in code but no longer documented — the worst failure mode for
 * a "where does my data go" doc). Adding a destination requires adding the
 * row here AND in the doc; removing one requires the same on both sides.
 */
export const REQUIRED_DESTINATIONS = Object.freeze([
  "Anthropic API",
  "OpenObserve",
  "GitHub",
  "npm registry",
  "ntfy.sh",
]);

const STRIDE_RE = /\bSTRIDE\b/i;
const GDPR_ART_25_RE = /GDPR\s+Article\s+25/i;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check over the doc text. Asserts:
 *   1. All six required H2 headings appear in the canonical order.
 *   2. Each enumerated egress destination is named at least once (case-
 *      sensitive — these are proper nouns / product names).
 *   3. The doc names STRIDE methodology by name (case-insensitive).
 *   4. The doc cites GDPR Article 25 (the load-bearing privacy-by-default
 *      anchor).
 *
 * @param {string} docText
 * @returns {CheckResult}
 */
export function checkPrivacyDataEgress(docText) {
  /** @type {string[]} */
  const errors = [];

  let cursor = 0;
  for (const section of REQUIRED_SECTIONS) {
    const re = new RegExp(`^${escapeRegExp(section)}\\s*$`, "m");
    const m = docText.slice(cursor).match(re);
    if (m === null || m.index === undefined) {
      errors.push(`missing or out-of-order section: \`${section}\``);
      continue;
    }
    cursor += m.index + m[0].length;
  }

  for (const dest of REQUIRED_DESTINATIONS) {
    if (!docText.includes(dest)) {
      errors.push(`egress allow-list does not name destination: \`${dest}\``);
    }
  }

  if (!STRIDE_RE.test(docText)) {
    errors.push("doc does not name `STRIDE` — rule #13.7 requires methodology engagement");
  }
  if (!GDPR_ART_25_RE.test(docText)) {
    errors.push("doc does not cite `GDPR Article 25` — the load-bearing privacy-by-default anchor");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  /** @type {string} */
  let text;
  try {
    text = await readFile(resolve(REPO_ROOT, PRIVACY_DATA_EGRESS_PATH), "utf8");
  } catch {
    process.stderr.write(
      `privacy-data-egress violation:\n  - ${PRIVACY_DATA_EGRESS_PATH}: file missing on disk\n`,
    );
    return 1;
  }
  const result = checkPrivacyDataEgress(text);
  if (result.ok) {
    process.stdout.write(
      `privacy-data-egress ok: ${PRIVACY_DATA_EGRESS_PATH} carries all ${REQUIRED_SECTIONS.length} required sections, ${REQUIRED_DESTINATIONS.length} enumerated destinations, STRIDE engagement, and the GDPR Article 25 anchor.\n`,
    );
    return 0;
  }
  process.stderr.write("privacy-data-egress violation:\n");
  for (const err of result.errors) {
    process.stderr.write(`  - ${PRIVACY_DATA_EGRESS_PATH}: ${err}\n`);
  }
  process.stderr.write(
    [
      "",
      "Per vision.md § 13 (minimum-bar item 7) and TASKS.md",
      "`security-privacy-priority-substrate`, `docs/security/privacy-data-egress.md`",
      "must enumerate every outbound destination and cite STRIDE + GDPR Art. 25.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-privacy-data-egress.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
