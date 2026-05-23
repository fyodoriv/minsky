#!/usr/bin/env node
// Pattern: deterministic milestone-alignment gate (vision.md § 15 milestone
// alignment, vision.md § 10 deterministic enforcement). Slice (a) of the
// `milestone-alignment-gate-enforcement` P0.
//
// Source: operator directive 2026-05-18 (verbatim: "ensure milestones are
// always aligned with readme, quickstart, vision, user stories, integration
// tests, logs + observability, and metrics — these are #1 priority in all
// minsky work"); rule #10 (deterministic enforcement — every milestone
// criterion must have all surfaces aligned or a tracked gap); rule #15
// (milestone alignment gate, AGENTS.md § 15); Forsgren/Humble/Kim 2018,
// *Accelerate* (measure what matters — a metric that's a stub isn't
// measured).
//
// Conformance: full — pure function over parsed markdown, no LLM in the
// chain. The script reads MILESTONES.md + docs/METRICS.md +
// user-stories/*.md + README.md, performs five surface checks per
// criterion, exits 0 by default (informational) or non-zero with `--strict`
// when fewer than `--min-aligned` criteria pass all five checks.
//
// Why this gate exists: today (audited 2026-05-23) 0/13 M1 exit criteria
// have all 5 surfaces aligned. README claims work that's still partial,
// docs/METRICS.md has 12 `(stub)` entries (10 over the ≤3 target), 8/13 M1
// criteria have no user story file, and only 1 criterion (M1.13) has the
// full chain user-story → integration test → metric → README mention.
// The script makes this gap visible and lets the operator file targeted
// gap-fill tasks per criterion. Subsequent slices wire this into
// `pnpm verify` as a hard gate once the count crosses the ≥10/13 threshold.
//
// Five surfaces checked per milestone criterion:
//   (i)   user-story:  ≥1 file under user-stories/ mentions the criterion
//                      ID (e.g. "M1.1") in its body.
//   (ii)  sections:    that user-story has both `## Metric` and
//                      `## Integration test` H2 sections.
//   (iii) test-file:   the path referenced in the `## Integration test`
//                      section exists on disk.
//   (iv)  metric:      docs/METRICS.md has a `## <metric-id>` section
//                      tagged `Milestone: M1.X` whose `Value:` field is
//                      NOT `(stub)`.
//   (v)   readme:      README.md mentions one of the criterion's key
//                      keywords (derived from the criterion's bold title).
//
// Output modes:
//   - default (text):   per-criterion checklist with ✅/❌ flags and a
//                       summary `Aligned: N/13`.
//   - `--json`:         machine-readable JSON, shape documented in
//                       `reportAlignment` JSDoc below.
//
// Exit codes:
//   - 0 by default (always — informational).
//   - 0 with `--strict` IF `aligned_count >= --min-aligned` (default 10).
//   - 1 with `--strict` when below the threshold (the Success-criterion
//     gate; subsequent slice wires this into pnpm verify).
//
// Pivot (rule #9, this gate): if the markdown-table parser is fragile
// (false negatives on edited rows, format drift from MILESTONES.md
// rewrites), fall back to a hand-maintained `scripts/milestone-
// alignment.config.json` that lists each criterion + its expected
// artifacts. Same checks, just hand-curated data source. Don't lower the
// 5-surface bar.

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * @typedef {{id: string, description: string, status: string, statusText: string, verify: string}} Criterion
 * @typedef {{id: string, title: string, criteria: Criterion[]}} Milestone
 * @typedef {{id: string, milestone: string|null, valueIsStub: boolean, rawValue: string}} MetricEntry
 * @typedef {{milestones: Milestone[], current: Milestone|null, inTable: boolean, sawHeader: boolean}} ParseState
 * @typedef {{userStoryFiles: string[], readUserStory: (file: string) => string, fileExists?: (path: string) => boolean, readmeContent?: string}} Surfaces
 * @typedef {{metrics: MetricEntry[]}} ParsedSurfaces
 * @typedef {{userStory: {ok: boolean, files: string[]}, sections: {ok: boolean, missing: string[]}, testFile: {ok: boolean, path: string|null, exists: boolean}, metric: {ok: boolean, metricIds: string[], hasStub: boolean}, readme: {ok: boolean, matchedKeywords: string[]}, allAligned: boolean}} CriterionResult
 */

