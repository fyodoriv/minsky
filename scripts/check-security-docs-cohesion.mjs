#!/usr/bin/env node
// @ts-check
// Pattern: deterministic substrate-cohesion gate over the operator-readable
// `docs/security/*.md` corpus. Pins each doc to (a) cite `rule #13` ≥1 times —
// binding every operator-readable security doc to the constitutional rule it
// operationalises — and (b) carry a STRIDE-shaped threat-model section,
// matching the methodology rule #13.8 ("Threat model documented per novel/*
// package") already pins for code packages. Companion to
// `check-threat-model-section.mjs` (covers `novel/<pkg>/README.md`),
// `check-rule-13-sibling-anchors.mjs` (covers TASKS.md sibling P0s), and
// `check-vision-rule-13-task-id-citations.mjs` (covers vision.md § 13). Where
// those three pin the *task / spec / package* surfaces, this gate pins the
// *operator-doc* surface — the fourth and last surface where rule #13's
// substrate cohesion can drift silently.
// Source: vision.md rule #13 minimum-bar items 1–8; TASKS.md
//   `security-privacy-priority-substrate` slice; rule #10 (deterministic
//   enforcement); Howard & LeBlanc, *Writing Secure Code*, Microsoft Press,
//   2003 (STRIDE methodology).
//   Conformance: full — pure function over file contents, no I/O in checks.
//
// Why this gate exists: six operator-readable docs already exist in
// `docs/security/` (audit-gate, dashboard-exposure, otel-no-pii,
// privacy-data-egress, secret-scanning, supply-chain), all six cite `rule #13`
// and all six carry STRIDE-shaped threat-model sections. Without a
// deterministic pin, a future rewrite could quietly strip the rule-#13 anchor
// (the doc still exists but no longer binds itself to the constitutional rule
// it implements) or replace the STRIDE methodology with prose claims (loss of
// the structured threat-model surface). The gate locks in the substrate-
// cohesion property the corpus already has.
//
// Pivot (rule #9): if STRIDE engagement proves too narrow as a methodology
// pin (e.g., a doc legitimately needs PASTA / LINDDUN instead), broaden the
// regex to accept `STRIDE | PASTA | LINDDUN` rather than retiring the gate —
// the requirement is "name a published threat-modelling methodology", not
// "STRIDE specifically". Same shape as `check-threat-model-section.mjs`.

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const SECURITY_DOCS_DIR = "docs/security";

const RULE_13_RE = /\brule\s*#?\s*13\b/i;
const STRIDE_RE = /\bSTRIDE\b/i;
const THREAT_MODEL_HEADING_RE = /^#{1,6}\s+.*Threat model/im;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check over a single doc. A doc passes when it both cites rule #13 AND
 * carries a threat-model heading + STRIDE methodology mention. Both are
 * load-bearing; one without the other defeats the cohesion property:
 *
 *   - rule-#13 alone, no threat model ⇒ doc claims constitutional grounding
 *     but ships no methodology; future readers can't reproduce the analysis.
 *   - threat model alone, no rule-#13 ⇒ doc is methodologically sound but
 *     unmoored from the rule it implements; rule-#13 changes can't ratchet.
 *
 * @param {string} docText
 * @param {string} relPath
 * @returns {CheckResult}
 */
export function checkSecurityDoc(docText, relPath) {
  /** @type {string[]} */
  const errors = [];
  if (!RULE_13_RE.test(docText)) {
    errors.push(
      `${relPath}: missing \`rule #13\` citation — operator-readable security doc must bind itself to vision.md § 13`,
    );
  }
  if (!THREAT_MODEL_HEADING_RE.test(docText)) {
    errors.push(
      `${relPath}: missing a \`Threat model\` heading — every security doc carries a structured threat-model section per rule #13.8`,
    );
  }
  if (!STRIDE_RE.test(docText)) {
    errors.push(
      `${relPath}: missing \`STRIDE\` methodology engagement — pin a published threat-modelling methodology by name`,
    );
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Enumerates every `*.md` under `docs/security/` (sorted, top-level only —
 * nested READMEs are out of scope; rule #13.8 covers novel READMEs via
 * `check-threat-model-section.mjs`).
 *
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function listSecurityDocs(repoRoot) {
  const dir = resolve(repoRoot, SECURITY_DOCS_DIR);
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => `${SECURITY_DOCS_DIR}/${e.name}`)
    .sort();
}

/**
 * @param {string} repoRoot
 * @returns {Promise<{ ok: true, count: number } | { ok: false, errors: string[] }>}
 */
export async function checkAllSecurityDocs(repoRoot) {
  const paths = await listSecurityDocs(repoRoot);
  if (paths.length === 0) {
    return {
      ok: false,
      errors: [
        `${SECURITY_DOCS_DIR}/: directory is empty — at least one operator-readable security doc must exist`,
      ],
    };
  }
  /** @type {string[]} */
  const errors = [];
  for (const rel of paths) {
    const text = await readFile(resolve(repoRoot, rel), "utf8");
    const r = checkSecurityDoc(text, rel);
    if (!r.ok) errors.push(...r.errors);
  }
  return errors.length === 0 ? { ok: true, count: paths.length } : { ok: false, errors };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const result = await checkAllSecurityDocs(REPO_ROOT);
  if (result.ok) {
    process.stdout.write(
      `security-docs-cohesion ok: ${result.count} ${SECURITY_DOCS_DIR}/*.md docs all cite rule #13 + carry a STRIDE-shaped threat-model section.\n`,
    );
    return 0;
  }
  process.stderr.write("security-docs-cohesion violation:\n");
  for (const err of result.errors) {
    process.stderr.write(`  - ${err}\n`);
  }
  process.stderr.write(
    [
      "",
      "Per vision.md § 13 (rule #13) and TASKS.md `security-privacy-priority-substrate`,",
      "every operator-readable doc under `docs/security/*.md` must (a) cite `rule #13`",
      "at least once and (b) carry a `Threat model` heading naming the STRIDE",
      "methodology — same substrate-cohesion shape rule #13.8 already pins for",
      "`novel/**/README.md` via `check-threat-model-section.mjs`.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-security-docs-cohesion.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
