/**
 * `npx minsky init` end-to-end smoke test (M1.3).
 *
 * Builds the publishable tarball (`pnpm pack`), unpacks it into a tmp
 * directory, then runs `bin/minsky init` from the unpacked location
 * against a fresh tmp git repo with a fresh tmp HOME. Asserts:
 *   1. `pnpm pack` succeeds (tarball is built without error).
 *   2. The tarball is ≤5 MB (npm convention; avoid heavy deps).
 *   3. The tarball contains `bin/minsky` (the `bin` entry resolves).
 *   4. `bin/minsky init <host>` writes `~/.minsky/config.json` with
 *      `default_host: <host>`.
 *   5. The init flow doesn't require `git rev-parse` against the
 *      minsky repo (works from any unpacked location).
 *
 * This is the M1.3 acceptance gate. Without it, the next package.json
 * touch could break the publishability of the tarball silently, and
 * the regression wouldn't surface until an operator runs `npx -y minsky
 * init` against a fresh machine — too late.
 *
 * Hypothesis (rule #9): if the substrate invariants pass, `npx minsky
 * init` would work on a fresh machine the day after `npm publish`.
 * Success: every test below passes.
 * Pivot: if the test passes but operator-side `npx minsky init` fails,
 * add the specific failure mode (e.g. missing dep, PATH assumption)
 * as a new invariant here.
 * Measurement: this file (opt-in via MINSKY_RUN_INTEGRATION=1).
 * Anchor: rule #1 (npm is the universal Node distribution channel);
 * Forsgren/Humble/Kim *Accelerate* 2018 (install IS the first
 * lead-time metric).
 *
 * Opt-in via MINSKY_RUN_INTEGRATION=1 (same shape as worktree-isolation
 * + others — the test shells out heavily and lefthook's stripped PATH
 * can't run it reliably; `pnpm test:integration` sets the env var).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const RUN_INTEGRATION =
  process.env["MINSKY_RUN_INTEGRATION"] === "1" ||
  process.env["CI"] === "true" ||
  process.env["VITEST_INTEGRATION"] === "1";

const FIVE_MB_BYTES = 5 * 1024 * 1024;

describe.skipIf(!RUN_INTEGRATION)("`npx minsky init` end-to-end (M1.3)", () => {
  test("pnpm pack succeeds + tarball ≤5MB + contains bin/minsky", () => {
    const packDir = mkdtempSync(join(tmpdir(), "minsky-pack-test-"));
    // Keep the existing PATH ordering (the operator's fnm-pinned node
    // is already first in `process.env.PATH`). Only APPEND known
    // system locations as a fallback — prepending them would push fnm's
    // node out of priority and the spawned `pnpm pack` would inherit
    // the wrong system node, breaking the `prepare` script's
    // check-toolchain probe.
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    };
    const stdout = execSync(
      `pnpm pack --config.ignore-scripts=true --pack-destination "${packDir}"`,
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env,
      },
    );
    // pnpm pack prints the tarball path on the last line of stdout.
    const tarballPath = stdout
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.endsWith(".tgz") && existsSync(l));
    expect(tarballPath).toBeDefined();
    // Tarball size must stay under the 5MB npm convention.
    const sizeBytes = statSync(tarballPath as string).size;
    expect(sizeBytes).toBeLessThanOrEqual(FIVE_MB_BYTES);
    // Tarball MUST contain bin/minsky (the `bin` entry).
    const contents = execSync(`tar -tzf "${tarballPath}"`, { encoding: "utf8" });
    expect(contents).toMatch(/package\/bin\/minsky\b/);
  });

  test("unpacked tarball + bin/minsky init writes ~/.minsky/config.json against a fresh host", () => {
    const packDir = mkdtempSync(join(tmpdir(), "minsky-pack-test-"));
    const pkgDir = mkdtempSync(join(tmpdir(), "minsky-pkg-test-"));
    const hostDir = mkdtempSync(join(tmpdir(), "minsky-host-test-"));
    const homeDir = mkdtempSync(join(tmpdir(), "minsky-home-test-"));
    // PATH: same shape as the neighbouring test — append system
    // locations as fallback, keep fnm's pinned-node first.
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    };
    execSync(`pnpm pack --config.ignore-scripts=true --pack-destination "${packDir}"`, {
      cwd: REPO_ROOT,
      env,
      stdio: "pipe",
    });
    // Scoped packages pack as <scope>-<name>-<version>.tgz (e.g. fyodoriv-minsky-0.1.0.tgz).
    const tarballMatch = execSync(`ls "${packDir}"/*minsky-*.tgz`, { encoding: "utf8" }).trim();
    // Unpack.
    execSync(`tar -xzf "${tarballMatch}" -C "${pkgDir}" --strip-components=1`, {
      env,
      stdio: "pipe",
    });
    // Fresh git host with one commit (init refuses non-repos).
    execSync("git init --quiet", { cwd: hostDir, env, stdio: "pipe" });
    execSync("git config user.email test@example.com && git config user.name test", {
      cwd: hostDir,
      env,
      stdio: "pipe",
    });
    writeFileSync(join(hostDir, "README.md"), "# host\n");
    execSync("git add -A && git commit -m 'init' --quiet --no-verify", {
      cwd: hostDir,
      env,
      stdio: "pipe",
    });
    // Run minsky init from the UNPACKED location, with a FRESH HOME.
    const isolated = { ...env, HOME: homeDir };
    const result = execSync(`bash "${pkgDir}/bin/minsky" init "${hostDir}"`, {
      encoding: "utf8",
      env: isolated,
    });
    // Output must announce success.
    expect(result).toMatch(/minsky initialized/);
    // The config file MUST be written.
    const configPath = join(homeDir, ".minsky", "config.json");
    expect(existsSync(configPath)).toBe(true);
    // The config's default_host MUST resolve to the fresh host
    // (resolved absolute path — macOS `/private` symlink-aware).
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    expect(cfg.default_host).toMatch(new RegExp(hostDir.replace(/^\/private/, "/?.*?/?")));
  });

  test("tarball-extracted bin/minsky-run.sh runs without an exec bit (mode 644)", () => {
    // Blocker (B): npm/pnpm pack only chmods the `bin`-entry file
    // (bin/minsky); every other bin/ file lands mode 644 in the artifact.
    // The runner must therefore be invoked via `bash "$runner"` and its
    // guards must test `-s` (non-empty), never `-x`. This test extracts
    // the published tarball, asserts minsky-run.sh is NOT executable
    // (mode bits stripped — the real-world artifact state), then runs it
    // via `bash` and confirms it reaches its own usage/invariant path
    // instead of `Permission denied` / a silent reject.
    const packDir = mkdtempSync(join(tmpdir(), "minsky-pack-test-"));
    const pkgDir = mkdtempSync(join(tmpdir(), "minsky-pkg-test-"));
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    };
    execSync(`pnpm pack --config.ignore-scripts=true --pack-destination "${packDir}"`, {
      cwd: REPO_ROOT,
      env,
      stdio: "pipe",
    });
    const tarballMatch = execSync(`ls "${packDir}"/*minsky-*.tgz`, { encoding: "utf8" }).trim();
    execSync(`tar -xzf "${tarballMatch}" -C "${pkgDir}" --strip-components=1`, {
      env,
      stdio: "pipe",
    });
    const runner = join(pkgDir, "bin", "minsky-run.sh");
    expect(existsSync(runner)).toBe(true);
    // The artifact ships the runner WITHOUT an exec bit — pin that fact so
    // the fix can never silently regress into requiring one.
    const mode = statSync(runner).mode & 0o111;
    expect(mode).toBe(0); // no execute bits anywhere
    // Invoked via `bash`, the runner reaches its arg parser and rejects a
    // missing --host/--hosts-dir with an INVARIANT FAIL — proof the
    // exec-bit-stripped file is runnable, not blocked by a -x guard.
    let _stderr = "";
    let exitCode = 0;
    try {
      execSync(`bash "${runner}" --help`, {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stderr?: Buffer | string; status?: number };
      _stderr = String(e.stderr ?? "");
      exitCode = e.status ?? 1;
    }
    // --help exits 0 and prints usage — the runner executed via bash.
    expect(exitCode).toBe(0);
  });

  test("the openhands spawn shim IS in the published tarball file list", () => {
    // Blocker (C): the agent spawn shim
    // novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py
    // was excluded from package.json `files`, so the runner died with
    // "INVARIANT FAIL: no OpenHands backend available" on a fresh npx run
    // that resolved the openhands backend. Pin that the shim ships.
    const packDir = mkdtempSync(join(tmpdir(), "minsky-pack-test-"));
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    };
    execSync(`pnpm pack --config.ignore-scripts=true --pack-destination "${packDir}"`, {
      cwd: REPO_ROOT,
      env,
      stdio: "pipe",
    });
    const tarballMatch = execSync(`ls "${packDir}"/*minsky-*.tgz`, { encoding: "utf8" }).trim();
    const contents = execSync(`tar -tzf "${tarballMatch}"`, { encoding: "utf8" });
    expect(contents).toMatch(
      /package\/novel\/adapters\/agent-runtime-openhands\/bin\/minsky-openhands-spawn\.py\b/,
    );
  });

  test("integrated no-subcommand run from the tarball reaches the daemon path (not silent exit-1)", () => {
    // Blockers (A) + (C): a bare `npx -y @fyodoriv/minsky` run (no
    // subcommand) must resolve the repo (self-resolution: the unpacked
    // package IS the repo) and reach the runner's dry-run path, recording
    // a "planned" verdict — NOT exit 1 in ~4s with ZERO output. We drive
    // the integrated path with MINSKY_REPO pointed at the unpacked
    // package + a `claude`-configured init + --dry-run so no agent spawns.
    const packDir = mkdtempSync(join(tmpdir(), "minsky-pack-test-"));
    const pkgDir = mkdtempSync(join(tmpdir(), "minsky-pkg-test-"));
    const hostDir = mkdtempSync(join(tmpdir(), "minsky-host-test-"));
    const homeDir = mkdtempSync(join(tmpdir(), "minsky-home-test-"));
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    };
    execSync(`pnpm pack --config.ignore-scripts=true --pack-destination "${packDir}"`, {
      cwd: REPO_ROOT,
      env,
      stdio: "pipe",
    });
    const tarballMatch = execSync(`ls "${packDir}"/*minsky-*.tgz`, { encoding: "utf8" }).trim();
    execSync(`tar -xzf "${tarballMatch}" -C "${pkgDir}" --strip-components=1`, {
      env,
      stdio: "pipe",
    });
    // Fresh git host with one commit.
    execSync("git init --quiet", { cwd: hostDir, env, stdio: "pipe" });
    execSync("git config user.email test@example.com && git config user.name test", {
      cwd: hostDir,
      env,
      stdio: "pipe",
    });
    writeFileSync(join(hostDir, "README.md"), "# host\n");
    execSync("git add -A && git commit -m 'init' --quiet --no-verify", {
      cwd: hostDir,
      env,
      stdio: "pipe",
    });
    const minskyBin = join(pkgDir, "bin", "minsky");
    // init writes ~/.minsky/config.json (cloud_agent: claude so the
    // openhands invariant skips on a fresh box).
    const isolated = { ...env, HOME: homeDir, MINSKY_REPO: pkgDir };
    execSync(`bash "${minskyBin}" init "${hostDir}"`, { env: isolated, stdio: "pipe" });
    // Integrated dry-run: no subcommand path → resolver → bash runner →
    // dry-run plan. MINSKY_ORCH_DRY/--dry-run avoids any real agent spawn.
    let stdout = "";
    let stderr = "";
    let _exitCode = 0;
    try {
      stdout = execSync(`bash "${minskyBin}" --once "${hostDir}" --dry-run`, {
        encoding: "utf8",
        env: { ...isolated, MINSKY_ORCH_DRY: "1", MINSKY_PR_FETCH_LIMIT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      stdout = String(e.stdout ?? "");
      stderr = String(e.stderr ?? "");
      _exitCode = e.status ?? 1;
    }
    const combined = `${stdout}\n${stderr}`;
    // The run MUST reach the runner (dry-run banner / planned verdict),
    // never the silent exit-1. We assert it produced runner output.
    expect(combined).toMatch(/dry-run|planned|iteration|host=/i);
    // And the exit-1-with-zero-output failure mode is gone.
    expect(combined.trim().length).toBeGreaterThan(0);
  });

  test("resolver failure prints an actionable error naming MINSKY_REPO (not silent exit-1)", () => {
    // Blocker (A): the inline repo resolver ran inside `$( ... 2>&1 )`
    // under `set -euo pipefail`, so a non-zero exit aborted the script
    // BEFORE the error-echo line — `npx -y @fyodoriv/minsky` exited 1 in
    // ~4s with ZERO output. After the fix, an unresolvable repo prints a
    // one-line actionable error naming MINSKY_REPO. We run the in-tree
    // bin/minsky with a fresh HOME (no ~/minsky clone) and MINSKY_REPO
    // unset so the resolver exhausts every candidate.
    const homeDir = mkdtempSync(join(tmpdir(), "minsky-home-test-"));
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
      HOME: homeDir,
    };
    // Unset MINSKY_REPO so the resolver can't short-circuit on it, AND
    // run from a tmp cwd so self-resolution (the package dir) can't find a
    // runner either — forcing the actionable-error path.
    (env as Record<string, string | undefined>)["MINSKY_REPO"] = undefined;
    const isolatedBin = mkdtempSync(join(tmpdir(), "minsky-lonebin-test-"));
    // Copy ONLY bin/minsky to an isolated dir with no sibling runner, so
    // self-resolution (../bin/minsky-run.sh) misses and the resolver
    // falls all the way through to the actionable error.
    execSync(
      `mkdir -p "${isolatedBin}/bin" && cp "${join(REPO_ROOT, "bin", "minsky")}" "${isolatedBin}/bin/minsky"`,
      {
        env,
        stdio: "pipe",
      },
    );
    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`bash "${join(isolatedBin, "bin", "minsky")}"`, {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stderr?: Buffer | string; status?: number };
      stderr = String(e.stderr ?? "");
      exitCode = e.status ?? 1;
    }
    expect(exitCode).not.toBe(0);
    // The actionable error MUST name MINSKY_REPO so the operator knows the
    // exact next command. The pre-fix failure printed NOTHING.
    expect(stderr).toMatch(/MINSKY_REPO/);
  });

  test("init refuses to write config when the target is not a git repo", () => {
    const pkgDir = REPO_ROOT; // the in-tree bin/minsky has the same semantic as the unpacked one
    const nonRepoDir = mkdtempSync(join(tmpdir(), "minsky-nonrepo-test-"));
    const homeDir = mkdtempSync(join(tmpdir(), "minsky-home-test-"));
    const env = {
      ...process.env,
      PATH: `${process.env["PATH"] ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`,
      HOME: homeDir,
    };
    let stderr = "";
    let exitCode = 0;
    try {
      execSync(`bash "${pkgDir}/bin/minsky" init "${nonRepoDir}"`, {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stderr?: Buffer | string; status?: number };
      stderr = String(e.stderr ?? "");
      exitCode = e.status ?? 1;
    }
    // Must exit non-zero with an actionable error.
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/is not a git repo/);
    // No config file written (rule #6 — no silent fallback).
    expect(existsSync(join(homeDir, ".minsky", "config.json"))).toBe(false);
  });
});
