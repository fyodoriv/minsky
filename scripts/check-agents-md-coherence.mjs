#!/usr/bin/env node
// @ts-check
// Pattern: deterministic CI gate over AGENTS.md's cross-references — every
// claim in AGENTS.md that points outward (relative link, `vision.md § N`
// citation, load-bearing section heading other scripts cite) must resolve.
// Same shape as `check-rule-13-sibling-anchors.mjs` / `check-pattern-index.mjs`
// — pure decision function over `{ agentsMd, visionMd, fileExists }`, CLI is
// the thin I/O wrapper.
//
// Source: rule #10 (vision.md § 10 — deterministic enforcement; a hand-written
//   runbook with stale cross-references is the same drift class as a
//   hand-maintained CHANGELOG, just slower-moving); rule #17 (vision.md § 17
//   — proactive healing; observed AGENTS.md drift risk during the 2026-05-21
//   doc-unification sweep was the trigger to add this gate before drift
//   manifested); operator directive 2026-05-21 verbatim: "Let's ensure
//   agents.md is always updated too" (after semantic-release closed the same
//   class of bug for CHANGELOG.md).
//
// Why this gate exists: AGENTS.md is the runbook every agent reads first.
// When it drifts from the actual repo state (broken relative links to renamed
// docs, `vision.md § N` citations pointing to non-existent rules, missing
// load-bearing section anchors that other scripts cite), the rule-#9
// pre-registered work flow degrades silently — agents follow stale
// instructions. This lint pins three classes of drift:
//   (1) required-section invariant: load-bearing sections cited by other
//       scripts (`## Orchestrator discipline`, `### 15. Milestone alignment
//       gate`, `## Constitutional rules`) must exist with their canonical
//       heading text.
//   (2) relative-link resolution: every markdown `[text](path)` whose path
//       does not begin with `http`, `mailto:`, or `#` must resolve to a real
//       file (or directory) under the repo root.
//   (3) vision.md § N citation resolution: every `vision.md § N` reference
//       (regardless of surrounding link form) must point to a real `### N. `
//       heading in vision.md.
//
// Pivot (rule #9): if this gate produces ≥3 false positives in 30 days on
// PRs that intentionally rename a load-bearing section (e.g., a constitutional
// renumbering), pivot to relax the required-section list to a smaller stable
// core (just `## Orchestrator discipline`) and move section-renumbering
// detection to a paired markdown-link-checker so the false-positive surface
// shrinks. If the gate produces ≥1 false negative (a PR with broken AGENTS.md
// cross-references still merges), tighten the relative-link resolver to also
// check anchor-fragments (`#section-id`).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Load-bearing section headings that other scripts / docs cite by exact name.
 * Removing one of these from AGENTS.md silently breaks the citation. The lint
 * fails the build if any is missing.
 *
 * @type {readonly { heading: string, citedBy: string }[]}
 */
export const REQUIRED_SECTIONS = Object.freeze([
  {
    heading: "## Constitutional rules",
    citedBy:
      "AGENTS.md's own internal reading order; this section anchors the rule-by-number lookups other docs use.",
  },
  {
    heading: "## Orchestrator discipline",
    citedBy:
      "scripts/check-pr-self-grade.mjs error message; scripts/check-rule-6-let-it-crash.mjs error message.",
  },
  {
    heading: "### 15. Milestone alignment gate",
    citedBy:
      "CHANGELOG.md (`Rule #15 (AGENTS.md § 15)` — the milestone-alignment gate); TASKS.md `milestone-alignment-gate-enforcement` task body cites this anchor.",
  },
]);

/**
 * Pattern matching every `vision.md § N` reference in prose. Captures the
 * integer N. The reference can appear inside or outside a markdown link;
 * we don't care about the link form, only the citation semantics.
 *
 * @type {RegExp}
 */
const VISION_RULE_REF_RE = /\bvision\.md\s+§\s+(\d+)\b/g;

/**
 * Pattern matching every `### N. ` heading in vision.md. Captures the integer.
 *
 * @type {RegExp}
 */
const VISION_RULE_HEADING_RE = /^###\s+(\d+)\.\s/gm;

/**
 * Pattern matching every markdown link `[text](path)` whose path is captured
 * verbatim. We post-filter in the consumer to skip external URLs + anchors.
 *
 * @type {RegExp}
 */
const MARKDOWN_LINK_RE = /\[(?:[^\]]+)\]\(([^)\s]+)\)/g;

/**
 * @typedef {{ kind: "missing-section" | "broken-link" | "stale-vision-rule-ref", message: string }} CoherenceError
 */

/**
 * Return the set of rule numbers present in vision.md as `### N. ` headings.
 * Pure function.
 *
 * @param {string} visionMd
 * @returns {Set<number>}
 */
