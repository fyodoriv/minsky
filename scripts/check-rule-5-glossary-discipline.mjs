#!/usr/bin/env node
// Pattern: Lexical lint over a behavioral specification (vision.md).
// Source: rule #10 (deterministic enforcement) + rule #5 (theoretical
//   grounding); Gabriel, Patterns of Software, 1996 (named patterns are
//   deterministic by construction); Aho-Sethi-Ullman 1986 (lexer shape).
// Conformance: full — pure function + thin CLI wrapper, no LLM in the chain.
// Why this rule exists: rule #5 says "every Minsky-coined word resolves to
//   a Glossary anchor". Today's CI only checks the section header is
//   present; this script checks every coined term *resolves*.
//
// Heuristic: extract every backticked identifier from vision.md outside the
// Glossary section. A candidate "looks coined" when it is PascalCase OR
// camelCase OR contains a dash. Paths (slash-bearing), filenames (ending
// in .md/.ts/.sh/.yaml/.json), and dotted-method tokens (foo.Bar) are
// rejected by the extraction filter — they are not "coined terms" in
// rule #5's sense.
//
// Resolution: a candidate resolves if it appears in the Glossary section,
// OR appears as an artifact-name token in the `## Pattern conformance
// index` table (rule #8 anchors satisfy rule #5 — both are "this term is
// anchored in published literature"), OR is on the allowlist.
//
// Pivot (rule #9): if this heuristic produces ≥3 false positives per PR,
// switch to "extract terms tagged <coined>…</coined> in HTML comments".

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Section title (text after the `## ` prefix) that hosts the canonical
// glossary table.
const GLOSSARY_HEADER = "Glossary — every term has a CS anchor";
const PATTERN_INDEX_HEADER = "Pattern conformance index";

// A backticked identifier-shaped token. Permits letters, digits, underscore,
// dot, slash, dash. Trailing slash allowed (e.g., `competitors/`).
const BACKTICK_TOKEN_RE = /`([A-Za-z_][A-Za-z0-9_./-]*)`/g;

// Identifier-shaped token (no backticks) — used to harvest terms from the
// Glossary table cells and Pattern-index Artifact column.
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_./-]*/g;

// Filename-extension reject pattern. A candidate ending in any of these
// extensions is a filename, not a coined term.
const FILENAME_EXT_RE = /\.(md|ts|tsx|mjs|js|sh|yaml|yml|json|toml|txt)$/;

// Dotted-method shape: lowercase letters → dot → lowercase letter (e.g.,
// `trace.setGlobalTracerProvider`). Method-syntax references are not
// "coined terms" in rule #5's sense; they are call-sites.
const DOTTED_METHOD_RE = /^[a-z][a-zA-Z]*\.[a-z]/;

// English / markup words that show up backticked but are obviously not
// coined identifiers. Filtered out before allowlist / glossary lookup.
const ENGLISH_NOISE = new Set([
  "if",
  "else",
  "true",
  "false",
  "null",
  "undefined",
  "main",
  "grep",
  "mkdir",
  "cost",
  "full",
  "partial",
  "deviation",
  "validated",
  "regressed",
  "inconclusive",
  "Success",
  "Pivot",
  "Measurement",
  "Experiment",
]);

/**
 * Split markdown into top-level sections keyed by `## …` heading.
 * Returns { [heading: string]: string } where the value is the body
 * (excluding the heading line itself).
 */
function splitSections(md) {
  const out = {};
  const lines = md.split("\n");
  let current = null;
  let buf = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current !== null) out[current] = buf.join("\n");
      current = line.replace(/^##\s+/, "").trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) out[current] = buf.join("\n");
  return out;
}

/**
 * "Looks like a Minsky-coined identifier" — PascalCase / camelCase / has
 * a dash. Path-shaped (contains `/`), filename-shaped (ending in a known
 * source/doc extension), and dotted-method-shaped (`foo.bar`) tokens are
 * REJECTED — they are not rule-#5 coined terms.
 *
 * Single all-lowercase words like `cost`, `main`, `null` fall through
 * (filtered separately via ENGLISH_NOISE).
 */
function looksCoined(token) {
  if (token.length < 2) return false;
  if (token.includes("/")) return false;
  if (FILENAME_EXT_RE.test(token)) return false;
  if (DOTTED_METHOD_RE.test(token)) return false;
  if (/-/.test(token)) return true;
  if (/^[A-Z]/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) {
    return true;
  }
  if (/^[a-z]/.test(token) && /[A-Z]/.test(token)) return true;
  return false;
}

/**
 * Parse the allowlist file. Format: one term per line; blank lines and
 * `#`-prefixed comment lines ignored. Inline comments (`term  # why`) are
 * supported.
 */
