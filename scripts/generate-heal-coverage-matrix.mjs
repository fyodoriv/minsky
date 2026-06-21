#!/usr/bin/env node
// generate-heal-coverage-matrix.mjs — produce a coverage matrix comparing
// observed spawn failure classes (from classify-spawn-failures.py) against
// the dispatchable heals in scripts/heal-dispatch.mjs.
//
// Usage:
//   node scripts/generate-heal-coverage-matrix.mjs [--json] [--failures-dir <path>]
//   node scripts/generate-heal-coverage-matrix.mjs --write-md  (writes docs/heal-class-coverage-matrix.md)
//
// Output (JSON mode):
//   { status, window_hours, total_classified, coverage_pct, top10_rows, uncovered_top3 }
//
// where each row in top10_rows is:
//   { failure_class, observed_count, heal_handler, heal_exists }
//
// Pivot: if total_classified < 5 → status = "pending-data" (not enough
// failures yet to compute a meaningful coverage ratio).
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "coverage matrix shows unmatched failure classes for top-3 observed"
//   - "coverage matrix returns pending-data when < 5 failures in window"
//   - "coverage_pct is 0 when no observed class has a dispatch handler"

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const PENDING_THRESHOLD = 5;
const DEFAULT_WINDOW = "7d";

/**
 * Extract heal handler IDs from heal-dispatch.mjs by scanning for
 * `id: "..."` properties inside the builder functions.
 * @param {string} dispatchSrc
 * @returns {string[]}
 */
export function parseHealIds(dispatchSrc) {
  const matches = dispatchSrc.matchAll(/\bid:\s*["']([^"']+)["']/g);
  return /** @type {string[]} */ ([...new Set([...matches].map((m) => m[1]))]);
}

/**
 * Extract known failure class names from classify-spawn-failures.py
 * by scanning the PATTERNS list.
 * @param {string} classifierSrc
 * @returns {string[]}
 */
