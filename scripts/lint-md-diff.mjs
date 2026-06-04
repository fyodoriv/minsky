#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved orchestrator-must-land-local-vetted-branches Pivot (b) — markdownlint diff-scoping factored out of run-pre-pr-lint-stack.mjs (named in that task's **Files** field) so concurrent swarm churn cannot flap an unrelated vetted branch's push -->
// Diff-scoped markdownlint: lint ONLY the *.md files this branch committed vs
// the resolved diff base — never the live `**/*.md` working tree.
//
// Why this exists (TASKS.md `orchestrator-must-land-local-vetted-branches`):
// the canonical pre-PR lint stack's `markdownlint` step previously ran
// `pnpm lint:md` (markdownlint-cli2 over `**/*.md` of the *live working
// tree*). Under the active multi-agent swarm two failure modes flap an
// unrelated, fully-vetted branch's `git push`:
//   1. Concurrent swarm churn — sibling workers re-dirty TASKS.md / vision.md
//      inside the ~100 s pre-push window, so a clean branch's push fails on
//      markdown its own diff never touched (2026-05-17 repro, four attempts
//      logged in `.minsky/prepr*.log`).
//   2. Inherited committed-main debt — markdown that landed via the
//      `@tasks-md/lint`-only carve-out (markdownlint never ran on it) fails
//      every subsequent push regardless of that branch's own changes.
// Linting only the committed branch diff (`<base>...HEAD` — merge-base, so
// immune to working-tree state and to commits on main) kills BOTH: a file
// the branch did not commit can neither flap nor inherit debt onto this
// push. This is the task's Pivot (b) — "scope pre-pr-lint to the committed
// branch diff" — applied to the single empirically-flapping step.
//
// Pattern: deterministic gate over a PR diff (rule #10); pure function over
//   (diffBase, listChangedFiles, runMarkdownlint) with all I/O behind
//   injected seams (rule #2 — the seam is the boundary). Conformance: full —
//   `lintMdDiff` is a pure function; the I/O lives in the `default*` helpers
//   and is replaceable via DI for the paired tests.
// Source: TASKS.md `orchestrator-must-land-local-vetted-branches` Pivot (b);
//   vision.md rule #10 (deterministic enforcement, gating the commit not a
//   race against concurrent unrelated edits). Reuses `resolveDiffBase` from
//   the canonical stack so the diff base never drifts from the other
//   diff-relative lints (rule-1/3/4/6/12).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDiffBase } from "./run-pre-pr-lint-stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Resolve a working git binary. The dotfiles PATH-based wrapper may be
 * blocked in sandbox environments (EPERM on ~/apps/tooling/dotfiles/bin/git).
 * Probe well-known locations first; fall back to plain "git" only as last resort.
 */
