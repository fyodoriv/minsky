#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per ban-test-real-install-against-repo-root -->
//
// check-no-repo-root-install-in-tests — static scan that fails when a test
// file (`**/*.test.{ts,mjs}`) can trigger a REAL install against the shared
// repo-root `node_modules` while the vitest worker pool is live.
//
// Why this class is load-bearing: on 2026-06-02 `test/integration/
// minsky-init.test.ts` spawned `distribution/install.sh <host>` with NO
// `--skip-install`, so `bin/minsky-init` ran `cd $MINSKY_ROOT && pnpm
// install` — relinking `node_modules/.pnpm` mid-run and killing live tinypool
// workers ("Worker exited unexpectedly / Cannot find module
// .../tinypool/dist/entry/process.js"). The whole `test` job went red on
// every main commit until #1028 gated the offending test behind an opt-in
// env. A test that mutates shared state under the runner is non-deterministic
// by construction (Fowler 2011 "Eradicating Non-Determinism in Tests"); this
// lint forbids the only way to reach that state at author time, so the class
// is non-recurring (rule #10 ratchet — every load-bearing CI failure becomes
// a deterministic gate).
//
// Two bad patterns, both scoped to test files only (production code legitimately
// shells out to installers):
//
//   A. A spawn of `bin/minsky-init` / `distribution/install.sh` (literal path,
//      or the conventional `MINSKY_INIT` / `INSTALL_SH` path vars) WITHOUT a
//      `--skip-install` argument. Safe alternatives: pass `--skip-install`, or
//      run against an ISOLATED checkout copy and mark the spawn with an inline
//      `repo-root-install-ok:` justification.
//   B. A literal `pnpm install` / `npm ci` invoked as a command whose cwd is
//      the repo root (`REPO_ROOT`, `import.meta.dirname/../..`, or an absent
//      cwd — which defaults to `process.cwd()`, the repo root under vitest).
//
// Carve-outs that keep the CURRENT tree green (post-#1028) without editing the
// sibling-task-owned `minsky-init.test.ts`:
//
//   - A spawn inside a region gated by `skipIf(...)` whose condition names an
//     install-mutation opt-in env (`MINSKY_RUN_INSTALL_MUTATION_TEST`, or any
//     env matching INSTALL_MUTATION_ENV_RE) is allowed — that path never runs
//     in the shared pool (this is exactly #1028's gate).
//   - A bootstrap spawn against a non-repo refusal target (identifier or
//     literal matching `nonRepo` / `non-repo`) is allowed — `minsky-init` /
//     `install.sh` refuse a non-git-repo with exit 2 BEFORE any install runs.
//   - A generic helper spawn whose args are a spread (`...args`) is allowed —
//     the concrete `--skip-install` (or its absence) is supplied at the call
//     site, which this scan evaluates separately.
//   - An inline `repo-root-install-ok:` marker (with a justification) on the
//     spawn's lines allows it (escape hatch for a genuinely isolated install).
//
// Anchors: Fowler 2011 "Eradicating Non-Determinism in Tests"; vision.md
// rule #10 (deterministic enforcement — every load-bearing CI failure becomes
// a ratcheted gate); TASKS.md `ban-test-real-install-against-repo-root`.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Tokens that identify a spawn of the bootstrap script. Either a literal path
 * fragment or the conventional path-var the test files bind the resolved
 * absolute path to (`const MINSKY_INIT = join(REPO_ROOT, "bin", "minsky-init")`).
 *
 * @type {readonly RegExp[]}
 */
export const BOOTSTRAP_SPAWN_RE = Object.freeze([
  /\bminsky-init\b/,
  /\binstall\.sh\b/,
  /\bMINSKY_INIT\b/,
  /\bINSTALL_SH\b/,
]);

/** A `--skip-install` token anywhere in the spawn call makes it safe. */
export const SKIP_INSTALL_RE = /--skip-install\b/;