export function extractVisionRuleNumbers(visionMd) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const m of visionMd.matchAll(VISION_RULE_HEADING_RE)) {
    const n = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

/**
 * Return every `vision.md § N` reference found in `agentsMd`. Duplicates are
 * preserved so the error message can carry counts. Pure function.
 *
 * @param {string} agentsMd
 * @returns {number[]}
 */
export function extractVisionRuleCitations(agentsMd) {
  /** @type {number[]} */
  const out = [];
  for (const m of agentsMd.matchAll(VISION_RULE_REF_RE)) {
    const n = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Return `true` if `raw` is a link target we should resolve (relative path,
 * not external URL, not pure anchor). Pure function.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isRelativeLink(raw) {
  if (raw.startsWith("http:") || raw.startsWith("https:")) return false;
  if (raw.startsWith("mailto:")) return false;
  if (raw.startsWith("#")) return false;
  return true;
}

/**
 * Return every relative link target in `agentsMd`. External URLs and pure
 * anchors are filtered out. Anchor fragments are stripped from the result.
 * Pure function.
 *
 * @param {string} agentsMd
 * @returns {string[]}
 */
export function extractRelativeLinks(agentsMd) {
  /** @type {string[]} */
  const out = [];
  for (const m of agentsMd.matchAll(MARKDOWN_LINK_RE)) {
    const raw = m[1] ?? "";
    if (!isRelativeLink(raw)) continue;
    const cleaned = raw.split("#")[0] ?? "";
    if (cleaned === "") continue;
    out.push(cleaned);
  }
  return out;
}

/**
 * Check that every load-bearing section heading from `REQUIRED_SECTIONS` is
 * present in `agentsMd`. Pure function.
 *
 * @param {string} agentsMd
 * @returns {CoherenceError[]}
 */
function checkRequiredSections(agentsMd) {
  /** @type {CoherenceError[]} */
  const errors = [];
  for (const { heading, citedBy } of REQUIRED_SECTIONS) {
    if (agentsMd.includes(heading)) continue;
    errors.push({
      kind: "missing-section",
      message: `AGENTS.md is missing the required section "${heading}". ${citedBy}`,
    });
  }
  return errors;
}

/**
 * Check that every relative link in `agentsMd` resolves via `fileExists`.
 * Pure function (modulo the injected resolver).
 *
 * @param {string} agentsMd
 * @param {(p: string) => boolean} fileExists
 * @returns {CoherenceError[]}
 */
function checkRelativeLinks(agentsMd, fileExists) {
  /** @type {CoherenceError[]} */
  const errors = [];
  for (const link of extractRelativeLinks(agentsMd)) {
    if (fileExists(link)) continue;
    errors.push({
      kind: "broken-link",
      message: `AGENTS.md links to "${link}", which does not exist in the repo. Either fix the path or remove the link.`,
    });
  }
  return errors;
}

/**
 * Check that every `vision.md § N` reference in `agentsMd` points to a real
 * `### N. ` heading in `visionMd`. Pure function. Duplicate stale citations
 * are deduplicated into one error.
 *
 * @param {string} agentsMd
 * @param {string} visionMd
 * @returns {CoherenceError[]}
 */
function checkVisionRuleCitations(agentsMd, visionMd) {
  const ruleNumbers = extractVisionRuleNumbers(visionMd);
  /** @type {Set<number>} */
  const seenStale = new Set();
  /** @type {CoherenceError[]} */
  const errors = [];
  for (const n of extractVisionRuleCitations(agentsMd)) {
    if (ruleNumbers.has(n)) continue;
    if (seenStale.has(n)) continue;
    seenStale.add(n);
    errors.push({
      kind: "stale-vision-rule-ref",
      message: `AGENTS.md cites "vision.md § ${n}" but vision.md has no "### ${n}. " heading. Either fix the citation number or add the rule to vision.md.`,
    });
  }
  return errors;
}

/**
 * Run the three coherence checks against AGENTS.md. Pure decision function —
 * `fileExists` is injected so tests don't touch the filesystem.
 *
 * @param {object} args
 * @param {string} args.agentsMd - Full text of AGENTS.md.
 * @param {string} args.visionMd - Full text of vision.md.
 * @param {(relativePath: string) => boolean} args.fileExists - Resolver for
 *   relative paths in AGENTS.md (relative to AGENTS.md itself, which lives at
 *   the repo root).
 * @returns {{ ok: boolean, errors: CoherenceError[] }}
 */
export function checkAgentsMdCoherence({ agentsMd, visionMd, fileExists }) {
  const errors = [
    ...checkRequiredSections(agentsMd),
    ...checkRelativeLinks(agentsMd, fileExists),
    ...checkVisionRuleCitations(agentsMd, visionMd),
  ];
  return { ok: errors.length === 0, errors };
}

/**
 * CLI entry point — reads AGENTS.md + vision.md from disk, runs the checker,
 * prints a human-readable verdict, exits 0/1.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const agentsMdPath = resolve(REPO_ROOT, "AGENTS.md");
  const visionMdPath = resolve(REPO_ROOT, "vision.md");
  const [agentsMd, visionMd] = await Promise.all([
    readFile(agentsMdPath, "utf-8"),
    readFile(visionMdPath, "utf-8"),
  ]);
  /** @type {(p: string) => boolean} */
  const fileExists = (rel) => existsSync(resolve(REPO_ROOT, rel));
  const result = checkAgentsMdCoherence({ agentsMd, visionMd, fileExists });
  if (result.ok) {
    const linkCount = extractRelativeLinks(agentsMd).length;
    const citationCount = extractVisionRuleCitations(agentsMd).length;
    process.stdout.write(
      `agents-md-coherence ok: ${REQUIRED_SECTIONS.length} required sections present, ${linkCount} relative link(s) resolve, ${citationCount} vision.md § N citation(s) resolve.\n`,
    );
    process.exit(0);
  }
  console.error(`agents-md-coherence violation: ${result.errors.length} drift(s) in AGENTS.md:`);
  for (const e of result.errors) {
    console.error(`  [${e.kind}] ${e.message}`);
  }
  console.error(
    "\nFix: update AGENTS.md so every cross-reference resolves. Pure function: `checkAgentsMdCoherence({ agentsMd, visionMd, fileExists })` is the load-bearing contract; this CLI is the I/O boundary.",
  );
  process.exit(1);
}

// Run main() only when invoked as a script, not when imported by tests.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-agents-md-coherence.mjs")
) {
  main().catch((err) => {
    console.error("agents-md-coherence failed:", err);
    process.exit(2);
  });
}
