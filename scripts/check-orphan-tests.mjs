#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-21 drain — rule-#10 ratchet for the test/-vs-src/ API drift class (PR #639 → #705). Task `tui-src-vs-test-api-drift-pivot-tracker` tracks the regex-vs-tsc pivot. -->
// Pattern: lexical lint over the parallel `test/` / `src/` topology of
//   `novel/**` packages. Cross-checks that every named symbol a
//   `<pkg>/test/*.test.{ts,mjs,js}` file imports from `../src/...`
//   actually exists as a named export of the resolved source file.
// Source: 2026-05-21 PM session — PR #639's `novel/tui/test/*.test.ts`
//   imported `formatProcRow`, `renderDetail`, and `gatherMachineRaw`
//   from `../src/*.js`. The merge conflict resolution took main's
//   source (which only ships slice-1 — `formatProcRow` etc. don't
//   exist), but PR's tests. tsc didn't catch it because the per-package
//   `tsconfig.json` only `include`s `src`. vitest caught it at the
//   `pnpm test` step in CI — i.e. only after a parallel-tests minute
//   had already been spent. This lint runs in ~200ms.
// Anchor: rule #10 (deterministic enforcement — "every behavioral
//   invariant has a mechanical check"); rule #14 (visible — every
//   regression class earns a lint); Aho-Sethi-Ullman 1986 *Compilers:
//   Principles, Techniques, and Tools*, Ch. 3 (lexer shape — regex is
//   enough for ESM import/export tokens, no AST needed); Beck 2002
//   *Test-Driven Development*, Ch. 26 (one bug, one test — observed
//   regression, mechanical detector).
// Pivot (rule #9): if this lint produces >2 false positives over a
//   rolling 5-PR window, switch to a tsc-based detector (separate
//   `tsconfig.test.json` per package, run `tsc --noEmit` over the test
//   files). The pivot threshold is no longer prose-only: `node
//   scripts/check-orphan-tests.mjs --check-pivot` reads the embedded
//   false-positive ledger (`FALSE_POSITIVE_LEDGER` below) and asserts,
//   deterministically (rule #10), whether the threshold has been
//   crossed. While the rolling-window false-positive count stays ≤2 the
//   tracker exits 0 ("persevere"); once it exceeds 2 the tracker exits 1
//   ("PIVOT") and prints the tsc-detector migration steps. Tracked at
//   `tui-src-vs-test-api-drift-pivot-tracker`.
// Conformance: full — pure pipeline of regex-extract + set-difference
//   over injected file bodies, plus a pure pivot-decision function over
//   the injected ledger, with a thin CLI wrapper at the bottom that
//   walks the filesystem / reads the ledger and feeds the pure functions.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// Test files live under `novel/<pkg>/test/` and import from `../src/...`.
// (Also `novel/<pkg>/<sub>/test/` for nested packages like
//  `novel/observer/heals/test/`.) We sweep every `test/` directory under
// `novel/` and check its `*.test.{ts,mjs,js}` files.
const NOVEL_DIR = resolve(REPO_ROOT, "novel");

// Ignored test directories — `test/fixtures/` is data, not code.
const IGNORE_PATH_TOKENS = new Set(["fixtures", "node_modules", "dist", ".git"]);

// File suffixes the lint scans. `.test.tsx` is excluded — none in the
// codebase today; revisit if React tests land.
const TEST_FILE_RE = /\.test\.(ts|mjs|js)$/;

const TS_EXTS = [".ts", ".mts", ".tsx", ".mjs", ".js"];

// ---------------------------------------------------------------------------
// Pure functions (injected with bodies and resolvers — no filesystem I/O).
// ---------------------------------------------------------------------------

