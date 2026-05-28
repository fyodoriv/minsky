// @ts-check
// Pinning tests for biome's `noConsoleLog` rule behavior. Surfaced
// 2026-05-28 in PR #956 — biome's `--write --unsafe` auto-fix
// STRIPPED every `console.log` call in `scripts/tasks-md-stale-
// sweep.mjs`'s `runCli()`, leaving the CLI silent at exit-0. The
// workaround in PR #957 was `process.stdout.write` (not flagged
// by `noConsoleLog`).
//
// Three tests pin the contract that prevents the class of bug:
//
//   1. `biome check --write` (safe fixes only) PRESERVES console
//      calls — quote-style normalization happens, the call itself
//      survives.
//
//   2. `biome check --write --unsafe` STRIPS console calls — the
//      bug is documented + pinned. Any future biome config change
//      that fixes the strip flips this test, alerting the next
//      operator that the bug is resolved.
//
//   3. None of the pre-pr-lint stack scripts invoke `--unsafe` on
//      biome. THIS IS THE LOAD-BEARING GATE — it ensures the
//      dangerous fix is never wired into the auto-fix path. The
//      PR #956 bug only happened because an operator manually ran
//      `--unsafe` during cleanup; pinning that the stack itself
//      never reaches for the flag closes the class.
//
// Anchor: rule #6 (let it crash at the right boundary — a silent
// auto-transform that drops user-visible output is the wrong
// boundary). Biome docs § lint/suspicious/noConsoleLog.

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("biome --write behavior against console.log", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {string} */
  let fixturePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "biome-noconsole-"));
    fixturePath = join(tmpDir, "cli-fixture.mjs");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

  it("`biome check --write` (safe) PRESERVES console.log calls", () => {
    writeFileSync(fixturePath, 'console.log("hello from cli");\nprocess.exit(0);\n');
    execSync(`pnpm exec biome check --write --config-path=${REPO_ROOT} ${fixturePath}`, {
      stdio: "ignore",
    });
    const after = readFileSync(fixturePath, "utf8");
    expect(after).toMatch(/console\.log\(['"]hello from cli['"]\)/);
  });

  it("`biome check --write --unsafe` STRIPS console.log calls (documented bug)", () => {
    writeFileSync(fixturePath, 'console.log("hello from cli");\nprocess.exit(0);\n');
    try {
      execSync(`pnpm exec biome check --write --unsafe --config-path=${REPO_ROOT} ${fixturePath}`, {
        stdio: "ignore",
      });
    } catch {
      // biome's exit code under --unsafe with warnings is non-zero;
      // the file-content assertion below is the test, not the exit.
    }
    const after = readFileSync(fixturePath, "utf8");
    // PINNED BUG: --unsafe + noConsoleLog (warn level) silently
    // removes the console.log line. When/if biome's behavior
    // changes, this assertion flips — that's the recovery signal.
    expect(after).not.toMatch(/console\.log/);
  });
});

// Pattern that catches `biome ... --unsafe` as a substring within a
// 200-char window. Single source of truth for both the scripts/
// walker (test 3) and the package.json scripts check (test 4).
const BIOME_UNSAFE_RE = /biome[^\n]{0,200}--unsafe/;

/**
 * Return true when the file's extension is one of the script kinds the
 * walker considers, excluding test files (which legitimately exercise
 * the `--unsafe` shape — including this one).
 *
 * @param {string} name
 * @returns {boolean}
 */
function isScriptFileToScan(name) {
  if (!/\.(mjs|ts|sh|js)$/.test(name)) return false;
  if (name.endsWith(".test.mjs") || name.endsWith(".test.ts")) return false;
  return true;
}

/**
 * Walk `dir` recursively and collect repo-relative paths of script
 * files whose content matches `BIOME_UNSAFE_RE`.
 *
 * @param {string} dir
 * @param {string} repoRoot
 * @returns {string[]}
 */
function findBiomeUnsafeOffenders(dir, repoRoot) {
  /** @type {string[]} */
  const offenders = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      offenders.push(...findBiomeUnsafeOffenders(full, repoRoot));
      continue;
    }
    if (!isScriptFileToScan(entry.name)) continue;
    if (BIOME_UNSAFE_RE.test(readFileSync(full, "utf8"))) {
      offenders.push(full.slice(repoRoot.length + 1));
    }
  }
  return offenders;
}

describe("pre-pr-lint stack must NOT invoke biome --unsafe (load-bearing gate)", () => {
  it("no script in scripts/ passes --unsafe to biome", () => {
    const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    // A future operator wiring auto-fix into pre-pr-lint with
    // --unsafe would land on this gate.
    expect(findBiomeUnsafeOffenders(join(repoRoot, "scripts"), repoRoot)).toEqual([]);
  });

  it("package.json scripts must NOT invoke biome --unsafe", () => {
    const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const pkgJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const scripts = pkgJson.scripts ?? {};
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(
        BIOME_UNSAFE_RE.test(/** @type {string} */ (cmd)),
        `package.json script '${name}' invokes biome --unsafe: ${cmd}`,
      ).toBe(false);
    }
  });
});
