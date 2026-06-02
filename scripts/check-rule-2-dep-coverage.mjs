#!/usr/bin/env node
// Rule #2 enforcement: every external dep is reached only through `novel/adapters/`.
//
// This script extracts vendor names from ARCHITECTURE.md's dependency table
// (the "Current implementation" and "Replacement candidates" columns) and
// fails CI if any non-adapter file under `novel/` directly imports one of
// those vendors.
//
// Pure function `checkDepCoverage({ archMd, files })` is testable in isolation;
// the CLI only handles I/O.
//
// Anchor: rule #2 (every external dep behind an interface in `novel/adapters/`);
// rule #10 (every constitutional rule has a deterministic CI lint);
// Martin, *Clean Architecture*, 2017 (dependency rule).

import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {import("node:fs").Dirent} Dirent */
/** @typedef {{ path: string, source: string }} CandidateFile */
/** @typedef {{ file: string, line: number, vendor: string }} Violation */
/** @typedef {{ line: number, vendor: string }} VendorHit */

// --- vendor-name extraction --------------------------------------------------

// Common English / framing words the cell-tokeniser surfaces but that are
// never vendor names. The dep table mixes prose ("Custom Claude Skill",
// "(novel; extract as OSS)") with real package names; this allowlist filters
// the prose out. Lower-cased; matched case-insensitively. When the dep table
// grows and a real prose word slips through, add it here.
const NON_VENDOR_TOKENS = new Set([
  "agent",
  "and",
  "app",
  "apple",
  "apt",
  "bot",
  "brew",
  "cli",
  "cloud",
  "code",
  "cross-platform",
  "custom",
  "evals",
  "framework",
  "later",
  "linux",
  "local",
  "macos",
  "mit",
  "mode",
  "n",
  "n/a",
  "native",
  "none",
  "novel",
  "npm",
  "or",
  "oss",
  "ours",
  "plugin",
  "shortcuts",
  "skill",
  "stanford",
  "step",
  "the",
  "tunnel",
  "wear",
  "watchos",
  "web",
  "yet",
  "yours",
]);

// A vendor name candidate. Two acceptable shapes:
//   1. all-lowercase (or digits) with at least one of hyphen/dot/digit — this
//      matches the npm package convention (`tasks-mcp`, `ntfy.sh`, `hono`).
//      Plain bare-lowercase like `hono` is also accepted.
//   2. mixed-case starting uppercase (PascalCase), 2-40 chars, allowed for
//      well-known vendors that publish under their brand name in docs
//      (`DSPy`, `Promptfoo`, `Tailscale`, `Loki`). The NON_VENDOR_TOKENS
//      list filters out the prose-word collisions.
const VENDOR_TOKEN_RE = /^[A-Za-z][A-Za-z0-9._-]{1,40}$/;

/**
 * Extract every vendor cell from the dependency table's "Current implementation"
 * and "Replacement candidates" columns, then tokenise into individual vendor
 * names.
 *
 * @param {string} archMd - the full ARCHITECTURE.md text
 * @returns {string[]} a sorted, deduplicated list of vendor identifiers
 */
export function extractVendors(archMd) {
  const tableLines = sliceDependencyTable(archMd);
  const cells = tableLines.flatMap(extractRowCells);
  const tokens = cells.flatMap(tokeniseCell);
  const vendors = tokens.filter(isLikelyVendorName);
  return [...new Set(vendors)].sort();
}

/**
 * @param {string} archMd
 * @returns {string[]}
 */
function sliceDependencyTable(archMd) {
  const lines = archMd.split("\n");
  const headerIdx = lines.findIndex((l) => /^##\s+The dependency table\b/i.test(l));
  if (headerIdx === -1) return [];
  /** @type {string[]} */
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.startsWith("## ")) break; // next H2 ends the table
    if (!line.startsWith("|")) continue;
    if (/^\|[\s|:-]+\|\s*$/.test(line)) continue; // separator row
    rows.push(line);
  }
  // first row is the header; skip it
  return rows.slice(1);
}

// Extract the "Current implementation" (col 4) and "Replacement candidates"
// (col 5) cells from a pipe-row. Column indices are 1-based after the leading
// pipe, matching the table schema in ARCHITECTURE.md.
/**
 * @param {string} row
 * @returns {string[]}
 */
function extractRowCells(row) {
  const cols = row.split("|").map((c) => c.trim());
  // cols: ["", "#", "Layer", "Interface", "Current impl", "Replacement", "Risk", ""]
  const impl = cols[4] ?? "";
  const repl = cols[5] ?? "";
  return [impl, repl].filter((c) => c.length > 0);
}

// A cell looks like: "DSPy (Stanford) + Promptfoo" or "Claude Code OTEL → local
// Loki/Tempo/Grafana". Strip parenthesised prose, then split on common
// separators: comma, slash, plus, arrow, "and", whitespace.
/**
 * @param {string} cell
 * @returns {string[]}
 */