/**
 * Extract every named-import target from a test file body. Returns a
 * flat list of `{ symbol, fromSpec }` records. Type-only imports (with
 * the `import type { ... }` shape OR the per-token `type ` modifier)
 * are SKIPPED — they're erased before runtime and don't cause API drift.
 *
 * Captured shapes:
 *   import { foo, bar } from "../src/x.js"      -> foo, bar
 *   import { foo as fooAlias } from "../src/x"  -> foo (source name)
 *   import { type Foo, bar } from "../src/x"    -> bar only
 *
 * Not captured (intentionally — out of scope):
 *   import foo from "../src/x.js"               — default imports
 *   import * as foo from "../src/x.js"          — namespace imports
 *   import "../src/x.js"                         — side-effect imports
 *   import type { Foo } from "../src/x.js"       — pure type imports
 *
 * @param {string} body  source of a test file
 * @returns {{ symbol: string, fromSpec: string }[]}
 */
export function extractNamedImports(body) {
  /** @type {{ symbol: string, fromSpec: string }[]} */
  const out = [];
  // Match `import { ... } from "..."`. The leading `import type { ... }`
  // shape is a pure type import — we exclude it via the regex by
  // capturing the optional `type ` prefix and skipping when present.
  const re = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  for (const m of body.matchAll(re)) {
    if (m[1] || !m[2] || !m[3]) continue;
    for (const symbol of parseImportTokens(m[2])) {
      out.push({ symbol, fromSpec: m[3] });
    }
  }
  return out;
}

/**
 * Pure tokenizer over the comma-separated content of one `import { ... }`
 * block. Returns the SOURCE names (resolving `foo as fooAlias` to `foo`)
 * of every runtime import, skipping the per-token `type ` modifier.
 *
 * @param {string} block content inside `{}`, e.g. `"foo, bar as b, type Baz"`
 * @returns {string[]}
 */
function parseImportTokens(block) {
  /** @type {string[]} */
  const out = [];
  for (const tok of block.split(",")) {
    const trimmed = tok.trim();
    if (!trimmed || /^type\s+/.test(trimmed)) continue;
    // `foo as fooAlias` — what matters for API drift is the SOURCE name.
    const asMatch = trimmed.match(/^(\S+)\s+as\s+\S+$/);
    const sourceName = asMatch?.[1] ?? trimmed;
    if (sourceName) out.push(sourceName);
  }
  return out;
}

/**
 * Extract every named export from a source file body. Recursively
 * follows `export * from "./..."` and `export { ... } from "./..."`
 * re-exports up to `maxDepth` via the injected resolver.
 *
 * @param {string} body
 * @param {(spec: string) => string | undefined} resolveAndRead
 *   given a relative specifier (e.g. `"./helpers.js"`), return the
 *   resolved file's body, or undefined if the resolver can't resolve
 *   (we tolerate dangling re-exports — they're separately caught by
 *   tsc; not this lint's job).
 * @param {number} maxDepth recursion bound on re-export chains
 * @param {Set<string>} visited cycle guard (the keys are arbitrary
 *   resolver-supplied identifiers; we use the resolved-spec string)
 * @returns {Set<string>}
 */
export function extractNamedExports(body, resolveAndRead, maxDepth = 8, visited = new Set()) {
  /** @type {Set<string>} */
  const names = new Set();
  // (a) Block exports: `export { foo, bar }` or `export { foo } from "./x.js"`.
  //     Re-export-from already harvests the named tokens above; we only
  //     recurse on the (c) star-re-export shape below.
  for (const m of body.matchAll(
    /export\s+(?:type\s+)?\{([^}]+)\}(?:\s+from\s+["']([^"']+)["'])?/g,
  )) {
    if (!m[1]) continue;
    for (const name of parseExportTokens(m[1])) names.add(name);
  }
  // (b) Inline declarations: `export const foo`, `export function bar`,
  //     `export type Foo`, `export interface Foo`, `export enum Foo`,
  //     `export class Foo`, `export namespace Foo`.
  for (const m of body.matchAll(
    /export\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class|interface|enum|type|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  )) {
    if (m[1]) names.add(m[1]);
  }
  // (c) Star re-exports: `export * from "./x.js"`.
  collectStarReexports(body, resolveAndRead, maxDepth, visited, names);
  return names;
}

