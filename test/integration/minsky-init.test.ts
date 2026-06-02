// Tests for minsky-init-one-command-bootstrap
// Integration tests for `bin/minsky-init` — the one-command bootstrap
// entry point (P0, M1). The task ID above is a self-doc header (matched
// by check-task-block-citations' SELF_DOC_LINE_RE), not a freeform
// citation — the TASKS.md block is closed in this same commit.
//
// Hypothesis (rule #9): collapsing the install chain (git clone + pnpm
// install + per-machine config + plugin install) into a single command
// drops time-to-first-iteration from >10 min to <3 min on a Node ≥20 box.
// The substrate invariant this file pins: `bin/minsky-init` (a) refuses
// non-repos loudly (exit 2, no silent fallback — rule #6), (b) writes
// ~/.minsky/config.json by delegating to `bin/minsky init` (one canonical
// config path — rule #1), and (c) runs `minsky doctor` and prints the
// one-line start command (`minsky`). If these hold, the operator-facing
// one-command flow works on a fresh machine.
// Success: every test below passes against the real bin/minsky-init with a
// temporary MINSKY_STATE_DIR + fresh tmp git host.
// Pivot: if the in-repo `npx`/bin entry point proves infeasible, the
// curl-pipe-sh variant (distribution/install.sh) is the fallback — also
// smoke-tested here (locates the local checkout + hands off to minsky-init),
// including a hermetic real-`pnpm install` smoke that runs install.sh from an
// ISOLATED tree-copy so the shared repo node_modules is never mutated.
// Measurement: this file (opt-in via MINSKY_RUN_INTEGRATION=1 — it shells
// out heavily; lefthook's stripped PATH can't run it reliably).
// Anchor: rule #1 (compose `pnpm install` + bin/minsky init — don't
// reinvent); Forsgren/Humble/Kim *Accelerate* 2018 (install IS the first
// lead-time metric); Krug *Don't Make Me Think* 2014 (one obvious path).
//
// Pattern: integration / CLI seam test (Wirfs-Brock & McKean 2003 — verify
// the contract at the shell-script seam, not in a leaf helper).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_INIT = join(REPO_ROOT, "bin", "minsky-init");
const INSTALL_SH = join(REPO_ROOT, "distribution", "install.sh");

const RUN_INTEGRATION =
  process.env["MINSKY_RUN_INTEGRATION"] === "1" ||
  process.env["CI"] === "true" ||
  process.env["VITEST_INTEGRATION"] === "1";

/**
 * Build a fresh tmp git host with one commit (minsky-init refuses
 * non-repos). Returns the absolute host dir.
 */
function makeGitHost(): string {
  const host = mkdtempSync(join(tmpdir(), "minsky-init-host-"));
  execFileSync("git", ["init", "--quiet"], { cwd: host });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: host });
  execFileSync("git", ["config", "user.name", "test"], { cwd: host });
  writeFileSync(join(host, "README.md"), "# host\n");
  execFileSync("git", ["add", "-A"], { cwd: host });
  execFileSync("git", ["commit", "-m", "init", "--quiet", "--no-verify"], { cwd: host });
  return host;
}

/** Fresh isolated HOME + MINSKY_STATE_DIR so the test never touches the real one. */
function makeIsolatedHome(): { home: string; stateDir: string } {
  const home = mkdtempSync(join(tmpdir(), "minsky-init-home-"));
  return { home, stateDir: join(home, ".minsky") };
}

/**
 * Copy the minsky tree (sans `node_modules`/`.git`/`dist`/worktrees) into a
 * fresh tmpdir so the real-`pnpm install` bootstrap path runs HERMETICALLY —
 * `bin/minsky-init` resolves $MINSKY_ROOT from its own location, so when it's
 * spawned from the copy it installs into the COPY's node_modules, never the
 * shared repo-root tree the vitest pool depends on (Meszaros 2007 "Fresh
 * Fixture" — a test owns and isolates its fixture). Excludes node_modules
 * (the whole point), `.git` (no history needed), `dist` (rebuilt by the
 * prepare hook), and the worktrees/coverage scratch dirs (irrelevant +
 * heavy). `rsync -a` is POSIX-ubiquitous and copies ~12 MB in ~1s.
 */
