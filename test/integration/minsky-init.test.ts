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
// smoke-tested here (locates the local checkout + hands off to minsky-init).
// Measurement: this file (opt-in via MINSKY_RUN_INTEGRATION=1 — it shells
// out heavily; lefthook's stripped PATH can't run it reliably).
// Anchor: rule #1 (compose `pnpm install` + bin/minsky init — don't
// reinvent); Forsgren/Humble/Kim *Accelerate* 2018 (install IS the first
// lead-time metric); Krug *Don't Make Me Think* 2014 (one obvious path).
//
// Pattern: integration / CLI seam test (Wirfs-Brock & McKean 2003 — verify
// the contract at the shell-script seam, not in a leaf helper).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  test("from a local checkout: bootstraps a real git host (config written)", () => {
    const host = makeGitHost();
    const { home, stateDir } = makeIsolatedHome();
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      MINSKY_STATE_DIR: stateDir,
      CI: "true",
      // install.sh execs `minsky-init <target>` with no flags, so the
      // bootstrap runs the real `pnpm install` step (idempotent — deps are
      // already present in the dev checkout, so it's a fast no-op resolve).
      // Guard with a generous timeout for the install step regardless.
    };
    const r = spawnSync("sh", [INSTALL_SH, host], {
      encoding: "utf8",
      env,
      timeout: 180_000,
    });
    // Bootstrap may end GREEN (0) or doctor-soft-RED (1) depending on the
    // host's optional CLIs; either way the config must be written.
    expect([0, 1]).toContain(r.status);
    expect(existsSync(join(stateDir, "config.json"))).toBe(true);
  });
});