function tokeniseCell(cell) {
  const stripped = cell
    .replace(/\([^)]*\)/g, " ") // drop parenthesised asides
    .replace(/\*\*?/g, " ") // drop markdown bold/italic markers
    .replace(/[—–]/g, " "); // em/en dashes
  return stripped
    .split(/[,/+→\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function isLikelyVendorName(token) {
  if (!VENDOR_TOKEN_RE.test(token)) return false;
  if (NON_VENDOR_TOKENS.has(token.toLowerCase())) return false;
  // Reject pure-uppercase short acronyms (e.g., "OSS", "MIT") — these are
  // never npm package names in the table.
  if (/^[A-Z]{2,5}$/.test(token)) return false;
  return true;
}

// --- file scanning -----------------------------------------------------------

/**
 * Pure-function check: returns the list of rule-#2 violations.
 *
 * @param {object} params
 * @param {string} params.archMd - the full ARCHITECTURE.md text
 * @param {CandidateFile[]} params.files - candidate files to scan
 * @returns {{violations: Violation[], vendors: string[]}}
 */
export function checkDepCoverage({ archMd, files }) {
  const vendors = extractVendors(archMd);
  /** @type {Violation[]} */
  const violations = [];
  for (const file of files) {
    if (!isScannable(file.path)) continue;
    for (const v of findVendorImports(file.source, vendors)) {
      violations.push({ file: file.path, line: v.line, vendor: v.vendor });
    }
  }
  return { violations, vendors };
}

// A file is in scope iff it's under `novel/` (but not `novel/adapters/`),
// ends in `.ts`, and is neither a test fixture nor a unit test.
/**
 * @param {string} path
 * @returns {boolean}
 */
function isScannable(path) {
  const norm = path.replace(/\\/g, "/");
  if (!norm.endsWith(".ts")) return false;
  if (norm.endsWith(".d.ts")) return false;
  if (norm.endsWith(".test.ts")) return false;
  if (norm.endsWith(".fixture.ts")) return false;
  if (!norm.startsWith("novel/") && !norm.includes("/novel/")) return false;
  if (norm.includes("/novel/adapters/") || norm.startsWith("novel/adapters/")) return false;
  return true;
}

// Returns one entry per vendor-import occurrence in the file source. The
// regex matches both `from "<vendor>"` (ES modules) and `require("<vendor>")`
// (CommonJS), and tolerates single or double quotes.
/**
 * @param {string} source
 * @param {string[]} vendors
 * @returns {VendorHit[]}
 */
function findVendorImports(source, vendors) {
  if (vendors.length === 0) return [];
  const lookup = new Set(vendors.map((v) => v.toLowerCase()));
  const lines = source.split("\n");
  /** @type {VendorHit[]} */
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (const spec of extractImportSpecifiers(line)) {
      if (lookup.has(spec.toLowerCase())) {
        hits.push({ line: i + 1, vendor: spec });
      }
    }
  }
  return hits;
}

// Pulls every import specifier out of one line of TS source. We only consider
// the bare-module form (no "./" / "../" relative paths); a vendor name with a
// leading dot would never match anyway.
const IMPORT_RE = /(?:from|require\s*\(\s*)\s*["']([^"']+)["']/g;

/**
 * @param {string} line
 * @returns {string[]}
 */
function extractImportSpecifiers(line) {
  /** @type {string[]} */
  const specs = [];
  for (const match of line.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec === undefined) continue;
    if (spec.startsWith(".") || spec.startsWith("/")) continue;
    // Strip any `npm:` / `node:` prefix and subpath; vendors may be reached as
    // `hono/middleware`, which still counts as an import of `hono`.
    const stripped = spec.replace(/^npm:/, "").replace(/^node:/, "");
    specs.push(rootSegment(stripped));
  }
  return specs;
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function rootSegment(specifier) {
  if (specifier.startsWith("@")) {
    // scoped package: @scope/name
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}

// --- CLI ---------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

/**
 * @param {string} dir
 * @returns {Promise<Dirent[]>}
 */
async function readdirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * @param {Dirent} entry
 * @param {string} full
 * @param {string[]} stack
 * @param {string[]} out
 * @returns {void}
 */
function classifyEntry(entry, full, stack, out) {
  // Skip symlinks entirely. Following them risks loops (`a -> b/`, `b -> a/`)
  // and the linter has no requirement to traverse outside the working tree.
  if (entry.isSymbolicLink()) return;
  if (entry.isDirectory()) {
    if (!SKIP_DIRS.has(entry.name)) stack.push(full);
    return;
  }
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    out.push(full);
  }
}

/**
 * Walk `root` and return every `.ts` file beneath it. Skips symlinks (loop
 * guard) and tracks visited canonical paths via `realpath` so that two
 * physical paths into the same directory are not scanned twice.
 *
 * Exported for tests.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function walkTs(root) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const stack = [root];
  /** @type {Set<string>} */
  const visited = new Set();
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let canonical;
    try {
      canonical = await realpath(dir);
    } catch {
      continue;
    }
    if (visited.has(canonical)) continue;
    visited.add(canonical);
    const entries = await readdirSafe(dir);
    for (const entry of entries) {
      classifyEntry(entry, join(dir, entry.name), stack, out);
    }
  }
  return out;
}

async function main() {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const archPath = join(repoRoot, "docs/ARCHITECTURE.md");
  const archMd = await readFile(archPath, "utf-8");
  const novelRoot = join(repoRoot, "novel");
  const absFiles = await walkTs(novelRoot);
  const files = await Promise.all(
    absFiles.map(async (abs) => ({
      path: relative(repoRoot, abs).split(sep).join("/"),
      source: await readFile(abs, "utf-8"),
    })),
  );
  const { violations, vendors } = checkDepCoverage({ archMd, files });
  if (violations.length === 0) {
    process.stdout.write(
      `rule-2-dep-coverage: clean (${files.length} files scanned, ${vendors.length} vendors checked)\n`,
    );
    return 0;
  }
  process.stderr.write(
    `rule-2-dep-coverage: ${violations.length} violation(s) — every external dep must be reached through novel/adapters/\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line} imports vendor "${v.vendor}"\n`);
  }
  return 1;
}

// Run as CLI when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`rule-2-dep-coverage: fatal: ${err?.message ?? err}\n`);
      process.exit(2);
    });
}
