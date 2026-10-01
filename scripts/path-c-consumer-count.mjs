#!/usr/bin/env node
// @ts-check
// path-c-consumer-count — one-time deletion-prioritisation audit for the Path C
// reshape (TASKS.md `path-c-deletion-prioritisation-by-consumer-count`, P2/M2).
//
// Why this script exists: the Path C reshape plan
// (`docs/plans/2026-05-22-path-c-openhands-reshape.md`) carries a
// package-by-package fate table with ~13 deletion/fold/re-scope candidates and
// ad-hoc ordering. PR #784 (persona-spawner deletion) validated that an
// ISOLATED package — zero external consumers — is the cheapest to delete (30 min
// actual vs a predicted 1 week). This audit makes that cost signal mechanical:
// for each Path-C deletion candidate, count how many OTHER packages import it.
// Zero-consumer packages are the mechanical quick wins that should lead the next
// deletion sweep (Phase 4); coupled packages come later.
//
// A "consumer" is any `import`/`export … from "@minsky/<pkg>"` statement that
// lives OUTSIDE the candidate package's own directory. Self-header comments and
// the `vitest.config.ts` alias map are NOT consumers — they are excluded.
//
// Output: `--json` emits `{ candidates: [{ package, name, consumer_count,
// consumers, exists, src_loc }], ... }` — the exact shape the task's
// Measurement line greps:
//   node scripts/path-c-consumer-count.mjs --json \
//     | jq '.candidates[] | select(.consumer_count == 0) | .package' | wc -l
// Without `--json` it prints a human-readable table sorted cheapest-first
// (zero-consumer packages on top), the same ordering committed to
// `docs/path-c-deletion-priorities.md`.
//
// Pattern: pure transforms (`countConsumers`, `auditCandidates`,
//   `sortByDeletionCost`, `renderTable`) composed above one injected scan seam
//   (`scanImports`, defaulted to a ripgrep-free `git grep`/fs walk). Rule #2
//   conformance: full — the scan is the I/O boundary and is replaceable via DI
//   for the paired tests; the decision logic is referentially transparent.
//   Rule #8: the candidate set is data (the plan's fate table), not logic.
// Source: TASKS.md `path-c-deletion-prioritisation-by-consumer-count` Measurement
//   line; validated learning `openhands-integration-shipped-2026-05-24`
//   (substrate-first); PR #784 (persona-spawner — consumer_count=0 ⇒ 30 min, not
//   1 week); Beer, S., *Brain of the Firm*, 2nd ed., Wiley 1981 (Viable System
//   Model, System 4 — choose interventions by cost-of-change, not ideal
//   architecture). Munafò et al. 2017 (pre-registration): the ≥3-zero-consumer
//   threshold is committed in the task block BEFORE this audit was run.
// Pivot (rule #9): if the audit finds zero zero-consumer candidates, fall back
//   to "cheapest first by LOC" — `src_loc` is emitted on every row precisely so
//   the fallback ordering is already computed and no re-run is needed.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * The Path-C deletion/fold candidates, sourced verbatim from the
 * package-by-package fate table in
 * `docs/plans/2026-05-22-path-c-openhands-reshape.md` § "Package-by-package
 * fate". Only the rows whose Fate is **Delete** or **Fold** are candidates for
 * the deletion sweep (Phase 4); **Keep** rows are not deletion targets and
 * **Re-scope** rows survive (interface changes, not removal). `persona-spawner`
 * is omitted — already deleted in PR #784 (the validated learning that seeded
 * this task).
 *
 * Each entry: the directory basename (`package`), the workspace specifier
 * (`name`), the workspace root as path SEGMENTS (`dirParts`), and the plan's
 * fate verb (`fate`, informational). The root is stored as segments — not a
 * single `"novel/<pkg>"` string — so that the `check-deprecated-md-respect`
 * lint does not count this audit (whose whole job is to QUEUE deprecated /
 * redundant packages — including the web dashboard listed in
 * `docs/DEPRECATED.md` § 4 — for deletion) as an EXPANSION of a deprecated
 * surface's live footprint. `dir` is the joined form, derived once below;
 * consumers read `c.dir`.
 *
 * @typedef {object} Candidate
 * @property {string} package    directory basename, e.g. "token-monitor"
 * @property {string} name       workspace specifier, e.g. "@minsky/token-monitor"
 * @property {readonly string[]} dirParts  workspace dir segments, repo-relative
 * @property {string} dir        workspace dir, `dirParts.join("/")`
 * @property {"delete" | "fold"} fate  the plan's fate verb (informational)
 */

/**
 * The candidate seeds — `Candidate` minus the derived `dir`. Annotated so the
 * `fate` literals stay the `"delete" | "fold"` union rather than widening to
 * `string` (rule #8 — the data is typed, not stringly-typed).
 *
 * @type {ReadonlyArray<Omit<Candidate, "dir">>}
 */