function makeIsolatedCheckout(): string {
  const dest = join(mkdtempSync(join(tmpdir(), "minsky-init-iso-")), "copy");
  execFileSync(
    "rsync",
    [
      "-a",
      "--exclude=node_modules",
      "--exclude=.git",
      "--exclude=dist",
      "--exclude=.worktrees",
      "--exclude=coverage",
      `${REPO_ROOT}/`,
      `${dest}/`,
    ],
    { timeout: 60_000 },
  );
  return dest;
}

/**
 * Resolve the shared repo's `tinypool/dist/entry/process.js` — the file whose
 * disappearance mid-run kills live vitest workers ("Cannot find module
 * .../tinypool/dist/entry/process.js"). pnpm stores it under a hashed
 * `.pnpm/tinypool@<ver>/...` dir, so glob for it. Returns null if not found
 * (e.g. a non-pnpm install layout) — the caller then skips the untouched
 * assertion rather than crash.
 */
function findSharedTinypoolEntry(): string | null {
  const matches = globSync(
    "node_modules/.pnpm/tinypool@*/node_modules/tinypool/dist/entry/process.js",
    { cwd: REPO_ROOT },
  );
  const direct = "node_modules/tinypool/dist/entry/process.js";
  const rel = matches[0] ?? (existsSync(join(REPO_ROOT, direct)) ? direct : null);
  return rel === null ? null : join(REPO_ROOT, rel);
}

/** A `{mtimeMs, size}` snapshot of a file, or null if it's absent. */
function statSnapshot(path: string | null): { mtimeMs: number; size: number } | null {
  if (path === null || !existsSync(path)) return null;
  const s = statSync(path);
  return { mtimeMs: s.mtimeMs, size: s.size };
}

/**
 * Spawn `bin/minsky-init <args...>` with an isolated env. `CI=true`
 * forces no-color + non-TTY so assertions match on plain text. Returns
 * the result for assertion without throwing on non-zero exit.
 */