/**
 * Pure tokenizer over the comma-separated content of one `export { ... }`
 * block. Returns the EXPORTED names (resolving `foo as fooAlias` to
 * `fooAlias`) of every export, stripping the leading `type ` modifier
 * from per-token type re-exports.
 *
 * @param {string} block content inside `{}`
 * @returns {string[]}
 */
function parseExportTokens(block) {
  /** @type {string[]} */
  const out = [];
  for (const tok of block.split(",")) {
    const trimmed = tok.trim();
    if (!trimmed) continue;
    // `foo as fooAlias` -> exported name is `fooAlias`.
    const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
    const exportedName = asMatch?.[2] ?? trimmed;
    // Strip leading `type ` modifier from per-token type re-exports.
    const stripped = exportedName.replace(/^type\s+/, "");
    if (stripped) out.push(stripped);
  }
  return out;
}

/**
 * Walk every `export * from "./..."` in the body, recursing into the
 * upstream module's exports up to `maxDepth`. Mutates `names` and
 * `visited` for compactness — they're the only sinks anyway.
 *
 * @param {string} body
 * @param {(spec: string) => string | undefined} resolveAndRead
 * @param {number} maxDepth
 * @param {Set<string>} visited
 * @param {Set<string>} names sink
 */
function collectStarReexports(body, resolveAndRead, maxDepth, visited, names) {
  if (maxDepth <= 0) return;
  for (const m of body.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec || visited.has(spec)) continue;
    visited.add(spec);
    const upstreamBody = resolveAndRead(spec);
    if (upstreamBody === undefined) continue;
    const inner = extractNamedExports(upstreamBody, resolveAndRead, maxDepth - 1, visited);
    for (const name of inner) names.add(name);
  }
}

/**
 * Pure orphan-check. Caller supplies:
 *  - `testBody` — the source of one test file
 *  - `resolveSource(spec)` — given a specifier from the test file (e.g.
 *     `"../src/foo.js"`), return the body of the resolved source file,
 *     or `null` if the spec doesn't resolve to a real file.
 *  - `resolveReexport(sourceSpec, reexportSpec)` — given a re-export
 *     specifier inside a source file, return the body of the upstream
 *     module, or `undefined` if it can't be resolved. (Optional; falls
 *     back to "no recursion".)
 *  - `crossDirOnly` — when true (default), only check imports whose
 *     spec starts with `"../src/"` or `"../../src/"` — the parallel-dir
 *     topology that the lint targets. When false, every relative
 *     import is checked.
 *
 * @param {object} input
 * @param {string} input.testBody
 * @param {(spec: string) => { body: string, resolved: string } | null} input.resolveSource
 * @param {(sourceSpec: string, reexportSpec: string) => string | undefined} [input.resolveReexport]
 * @param {boolean} [input.crossDirOnly]
 * @returns {{ violations: { symbol: string, fromSpec: string, resolved: string | null }[] }}
 */
export function checkOrphans({ testBody, resolveSource, resolveReexport, crossDirOnly = true }) {
  /** @type {{ symbol: string, fromSpec: string, resolved: string | null }[]} */
  const violations = [];
  const reexportResolver = resolveReexport ?? (() => undefined);
  for (const { symbol, fromSpec } of extractNamedImports(testBody)) {
    if (crossDirOnly && !fromSpec.startsWith("../src/") && !fromSpec.startsWith("../../src/")) {
      continue;
    }
    const resolved = resolveSource(fromSpec);
    if (resolved === null) {
      violations.push({ symbol, fromSpec, resolved: null });
      continue;
    }
    const exports = extractNamedExports(resolved.body, (reexportSpec) =>
      reexportResolver(resolved.resolved, reexportSpec),
    );
    if (!exports.has(symbol)) {
      violations.push({ symbol, fromSpec, resolved: resolved.resolved });
    }
  }
  return { violations };
}

