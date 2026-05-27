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
    const stdout = execSync(`pnpm pack --pack-destination "${packDir}"`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
    });
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
    execSync(`pnpm pack --pack-destination "${packDir}"`, {
      cwd: REPO_ROOT,
      env,
      stdio: "pipe",
    });
    const tarballMatch = execSync(`ls "${packDir}"/minsky-*.tgz`, { encoding: "utf8" }).trim();
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
