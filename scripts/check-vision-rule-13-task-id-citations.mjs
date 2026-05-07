#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved security-privacy-priority-substrate -->
//
// Rule #13 inverse substrate-cohesion gate: verifies that vision.md § 13
// (the "Security & privacy" section) cites each of the 6 sibling P0 task
// IDs as backticked text (e.g. `secret-scanning-precommit-and-ci`).
//
// Acceptance criterion #3 (inverse direction) of
// `security-privacy-priority-substrate`.
//
// Pattern: deterministic CI gate over a static file (rule #10).
// Source: vision.md § 13 (Security & privacy — substrate cohesion);
//   rule #10 (deterministic enforcement); Munafò et al. 2017
//   (pre-registration — the citation commitment is made here, before
//   each sibling ships, so the rule cannot drift post-hoc).
// Conformance: full — pure function over file content; no LLM in chain.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Canonical IDs — must match SIBLING_P0_IDS in check-rule-13-sibling-anchors.mjs.
 * Shipped tasks are removed once their PR merges; dashboard-localhost-only-by-default shipped.
 */
export const SIBLING_P0_IDS = Object.freeze([
  "secret-scanning-precommit-and-ci",
  "supervisor-sandbox-syscall-restriction",
  "otel-no-pii-in-spans-lint",
  "supply-chain-hardening-lockfile-sbom-slsa",
  "cloud-tier-external-security-audit-gate",
]);

/**
 * @typedef {object} CitationResult
 * @property {string}  id      task ID
 * @property {boolean} cited   appears as backticked text in rule-13 section
 */

/**
 * Pure function. Extracts vision.md § 13 then verifies each sibling ID
 * appears as `` `id` `` within that section.
 *
 * The section is delimited by:
 *   - start: "### 13. Security & privacy"
 *   - end  : next "### " heading or "## " heading (whichever comes first)
 *
 * @param {string} visionMdContent
 * @param {readonly string[]} [siblingIds]
 * @returns {{ sectionFound: boolean; results: CitationResult[] }}
 */
export function checkVisionRule13Citations(visionMdContent, siblingIds = SIBLING_P0_IDS) {
  const sectionStart = visionMdContent.indexOf("### 13. Security & privacy");
  if (sectionStart === -1) {
    return { sectionFound: false, results: siblingIds.map((id) => ({ id, cited: false })) };
  }

  // Find next section heading after the rule-13 heading.
  const headingEnd = visionMdContent.indexOf("\n", sectionStart);
  const afterStart = headingEnd === -1 ? "" : visionMdContent.slice(headingEnd + 1);
  const nextHeading = /^###?\s/m.exec(afterStart);
  const bodyStart = headingEnd === -1 ? visionMdContent.length : headingEnd + 1;
  const sectionEnd = nextHeading === null ? visionMdContent.length : bodyStart + nextHeading.index;

  const section = visionMdContent.slice(sectionStart, sectionEnd);

  const results = siblingIds.map((id) => {
    const backticked = new RegExp(`\`${escapeRegex(id)}\``);
    return { id, cited: backticked.test(section) };
  });

  return { sectionFound: true, results };
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --------------------------------------------------------------- CLI -------

function main() {
  const visionPath = resolve(REPO_ROOT, "vision.md");
  let visionMdContent;
  try {
    visionMdContent = readFileSync(visionPath, "utf8");
  } catch {
    process.stderr.write(`check-vision-rule-13-task-id-citations: cannot read ${visionPath}\n`);
    process.exit(1);
  }

  const { sectionFound, results } = checkVisionRule13Citations(visionMdContent);

  if (!sectionFound) {
    process.stderr.write("FAIL: '### 13. Security & privacy' section not found in vision.md\n");
    process.exit(1);
  }

  let allPass = true;
  for (const r of results) {
    if (!r.cited) {
      process.stderr.write(
        `FAIL: task ID '${r.id}' not cited as backticked text in vision.md § 13 — ` +
          `add \`${r.id}\` to the Substrate cohesion paragraph\n`,
      );
      allPass = false;
    }
  }

  if (allPass) {
    process.stdout.write(
      `check-vision-rule-13-task-id-citations: all ${results.length} sibling IDs cited in vision.md § 13\n`,
    );
    process.exit(0);
  } else {
    process.exit(1);
  }
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