function runInit(
  args: readonly string[],
  opts: { home: string; stateDir: string },
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: opts.home,
    MINSKY_STATE_DIR: opts.stateDir,
    CI: "true",
  };
  const r = spawnSync("bash", [MINSKY_INIT, ...args], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

describe.skipIf(!RUN_INTEGRATION)("bin/minsky-init — one-command bootstrap", () => {
  test("refuses a non-git-repo target: exit 2 + actionable error, no config written", () => {
    const { home, stateDir } = makeIsolatedHome();
    const nonRepo = mkdtempSync(join(tmpdir(), "minsky-init-nonrepo-"));
    const r = runInit([nonRepo], { home, stateDir });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/is not a git repo/);
    // rule #6 — no silent fallback: nothing written for a bad target.
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
  });

  test("--skip-install bootstrap: writes ~/.minsky/config.json + doctor GREEN + prints `minsky`", () => {
    const host = makeGitHost();
    const { home, stateDir } = makeIsolatedHome();
    const r = runInit(["--skip-install", host], { home, stateDir });
    expect(r.status).toBe(0);
    // The config file MUST be written (delegated to bin/minsky init).
    const configPath = join(stateDir, "config.json");
    expect(existsSync(configPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { default_host?: string };
    // default_host resolves to the fresh host (macOS /private symlink-aware).
    expect(cfg.default_host).toMatch(new RegExp(host.replace(/^\/private/, "/?.*?/?")));
    // The one-line start command is printed (rule #11 — one obvious path).
    expect(r.stdout).toMatch(/Next: start an iteration/);
    expect(r.stdout).toMatch(/\bminsky\b/);
  });

  test("--doctor mode is read-only: runs checks, writes NO config", () => {
    const host = makeGitHost();
    const { home, stateDir } = makeIsolatedHome();
    const r = runInit(["--doctor", host], { home, stateDir });
    expect(r.status).toBe(0);
    // Dry diagnostic — must not have written the per-machine config.
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
    expect(r.stdout).toMatch(/minsky doctor/);
  });

  test("unknown flag: exit 2 with usage hint", () => {
    const { home, stateDir } = makeIsolatedHome();
    const r = runInit(["--bogus"], { home, stateDir });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown flag/);
  });

  test("idempotent: re-running --skip-install on an already-bootstrapped host stays GREEN", () => {
    const host = makeGitHost();
    const { home, stateDir } = makeIsolatedHome();
    const first = runInit(["--skip-install", host], { home, stateDir });
    expect(first.status).toBe(0);
    const second = runInit(["--skip-install", host], { home, stateDir });
    expect(second.status).toBe(0);
    expect(existsSync(join(stateDir, "config.json"))).toBe(true);
  });

  test("--help prints the usage header without mutating anything", () => {
    const { home, stateDir } = makeIsolatedHome();
    const r = runInit(["--help"], { home, stateDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/minsky-init/);
    expect(r.stdout).toMatch(/one-command/);
    expect(existsSync(join(stateDir, "config.json"))).toBe(false);
  });
});

describe.skipIf(!RUN_INTEGRATION)("distribution/install.sh — curl-pipe-sh fallback", () => {
  test("from a local checkout: locates bin/minsky-init and hands off (refuses non-repo)", () => {
    // When run from inside the checkout (script lives at
    // distribution/install.sh), install.sh must NOT clone — it reuses the
    // local tree and execs bin/minsky-init. We assert via the non-repo
    // refusal path so the test needs no network.
    const { home, stateDir } = makeIsolatedHome();
    const nonRepo = mkdtempSync(join(tmpdir(), "minsky-install-nonrepo-"));
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      MINSKY_STATE_DIR: stateDir,
      CI: "true",
    };
    const r = spawnSync("sh", [INSTALL_SH, nonRepo], {
      encoding: "utf8",
      env,
      timeout: 30_000,
    });
    // Handed off to minsky-init, which refuses the non-repo with exit 2.
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/is not a git repo/);
    // Used the local checkout — no clone into ~/.minsky-src.
    expect(existsSync(join(home, ".minsky-src"))).toBe(false);
  });

  test("real-install smoke: bootstraps a real host from an ISOLATED checkout (config written, shared node_modules untouched)", () => {
    // repo-root-install-ok: install.sh runs the real `pnpm install`, but
    // against an ISOLATED tree-copy (`iso`), not the shared repo root —
    // `bin/minsky-init` resolves $MINSKY_ROOT from its own location, so
    // installing from the copy mutates the copy's node_modules, never the
    // shared tree the live vitest pool depends on. This restores CI
    // coverage of the install.sh → minsky-init → real-`pnpm install` →
    // config path without the tinypool-worker corruption that forced the
    // #1028 opt-in gate (Meszaros 2007 "Fresh Fixture").
    const iso = makeIsolatedCheckout();
    const isoInstall = join(iso, "distribution", "install.sh");
    const host = makeGitHost();
    const { home, stateDir } = makeIsolatedHome();

    // Pin the shared tree's vitest-worker entry BEFORE the install runs; it
    // must be byte-for-byte identical AFTER (the install hit the copy only).
    const tinypool = findSharedTinypoolEntry();
    const before = statSnapshot(tinypool);

    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      MINSKY_STATE_DIR: stateDir,
      CI: "true",
    };
    const r = spawnSync("sh", [isoInstall, host], {
      encoding: "utf8",
      env,
      timeout: 90_000,
    });

    // Bootstrap may end GREEN (0) or doctor-soft-RED (1) depending on the
    // host's optional CLIs; either way the config must be written.
    expect([0, 1]).toContain(r.status);
    expect(existsSync(join(stateDir, "config.json"))).toBe(true);
    // The real install ran in the isolated copy, not the shared root.
    expect(existsSync(join(iso, "node_modules"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "node_modules"))).toBe(true);
    // The shared vitest-worker entry is provably untouched (the failure mode
    // #1028 guarded against was this file vanishing mid-run).
    const after = statSnapshot(tinypool);
    expect(after).toEqual(before);
  }, 120_000);
});