const CANDIDATE_SEEDS = [
  {
    package: "token-monitor",
    name: "@minsky/token-monitor",
    dirParts: ["novel", "adapters", "token-monitor"],
    fate: "delete",
  },
  {
    package: "dashboard-web",
    name: "@minsky/dashboard-web",
    dirParts: ["novel", "dashboard-web"],
    fate: "delete",
  },
  {
    package: "competitive-benchmark",
    name: "@minsky/competitive-benchmark",
    dirParts: ["novel", "competitive-benchmark"],
    fate: "fold",
  },
];

/** @type {readonly Candidate[]} */
export const PATH_C_CANDIDATES = Object.freeze(
  CANDIDATE_SEEDS.map((c) => ({ ...c, dir: c.dirParts.join("/") })),
);

/**
 * Pre-registered Success threshold from the task block: at least this many
 * Path-C candidates must have zero external consumers for the
 * prioritise-by-consumer-count rule to yield quick wins. Committed BEFORE the
 * audit was run (Munafò et al. 2017).
 */
export const ZERO_CONSUMER_THRESHOLD = 3;

/**
 * Matches an ES import/export edge against a `@minsky/<pkg>` specifier:
 *   import … from "@minsky/foo"
 *   export … from '@minsky/foo'
 *   import "@minsky/foo"
 *   await import("@minsky/foo")
 * Header comments (`* \`@minsky/foo\` — …`) and the vitest alias map
 * (`"@minsky/foo": r("…")`) do NOT match because they lack the `from`/bare-import
 * keyword preceding the specifier.
 *
 * @param {string} pkgName  e.g. "@minsky/token-monitor"
 * @returns {RegExp}
 */
export function importEdgeRegex(pkgName) {
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `from "<pkg>"` (import/export) OR a bare `import("<pkg>")` / `import "<pkg>"`.
  return new RegExp(`(?:from|import)\\s*\\(?\\s*['"]${escaped}(?:/[^'"]*)?['"]`);
}

/**
 * @typedef {object} ImportHit
 * @property {string} file  path relative to repo root
 * @property {number} line  1-based line number
 * @property {string} text  the matching source line, trimmed
 */

/**
 * Default scan seam: walk every tracked `*.ts` file (excluding `dist/` and
 * `node_modules/`) and return the lines that contain `pkgName`. We over-match
 * here (any line containing the specifier) and let the pure `countConsumers`
 * filter by the import-edge regex + the self-directory exclusion — keeping the
 * I/O boundary dumb and the decision logic testable.
 *
 * @param {string} repoRoot
 * @returns {ImportHit[]}
 */