// ---------------------------------------------------------------------------
// Pivot tracker (rule #9 pre-registered pivot threshold + rule #10
// deterministic enforcement). Makes the "regex-vs-tsc" pivot mechanical.
// ---------------------------------------------------------------------------

/**
 * Rolling window (in PRs) over which false positives are counted.
 * Anchored to the task `tui-src-vs-test-api-drift-pivot-tracker`'s
 * Pivot line: ">2 false positives over a 5-PR window → switch to tsc".
 */
export const PIVOT_WINDOW_PRS = 5;

/**
 * Pivot fires when the false-positive count over the most-recent
 * `PIVOT_WINDOW_PRS` window exceeds this. ">2" means strictly greater
 * than 2, i.e. the third false positive in the window trips it.
 */
export const PIVOT_FALSE_POSITIVE_THRESHOLD = 2;

/**
 * @typedef {{
 *   pr: number,            // PR number that triggered the orphan-tests job to go red
 *   classification: "false-positive" | "true-positive",
 *   note: string,          // one-line reason (cited evidence)
 * }} FalsePositiveObservation
 */

/**
 * The checked-in false-positive observation ledger. Each entry records a
 * PR on which the `orphan-tests` CI job went red, classified true-vs-
 * false against the actual orphan-symbol report (the task's Measurement
 * line). The tracker counts only `false-positive` entries inside the
 * rolling window.
 *
 * Seeded empty: as of 2026-06-02 the `orphan-tests` job was green on 40+
 * consecutive CI runs (measured via `gh run view <id> --json jobs`), so
 * the regex detector has produced ZERO false positives since it shipped
 * in PR #713. The regex approach is being persevered with, exactly as
 * rule #9 prescribes — pivot only when the threshold is crossed, never
 * pre-emptively. When a future orphan-tests red is triaged as a false
 * positive, append a `{ pr, classification: "false-positive", note }`
 * row here in the SAME PR that diagnoses it (the task's "file an
 * immediate diagnostic task" step), and this tracker will fire the pivot
 * once three accumulate inside any 5-PR window.
 *
 * @type {FalsePositiveObservation[]}
 */
export const FALSE_POSITIVE_LEDGER = [];

/**
 * Pure pivot-decision function. Given the false-positive ledger, decides
 * whether the regex detector should be persevered with or the tsc-based
 * detector pivot should fire. The window is interpreted over the SORTED-
 * ascending tail of distinct PR numbers that appear in the ledger: the
 * count is the number of `false-positive` rows whose PR sits in the most-
 * recent `windowSize` PRs of the ledger (an empty ledger ⇒ 0 ⇒
 * persevere). Threshold is strictly-greater-than (`>`), matching the
 * task's ">2" wording.
 *
 * @param {object} input
 * @param {FalsePositiveObservation[]} input.ledger
 * @param {number} [input.windowSize]
 * @param {number} [input.threshold]
 * @returns {{
 *   decision: "persevere" | "pivot",
 *   falsePositivesInWindow: number,
 *   windowSize: number,
 *   threshold: number,
 *   windowPrs: number[],
 * }}
 */
export function evaluateFalsePositivePivot({
  ledger,
  windowSize = PIVOT_WINDOW_PRS,
  threshold = PIVOT_FALSE_POSITIVE_THRESHOLD,
}) {
  // Distinct PR numbers in the ledger, ascending. The rolling window is
  // the most-recent `windowSize` of these — counting PRs, not rows, so a
  // PR with two false-positive rows still consumes one window slot but
  // contributes two to the count.
  const distinctPrs = [...new Set(ledger.map((o) => o.pr))].sort((a, b) => a - b);
  const windowPrs = distinctPrs.slice(-windowSize);
  const windowPrSet = new Set(windowPrs);
  const falsePositivesInWindow = ledger.filter(
    (o) => o.classification === "false-positive" && windowPrSet.has(o.pr),
  ).length;
  return {
    decision: falsePositivesInWindow > threshold ? "pivot" : "persevere",
    falsePositivesInWindow,
    windowSize,
    threshold,
    windowPrs,
  };
}