export function parseKnownPatterns(classifierSrc) {
  const matches = classifierSrc.matchAll(/\(\s*["']([^"']+)["']\s*,\s*r["']/g);
  return /** @type {string[]} */ ([...matches].map((m) => m[1]));
}

/**
 * @typedef {{ failure_class: string; observed_count: number; heal_handler: string | null; heal_exists: boolean }} MatrixRow
 */

/**
 * Build top-10 coverage matrix rows from observed class counts + heal IDs.
 * Includes all observed classes plus unobserved known patterns up to 10 rows.
 * @param {{ observedClasses: Record<string, number>; healIds: string[]; knownPatterns: string[] }} args
 * @returns {MatrixRow[]}
 */
export function buildMatrix({ observedClasses, healIds, knownPatterns }) {
  /** @type {MatrixRow[]} */
  const rows = [];

  // Observed classes sorted by count descending.
  for (const [cls, count] of Object.entries(observedClasses)) {
    const matchingHeal = healIds.find((id) => id === cls || id.includes(cls) || cls.includes(id));
    rows.push({
      failure_class: cls,
      observed_count: count,
      heal_handler: matchingHeal ?? null,
      heal_exists: matchingHeal !== undefined,
    });
  }

  // Pad with unobserved known patterns so the matrix has substance even
  // when real data is sparse. Skip patterns already included above.
  const observedSet = new Set(Object.keys(observedClasses));
  for (const pattern of knownPatterns) {
    if (rows.length >= 10) break;
    if (observedSet.has(pattern)) continue;
    const matchingHeal = healIds.find(
      (id) => id === pattern || id.includes(pattern) || pattern.includes(id),
    );
    rows.push({
      failure_class: pattern,
      observed_count: 0,
      heal_handler: matchingHeal ?? null,
      heal_exists: matchingHeal !== undefined,
    });
  }

  return rows.slice(0, 10);
}

/**
 * Compute coverage_pct over observed-only rows (count > 0).
 * Returns 0 when no observed classes exist to avoid division-by-zero.
 * @param {MatrixRow[]} rows
 * @returns {number}
 */
export function computeCoveragePct(rows) {
  const observed = rows.filter((r) => r.observed_count > 0);
  if (observed.length === 0) return 0;
  const covered = observed.filter((r) => r.heal_exists);
  return covered.length / observed.length;
}

/**
 * Render the matrix as a markdown table.
 * @param {MatrixRow[]} rows
 * @param {{ status: string; coverage_pct: number; total_classified: number; window_hours: number }} meta
 * @returns {string}
 */
export function renderMarkdown(rows, { status, coverage_pct, total_classified, window_hours }) {
  const ts = new Date().toISOString().slice(0, 10);
  const lines = [
    "# Heal-Class Coverage Matrix",
    "",
    `_Generated ${ts} · window ${window_hours}h · ${total_classified} classified failures · status: ${status}_`,
    "",
  ];

  if (status === "pending-data") {
    lines.push(
      "> **Pending data** — fewer than 5 spawn failures in the 7-day window.",
      "> Re-run after the next 24h to accumulate more observations.",
      "",
      "Coverage measurement will be available once ≥5 failures are classified.",
    );
    return lines.join("\n");
  }

  lines.push(
    `**heal-class coverage:** ${Math.round(coverage_pct * 100)}% of observed failure classes have a dispatch handler`,
    "",
    "| failure_class | observed_count | heal_handler | heal_exists |",
    "|---|---|---|---|",
  );

  for (const row of rows) {
    lines.push(
      `| ${row.failure_class} | ${row.observed_count} | ${row.heal_handler ?? "—"} | ${row.heal_exists ? "✅" : "❌"} |`,
    );
  }

  lines.push("", "## Uncovered observed classes", "");

  const uncovered = rows.filter((r) => r.observed_count > 0 && !r.heal_exists);
  if (uncovered.length === 0) {
    lines.push("All observed failure classes have a dispatch handler.");
  } else {
    for (const row of uncovered) {
      const slug = row.failure_class.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      lines.push(
        `- **${row.failure_class}** (${row.observed_count} occurrences) — no heal handler → file \`heal-${slug}\` task`,
      );
    }
  }

  lines.push(
    "",
    "## Dispatchable heal catalog",
    "",
    "_Source: `scripts/heal-dispatch.mjs` `buildPreWalkHeals` + `buildPreSpawnHeals`_",
    "",
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Run classify-spawn-failures.py and return parsed JSON.
 * @param {{ failuresDir?: string; windowSpec?: string; python3?: string }} opts
 * @returns {{ window_hours: number; total_classified: number; total_failures: number; top_class: string | null; classes: Record<string, number> }}
 */
export function runClassifier({
  failuresDir,
  windowSpec = DEFAULT_WINDOW,
  python3 = "/usr/bin/python3",
}) {
  const classifierScript = join(REPO_ROOT, "scripts", "classify-spawn-failures.py");
  const cliArgs = ["--window", windowSpec, "--json"];
  if (failuresDir) {
    cliArgs.push("--failures-dir", failuresDir);
  }
  try {
    const stdout = execFileSync(python3, [classifierScript, ...cliArgs], {
      encoding: "utf8",
      timeout: 15_000,
    });
    return JSON.parse(stdout);
  } catch (err) {
    const e = /** @type {{ stdout?: string; message?: string }} */ (err);
    throw new Error(
      `classify-spawn-failures.py failed: ${e.message ?? "unknown"}\n${e.stdout ?? ""}`,
    );
  }
}

/**
 * Main entry: build the coverage matrix JSON.
 * @param {{ failuresDir?: string; windowSpec?: string; python3?: string }} opts
 * @returns {{ status: string; window_hours: number; total_classified: number; coverage_pct: number; top10_rows: MatrixRow[]; uncovered_top3: MatrixRow[] }}
 */
export function buildCoverageMatrix({
  failuresDir,
  windowSpec = DEFAULT_WINDOW,
  python3 = "/usr/bin/python3",
}) {
  const dispatchSrc = readFileSync(join(REPO_ROOT, "scripts", "heal-dispatch.mjs"), "utf8");
  const classifierSrc = readFileSync(
    join(REPO_ROOT, "scripts", "classify-spawn-failures.py"),
    "utf8",
  );

  const healIds = parseHealIds(dispatchSrc);
  const knownPatterns = parseKnownPatterns(classifierSrc);

  const classified = runClassifier({
    ...(failuresDir !== undefined ? { failuresDir } : {}),
    windowSpec,
    python3,
  });
  const totalClassified = classified.total_classified ?? classified.total_failures ?? 0;

  if (totalClassified < PENDING_THRESHOLD) {
    return {
      status: "pending-data",
      window_hours: classified.window_hours,
      total_classified: totalClassified,
      coverage_pct: 0,
      top10_rows: [],
      uncovered_top3: [],
    };
  }

  const top10Rows = buildMatrix({
    observedClasses: classified.classes,
    healIds,
    knownPatterns,
  });

  const coveragePct = computeCoveragePct(top10Rows);

  const uncoveredTop3 = top10Rows.filter((r) => r.observed_count > 0 && !r.heal_exists).slice(0, 3);

  return {
    status: "ok",
    window_hours: classified.window_hours,
    total_classified: totalClassified,
    coverage_pct: coveragePct,
    top10_rows: top10Rows,
    uncovered_top3: uncoveredTop3,
  };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const cliArgs = process.argv.slice(2);
  const jsonMode = cliArgs.includes("--json");
  const writeMd = cliArgs.includes("--write-md");
  let failuresDir = /** @type {string | undefined} */ (undefined);
  let windowSpec = DEFAULT_WINDOW;
  let python3 = "/usr/bin/python3";

  for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if (a === "--failures-dir") {
      failuresDir = cliArgs[++i];
    } else if (a?.startsWith("--failures-dir=")) {
      failuresDir = a.slice("--failures-dir=".length);
    } else if (a === "--window") {
      windowSpec = cliArgs[++i] ?? DEFAULT_WINDOW;
    } else if (a?.startsWith("--window=")) {
      windowSpec = a.slice("--window=".length);
    } else if (a === "--python3") {
      python3 = cliArgs[++i] ?? python3;
    } else if (a?.startsWith("--python3=")) {
      python3 = a.slice("--python3=".length);
    }
  }

  try {
    const result = buildCoverageMatrix({
      ...(failuresDir !== undefined ? { failuresDir } : {}),
      windowSpec,
      python3,
    });

    if (writeMd) {
      const md = renderMarkdown(result.top10_rows, {
        status: result.status,
        coverage_pct: result.coverage_pct,
        total_classified: result.total_classified,
        window_hours: result.window_hours,
      });
      const mdPath = join(REPO_ROOT, "docs", "heal-class-coverage-matrix.md");
      writeFileSync(mdPath, md);
      console.error(`heal-coverage-matrix: wrote ${mdPath}`);
    }

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const { status, total_classified, coverage_pct, top10_rows, uncovered_top3 } = result;
      console.info(`status: ${status}`);
      console.info(`total_classified: ${total_classified}`);
      console.info(`coverage_pct: ${Math.round(coverage_pct * 100)}%`);
      if (top10_rows.length > 0) {
        console.info("\nMatrix:");
        for (const row of top10_rows) {
          const indicator = row.heal_exists ? "✅" : "❌";
          console.info(
            `  ${indicator} ${row.failure_class} (${row.observed_count}) → ${row.heal_handler ?? "no handler"}`,
          );
        }
      }
      if (uncovered_top3.length > 0) {
        console.info("\nTop unmatched (file P0 heal tasks for these):");
        for (const row of uncovered_top3) {
          console.info(`  ${row.failure_class} (${row.observed_count} occurrences)`);
        }
      }
    }
  } catch (err) {
    console.error(`heal-coverage-matrix: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