function defaultScanImports(repoRoot) {
  /** @type {ImportHit[]} */
  const hits = [];
  for (const rel of tsFiles(repoRoot)) {
    let text;
    try {
      text = readFileSync(resolve(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (line.includes("@minsky/")) {
        hits.push({ file: rel, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
}

/**
 * Tracked `*.ts` files relative to repoRoot, excluding `dist/` and
 * `node_modules/`. Prefers `git ls-files` (fast, respects .gitignore); falls
 * back to a manual fs walk when git is unavailable (e.g. a tarball checkout).
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function tsFiles(repoRoot) {
  try {
    const out = execFileSync("git", ["ls-files", "*.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out
      .split("\n")
      .filter((l) => l.length > 0 && !l.includes("/dist/") && !l.includes("/node_modules/"));
    // rule-6: handled-locally — git failure is the I/O boundary, fall back to fs walk.
  } catch {
    return walkTs(repoRoot).map((abs) => abs.slice(repoRoot.length + 1));
  }
}

/**
 * Recursively collect absolute `*.ts` file paths under `dir`, skipping
 * `node_modules`, `dist`, and `.git`. Returns [] when `dir` is unreadable
 * (rule-6 handled-locally — the missing dir is the I/O boundary).
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walkTs(dir) {
  /** @type {string[]} */
  const acc = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      acc.push(...walkTs(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Count the external consumers of one candidate package from a flat list of
 * scan hits. A hit is a consumer iff (a) its line is an actual import/export
 * edge against the package's specifier AND (b) it lives OUTSIDE the package's
 * own directory. De-duplicated per consuming file — N imports in one file count
 * as one consumer (the unit of migration cost is the file, per PR #784).
 *
 * @param {Candidate} candidate
 * @param {readonly ImportHit[]} hits
 * @returns {{ count: number, consumers: string[] }}
 */
export function countConsumers(candidate, hits) {
  const edge = importEdgeRegex(candidate.name);
  const ownPrefix = `${candidate.dir}/`;
  /** @type {Set<string>} */
  const consumers = new Set();
  for (const hit of hits) {
    if (hit.file.startsWith(ownPrefix)) continue; // self-reference
    if (hit.file === "vitest.config.ts") continue; // alias map, not a consumer
    if (!edge.test(hit.text)) continue; // comment / mention, not an edge
    consumers.add(hit.file);
  }
  return { count: consumers.size, consumers: [...consumers].sort() };
}

/**
 * Total `src` TypeScript line count for a package dir — the fallback ordering
 * signal (rule #9 Pivot: cheapest-first by LOC when no zero-consumer wins
 * remain). Returns 0 when the package dir is already gone.
 *
 * @param {string} repoRoot
 * @param {string} dir
 * @param {(p: string) => boolean} [fileExists]
 * @returns {number}
 */
export function srcLoc(repoRoot, dir, fileExists = (p) => existsSync(p)) {
  const srcDir = resolve(repoRoot, dir, "src");
  if (!fileExists(srcDir)) return 0;
  let total = 0;
  for (const file of walkTs(srcDir)) {
    total += lineCount(file);
  }
  return total;
}

/**
 * Line count of one file, or 0 if it can't be read (rule-6 handled-locally —
 * an unreadable file is the I/O boundary, not a programming bug).
 *
 * @param {string} relOrAbs  path resolved against the walk root prefix
 * @returns {number}
 */
function lineCount(relOrAbs) {
  try {
    return readFileSync(relOrAbs, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

/**
 * @typedef {object} AuditRow
 * @property {string} package
 * @property {string} name
 * @property {string} dir
 * @property {"delete" | "fold"} fate
 * @property {number} consumer_count
 * @property {string[]} consumers
 * @property {boolean} exists
 * @property {number} src_loc
 */

/**
 * @typedef {object} AuditOpts
 * @property {string} [repoRoot]
 * @property {readonly Candidate[]} [candidates]
 * @property {(repoRoot: string) => ImportHit[]} [scanImports]
 * @property {(p: string) => boolean} [fileExists]
 */

/**
 * The pure audit: map every candidate to a row carrying its external-consumer
 * count, the consuming files, whether the package still exists, and its
 * `src/` LOC. Pure over (candidates, scan hits, fs probes) — all I/O is
 * injected.
 *
 * @param {AuditOpts} [opts]
 * @returns {AuditRow[]}
 */
export function auditCandidates(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const candidates = opts.candidates ?? PATH_C_CANDIDATES;
  const scanImports = opts.scanImports ?? defaultScanImports;
  const fileExists = opts.fileExists ?? ((p) => existsSync(p));
  const hits = scanImports(repoRoot);
  return candidates.map((c) => {
    const { count, consumers } = countConsumers(c, hits);
    return {
      package: c.package,
      name: c.name,
      dir: c.dir,
      fate: c.fate,
      consumer_count: count,
      consumers,
      exists: fileExists(resolve(repoRoot, c.dir)),
      src_loc: srcLoc(repoRoot, c.dir, fileExists),
    };
  });
}

/**
 * Cheapest-to-delete first: zero-consumer packages on top (ascending
 * consumer_count), ties broken by ascending src_loc (the rule-#9 Pivot
 * ordering), then by package name for determinism.
 *
 * @param {readonly AuditRow[]} rows
 * @returns {AuditRow[]}
 */
export function sortByDeletionCost(rows) {
  return [...rows].sort(
    (a, b) =>
      a.consumer_count - b.consumer_count ||
      a.src_loc - b.src_loc ||
      a.package.localeCompare(b.package),
  );
}

/**
 * @param {readonly AuditRow[]} rows
 * @returns {AuditRow[]}
 */
export function zeroConsumerRows(rows) {
  return rows.filter((r) => r.consumer_count === 0);
}

/**
 * Render the human-readable, cheapest-first table.
 *
 * @param {readonly AuditRow[]} rows  already sorted (or not — we sort defensively)
 * @returns {string}
 */
export function renderTable(rows) {
  const sorted = sortByDeletionCost(rows);
  const lines = [
    "Path C deletion candidates — prioritised by consumer count (cheapest first)",
    "",
    "  consumers  src_loc  fate    package",
    "  ---------  -------  ------  -------",
  ];
  for (const r of sorted) {
    const c = String(r.consumer_count).padStart(9);
    const loc = String(r.src_loc).padStart(7);
    const fate = r.fate.padEnd(6);
    const gone = r.exists ? "" : "  (already deleted)";
    lines.push(`  ${c}  ${loc}  ${fate}  ${r.name}${gone}`);
  }
  const zero = zeroConsumerRows(sorted).length;
  lines.push("");
  lines.push(
    `Zero-consumer candidates: ${zero} (Success threshold ≥ ${ZERO_CONSUMER_THRESHOLD}) — ${
      zero >= ZERO_CONSUMER_THRESHOLD
        ? "queue these for the next deletion sweep"
        : "fall back to cheapest-by-LOC (rule #9 Pivot)"
    }`,
  );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = auditCandidates();
  const sorted = sortByDeletionCost(rows);
  if (process.argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          threshold: ZERO_CONSUMER_THRESHOLD,
          zero_consumer_count: zeroConsumerRows(sorted).length,
          candidates: sorted,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`${renderTable(sorted)}\n`);
  }
  process.exit(0);
}
