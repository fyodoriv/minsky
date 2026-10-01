#!/usr/bin/env node
// @ts-check
// audit-fixtures — the Fake Fixture smell (Meszaros 2007) made falsifiable
// for this repo's load-bearing parsers.
//
// PR #494 surfaced a class of bug Meszaros names the "Fake Fixture": a single
// narrow synthetic fixture passed every test for the host-task picker while the
// real parser silently skipped real-world input. Synthetic literals drift away
// from the live format they purport to model, and the test suite stays green
// because it only ever feeds the parser the convenient shape it was written
// against — never the messy real thing.
//
// This script enumerates the repo's load-bearing parser test files and reports,
// per parser, whether the test feeds the parser ONLY from a synthetic literal,
// or ALSO from a real-world-derived fixture (a slice of minsky's own live
// `TASKS.md` / `experiments/*.yaml`, or a brief built from a live task block).
// A test that pairs a synthetic fixture with a real-world-derived one catches
// format drift the synthetic alone never would.
//
// Detection is deterministic and self-documenting: a test file is counted as
// having real-world-fixture coverage when its content carries the literal
// marker `REAL-WORLD FIXTURE:` (a comment the paired-fixture author adds next
// to the assertion that loads live repo data). No heuristic AST walk, no LLM —
// a grep-shaped substring check, so the audit can never disagree with itself
// across runs (rule #10 — deterministic enforcement).
//
// Usage:
//   node scripts/audit-fixtures.mjs [--format=table|json] [--strict] [--help]
//
// Defaults: a human-readable table on stdout, exit 0 (report-only). `--strict`
// exits 1 when fewer than MIN_REAL_WORLD_FIXTURE_PARSERS parsers carry a
// real-world-derived fixture (for CI / a future ratchet). `--format=json`
// emits the Measurement object the task block pre-registered:
//
//   { "parsers": [ { parser, testFile, hasSyntheticFixture,
//                    hasRealWorldFixture } ],
//     "parsersTotal": N, "parsersWithRealWorldFixture": M,
//     "parsersSyntheticOnly": K }
//
// Pattern: pure manifest + injected reader + thin CLI wrapper (matches
// scripts/audit-pass-empty-queue-coverage.mjs / scripts/run-pre-pr-lint-
// stack.mjs — the manifest is the seam, the reader is the boundary, rule #2).
// Conformance: full — `auditFixtures`, `formatTable`, `parseArgs`,
// `hasRealWorldMarker` are exported and unit-tested in
// scripts/audit-fixtures.test.mjs via dependency injection (a fake reader).
// Source: TASKS.md `integration-fixture-fake-fixture-smell-audit`;
//   user-stories/022-fixture-coverage-against-fake-fixture-smell.md;
//   vision.md rule #3 (test-first), rule #10 (deterministic enforcement);
//   Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (Fake Fixture
//   smell — the pattern this addresses); Bentley, J., *Programming Pearls*,
//   2nd ed., 1986 (real-world data drives test design).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/**
 * The literal marker a paired-fixture author adds next to the assertion that
 * loads live repo data. Deterministic detection key (rule #10): a test file
 * carries real-world-fixture coverage iff its content includes this substring.
 */
export const REAL_WORLD_MARKER = "REAL-WORLD FIXTURE:";

/**
 * Pre-registered Success threshold (task block): at least this many of the
 * audited load-bearing parsers must carry a real-world-derived paired fixture.
 */
export const MIN_REAL_WORLD_FIXTURE_PARSERS = 3;

/**
 * @typedef {Object} ParserEntry
 * @property {string} parser     human label for the parser under test
 * @property {string} source     repo-relative path of the parser implementation
 * @property {string} testFile   repo-relative path of the parser's test file
 */

/**
 * The load-bearing parsers this audit tracks. Each row names a parser whose
 * test historically fed it ONLY from a synthetic literal — exactly the Fake
 * Fixture risk PR #494 exposed for the host-task picker.
 *
 * @type {readonly ParserEntry[]}
 */
export const PARSER_MANIFEST = [
  {
    parser: "pick_task.parse_tasks_md (TASKS.md picker)",
    source: "scripts/pick_task.py",
    testFile: "tests/test_pick_task.py",
  },
  {
    parser: "build_brief.render_brief (agent brief builder)",
    source: "scripts/build_brief.py",
    testFile: "tests/test_build_brief.py",
  },
  {
    parser: "experiment-record parse (EXPERIMENT.yaml)",
    source: "novel/experiment-record/src/parse.ts",
    testFile: "novel/experiment-record/src/parse.test.ts",
  },
];

/**
 * @typedef {Object} ParserReport
 * @property {string} parser
 * @property {string} source
 * @property {string} testFile
 * @property {boolean} testFileExists
 * @property {boolean} hasSyntheticFixture
 * @property {boolean} hasRealWorldFixture
 */

/**
 * @typedef {Object} AuditReport
 * @property {ParserReport[]} parsers
 * @property {number} parsersTotal
 * @property {number} parsersWithRealWorldFixture
 * @property {number} parsersSyntheticOnly
 */

/**
 * Pure: does this test-file body carry the real-world-fixture marker?
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasRealWorldMarker(body) {
  return body.includes(REAL_WORLD_MARKER);
}

/**
 * Pure: a test file "has a synthetic fixture" when it contains an inline
 * literal that models the parser's input. We detect the two literal shapes
 * the repo's parser tests use — a triple-quoted Python heredoc assigned to an
 * upper-snake constant (`SAMPLE_TASKS_MD = """..."""`) or an inline
 * backtick/template literal (`parse(\`...\`)` / `fx("...yaml")`). Conservative
 * by construction: a false negative here only understates synthetic coverage,
 * never the real-world count the Measurement gates on.
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasSyntheticMarker(body) {
  if (/[A-Z][A-Z0-9_]*\s*=\s*"""/.test(body)) return true; // Python heredoc literal
  if (/fx\(\s*["']/.test(body)) return true; // experiment-record fixture loader
  if (/parse\(\s*`/.test(body)) return true; // inline template-literal parse input
  return false;
}

/**
 * Pure core: build the per-parser coverage report. I/O is injected via
 * `readFile` so the unit test drives it with a fake reader (rule #2 — the
 * reader is the boundary, the manifest is the seam).
 *
 * @param {object} [opts]
 * @param {readonly ParserEntry[]} [opts.manifest]
 * @param {(path: string) => (string | null)} [opts.readFile] returns file body
 *   or null when the path does not exist
 * @returns {AuditReport}
 */
export function auditFixtures(opts = {}) {
  const manifest = opts.manifest ?? PARSER_MANIFEST;
  const readFile = opts.readFile ?? defaultReadFile;

  /** @type {ParserReport[]} */
  const parsers = manifest.map((entry) => {
    const body = readFile(entry.testFile);
    const testFileExists = body !== null;
    return {
      parser: entry.parser,
      source: entry.source,
      testFile: entry.testFile,
      testFileExists,
      hasSyntheticFixture: testFileExists ? hasSyntheticMarker(body) : false,
      hasRealWorldFixture: testFileExists ? hasRealWorldMarker(body) : false,
    };
  });

  const parsersWithRealWorldFixture = parsers.filter((p) => p.hasRealWorldFixture).length;
  const parsersSyntheticOnly = parsers.filter(
    (p) => p.hasSyntheticFixture && !p.hasRealWorldFixture,
  ).length;

  return {
    parsers,
    parsersTotal: parsers.length,
    parsersWithRealWorldFixture,
    parsersSyntheticOnly,
  };
}

/**
 * Default reader: read a repo-relative path, returning null when absent
 * (graceful-degrade, rule #6 — a missing test file is reported, not crashed on).
 *
 * @param {string} relPath
 * @returns {string | null}
 */
function defaultReadFile(relPath) {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

/**
 * Pure: render the report as a human-readable table.
 *
 * @param {AuditReport} report
 * @returns {string}
 */
export function formatTable(report) {
  const lines = [];
  lines.push("Fixture coverage audit — Fake Fixture smell (Meszaros 2007)");
  lines.push("");
  for (const p of report.parsers) {
    const real = p.hasRealWorldFixture ? "real-world+synthetic" : "synthetic-only";
    const status = p.testFileExists ? real : "MISSING TEST FILE";
    lines.push(`  ${p.hasRealWorldFixture ? "✓" : "·"} ${p.parser}`);
    lines.push(`      test:   ${p.testFile} [${status}]`);
  }
  lines.push("");
  lines.push(
    `  parsers with real-world fixture: ${report.parsersWithRealWorldFixture}/${report.parsersTotal}` +
      ` (threshold ${MIN_REAL_WORLD_FIXTURE_PARSERS})`,
  );
  lines.push(`  synthetic-only parsers:          ${report.parsersSyntheticOnly}`);
  return lines.join("\n");
}

/**
 * Pure: parse argv into options.
 *
 * @param {readonly string[]} argv
 * @returns {{ format: "table" | "json", strict: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const set = new Set(argv);
  const help = set.has("--help") || set.has("-h");
  const strict = set.has("--strict");
  const wantsJson = set.has("--format=json") || set.has("--json");
  const format = /** @type {"table" | "json"} */ (wantsJson ? "json" : "table");
  return { format, strict, help };
}

const HELP_TEXT = `audit-fixtures — Fake Fixture smell audit for load-bearing parsers

Usage:
  node scripts/audit-fixtures.mjs [--format=table|json] [--strict] [--help]

Reports, per parser, whether its test feeds it ONLY a synthetic literal or
ALSO a real-world-derived fixture (a slice of minsky's own live TASKS.md /
experiments/*.yaml). Exit 0 by default (report-only); --strict exits 1 when
fewer than ${MIN_REAL_WORLD_FIXTURE_PARSERS} parsers carry a real-world fixture.`;

/**
 * CLI entry. I/O lives here; the pure core is `auditFixtures` + `formatTable`.
 *
 * @param {readonly string[]} argv
 * @returns {number} process exit code
 */
export function main(argv) {
  const { format, strict, help } = parseArgs(argv);
  if (help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }
  const report = auditFixtures();
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTable(report)}\n`);
  }
  if (strict && report.parsersWithRealWorldFixture < MIN_REAL_WORLD_FIXTURE_PARSERS) {
    process.stderr.write(
      `audit-fixtures: only ${report.parsersWithRealWorldFixture} parser(s) carry a ` +
        `real-world fixture; need ≥${MIN_REAL_WORLD_FIXTURE_PARSERS}.\n`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