// ---------------------------------------------------------------------------
// CLI binding (filesystem I/O).
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree and yield absolute paths of files matching
 * the predicate. Skips `IGNORE_PATH_TOKENS` directories.
 *
 * @param {string} dir
 * @param {(absPath: string) => boolean} matchFile
 * @returns {string[]}
 */
function walkFiles(dir, matchFile) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  /** @type {string[]} */
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur) walkOneDir(cur, matchFile, stack, out);
  }
  out.sort();
  return out;
}

/**
 * Read one directory's entries and dispatch each entry: push subdirs
 * onto `stack`, push matching files into `out`. Extracted helper to keep
 * `walkFiles`'s cognitive complexity below biome's threshold.
 *
 * @param {string} dir
 * @param {(absPath: string) => boolean} matchFile
 * @param {string[]} stack
 * @param {string[]} out
 */
function walkOneDir(dir, matchFile, stack, out) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (IGNORE_PATH_TOKENS.has(ent.name)) continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) stack.push(abs);
    else if (ent.isFile() && matchFile(abs)) out.push(abs);
  }
}

/**
 * Resolve a TypeScript-style import specifier (`./foo.js`, `../src/bar`,
 * `../../shared/qux.mjs`) against the importing file's directory to a
 * real source file path on disk. Returns null if no candidate resolves.
 *
 * @param {string} importer  absolute path of the importing file
 * @param {string} spec      raw specifier from the import statement
 * @returns {string | null}
 */