/**
 * A non-repo refusal target — `minsky-init` / `install.sh` exit 2 on a
 * non-git-repo before any install runs, so spawning against one is safe.
 *
 * @type {RegExp}
 */
export const NON_REPO_TARGET_RE = /\bnon-?[rR]epo\b/;

/** A spread-args helper spawn (`[MINSKY_INIT, ...args]`) defers the flag decision. */
export const SPREAD_ARGS_RE = /\.\.\.\s*\w+/;

/**
 * Env names that gate an install-mutation opt-in. A `skipIf(...)` whose
 * condition references one of these guards the spawn out of the shared pool
 * (this is #1028's gate). Matched against the `skipIf(...)` condition text.
 *
 * @type {RegExp}
 */
export const INSTALL_MUTATION_ENV_RE = /INSTALL_MUTATION|RUN_INSTALL_MUTATION/;

/**
 * A literal repo-root install command. Matches `pnpm install` / `npm ci`
 * (and `npm install`) in two shapes: a single shell string (`"pnpm install"`,
 * `"npm ci"`) and the split-argv form (`"pnpm", ["install"]` / `"npm", "ci"`).
 * Only consulted on lines that already read as a spawn/exec call (see
 * `looksLikeCommand`), so prose mentions never reach this regex.
 *
 * @type {RegExp}
 */
export const REPO_ROOT_INSTALL_RE =
  /\b(?:pnpm\s+install|npm\s+(?:ci|install))\b|["'`]pnpm["'`]\s*,\s*\[?\s*["'`]install["'`]|["'`]npm["'`]\s*,\s*\[?\s*["'`](?:ci|install)["'`]/;

/**
 * Signals that a command's cwd is the repo root: an explicit `REPO_ROOT` /
 * repo-root path-join, OR the ABSENCE of any `cwd:` option on the spawn (which
 * defaults to `process.cwd()` — the repo root under vitest).
 *
 * @type {RegExp}
 */
export const REPO_ROOT_CWD_RE = /\bREPO_ROOT\b|import\.meta\.dirname[^\n]*\.\.[^\n]*\.\./;

/** Inline escape-hatch marker (must carry a justification after the colon). */
export const INLINE_ALLOW_RE = /\brepo-root-install-ok:/;

/**
 * Files allowed to MENTION the patterns (this lint, its tests, docs). The
 * sibling-owned `minsky-init.test.ts` is intentionally NOT here — the
 * carve-outs above keep its current (post-#1028) shape green.
 *
 * @type {readonly RegExp[]}
 */
