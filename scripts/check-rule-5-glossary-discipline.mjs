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
// camelCase OR contains a dash / dot / slash (Minsky's package / file / id
// naming conventions). Candidates not on the allowlist must appear as a
// resolvable token inside the Glossary section, otherwise the lint fails.
//
// Pivot (rule #9): if this heuristic produces ≥3 false positives per PR,
// switch to "extract terms tagged <coined>…</coined> in HTML comments".

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Section title (text after the `## ` prefix) that hosts the canonical
// glossary table. Compared against the splitSections keys, which strip
// the `## ` prefix.
const GLOSSARY_HEADER = "Glossary — every term has a CS anchor";

// A backticked identifier-shaped token. Permits letters, digits, underscore,
// dot, slash, dash. Trailing slash allowed (e.g., `competitors/`).
const BACKTICK_TOKEN_RE = /`([A-Za-z_][A-Za-z0-9_./-]*)`/g;

// Identifier-shaped token (no backticks) — used to harvest terms from the
// Glossary table cells.
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_./-]*/g;

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
      // Re-key by the canonical full heading (`## …`) for callers that
      // want to compare against GLOSSARY_HEADER.
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
 * a dash, dot, slash, or underscore. Single all-lowercase words like
 * `cost`, `main`, `null` fall through (filtered separately).
 */
function looksCoined(token) {
  if (token.length < 2) return false;
  // contains a structural separator → coined-shaped (kebab / dotted / path)
  if (/[._/-]/.test(token)) return true;
  // PascalCase — starts upper, contains a lower somewhere
  if (/^[A-Z]/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) {
    return true;
  }
  // camelCase — starts lower, contains an upper somewhere
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
 * Returns a sorted-insertion-order set of unique tokens.
 */
function harvestCandidates(body) {
  const out = new Set();
  for (const match of body.matchAll(BACKTICK_TOKEN_RE)) {
    const token = match[1].replace(/\/$/, ""); // strip trailing slash
    if (token.length === 0) continue;
    if (ENGLISH_NOISE.has(token)) continue;
    if (!looksCoined(token)) continue;
    out.add(token);
  }
  return out;
}

/**
 * Pure function: given vision.md text + allowlist, return { missing, candidates }.
 * `missing` is the sorted list of candidate terms that were neither
 * allowlisted nor resolved in the Glossary. `candidates` is the full set of
 * harvested coined-shape backticked identifiers (deduped, sorted) — useful
 * for tests.
 */
export function checkGlossaryDiscipline({ visionMd, allowlist }) {
  const sections = splitSections(visionMd);
  const glossaryBody = sections[GLOSSARY_HEADER];
  if (typeof glossaryBody !== "string") {
    return { missing: [], candidates: [], glossarySectionMissing: true };
  }
  // Resolved set: every identifier-shaped token that appears anywhere in the
  // Glossary section body. We deliberately do *not* restrict to the first
  // table column — many terms are introduced parenthetically (e.g., the
  // backticked `claude-budget-guard` inside the "Watchdog" row). Resolution
  // is "the Glossary mentions you", not "you are the row's primary key".
  const resolved = new Set(glossaryBody.match(TOKEN_RE) ?? []);

  // Harvest backticked tokens from every section EXCEPT the Glossary.
  const candidates = new Set();
  for (const [heading, body] of Object.entries(sections)) {
    if (heading === GLOSSARY_HEADER) continue;
    for (const token of harvestCandidates(body)) candidates.add(token);
  }

  const missing = [...candidates]
    .filter((token) => !allowlist.has(token) && !resolved.has(token))
    .sort();
  return {
    missing,
    candidates: [...candidates].sort(),
    glossarySectionMissing: false,
  };
}

// CLI wrapper. Resolves vision.md + allowlist relative to repo root
// (the parent of the scripts/ directory).
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
      `rule-5 violation: ${result.missing.length} backticked term(s) in vision.md do not resolve to a Glossary entry and are not on the allowlist:\n`,
    );
    for (const term of result.missing) process.stderr.write(`  - ${term}\n`);
    process.stderr.write(
      [
        "",
        "Fix options:",
        "  1. Add the term to the Glossary table in vision.md (preferred — rule #5).",
        "  2. If the term is a standard CS / web acronym or a third-party",
        "     package name, add it to scripts/glossary-allowlist.txt with a",
        "     one-line '#' justification.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  process.stdout.write(
    `rule-5 ok: ${result.candidates.length} coined-shape backticked term(s) all resolve to a Glossary entry or the allowlist.\n`,
  );
}

// Only run main when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
