#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-16 operator "build the best solution for autonomous opus, we're here for the long game" — runany-zero-arg-entrypoint Acceptance (4) measurement artifact -->
//
// `runany-zero-arg-entrypoint` Acceptance (4) measurement harness.
//
// The task's `**Measurement**` field is a shell one-liner with a
// `<5 fixtures>` placeholder — an English instruction, not a runnable
// command. Rule #9 (pre-registered hypothesis) requires "the exact
// runnable command … that produces the observable. No English
// instructions, no manual steps." This script IS that command: it
// builds the 5 distinct folder types, launches the zero-arg conductor
// in each exactly as `bin/minsky` does (`MINSKY_HOME` unset → the
// conductor self-resolves scope from cwd via `detectConductorRoot`),
// confirms the process comes up scoped to that folder, then SIGTERMs
// it (the `minsky stop` equivalent).
//
//   Hypothesis: zero-arg launch succeeds (conductor up, scoped to the
//   cwd tree) in 5/5 distinct folder types.
//   Success: prints `5/5 ok`, exit 0.   Pivot: <5 → exit 1.
//
// Composes the existing conductor + cwd resolver (rule #1 — no new
// orchestrator). Runs with `MINSKY_ORCH_DRY=1` so the gate sweep is
// vet-only: no live `gh pr merge`, no ledger write, so the harness is
// safe to re-run against any machine. Note: a real zero-arg launch
// also heals the Sonnet worker daemon if it is down; this harness
// faithfully reproduces that, so it will kickstart
// `com.minsky.opus-sonnet-run` when that agent is loaded but down. Run
// it when that is acceptable, or pre-start the worker.
//
// Usage: node scripts/runany-zero-arg-measure.mjs [--keep]
//   --keep : leave the tmp fixture tree on disk for inspection.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolvePath(SCRIPT_DIR, "..");
const CONDUCTOR = join(REPO_ROOT, "scripts", "orchestrate.mjs");
const UP_DEADLINE_MS = 8000; // mirror the task's `sleep 8` window
const POLL_MS = 200;

// The conductor's startup line: `orchestrate: start <ts> root=<dir> …`.
// `root=` is the resolved scope — the "it's up AND scoped to where I
// launched it" proof (stronger than the task's bare `pgrep` check).
const START_RE = /orchestrate: start \S+ root=(\S+)/;

/**
 * Init a throwaway tmp fixture repo. `core.hooksPath=` (empty) +
 * `--no-verify` isolate it from the operator's global commit-msg /
 * lefthook hooks — these are disposable tmpdir repos that never get
 * pushed, so the global no-verify-on-remote rule does not apply.
 * @param {string} dir
 */
function gitInit(dir) {
  /** @param {string[]} a */
  const g = (a) =>
    execFileSync("git", ["-C", dir, "-c", "core.hooksPath=", ...a], { encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "measure@minsky.local"]);
  g(["config", "user.name", "measure"]);
  g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  g(["add", "README.md"]);
  g(["commit", "-q", "--no-verify", "-m", "init"]);
}

/**
 * Build the 5 distinct folder types the acceptance enumerates.
 * @param {string} base
 * @returns {{name: string, dir: string}[]}
 */