export const ALLOWLIST = Object.freeze([
  /^scripts\/check-no-repo-root-install-in-tests\.mjs$/,
  /^scripts\/check-no-repo-root-install-in-tests\.test\.mjs$/,
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} scannedCount
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {string[]} [files]
 * @property {(p: string) => string} [readText]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkNoRepoRootInstallInTests(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  const files = opts.files ?? defaultFileList(repoRoot);
  /** @type {string[]} */
  const violations = [];

  for (const relPath of files) {
    if (isAllowlisted(relPath)) continue;
    if (isGeneratedCheckout(relPath)) continue;
    const full = `${repoRoot}/${relPath}`;
    let src;
    try {
      src = readText(full);
    } catch {
      // rule-6: handled-locally — a listed-but-unreadable file is not a lint
      // failure; skip it. The I/O boundary throws; we want to continue.
      continue;
    }
    scanFile(relPath, src, violations);
  }

  return { ok: violations.length === 0, violations, scannedCount: files.length };
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isGeneratedCheckout(relPath) {
  return relPath.startsWith(".worktrees/");
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isAllowlisted(relPath) {
  return ALLOWLIST.some((re) => re.test(relPath));
}

/**
 * Scan one test file. Tracks whether the current line sits inside a
 * `skipIf(...)`-gated region whose condition names an install-mutation env;
 * that gates a bootstrap spawn out of the shared pool.
 *
 * @param {string} relPath
 * @param {string} src
 * @param {string[]} violations
 */
function scanFile(relPath, src, violations) {
  const lines = src.split("\n");
  // Whether ANY `skipIf(...)` in this file gates on an install-mutation env.
  // Block-scope tracking in raw text is brittle; for the bootstrap-spawn rule
  // a file-level guard is the correct granularity — the only safe way to run a
  // real repo-root install under vitest IS behind such a gate, and a file that
  // declares one is opting the dangerous path out of the shared pool.
  const fileHasInstallMutationGate = hasInstallMutationSkipIf(src);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isCommentLine(line)) continue;
    const context = nearbyLines(lines, i);
    if (INLINE_ALLOW_RE.test(context)) continue;

    if (isBootstrapSpawnViolation(line, context, fileHasInstallMutationGate)) {
      violations.push(
        `${relPath}:${i + 1}: spawns the bootstrap script (minsky-init/install.sh) WITHOUT --skip-install — runs a real \`pnpm install\` against the repo root, relinking node_modules mid-run and killing live tinypool workers. Pass --skip-install, or run against an isolated checkout copy + mark the spawn \`repo-root-install-ok: <reason>\`.`,
      );
    }
    if (isRepoRootInstallViolation(line, context)) {
      violations.push(
        `${relPath}:${i + 1}: runs \`pnpm install\` / \`npm ci\` against the repo root under the vitest pool — mutates the shared node_modules mid-run. Install into an isolated tmp checkout, or set cwd to a tmpdir fixture.`,
      );
    }
  }
}

/**
 * Rule A: a bootstrap spawn (`minsky-init` / `install.sh`) is a violation
 * unless it carries `--skip-install`, targets a non-repo refusal fixture, is a
 * spread-args helper, or the file gates the dangerous path behind a skipIf
 * install-mutation env.
 *
 * @param {string} line
 * @param {string} context
 * @param {boolean} fileHasInstallMutationGate
 * @returns {boolean}
 */
function isBootstrapSpawnViolation(line, context, fileHasInstallMutationGate) {
  if (!BOOTSTRAP_SPAWN_RE.some((re) => re.test(line))) return false;
  // Only a line that READS as a spawn/exec call is a violation — a bare path
  // binding (`const MINSKY_INIT = join(REPO_ROOT, "bin", "minsky-init")`), a
  // `mkdtempSync(…, "minsky-init-host-")` prefix, a describe/test title, or a
  // `.toMatch(/minsky-init/)` assertion mentions the token without spawning
  // it. Same `looksLikeCommand` guard Rule B uses; without it the gate fires
  // on every incidental mention once a file drops its install-mutation skipIf.
  if (!looksLikeCommand(line)) return false;
  if (SKIP_INSTALL_RE.test(context)) return false;
  if (NON_REPO_TARGET_RE.test(context)) return false;
  if (SPREAD_ARGS_RE.test(line)) return false;
  if (fileHasInstallMutationGate) return false;
  return true;
}

/**
 * Rule B: a literal `pnpm install` / `npm ci` is a violation when it reads as
 * a spawn/exec command (not prose) AND its cwd is the repo root (explicit
 * `REPO_ROOT` / repo-root path-join, or an absent `cwd:` — which defaults to
 * the repo root under vitest).
 *
 * @param {string} line
 * @param {string} context
 * @returns {boolean}
 */
function isRepoRootInstallViolation(line, context) {
  if (!(REPO_ROOT_INSTALL_RE.test(line) && looksLikeCommand(line))) return false;
  const cwdMissing = !/\bcwd\s*:/.test(context);
  return REPO_ROOT_CWD_RE.test(context) || cwdMissing;
}

/**
 * Does the file declare a `skipIf(...)` whose condition references an
 * install-mutation opt-in env? Either the `skipIf(...)` condition names the
 * env token directly, or it references a `const X = process.env[...]` binding
 * that resolves to one.
 *
 * @param {string} src
 * @returns {boolean}
 */
function hasInstallMutationSkipIf(src) {
  const gateNames = collectInstallMutationGateNames(src);
  for (const m of src.matchAll(/skipIf\(([^)]*)\)/g)) {
    if (skipIfCondGatesOnInstallMutation(m[1] ?? "", gateNames)) return true;
  }
  return false;
}

