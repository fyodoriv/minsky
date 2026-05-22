#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over the rendered `METRICS.md` artefact
//   (rule #10 — same input, same output; no LLM in the chain). Mirrors
//   `check-pr-self-grade.mjs` shape: pure decision + thin CLI.
// Source: `canonical-metric-list-per-repo` task — acceptance criteria
//   (2) "freshness lint blocks stale in CI" + (5) "no-vanity guard
//   catches monotonic-without-annotation". Substrate slice 2/N (the
//   builder + genesis shipped in slice 1; vision.md row 82).
// Anchor: Munafò et al. 2017 (pre-registration — every metric carries
//   its `freshnessBudgetMs` *before* observation, so "stale" is
//   defined ahead of time, not chosen post-hoc); Ries 2011, Ch. 7
//   (vanity metrics — counts that always go up; the explicit
//   `_monotonic: ok_` annotation is the opt-in escape valve);
//   Helland 2007 (visible-not-silent — `(stub)` is a valid signal,
//   silent-zero is not).
// Conformance: full — pure function over the markdown text + clock,
//   no I/O at the decision boundary.
//
// Required `METRICS.md` shape (one section per metric, separated by
// `## <id> — <label>` headings):
//
//   ## <id> — <label>
//
//   _Updated: <iso-utc> · Budget: <N>(d|h)( · Source: `<path>`)?( · _monotonic: ok_)?_
//
//   **Value:** <number> <unit>
//
//   Formula: `…`
//
// OR for stubs (no observation captured yet):
//
//   ## <id> — <label>
//
//   _Budget: <N>(d|h)( · _monotonic: ok_)?_
//
//   **Value:** (stub) — <reason>
//
//   Formula: `…`
//
// Failure cases:
//   1. A section's `**Value:**` is a real value (not `(stub)`), but
//      there is no `_Updated: <iso>` line — the value is unannotated.
//   2. A section's `_Updated:` timestamp is older than its
//      `_Budget:` window — the value is stale.
//   3. A section is missing the `_Budget:` annotation entirely —
//      malformed render.
//   4. (Optional, when expected ids are supplied) a section is
//      missing for an expected metric id, OR the rendered ids carry
//      duplicates — the artefact has drifted from `SUCCESS_METRICS`.
//
// `(stub)` sections are accepted unconditionally — they are the
// explicit "no observation yet" signal (Helland 2007). If a stub
// goes stale relative to its target, the daemon's daily-refresh
// wire-in is the load-bearing fix, not this lint.
//
// Pivot (rule #9): if this gate produces ≥3 false positives in its
// first month from legitimately-stale-but-known stubs, tighten the
// scope to "non-stub sections only" rather than retiring the gate.