function resolveOnDisk(importer, spec) {
  if (!spec.startsWith(".")) return null;
  const baseDir = dirname(importer);
  const resolvedAbs = resolve(baseDir, spec);
  const tsCandidates = [];
  if (spec.endsWith(".js")) tsCandidates.push(`${resolvedAbs.slice(0, -3)}.ts`);
  if (spec.endsWith(".mjs")) tsCandidates.push(`${resolvedAbs.slice(0, -4)}.mts`);
  for (const ext of TS_EXTS) {
    tsCandidates.push(resolvedAbs + ext);
    tsCandidates.push(join(resolvedAbs, `index${ext}`));
  }
  tsCandidates.push(resolvedAbs);
  for (const cand of tsCandidates) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/**
 * Disk-backed orphan check across the whole `novel/` tree. Returns a
 * flat list of violations, one per orphan-symbol-per-test-file.
 *
 * @returns {{ violations: { test: string, importedSymbol: string, fromSpec: string, sourceAbs: string | null }[] }}
 */
export function runCheck() {
  /** @type {{ test: string, importedSymbol: string, fromSpec: string, sourceAbs: string | null }[]} */
  const violations = [];
  for (const testAbs of walkFiles(
    NOVEL_DIR,
    (abs) => TEST_FILE_RE.test(abs) && /\/test\//.test(abs),
  )) {
    const testBody = readFileSync(testAbs, "utf8");
    const { violations: vs } = checkOrphans({
      testBody,
      resolveSource: (spec) => {
        const abs = resolveOnDisk(testAbs, spec);
        if (!abs) return null;
        return { body: readFileSync(abs, "utf8"), resolved: abs };
      },
      resolveReexport: (sourceAbs, reexportSpec) => {
        const abs = resolveOnDisk(sourceAbs, reexportSpec);
        if (!abs) return undefined;
        return readFileSync(abs, "utf8");
      },
    });
    for (const v of vs) {
      violations.push({
        test: relative(REPO_ROOT, testAbs),
        importedSymbol: v.symbol,
        fromSpec: v.fromSpec,
        sourceAbs: v.resolved ? relative(REPO_ROOT, v.resolved) : null,
      });
    }
  }
  return { violations };
}

/**
 * Pivot-tracker CLI mode (`--check-pivot`). Reads the embedded false-
 * positive ledger and prints the persevere/pivot decision. Exit 0 while
 * the rolling-window false-positive count stays at-or-below the
 * threshold; exit 1 (with the tsc-detector migration steps) once it is
 * exceeded.
 *
 * @returns {never}
 */
function runPivotTracker() {
  const verdict = evaluateFalsePositivePivot({ ledger: FALSE_POSITIVE_LEDGER });
  const windowDesc =
    verdict.windowPrs.length > 0
      ? `last ${verdict.windowSize}-PR window [${verdict.windowPrs.join(", ")}]`
      : `${verdict.windowSize}-PR window (ledger empty — no orphan-tests false positives recorded)`;
  if (verdict.decision === "persevere") {
    process.stdout.write(
      `orphan-tests pivot-tracker: PERSEVERE — ${verdict.falsePositivesInWindow} false positive(s) in the ${windowDesc}; threshold is >${verdict.threshold}. Regex detector stays.\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `orphan-tests pivot-tracker: PIVOT — ${verdict.falsePositivesInWindow} false positive(s) in the ${windowDesc} exceeds the >${verdict.threshold} threshold.\n` +
      "Per rule #9, abandon the regex approach and ship the tsc-based detector:\n" +
      "  1. Add a `tsconfig.test.json` to every `novel/*` package with a `test/` dir,\n" +
      "     extending the package tsconfig and adding `test` to `include`.\n" +
      "  2. Replace the regex extract/export pass in `checkOrphans` with a\n" +
      "     `tsc --noEmit -p novel/<pkg>/tsconfig.test.json` invocation per package.\n" +
      "  3. Rewire the `orphan-tests` CI job + the pre-pr-lint `orphan-tests` step.\n" +
      "  4. Update the paired tests in `scripts/check-orphan-tests.test.mjs`.\n",
  );
  process.exit(1);
}

function main() {
  if (process.argv.includes("--check-pivot")) runPivotTracker();
  const { violations } = runCheck();
  if (violations.length === 0) {
    process.stdout.write(
      "check-orphan-tests: no orphan symbols — every test/ import resolves to an export in sibling src/.\n",
    );
    process.exit(0);
  }
  /** @type {Map<string, typeof violations>} */
  const byTest = new Map();
  for (const v of violations) {
    if (!byTest.has(v.test)) byTest.set(v.test, []);
    /** @type {typeof violations} */ (byTest.get(v.test)).push(v);
  }
  process.stderr.write(
    `check-orphan-tests: ${violations.length} orphan symbol(s) across ${byTest.size} test file(s).\n  Test imports a symbol that doesn't exist as a named export in the resolved sibling source.\n  Class: API drift between the test and the source after a merge that took one side's source\n         and the other side's tests. See \`vision.md\` § 18 and the 2026-05-21 drain.\n\n`,
  );
  for (const [test, vs] of byTest) {
    process.stderr.write(`${test}:\n`);
    for (const v of vs) {
      const target = v.sourceAbs ?? `(unresolved spec '${v.fromSpec}')`;
      process.stderr.write(
        `  - import { ${v.importedSymbol} } from "${v.fromSpec}" -> ${target}\n`,
      );
    }
    process.stderr.write("\n");
  }
  process.stderr.write(
    "Fix: either (a) add the missing exports to the resolved source file,\n" +
      "          or (b) delete / rewrite the test file to use only currently-exported symbols.\n" +
      "          (Conflict-resolution path: if you take main's source, also take main's tests.)\n",
  );
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-orphan-tests.mjs");
if (invokedDirectly) main();