function resolveGitBinary() {
  for (const candidate of ["/opt/homebrew/bin/git", "/usr/local/bin/git"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "git";
}
const GIT_BIN = resolveGitBinary();

/**
 * Mirror `package.json` "lint:md"'s exclusion globs. markdownlint-cli2 also
 * honours `.markdownlint.json`'s `ignores`, but pre-filtering the diff list
 * means a swarm-churned ignored path can't even reach the linter — and the
 * "zero files → skip" fast-path then fires whenever the *real* committed
 * diff is entirely ignored paths.
 *
 * @type {readonly string[]}
 */
const IGNORE_PREFIXES = Object.freeze([
  "node_modules/",
  ".worktrees/",
  ".minsky/",
  ".obsidian/",
  ".claude/",
  ".claire/",
]);

/** @type {readonly string[]} */
const IGNORE_EXACT = Object.freeze(["opencode.notes.md"]);

/**
 * `.aider*` — any path segment that starts with `.aider`.
 *
 * @param {string} p
 * @returns {boolean}
 */
function isAiderPath(p) {
  return p.split("/").some((seg) => seg.startsWith(".aider"));
}

/**
 * Pure: from `git diff --name-only` output, keep the *.md files the
 * whole-tree `lint:md` would have linted (same ignore set). Robust to the
 * trailing newline and to CRLF.
 *
 * @param {string} nameOnly  newline-joined paths from `git diff --name-only`
 * @returns {string[]}
 */
export function selectMarkdownFiles(nameOnly) {
  return nameOnly
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((p) => p.length > 0 && p.toLowerCase().endsWith(".md"))
    .filter((p) => !IGNORE_PREFIXES.some((pre) => p.startsWith(pre)))
    .filter((p) => !IGNORE_EXACT.includes(p))
    .filter((p) => !isAiderPath(p));
}

/**
 * @param {string[]} argv
 * @returns {{ diffBase: string | null, diffFile: string | null }}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let diffBase = null;
  /** @type {string | null} */
  let diffFile = null;
  for (const a of argv) {
    const b = /^--diff-base=(.+)$/.exec(a);
    if (b !== null && b[1] !== undefined) {
      diffBase = b[1];
      continue;
    }
    const f = /^--diff=(.+)$/.exec(a);
    if (f !== null && f[1] !== undefined) {
      diffFile = f[1];
    }
  }
  return { diffBase, diffFile };
}

/**
 * Resolve the effective diff base. Precedence (explicit beats heuristic):
 *   1. `--diff-base=<ref>` argv
 *   2. `LINT_MD_DIFF_BASE` env (how the canonical stack injects the
 *      already-resolved base via `withResolvedDiffBase`)
 *   3. `resolveDiffBase()` — the shared freshest-of-mains heuristic, so a
 *      standalone `node scripts/lint-md-diff.mjs` invocation matches the
 *      rest of the diff-relative lints.
 *
 * @param {{ argBase: string | null, env: NodeJS.ProcessEnv }} o
 * @returns {string}
 */
export function effectiveDiffBase({ argBase, env }) {
  if (argBase !== null && argBase.length > 0) return argBase;
  const e = env["LINT_MD_DIFF_BASE"];
  if (e !== undefined && e.length > 0) return e;
  return resolveDiffBase({ env });
}

/**
 * @typedef {object} LintMdResult
 * @property {boolean} ok
 * @property {boolean} skipped   true when the committed diff has no lintable *.md
 * @property {string[]} files
 * @property {number} exitCode
 */

/**
 * Pure orchestration over injected seams. No I/O here — the git read and the
 * markdownlint spawn are passed in, so the paired test exercises every branch
 * (empty diff fast-path, clean, dirty) without a real repo or linter.
 *
 * @param {{
 *   diffBase: string,
 *   listChangedFiles: (base: string) => string,
 *   runMarkdownlint: (files: string[]) => number,
 * }} io
 * @returns {LintMdResult}
 */
export function lintMdDiff(io) {
  const files = selectMarkdownFiles(io.listChangedFiles(io.diffBase));
  if (files.length === 0) {
    return { ok: true, skipped: true, files: [], exitCode: 0 };
  }
  const exitCode = io.runMarkdownlint(files);
  return { ok: exitCode === 0, skipped: false, files, exitCode };
}

/**
 * Default I/O: the committed branch diff. `<base>...HEAD` uses the merge-base
 * so working-tree state and post-branch commits on `base` are invisible —
 * exactly the property that defeats swarm flapping. `--diff-filter=ACMR`
 * drops deletions (a deleted file can't be linted).
 *
 * Let-it-crash (rule #6): a bad/unresolvable `diffBase` makes `git` exit
 * non-zero, `execFileSync` throws, the gate goes red with git's message.
 * Silently passing on an unknown base would defeat the gate — crashing loud
 * is the correct behaviour, so this boundary is intentionally un-caught.
 *
 * @param {string} diffBase
 * @returns {string}
 */
function defaultListChangedFiles(diffBase) {
  return execFileSync(
    GIT_BIN,
    ["diff", "--name-only", "--diff-filter=ACMR", `${diffBase}...HEAD`],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
}

/**
 * Default I/O: run markdownlint-cli2 over exactly the diff's *.md files.
 * `pnpm exec` resolves the repo-pinned CLI (same binary `lint:md` uses, so
 * local and CI share one markdownlint version). `stdio: "inherit"` lets the
 * findings reach the pre-PR stack's captured stderr tail unchanged.
 *
 * @param {string[]} files
 * @returns {number}
 */
function defaultRunMarkdownlint(files) {
  const r = spawnSync("pnpm", ["exec", "markdownlint-cli2", ...files], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return typeof r.status === "number" ? r.status : 1;
}

function main() {
  const { diffBase: argBase, diffFile } = parseArgs(process.argv.slice(2));
  const diffBase = effectiveDiffBase({ argBase, env: process.env });
  /** @type {(base: string) => string} */
  const listChangedFiles =
    diffFile !== null ? () => readFileSync(diffFile, "utf8") : defaultListChangedFiles;
  const result = lintMdDiff({
    diffBase,
    listChangedFiles,
    runMarkdownlint: defaultRunMarkdownlint,
  });
  process.stdout.write(
    result.skipped
      ? `lint-md-diff: no committed *.md changes vs ${diffBase} — skip\n`
      : `lint-md-diff: ${result.files.length} file(s) vs ${diffBase} — ${result.ok ? "clean" : "FAIL"}\n`,
  );
  process.exit(result.exitCode === 0 ? 0 : 1);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