export function parseAllowlist(text) {
  const out = new Set();
  for (const raw of text.split("\n")) {
    const stripped = raw.split("#")[0].trim();
    if (stripped.length === 0) continue;
    out.add(stripped);
  }
  return out;
}

/**
 * Harvest backticked coined-shape tokens from a single section body.
 */
function harvestCandidates(body) {
  const out = new Set();
  for (const match of body.matchAll(BACKTICK_TOKEN_RE)) {
    const token = match[1].replace(/\/$/, "");
    if (token.length === 0) continue;
    if (ENGLISH_NOISE.has(token)) continue;
    if (!looksCoined(token)) continue;
    out.add(token);
  }
  return out;
}

/**
 * Harvest tokens that appear in the "Artifact" column of the Pattern
 * conformance index table.
 *
 * Rule-#5 / rule-#8 bridge: rule #8 says every artifact has a row here
 * with a published pattern + source. That IS a CS anchor — rule #5's
 * spirit ("every coined term resolves to published literature") is
 * satisfied via the index, not just the Glossary.
 */
function isDataRow(line) {
  if (!line.trimStart().startsWith("|")) return false;
  if (line.includes("---")) return false;
  return true;
}

function parseRowCells(line) {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

export function harvestPatternIndexTokens(body) {
  const out = new Set();
  for (const line of body.split("\n")) {
    if (!isDataRow(line)) continue;
    const cells = parseRowCells(line);
    if (cells.length < 2) continue;
    if (!/^\d+$/.test(cells[0])) continue;
    for (const token of cells[1].match(TOKEN_RE) ?? []) out.add(token);
  }
  return out;
}

/**
 * Pure function: given vision.md text + allowlist, return missing /
 * candidates. `missing` is the sorted list of candidate terms that were
 * neither allowlisted nor resolved in the Glossary or Pattern index.
 */
export function checkGlossaryDiscipline({ visionMd, allowlist }) {
  const sections = splitSections(visionMd);
  const glossaryBody = sections[GLOSSARY_HEADER];
  if (typeof glossaryBody !== "string") {
    return { missing: [], candidates: [], glossarySectionMissing: true };
  }
  const glossaryResolved = new Set(glossaryBody.match(TOKEN_RE) ?? []);
  const indexBody = sections[PATTERN_INDEX_HEADER];
  const indexResolved =
    typeof indexBody === "string" ? harvestPatternIndexTokens(indexBody) : new Set();

  const candidates = new Set();
  for (const [heading, body] of Object.entries(sections)) {
    if (heading === GLOSSARY_HEADER) continue;
    if (heading === PATTERN_INDEX_HEADER) continue;
    for (const token of harvestCandidates(body)) candidates.add(token);
  }

  const missing = [...candidates]
    .filter(
      (token) => !allowlist.has(token) && !glossaryResolved.has(token) && !indexResolved.has(token),
    )
    .sort();
  return {
    missing,
    candidates: [...candidates].sort(),
    glossarySectionMissing: false,
  };
}

function main() {
  const repoRoot = resolve(HERE, "..");
  const visionPath = resolve(repoRoot, "vision.md");
  const allowlistPath = resolve(repoRoot, "scripts/glossary-allowlist.txt");
  const visionMd = readFileSync(visionPath, "utf8");
  const allowlist = parseAllowlist(readFileSync(allowlistPath, "utf8"));
  const result = checkGlossaryDiscipline({ visionMd, allowlist });
  if (result.glossarySectionMissing) {
    process.stderr.write(
      `vision.md is missing the "## ${GLOSSARY_HEADER}" section required by rule #5\n`,
    );
    process.exit(1);
  }
  if (result.missing.length > 0) {
    process.stderr.write(
      `rule-5 violation: ${result.missing.length} backticked term(s) in vision.md do not resolve to a Glossary entry, a Pattern-conformance-index row, or the allowlist:\n`,
    );
    for (const term of result.missing) process.stderr.write(`  - ${term}\n`);
    process.stderr.write(
      [
        "",
        "Fix options:",
        "  1. Add the term to the Glossary table in vision.md (preferred for prose terms — rule #5).",
        "  2. Add a row to the Pattern conformance index (preferred for class/interface/package names — rule #8).",
        "  3. If the term is a standard CS / web acronym or a third-party",
        "     package name, add it to scripts/glossary-allowlist.txt with a",
        "     one-line '#' justification.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  process.stdout.write(
    `rule-5 ok: ${result.candidates.length} coined-shape backticked term(s) all resolve to a Glossary entry, a Pattern-index row, or the allowlist.\n`,
  );
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
