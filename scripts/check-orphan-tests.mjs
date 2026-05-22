#!/usr/bin/env node
// @ts-check
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
// Pivot (rule #9): if this lint produces >2 false positives per PR
//   over a rolling 5-PR window, switch to a tsc-based detector
//   (separate `tsconfig.test.json` per package, run `tsc --noEmit`
//   over the test files). Tracked at `tui-src-vs-test-api-drift`.
// Conformance: full — pure pipeline of regex-extract + set-difference
//   over injected file bodies, with a thin CLI wrapper at the bottom
//   that walks the filesystem and feeds the pure function.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
    const isTypeOnly = !!m[1];
    if (isTypeOnly) continue;
    const block = m[2];
    const fromSpec = m[3];
    if (!block || !fromSpec) continue;
    for (const tok of block.split(",")) {
      const trimmed = tok.trim();
      if (!trimmed) continue;
      // Per-token type modifier: `import { type Foo, bar }` — Foo is
      // erased, bar is runtime. Skip the typed ones.
      if (/^type\s+/.test(trimmed)) continue;
      // `foo as fooAlias` — what matters for API drift is the SOURCE
      // name (`foo`), not the local alias (`fooAlias`). The local
      // name is what `collectExports` reports on the source side.
      const asMatch = trimmed.match(/^(\S+)\s+as\s+\S+$/);
      const sourceName = asMatch && asMatch[1] ? asMatch[1] : trimmed;
      if (sourceName) out.push({ symbol: sourceName, fromSpec });
    }
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
  for (const m of body.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}(?:\s+from\s+["']([^"']+)["'])?/g)) {
    const block = m[1];
    if (!block) continue;
    for (const tok of block.split(",")) {
      const trimmed = tok.trim();
      if (!trimmed) continue;
      // `foo as fooAlias` -> exported name is `fooAlias`.
      const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
      const exportedName = asMatch && asMatch[2] ? asMatch[2] : trimmed;
      // Strip leading `type ` modifier from per-token type imports.
      const stripped = exportedName.replace(/^type\s+/, "");
      if (stripped) names.add(stripped);
    }
    // `export { foo } from "x"` already harvested `foo` above; the
    // inner walk would be redundant for this case. We only recurse on
    // (c) below — the star re-export shape.
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
  for (const m of body.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    if (maxDepth <= 0) break;
    const spec = m[1];
    if (!spec) continue;
    if (visited.has(spec)) continue;
    visited.add(spec);
    const upstreamBody = resolveAndRead(spec);
    if (upstreamBody === undefined) continue;
    const inner = extractNamedExports(upstreamBody, resolveAndRead, maxDepth - 1, visited);
    for (const name of inner) names.add(name);
  }
  return names;
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
    const exports = extractNamedExports(
      resolved.body,
      (reexportSpec) => reexportResolver(resolved.resolved, reexportSpec),
    );
    if (!exports.has(symbol)) {
      violations.push({ symbol, fromSpec, resolved: resolved.resolved });
    }
  }
  return { violations };
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
    if (!cur) continue;
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (IGNORE_PATH_TOKENS.has(ent.name)) continue;
      const abs = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile() && matchFile(abs)) {
        out.push(abs);
      }
    }
  }
  out.sort();
  return out;
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
  if (spec.endsWith(".js")) tsCandidates.push(resolvedAbs.slice(0, -3) + ".ts");
  if (spec.endsWith(".mjs")) tsCandidates.push(resolvedAbs.slice(0, -4) + ".mts");
  for (const ext of TS_EXTS) {
    tsCandidates.push(resolvedAbs + ext);
    tsCandidates.push(join(resolvedAbs, "index" + ext));
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
  for (const testAbs of walkFiles(NOVEL_DIR, (abs) => TEST_FILE_RE.test(abs) && /\/test\//.test(abs))) {
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

function main() {
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
    `check-orphan-tests: ${violations.length} orphan symbol(s) across ${byTest.size} test file(s).\n` +
      "  Test imports a symbol that doesn't exist as a named export in the resolved sibling source.\n" +
      "  Class: API drift between the test and the source after a merge that took one side's source\n" +
      "         and the other side's tests. See `vision.md` § 18 and the 2026-05-21 drain.\n\n",
  );
  for (const [test, vs] of byTest) {
    process.stderr.write(`${test}:\n`);
    for (const v of vs) {
      const target = v.sourceAbs ?? `(unresolved spec '${v.fromSpec}')`;
      process.stderr.write(`  - import { ${v.importedSymbol} } from "${v.fromSpec}" -> ${target}\n`);
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