// ---------- parsers ----------

/**
 * Parse MILESTONES.md and return all milestone tables.
 * @param {string} content
 * @returns {Array<{id: string, title: string, criteria: Array<{id: string, description: string, status: string, statusText: string, verify: string}>}>}
 */
export function parseMilestonesMd(content) {
  /** @type {ParseState} */
  const state = {
    milestones: [],
    current: null,
    inTable: false,
    sawHeader: false,
  };
  for (const raw of content.split("\n")) {
    parseMilestonesLine(raw.trim(), state);
  }
  if (state.current) state.milestones.push(state.current);
  return state.milestones;
}

/**
 * @param {string} line
 * @param {ParseState} state
 */
function parseMilestonesLine(line, state) {
  if (handleMilestoneHeader(line, state)) return;
  if (!state.current) return;
  if (handleTableHeader(line, state)) return;
  if (state.inTable) handleTableRow(line, state);
}

/**
 * @param {string} line
 * @param {ParseState} state
 * @returns {boolean}
 */
function handleMilestoneHeader(line, state) {
  const header = line.match(/^## (M\d+)\b\s*—?\s*(.+)$/);
  if (!header || !header[1] || !header[2]) return false;
  if (state.current) state.milestones.push(state.current);
  state.current = { id: header[1], title: header[2].trim(), criteria: [] };
  state.inTable = false;
  state.sawHeader = false;
  return true;
}

/**
 * @param {string} line
 * @param {ParseState} state
 * @returns {boolean}
 */
function handleTableHeader(line, state) {
  if (line.startsWith("|") && line.includes("Criterion")) {
    state.sawHeader = true;
    return true;
  }
  if (state.sawHeader && line.match(/^\|\s*-+/)) {
    state.inTable = true;
    return true;
  }
  return false;
}

/**
 * @param {string} line
 * @param {ParseState} state
 */
function handleTableRow(line, state) {
  if (!line.startsWith("|")) {
    state.inTable = false;
    state.sawHeader = false;
    return;
  }
  const criterion = parseCriterionRow(line);
  if (criterion && state.current) state.current.criteria.push(criterion);
}

/**
 * @param {string} line
 * @returns {Criterion|null}
 */
function parseCriterionRow(line) {
  // Row: | M1.1 | description | status | verify |
  // Some milestones (M2+) have only 3 columns (no Status). Tolerate either.
  const cells = splitTableRow(line);
  const id = cells[0]?.trim();
  if (!id || !/^M\d+\.\d+$/.test(id)) return null;
  const description = cells[1]?.trim() ?? "";
  const fourCol = cells.length >= 4;
  const statusRaw = fourCol ? (cells[2]?.trim() ?? "") : "";
  const verify = fourCol ? (cells[3]?.trim() ?? "") : (cells[2]?.trim() ?? "");
  return {
    id,
    description,
    status: statusFromEmoji(statusRaw),
    statusText: statusRaw,
    verify,
  };
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  // Pipe-split with escape handling: `\|` in cells is rare in our table but
  // we tolerate it for robustness. Trim the outer pipes.
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let buf = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      buf += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  return cells;
}

/**
 * Map a MILESTONES.md status cell to canonical token.
 * @param {string} cell
 * @returns {"done"|"partial"|"blocked"|"not-started"|"unknown"}
 */
export function statusFromEmoji(cell) {
  if (cell.includes("✅")) return "done";
  if (cell.includes("🟡")) return "partial";
  if (cell.includes("❌")) return "blocked";
  if (cell.includes("🔵")) return "not-started";
  return "unknown";
}

/**
 * Parse docs/METRICS.md and return each metric with its milestone tag and
 * value-stub status.
 * @param {string} content
 * @returns {MetricEntry[]}
 */
export function parseMetricsMd(content) {
  const sections = content.split(/^## /m).slice(1); // first chunk is preamble
  /** @type {MetricEntry[]} */
  const metrics = [];
  for (const section of sections) {
    const firstLine = section.split("\n")[0] ?? "";
    const idMatch = firstLine.match(/^([a-z0-9-]+)\b/);
    if (!idMatch || !idMatch[1]) continue;
    const id = idMatch[1];
    // Look for `Milestone: M1.X` (italic _Budget: 7d · Milestone: M1.1_ pattern)
    const milestoneMatch = section.match(/Milestone:\s*(M\d+(?:\.\d+)?)/);
    const milestone = milestoneMatch?.[1] ?? null;
    // Look for `**Value:** ...`
    const valueMatch = section.match(/\*\*Value:\*\*\s*(.+?)(?:\n|$)/);
    const rawValue = valueMatch?.[1]?.trim() ?? "";
    const valueIsStub = rawValue.startsWith("(stub)");
    metrics.push({ id, milestone, valueIsStub, rawValue });
  }
  return metrics;
}

/**
 * Find all user-stories/*.md files that mention a given criterion ID (e.g.
 * "M1.13") in their body. Returns the relative paths.
 * @param {string} criterionId
 * @param {Surfaces} surfaces
 * @returns {string[]}
 */
export function findUserStoriesForCriterion(criterionId, surfaces) {
  const matches = [];
  for (const file of surfaces.userStoryFiles) {
    const content = surfaces.readUserStory(file);
    // Word-boundary match so "M1.1" doesn't match "M1.13".
    const escaped = criterionId.replace(/\./g, "\\.");
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(content)) matches.push(file);
  }
  return matches;
}

/**
 * Extract the integration-test file path from a user story's `## Integration
 * test` section. Looks for the first `**File**:` or backticked path that
 * resembles a test file. Returns null if not found.
 * @param {string} userStoryContent
 * @returns {string|null}
 */
export function extractTestFilePath(userStoryContent) {
  const integrationIdx = userStoryContent.indexOf("## Integration test");
  if (integrationIdx === -1) return null;
  const section = userStoryContent.slice(integrationIdx);
  const nextH2 = section.slice(2).indexOf("\n## ");
  const sectionBody = nextH2 === -1 ? section : section.slice(0, nextH2 + 2);
  // Try `**File**: <path>` first; then bare backticked path that contains `.test.`.
  const fileFieldMatch = sectionBody.match(/\*\*File\*\*:\s*`([^`]+)`/);
  if (fileFieldMatch?.[1]) return fileFieldMatch[1];
  const testPathMatch = sectionBody.match(/`([^`]+\.test\.[a-z]+)`/);
  if (testPathMatch?.[1]) return testPathMatch[1];
  return null;
}

/**
 * Extract keywords from a criterion description for README mention check.
 * Strategy: take bold-faced phrases (between `**...**`) and noun-like
 * lowercase words ≥6 chars. Strip common words.
 * @param {string} description
 * @returns {string[]}
 */
export function extractCriterionKeywords(description) {
  /** @type {Set<string>} */
  const keywords = new Set();
  // Bold phrases — these are the headline keywords (rule #15: bold = canonical).
  const boldMatches = description.matchAll(/\*\*([^*]+)\*\*/g);
  for (const m of boldMatches) {
    const phrase = m[1]?.toLowerCase() ?? "";
    if (!phrase) continue;
    // Capture multi-word phrases verbatim AND individual ≥5-char words.
    keywords.add(phrase);
    for (const word of phrase.split(/\s+/)) {
      if (word.length >= 5 && !COMMON_WORDS.has(word)) keywords.add(word);
    }
  }
  return [...keywords];
}

const COMMON_WORDS = new Set([
  "every",
  "across",
  "without",
  "anywhere",
  "everything",
  "remove",
  "removes",
  "minsky",
  "any",
  "with",
  "from",
  "into",
  "machine",
  "first",
  "session",
  "uptime",
  "default",
  "review",
  "where",
  "level",
  "ready",
]);

// ---------- checks ----------

/**
 * Check (ii): each matching user-story has `## Metric` AND `## Integration
 * test` sections. Returns `{ ok: true }` if ANY matching story has both.
 * @param {string[]} matchingStories
 * @param {Surfaces} surfaces
 * @returns {{ok: boolean, missing: string[]}}
 */
function checkSectionsSurface(matchingStories, surfaces) {
  if (matchingStories.length === 0) return { ok: false, missing: ["no-user-story"] };
  const allMissing = [];
  for (const file of matchingStories) {
    const content = surfaces.readUserStory(file);
    const local = [];
    if (!/^## Metric\b/m.test(content)) local.push("## Metric");
    if (!/^## Integration test\b/m.test(content)) local.push("## Integration test");
    if (local.length === 0) return { ok: true, missing: [] };
    allMissing.push(...local.map((s) => `${file}: ${s}`));
  }
  return { ok: false, missing: [...new Set(allMissing)] };
}

/**
 * Check (iii): the path referenced in `## Integration test` exists on disk.
 * @param {string[]} matchingStories
 * @param {Surfaces} surfaces
 * @returns {{ok: boolean, path: string|null, exists: boolean}}
 */
function checkTestFileSurface(matchingStories, surfaces) {
  for (const file of matchingStories) {
    const content = surfaces.readUserStory(file);
    const path = extractTestFilePath(content);
    if (!path) continue;
    const exists = surfaces.fileExists?.(path) ?? false;
    if (exists) return { ok: true, path, exists: true };
    // Remember the first found path even if it doesn't exist (so the report
    // tells the reader what the user story claimed).
    return { ok: false, path, exists: false };
  }
  return { ok: false, path: null, exists: false };
}

/**
 * Check (iv): docs/METRICS.md has a non-stub metric tagged with the
 * criterion's milestone ID.
 * @param {string} criterionId
 * @param {MetricEntry[]} metrics
 * @returns {{ok: boolean, metricIds: string[], hasStub: boolean}}
 */
function checkMetricSurface(criterionId, metrics) {
  const tagged = metrics.filter((m) => m.milestone === criterionId);
  const nonStub = tagged.filter((m) => !m.valueIsStub);
  return {
    ok: tagged.length > 0 && nonStub.length > 0,
    metricIds: tagged.map((m) => m.id),
    hasStub: tagged.some((m) => m.valueIsStub),
  };
}

/**
 * Run the five surface checks for a single criterion.
 * @param {{id: string, description: string}} criterion
 * @param {ParsedSurfaces} parsedSurfaces
 * @param {Surfaces} surfaces
 * @returns {CriterionResult}
 */
export function checkCriterion(criterion, parsedSurfaces, surfaces) {
  const matchingStories = findUserStoriesForCriterion(criterion.id, surfaces);
  const userStory = { ok: matchingStories.length > 0, files: matchingStories };
  const sections = checkSectionsSurface(matchingStories, surfaces);
  const testFile = checkTestFileSurface(matchingStories, surfaces);
  const metric = checkMetricSurface(criterion.id, parsedSurfaces.metrics);

  // (v) README mentions a criterion keyword
  const keywords = extractCriterionKeywords(criterion.description);
  const readmeContent = surfaces.readmeContent ?? "";
  const matched = keywords.filter((kw) => readmeContent.toLowerCase().includes(kw.toLowerCase()));
  const readme = { ok: matched.length > 0, matchedKeywords: matched };

  const allAligned = userStory.ok && sections.ok && testFile.ok && metric.ok && readme.ok;

  return { userStory, sections, testFile, metric, readme, allAligned };
}

/**
 * Run all five checks for every criterion in a milestone and aggregate.
 * @param {Milestone} milestone
 * @param {ParsedSurfaces} parsedSurfaces
 * @param {Surfaces} surfaces
 * @returns {{
 *   milestone: string,
 *   total: number,
 *   aligned_count: number,
 *   gaps: Record<string, {criterion: string, missing: string[]}>,
 *   per_criterion: Record<string, CriterionResult>,
 * }}
 */
export function reportAlignment(milestone, parsedSurfaces, surfaces) {
  /** @type {Record<string, CriterionResult>} */
  const per_criterion = {};
  /** @type {Record<string, {criterion: string, missing: string[]}>} */
  const gaps = {};
  let aligned_count = 0;
  for (const criterion of milestone.criteria) {
    const result = checkCriterion(criterion, parsedSurfaces, surfaces);
    per_criterion[criterion.id] = result;
    if (result.allAligned) {
      aligned_count++;
    } else {
      gaps[criterion.id] = {
        criterion: criterion.description,
        missing: listMissingSurfaces(result),
      };
    }
  }
  return {
    milestone: milestone.id,
    total: milestone.criteria.length,
    aligned_count,
    gaps,
    per_criterion,
  };
}

/**
 * @param {CriterionResult} result
 * @returns {string[]}
 */
function listMissingSurfaces(result) {
  const missing = [];
  if (!result.userStory.ok) missing.push("user-story");
  if (!result.sections.ok) missing.push("sections");
  if (!result.testFile.ok) missing.push("integration-test");
  if (!result.metric.ok) missing.push("metric");
  if (!result.readme.ok) missing.push("readme-mention");
  return missing;
}

// ---------- CLI ----------

/**
 * @param {Milestone[]} milestones
 * @returns {Milestone|null}
 */
function pickActiveMilestone(milestones) {
  // Active = first milestone that isn't fully done OR has criteria with
  // statuses (i.e. not just the M2+ "How to verify"-only tables).
  for (const m of milestones) {
    const hasStatuses = m.criteria.some((c) => c.status !== "unknown");
    if (!hasStatuses) continue; // Only count milestones whose table has statuses (M1 today).
    if (m.criteria.some((c) => c.status !== "done")) return m;
  }
  return milestones.find((m) => m.criteria.some((c) => c.status !== "unknown")) ?? null;
}

/**
 * @param {ReturnType<typeof reportAlignment>} report
 * @returns {string}
 */
function renderText(report) {
  const header = [
    `Milestone: ${report.milestone}`,
    `Aligned: ${report.aligned_count} / ${report.total}`,
    "",
  ];
  const rows = Object.entries(report.per_criterion).map(([id, result]) =>
    renderCriterionLine(id, result),
  );
  return [...header, ...rows].join("\n");
}

/**
 * @param {string} id
 * @param {CriterionResult} result
 * @returns {string}
 */
function renderCriterionLine(id, result) {
  const mark = result.allAligned ? "✅" : "❌";
  /** @type {Array<[string, boolean]>} */
  const fields = [
    ["user-story", result.userStory.ok],
    ["sections", result.sections.ok],
    ["test-file", result.testFile.ok],
    ["metric", result.metric.ok],
    ["readme", result.readme.ok],
  ];
  const checks = fields.map(([name, ok]) => `${name} ${ok ? "✓" : "✗"}`).join(" · ");
  return `${mark} ${id}: ${checks}`;
}

/**
 * @param {string} [root]
 * @returns {Required<Surfaces>}
 */
export function buildSurfaces(root = ROOT) {
  const userStoriesDir = join(root, "user-stories");
  const userStoryFiles = readdirSync(userStoriesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return {
    userStoryFiles,
    /** @param {string} file */
    readUserStory: (file) => readFileSync(join(userStoriesDir, file), "utf-8"),
    /** @param {string} relPath */
    fileExists: (relPath) => {
      try {
        statSync(join(root, relPath));
        return true;
      } catch {
        return false;
      }
    },
    readmeContent: readFileSync(join(root, "README.md"), "utf-8"),
  };
}

/**
 * @param {string[]} [argv]
 */
export async function main(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  const strict = argv.includes("--strict");
  const minAlignedArg = argv.find((a) => a.startsWith("--min-aligned="));
  const parsedMin = minAlignedArg ? Number.parseInt(minAlignedArg.split("=")[1] ?? "10", 10) : 10;
  const minAligned = Number.isNaN(parsedMin) ? 10 : parsedMin;

  const milestonesContent = readFileSync(join(ROOT, "MILESTONES.md"), "utf-8");
  const milestones = parseMilestonesMd(milestonesContent);
  const active = pickActiveMilestone(milestones);
  if (!active) {
    console.error("No active milestone found in MILESTONES.md");
    process.exit(1);
  }

  const metricsContent = readFileSync(join(ROOT, "docs", "METRICS.md"), "utf-8");
  const metrics = parseMetricsMd(metricsContent);
  const surfaces = buildSurfaces();
  const report = reportAlignment(active, { metrics }, surfaces);

  if (json) {
    console.info(JSON.stringify(report, null, 2));
  } else {
    console.info(renderText(report));
  }

  if (strict && report.aligned_count < minAligned) {
    process.exit(1);
  }
}

// Allow `node scripts/check-milestone-alignment.mjs` direct invocation but
// not when imported (vitest, other scripts). `process.argv[1]` may be a
// relative path while `__filename` is absolute, so we resolve both before
// comparing.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(__filename);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
