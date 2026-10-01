#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved runany-zero-arg-entrypoint — zero-arg context resolver + multi-root scoping for `minsky` (no args) run in any folder -->
//
// `minsky` zero-arg context resolver. When the operator runs `minsky` with
// NO arguments in an arbitrary folder, the smart-auto-attach block in
// `bin/minsky` needs to answer one question deterministically: which host(s)
// should the conductor be scoped to? This module IS that answer — a pure
// decision over the cwd's filesystem shape, with the I/O (readdir / .git
// probe) injected as seams so the decision is unit-testable (rule #10 —
// no I/O in the decision; the I/O lives in `defaultListEntries` /
// `defaultIsGitRepo` at the module edge).
//
// The three shapes the resolver recognises (Acceptance #2 — git-repo /
// nested-repos / plain-dir, plus monorepo + detached-worktree from the
// Success criterion's 5 folder types):
//   - `git-repo`     — cwd itself is a git repo (`.git` present). Scope to
//                      that single host (`--host <cwd>`). Nested repos
//                      inside it are submodule/vendored noise, NOT separate
//                      conductor targets (Pivot — scope to the cwd repo
//                      only when multi-root is unsafe; a git-repo cwd is
//                      exactly that case).
//   - `nested-repos` — cwd is NOT a git repo but contains >=1 nested git
//                      repo one level down. Scope to the whole tree
//                      (`--hosts-dir <cwd>`) so the conductor walks every
//                      child repo (the cross-repo-runner's native multi-host
//                      mode).
//   - `plain-dir`    — cwd is neither a git repo nor a parent of any. Scope
//                      to the single dir as a host (`--host <cwd>`); the
//                      runner treats a plain dir as a degenerate one-host
//                      walk (Saltzer & Schroeder 1975 — least-surprise:
//                      zero args still does *something* sensible).
//
// Pattern: Strategy boundary (rule #2) — `resolveRunanyContext` is pure over
//   injected probes; `defaultListEntries` / `defaultIsGitRepo` are the I/O
//   implementations. Deterministic decision (rule #10). Conformance: full.
// Source: TASKS.md `runany-zero-arg-entrypoint`; operator directive (verbatim
//   in that task block: "`minsky` with NO args, run in any folder, starts the
//   orchestrator scoped to that folder + all subfolders"); Saltzer &
//   Schroeder 1975 (least-surprise default — zero config); rule #1 (compose
//   the existing `--host` / `--hosts-dir` runner modes, no new orchestrator).

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * @typedef {"git-repo" | "nested-repos" | "plain-dir"} ContextKind
 */

/**
 * @typedef {object} RunanyContext
 * @property {string} contextRoot   absolute path the conductor is scoped against (the cwd)
 * @property {ContextKind} kind
 * @property {readonly string[]} repos   absolute paths of git repos in scope (the cwd itself for git-repo; the nested children for nested-repos; empty for plain-dir)
 * @property {"single-host" | "multi-host"} scope
 */

/**
 * @typedef {object} ResolveOpts
 * @property {string} cwd                              absolute cwd to resolve
 * @property {(dir: string) => readonly string[]} [listEntries]   list immediate child directory names of `dir`
 * @property {(dir: string) => boolean} [isGitRepo]   true iff `dir` is a git repo (`.git` present)
 */

/**
 * Pure: resolve the zero-arg launch context from the cwd's filesystem shape.
 * No process spawning, no PID files — just "what should we scope to". The
 * caller (`bin/minsky`) turns the result into `--host` / `--hosts-dir` argv
 * via {@link selectLaunchArgs}.
 *
 * @param {ResolveOpts} opts
 * @returns {RunanyContext}
 */
export function resolveRunanyContext(opts) {
  const listEntries = opts.listEntries ?? defaultListEntries;
  const isGitRepo = opts.isGitRepo ?? defaultIsGitRepo;
  const contextRoot = resolve(opts.cwd);

  // 1. cwd is itself a git repo -> single host, scope to it (Pivot: nested
  //    repos under a git repo are submodules/vendored, not separate targets).
  if (isGitRepo(contextRoot)) {
    return {
      contextRoot,
      kind: "git-repo",
      repos: [contextRoot],
      scope: "single-host",
    };
  }

  // 2. cwd is not a repo but has nested repos one level down -> multi-host
  //    walk over the whole tree. Sorted for deterministic output (the test
  //    fixtures and the operator both see a stable ordering).
  const nested = listEntries(contextRoot)
    .map((name) => join(contextRoot, name))
    .filter((child) => isGitRepo(child))
    .sort();
  if (nested.length > 0) {
    return {
      contextRoot,
      kind: "nested-repos",
      repos: nested,
      scope: "multi-host",
    };
  }

  // 3. neither -> plain dir, treat as a degenerate single host.
  return {
    contextRoot,
    kind: "plain-dir",
    repos: [],
    scope: "single-host",
  };
}

/**
 * Pure: map a resolved context to the `bin/minsky` daemon argv that scopes
 * the conductor. `single-host` -> `["--host", root]`; `multi-host` ->
 * `["--hosts-dir", root]` (the cross-repo-runner walks every child repo).
 *
 * @param {RunanyContext} ctx
 * @returns {readonly string[]}
 */
export function selectLaunchArgs(ctx) {
  if (ctx.scope === "multi-host") return ["--hosts-dir", ctx.contextRoot];
  return ["--host", ctx.contextRoot];
}

/**
 * I/O edge: list immediate child *directory* names of `dir`. Missing /
 * unreadable dir degrades to `[]` (rule #6 — a probe failure must not crash
 * the zero-arg launch; an empty list just routes to the plain-dir branch).
 *
 * @param {string} dir
 * @returns {readonly string[]}
 */
export function defaultListEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
    // rule-6: handled-locally — readdir throws on a missing/unreadable dir;
    // that is the I/O boundary, not a programming bug. The empty list routes
    // the resolver to plain-dir, which is the correct degraded default.
  } catch {
    return [];
  }
}

/**
 * I/O edge: true iff `dir` contains a `.git` entry (file OR directory — a
 * worktree checkout has a `.git` *file* pointing at the real gitdir, which is
 * the detached-worktree folder type from the Success criterion).
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function defaultIsGitRepo(dir) {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return false;
  try {
    const st = statSync(dotGit);
    return st.isDirectory() || st.isFile();
    // rule-6: handled-locally — a TOCTOU race (dir removed between existsSync
    // and statSync) degrades to "not a repo", never a crash.
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- CLI -------
// `node scripts/runany-context.mjs [cwd] [--json]` — prints the launch argv
// the bash shim should pass to the daemon. Default output is the space-joined
// argv (`--host /abs/path` or `--hosts-dir /abs/path`) so `bin/minsky` can
// `read` it directly; `--json` emits the full RunanyContext for tooling.

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]).endsWith("runany-context.mjs");

if (invokedAsScript) {
  const rest = process.argv.slice(2).filter((a) => a !== "--json");
  const json = process.argv.includes("--json");
  const cwd = rest[0] ?? process.cwd();
  const ctx = resolveRunanyContext({ cwd });
  if (json) {
    process.stdout.write(`${JSON.stringify(ctx)}\n`);
  } else {
    process.stdout.write(`${selectLaunchArgs(ctx).join(" ")}\n`);
  }
}