/**
 * Names bound to an install-mutation env, e.g.
 * `const RUN_INSTALL_MUTATION = process.env["MINSKY_RUN_INSTALL_MUTATION_TEST"]`.
 *
 * @param {string} src
 * @returns {Set<string>}
 */
function collectInstallMutationGateNames(src) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*process\.env\[[^\]]*\]/g)) {
    const name = m[1];
    const stmt = src.slice(m.index ?? 0, (m.index ?? 0) + 200);
    if (name && INSTALL_MUTATION_ENV_RE.test(stmt)) names.add(name);
  }
  return names;
}

/**
 * @param {string} cond   the `skipIf(...)` condition text
 * @param {Set<string>} gateNames
 * @returns {boolean}
 */
function skipIfCondGatesOnInstallMutation(cond, gateNames) {
  if (INSTALL_MUTATION_ENV_RE.test(cond)) return true;
  for (const name of gateNames) {
    if (new RegExp(`\\b${name}\\b`).test(cond)) return true;
  }
  return false;
}

/**
 * A `pnpm install` / `npm ci` is a real command — not prose — ONLY when the
 * line is a process-spawning call (`spawn`/`spawnSync`/`exec`/`execSync`/
 * `execFile`/`execFileSync`). Prose mentions (test/describe names, assertion
 * strings, object-literal remediation hints, comments) never carry a spawn
 * keyword, so they're excluded — this is what keeps the current tree green
 * (5 such mentions in `019-honest-readme`, `heal-worktree-missing-node-modules`,
 * `post-merge-auto-install`, `check-toolchain`). The bad cases
 * (`spawnSync("pnpm", ["install"], …)`, `execSync("npm ci", { cwd: REPO_ROOT })`)
 * carry the keyword AND the install verb on the same line.
 *
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeCommand(line) {
  return /\b(?:spawn(?:Sync)?|execFileSync|execFile|execSync|exec)\s*\(/.test(line);
}

/**
 * The `±1` line window around line `i` (spawn calls span multiple lines —
 * the command array, options, and a trailing comment can each land on a
 * separate line). Keeps the per-line regexes simple while still seeing the
 * `--skip-install` / `cwd:` / inline-marker that the spawn carries nearby.
 *
 * @param {string[]} lines
 * @param {number} i
 * @returns {string}
 */
function nearbyLines(lines, i) {
  const lo = Math.max(0, i - 2);
  const hi = Math.min(lines.length, i + 3);
  return lines.slice(lo, hi).join("\n");
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isCommentLine(line) {
  return /^\s*(?:\/\/|\*|#)/.test(line);
}

/**
 * Tracked test files: every `*.test.ts` + `*.test.mjs`, excluding `dist/`,
 * `node_modules/`, `.minsky/`, and nested `.worktrees/`. POSIX `find` (the modern-CLI cohort's
 * `fd` may be absent in CI), same shape as sibling lints.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultFileList(repoRoot) {
  try {
    const out = execSync(
      '/usr/bin/find . -type d \\( -name node_modules -o -name dist -o -name .minsky -o -name .git -o -name .worktrees \\) -prune -o -type f \\( -name "*.test.ts" -o -name "*.test.mjs" \\) -print 2>/dev/null',
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^\.\//, ""));
    // rule-6: handled-locally — `find` returning non-zero (no matches /
    // permission) should yield an empty list, not crash the gate.
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkNoRepoRootInstallInTests();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-no-repo-root-install-in-tests: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: a test must never run a real install against the shared repo-root node_modules while the vitest pool is live — it relinks node_modules/.pnpm mid-run and kills tinypool workers. Use --skip-install, an isolated tmp checkout, or gate the path behind an install-mutation opt-in env. See AGENTS.md + TASKS.md `ban-test-real-install-against-repo-root`.",
  );
  process.exit(1);
}