function buildFixtures(base) {
  // 1. plain git repo
  const gitRepo = join(base, "git-repo");
  mkdirSync(gitRepo, { recursive: true });
  gitInit(gitRepo);

  // 2. nested-repos tree (parent is NOT a repo; 2 child repos)
  const nested = join(base, "nested-repos");
  mkdirSync(join(nested, "a"), { recursive: true });
  mkdirSync(join(nested, "b"), { recursive: true });
  gitInit(join(nested, "a"));
  gitInit(join(nested, "b"));

  // 3. plain dir (no git)
  const plain = join(base, "plain-dir");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, "notes.txt"), "no git here\n");

  // 4. monorepo (single git root, package subdirs, no nested .git)
  const mono = join(base, "monorepo");
  mkdirSync(join(mono, "packages", "x"), { recursive: true });
  mkdirSync(join(mono, "packages", "y"), { recursive: true });
  gitInit(mono);

  // 5. detached worktree (.git is a FILE pointing at the main gitdir)
  const wtBase = join(base, "wt-base");
  mkdirSync(wtBase, { recursive: true });
  gitInit(wtBase);
  const worktree = join(base, "detached-worktree");
  execFileSync("git", ["-C", wtBase, "worktree", "add", "-q", worktree, "-b", "measure-wt"], {
    encoding: "utf8",
  });

  return [
    { name: "git-repo", dir: gitRepo },
    { name: "nested-repos", dir: nested },
    { name: "plain-dir", dir: plain },
    { name: "monorepo", dir: mono },
    { name: "detached-worktree", dir: worktree },
  ];
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Conductor child wrapper: spawns the zero-arg conductor and exposes
 * its accumulated output + exit state. Spawning matches `bin/minsky`'s
 * zero-arg path exactly: `MINSKY_HOME` unset (scope self-resolves from
 * cwd) + `MINSKY_ORCH_DRY=1` (vet-only sweep, no live merge). A long
 * interval keeps it to a single tick within the probe window.
 * @param {string} dir
 */
function spawnConductor(dir) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, MINSKY_ORCH_DRY: "1", MINSKY_ORCH_INTERVAL_MS: "3600000" };
  env["MINSKY_HOME"] = undefined; // mirror `exec env -u MINSKY_HOME`
  const child = spawn("node", [CONDUCTOR], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  const state = { out: "", exited: false };
  const append = (/** @type {Buffer} */ b) => {
    state.out += String(b);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", () => {
    state.exited = true;
  });
  return { child, state };
}

/**
 * Poll until the conductor logs its startup+scope line (the
 * `pgrep -f scripts/orchestrate.mjs` "it's up" equivalent, with the
 * resolved root for the scoping assertion) or it exits / the deadline
 * passes. Returns the captured root or "".
 * @param {{out: string, exited: boolean}} state
 * @returns {Promise<string>}
 */
async function waitForScope(state) {
  const start = Date.now();
  const grab = () => state.out.match(START_RE)?.[1] ?? "";
  while (Date.now() - start < UP_DEADLINE_MS && !state.exited) {
    const root = grab();
    if (root) return root;
    await sleep(POLL_MS);
  }
  return grab();
}

/**
 * SIGTERM the conductor (the `minsky stop` equivalent); escalate to
 * SIGKILL if it has not exited within the grace window.
 * @param {import("node:child_process").ChildProcess} child
 * @param {{exited: boolean}} state
 */
async function terminate(child, state) {
  child.kill("SIGTERM");
  for (let i = 0; i < 25 && !state.exited; i++) await sleep(POLL_MS);
  if (!state.exited) child.kill("SIGKILL");
}

/** @param {string} p */
const norm = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Launch the zero-arg conductor in `dir`, confirm it comes up scoped to
 * that folder (resolved `root=` equals the launch dir), then stop it.
 * @param {string} dir
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
async function launchAndProbe(dir) {
  const { child, state } = spawnConductor(dir);
  const root = await waitForScope(state);
  const up = root !== "" && !state.exited;
  const scoped = up && norm(root) === norm(dir);
  await terminate(child, state);
  if (!up) {
    return {
      ok: false,
      detail: state.exited ? "process exited before start log" : "no start log in 8s",
    };
  }
  return scoped
    ? { ok: true, detail: `root=${root}` }
    : { ok: false, detail: `scope mismatch: root=${root} ≠ launch dir ${dir}` };
}

async function main() {
  const keep = process.argv.includes("--keep");
  const base = mkdtempSync(join(tmpdir(), "runany-measure-"));
  let pass = 0;
  const fixtures = buildFixtures(base);
  try {
    for (const f of fixtures) {
      const r = await launchAndProbe(f.dir);
      if (r.ok) pass++;
      process.stdout.write(`${r.ok ? "ok  " : "FAIL"} ${f.name.padEnd(18)} ${r.detail}\n`);
    }
  } finally {
    if (keep) process.stdout.write(`\nfixtures kept at ${base}\n`);
    else rmSync(base, { recursive: true, force: true });
  }
  process.stdout.write(`\n${pass}/${fixtures.length} ok\n`);
  process.exit(pass === fixtures.length ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `runany-zero-arg-measure: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