import process from "node:process";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Heading: `## <id> — <label>` where id is kebab-case (matches
// `generate-metrics-md.mjs`'s render). The em-dash is the section
// shape's separator; ASCII `--` would be a render bug.
const SECTION_HEADING_RE = /^##[ \t]+([a-z0-9][a-z0-9-]*)[ \t]+—[ \t]+(.+?)[ \t]*$/m;
const UPDATED_RE = /Updated:[ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/;
const BUDGET_RE = /Budget:[ \t]+(\d+(?:\.\d+)?)(d|h)/;
const VALUE_LINE_RE = /^\*\*Value:\*\*[ \t]+(.+)$/m;
const STUB_PREFIX_RE = /^\(stub\)/;
const MONOTONIC_RE = /_monotonic:[ \t]*ok_/;

/**
 * @typedef {object} ParsedSection
 * @property {string} id
 * @property {string} label
 * @property {string} body
 * @property {number | null} updatedMs
 * @property {number | null} budgetMs
 * @property {string | null} valueLine
 * @property {boolean} isStub
 * @property {boolean} hasMonotonicTag
 */

/**
 * @typedef {object} CheckInput
 * @property {string} markdown   the full `METRICS.md` content
 * @property {number} nowMs      caller-supplied clock (pure)
 * @property {readonly string[]} [expectedIds]  when supplied, the
 *   lint also verifies every id is rendered exactly once
 */

/**
 * @typedef {object} CheckOk
 * @property {true} ok
 * @property {readonly ParsedSection[]} sections
 */
/**
 * @typedef {object} CheckFail
 * @property {false} ok
 * @property {readonly string[]} errors
 * @property {readonly ParsedSection[]} sections
 */
/** @typedef {CheckOk | CheckFail} CheckResult */

/**
 * Split markdown into sections at `## ` boundaries. The text before
 * the first `## ` (the document preamble) is discarded.
 *
 * @param {string} markdown
 * @returns {ParsedSection[]}
 */
/**
 * @param {string} chunk
 * @returns {ParsedSection | null}
 */
function parseChunk(chunk) {
  const heading = chunk.match(SECTION_HEADING_RE);
  if (!heading?.[1] || !heading[2]) return null;
  const updatedMatch = chunk.match(UPDATED_RE);
  const budgetMatch = chunk.match(BUDGET_RE);
  const valueMatch = chunk.match(VALUE_LINE_RE);
  const valueLine = valueMatch?.[1] ? valueMatch[1].trim() : null;
  const updatedMs = updatedMatch?.[1] ? Date.parse(updatedMatch[1]) : null;
  const budgetMs =
    budgetMatch?.[1] && budgetMatch[2] ? parseBudget(budgetMatch[1], budgetMatch[2]) : null;
  return {
    id: heading[1],
    label: heading[2],
    body: chunk,
    updatedMs,
    budgetMs,
    valueLine,
    isStub: valueLine !== null && STUB_PREFIX_RE.test(valueLine),
    hasMonotonicTag: MONOTONIC_RE.test(chunk),
  };
}

/**
 * @param {string} markdown
 * @returns {ParsedSection[]}
 */
function parseSections(markdown) {
  // Split on lines that start with `## ` to get one chunk per metric.
  // Slice(1) drops the preamble.
  const chunks = markdown.split(/^(?=##[ \t]+)/m).slice(1);
  /** @type {ParsedSection[]} */
  const sections = [];
  for (const chunk of chunks) {
    const parsed = parseChunk(chunk);
    if (parsed !== null) sections.push(parsed);
  }
  return sections;
}

/**
 * @param {string} numStr
 * @param {string} unit  "d" | "h"
 * @returns {number}
 */
function parseBudget(numStr, unit) {
  const n = Number(numStr);
  return unit === "d" ? n * DAY_MS : n * HOUR_MS;
}

/**
 * Per-section structural + freshness check. Returns null when the
 * section passes; otherwise the human-readable error string.
 *
 * @param {ParsedSection} s
 * @param {number} nowMs
 * @returns {string | null}
 */
function checkSection(s, nowMs) {
  if (s.valueLine === null) {
    return `section \`${s.id}\` is missing a \`**Value:** …\` line`;
  }
  if (s.budgetMs === null) {
    return `section \`${s.id}\` is missing a \`Budget: <N>(d|h)\` annotation`;
  }
  if (s.isStub) return null; // explicit `(stub)` accepted — visible-not-silent
  if (s.updatedMs === null || Number.isNaN(s.updatedMs)) {
    return `section \`${s.id}\` carries a real value (\`${truncate(s.valueLine, 40)}\`) but no \`_Updated: <iso-utc>\` timestamp — the freshness lint cannot verify it`;
  }
  const ageMs = nowMs - s.updatedMs;
  if (ageMs > s.budgetMs) {
    const iso = new Date(s.updatedMs).toISOString().replace(/\.\d{3}Z$/, "Z");
    return `section \`${s.id}\` is stale: observation is ${humanize(ageMs)} old, budget is ${humanize(s.budgetMs)} (\`_Updated: ${iso}\`)`;
  }
  return null;
}

/**
 * Cross-section: duplicate ids → render bug.
 *
 * @param {readonly ParsedSection[]} sections
 * @returns {string[]}
 */
function findDuplicateIds(sections) {
  const counts = new Map();
  for (const s of sections) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  /** @type {string[]} */
  const errors = [];
  for (const [id, count] of counts) {
    if (count > 1) errors.push(`section \`${id}\` is rendered ${count} times — duplicate id`);
  }
  return errors;
}

/**
 * Cross-section drift detection against the canonical id list.
 *
 * @param {readonly ParsedSection[]} sections
 * @param {readonly string[]} expectedIds
 * @returns {string[]}
 */
function findDrift(sections, expectedIds) {
  const renderedIds = new Set(sections.map((s) => s.id));
  /** @type {string[]} */
  const errors = [];
  for (const id of expectedIds) {
    if (!renderedIds.has(id)) {
      errors.push(`expected metric \`${id}\` is missing from \`METRICS.md\``);
    }
  }
  for (const id of renderedIds) {
    if (!expectedIds.includes(id)) {
      errors.push(
        `unexpected metric \`${id}\` rendered — not present in \`SUCCESS_METRICS\` (drift)`,
      );
    }
  }
  return errors;
}

/**
 * Pure decision. See module header.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkMetricFreshness({ markdown, nowMs, expectedIds }) {
  const sections = parseSections(markdown);
  /** @type {string[]} */
  const errors = [];
  for (const s of sections) {
    const err = checkSection(s, nowMs);
    if (err !== null) errors.push(err);
  }
  errors.push(...findDuplicateIds(sections));
  if (expectedIds !== undefined) errors.push(...findDrift(sections, expectedIds));
  return errors.length === 0 ? { ok: true, sections } : { ok: false, errors, sections };
}

/**
 * @param {number} ms
 * @returns {string}
 */
function humanize(ms) {
  if (ms >= DAY_MS) {
    const days = ms / DAY_MS;
    const rounded = Number.isInteger(days) ? days : days.toFixed(1);
    return `${rounded}d`;
  }
  return `${Math.round(ms / HOUR_MS)}h`;
}

/**
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// ---- CLI thin wrapper ------------------------------------------------
//
// Reads `METRICS.md` from `--input <path>` (default: `./METRICS.md`).
// Optional `--expected <id,id,…>` enables drift detection. `--now <ms>`
// pins the clock for hermetic re-execution; defaults to `Date.now()`.

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ input: string, expected: string[] | null, now: number | null }} */
  const args = { input: "docs/METRICS.md", expected: null, now: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i] ?? args.input;
    else if (a === "--expected") {
      const v = argv[++i] ?? "";
      args.expected = v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (a === "--now") args.now = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { readFile } = await import("node:fs/promises");
  const markdown = await readFile(args.input, "utf8");
  /** @type {CheckInput} */
  const input =
    args.expected !== null
      ? { markdown, nowMs: args.now ?? Date.now(), expectedIds: args.expected }
      : { markdown, nowMs: args.now ?? Date.now() };
  const result = checkMetricFreshness(input);
  if (result.ok) {
    process.stdout.write(`metric-freshness ok: ${result.sections.length} section(s) verified.\n`);
    return 0;
  }
  process.stderr.write("metric-freshness violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Fix paths:",
      "  - For unannotated values: regenerate `METRICS.md` via",
      "    `node scripts/generate-metrics-md.mjs --input <observations.json>`",
      "    so each non-stub section carries `_Updated: <iso-utc>`.",
      "  - For stale observations: capture a fresh observation, OR",
      "    rerender as an explicit `(stub)` (visible-not-silent).",
      "  - For drift: add the new metric to `SUCCESS_METRICS` and",
      "    regenerate, OR remove the unexpected section.",
      "",
      "See vision.md row 82 + TASKS.md `canonical-metric-list-per-repo`.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-metric-freshness.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
