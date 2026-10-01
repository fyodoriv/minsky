/**
 * `@minsky/mape-k-loop/cost-schedule` — parser for the per-rule cost-weight
 * schedule consumed by the {@link analyze} phase.
 *
 * The Theory of Constraints picks the rule whose `violationCount × cost` is
 * highest (Goldratt, *The Goal*, 1984). The v0 Analyze phase shipped with the
 * identity schedule (every rule = 1), which over-collapses high-volume
 * low-severity rules (typo lints) against rare high-severity rules (rule-#9
 * pre-registration misses). This module is the upstream of `analyze`'s
 * `costs` argument: the CLI wrapper around `tick(...)` reads `vision.md`
 * once at startup, parses the `## Cost schedule` markdown table with
 * {@link parseCostSchedule}, and threads the result through.
 *
 * Pure function. The CLI wrapper is the I/O boundary (Martin, *Clean
 * Architecture*, 2017 — every input is data, every output is data).
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - This module:              MAPE-K Analyze cost-weight upstream (rule #4
 *                               "every constant in source"). Conformance: full
 *                               for the markdown-table parser; the schedule is
 *                               sourced from `vision.md` § "Cost schedule".
 *   - `parseCostSchedule(...)`: Pure regex-based parser over a fixed-shape
 *                               markdown table; returns an empty schedule
 *                               when the section is missing (graceful-degrade
 *                               per rule #7 — a missing schedule means every
 *                               rule = 1, which is the v0 default).
 *
 * @module mape-k-loop/cost-schedule
 */

import type { CostSchedule } from "./analyze.js";

/**
 * Parse the `## Cost schedule` markdown table from a vision.md document.
 *
 * Expected shape (the section heading is matched case-sensitively; the
 * column order is fixed — `Rule ID | Cost weight | Rationale`):
 *
 * ```markdown
 * ## Cost schedule
 *
 * <prose paragraph(s)>
 *
 * | Rule ID  | Cost weight | Rationale ... |
 * |----------|-------------|---------------|
 * | rule-9   | 100         | ...           |
 * | rule-7   | 50          | ...           |
 * ```
 *
 * Returns an empty schedule (`{}`) when:
 *   - the `## Cost schedule` heading is absent, or
 *   - the heading is present but no parseable table follows.
 *
 * Rows whose cost weight is non-numeric, non-finite, or `≤ 0` are dropped
 * (graceful-degrade per rule #7 — a misconfigured weight should not zero
 * out a real constraint; `costEstimate(...)` falls back to
 * `DEFAULT_RULE_COST` for any rule absent from the schedule).
 *
 * @otel-exempt pure parser; the CLI wrapper carries the OTEL span.
 */
export function parseCostSchedule(visionMdContent: string): CostSchedule {
  const section = extractCostScheduleSection(visionMdContent);
  if (section === null) return {};
  return parseScheduleTable(section);
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/**
 * Slice the substring beginning at `## Cost schedule` and ending at the
 * next top-level `## ` heading (or end-of-file). Returns `null` when the
 * heading is absent.
 *
 * @otel-exempt pure helper.
 */
function extractCostScheduleSection(content: string): string | null {
  const start = content.search(/^## Cost schedule\s*$/m);
  if (start < 0) return null;
  const tail = content.slice(start);
  const next = tail.slice(2).search(/^## /m); // skip own `## ` then look ahead
  if (next < 0) return tail;
  return tail.slice(0, next + 2);
}

/**
 * Walk the lines of a `## Cost schedule` section, locate the markdown table
 * by its `|---|---|---|` divider, and extract each `| ruleId | weight | ... |`
 * data row. Pre-divider header rows and post-divider non-table lines are
 * ignored.
 *
 * @otel-exempt pure helper.
 */
function parseScheduleTable(section: string): CostSchedule {
  const lines = section.split("\n");
  const dividerIdx = lines.findIndex(isTableDivider);
  if (dividerIdx < 0) return {};
  const schedule: Record<string, number> = {};
  for (let i = dividerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!isDataRow(line)) break; // table ends at the first non-table line
    const entry = parseDataRow(line);
    if (entry !== null) schedule[entry.ruleId] = entry.weight;
  }
  return schedule;
}

/**
 * Extract `{ ruleId, weight }` from one data row, or `null` when the row
 * has too few cells, an empty ruleId, or an unusable weight.
 *
 * @otel-exempt pure helper.
 */
function parseDataRow(line: string): { ruleId: string; weight: number } | null {
  const cells = splitRow(line);
  if (cells.length < 2) return null;
  const ruleId = (cells[0] ?? "").trim();
  const weight = parseWeight(cells[1] ?? "");
  if (ruleId.length === 0 || weight === null) return null;
  return { ruleId, weight };
}

/** @otel-exempt pure helper. */
function isTableDivider(line: string): boolean {
  // `|---|---|---|` (with optional whitespace and `:` alignment markers).
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

/** @otel-exempt pure helper. */
function isDataRow(line: string): boolean {
  // A data row starts with `|` (after any indentation) and contains at
  // least one further `|`. Empty lines and prose terminate the table.
  if (!/^\s*\|/.test(line)) return false;
  return (line.match(/\|/g) ?? []).length >= 2;
}

/** @otel-exempt pure helper. */
function splitRow(line: string): readonly string[] {
  // Strip the leading and trailing `|` (if present), then split on `|`.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|");
}

/**
 * Parse a cell into a positive finite number, or return `null` for
 * unusable inputs. Aligns with `costEstimate(...)`'s fallback semantics.
 *
 * @otel-exempt pure helper.
 */
function parseWeight(cell: string): number | null {
  const trimmed = cell.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
