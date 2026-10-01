// @ts-check
// Paired test for `check-no-corporate-refs.mjs`.
//
// The guard loads its private pattern at runtime, so this file uses neutral
// fixture tokens (`company-private`, `PROJ-`) injected through the env. The
// live scan runs only when the operator has a real pattern configured.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  deadAllowlistEntries,
  findOffenders,
  listScanFiles,
  loadInternalPattern,
  PERMANENT_ALLOWLIST,
  TEMPORARY_ALLOWLIST,
} from "./check-no-corporate-refs.mjs";

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), "check-no-corporate-refs.mjs");
const FIXTURE_PATTERN = "\\b(company-private|PROJ-)";

/** @returns {string} */
function scratch() {
  return mkdtempSync(join(tmpdir(), "oss-readiness-test-"));
}

/**
 * Run the guard CLI with an isolated env (no inherited pattern, fake HOME).
 *
 * @param {Record<string, string>} env
 */
function runGuard(env) {
  const home = scratch();
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
  });
}

describe("loadInternalPattern", () => {
  it("reads the pattern from the env var", () => {
    const re = loadInternalPattern({
      env: { OSS_READINESS_INTERNAL_PATTERN: FIXTURE_PATTERN },
      home: scratch(),
    });
    expect(re?.test("COMPANY-PRIVATE")).toBe(true);
    expect(re?.test("PROJ-12")).toBe(true);
    expect(re?.test("example")).toBe(false);
  });

  it("reads the pattern from OSS_READINESS_ENV_FILE (quoted)", () => {
    const file = join(scratch(), "custom.env");
    writeFileSync(file, `# comment\nOSS_READINESS_INTERNAL_PATTERN='${FIXTURE_PATTERN}'\n`);
    const re = loadInternalPattern({ env: { OSS_READINESS_ENV_FILE: file }, home: scratch() });
    expect(re?.test("company-private")).toBe(true);
  });

  it("reads an unquoted value", () => {
    const file = join(scratch(), "custom.env");
    writeFileSync(file, "OSS_READINESS_INTERNAL_PATTERN=company-private\n");
    const re = loadInternalPattern({ env: { OSS_READINESS_ENV_FILE: file }, home: scratch() });
    expect(re?.test("a company-private b")).toBe(true);
  });

  it("reads the XDG default path", () => {
    const xdg = scratch();
    mkdirSync(join(xdg, "oss-readiness"));
    writeFileSync(
      join(xdg, "oss-readiness", "oss-readiness.env"),
      `OSS_READINESS_INTERNAL_PATTERN="${FIXTURE_PATTERN}"\n`,
    );
    const re = loadInternalPattern({ env: { XDG_CONFIG_HOME: xdg }, home: scratch() });
    expect(re?.test("PROJ-1")).toBe(true);
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    const home = scratch();
    mkdirSync(join(home, ".config", "oss-readiness"), { recursive: true });
    writeFileSync(
      join(home, ".config", "oss-readiness", "oss-readiness.env"),
      `OSS_READINESS_INTERNAL_PATTERN='${FIXTURE_PATTERN}'\n`,
    );
    expect(loadInternalPattern({ env: {}, home })?.test("PROJ-1")).toBe(true);
  });

  it("skips an env file that names a different repo", () => {
    const file = join(scratch(), "other.env");
    writeFileSync(
      file,
      `OSS_READINESS_REPO=some-other-repo\nOSS_READINESS_INTERNAL_PATTERN='${FIXTURE_PATTERN}'\n`,
    );
    expect(loadInternalPattern({ env: { OSS_READINESS_ENV_FILE: file }, home: scratch() })).toBe(
      null,
    );
  });

  it("accepts an env file that names this repo", () => {
    const file = join(scratch(), "mine.env");
    writeFileSync(
      file,
      `OSS_READINESS_REPO=minsky\nOSS_READINESS_INTERNAL_PATTERN='${FIXTURE_PATTERN}'\n`,
    );
    const re = loadInternalPattern({ env: { OSS_READINESS_ENV_FILE: file }, home: scratch() });
    expect(re?.test("company-private")).toBe(true);
  });

  it("returns null when nothing is configured", () => {
    expect(loadInternalPattern({ env: {}, home: scratch() })).toBe(null);
  });
});

describe("guard CLI", () => {
  it("no pattern configured: prints a notice and exits 0", () => {
    const res = runGuard({});
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skipped/);
  });

  it("a pattern with no hits exits 0", () => {
    const res = runGuard({ OSS_READINESS_INTERNAL_PATTERN: "zzz-never-present-\\d{9}" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/no-corporate-refs ok/);
  });

  it("a real hit exits non-zero and names the file", () => {
    // This test file carries the fixture token, so the scan must flag it.
    const res = runGuard({ OSS_READINESS_INTERNAL_PATTERN: "company-private" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/check-no-corporate-refs\.test\.mjs/);
  });

  it("a repo-mismatch env file is skipped (exit 0)", () => {
    const file = join(scratch(), "other.env");
    writeFileSync(
      file,
      "OSS_READINESS_REPO=some-other-repo\nOSS_READINESS_INTERNAL_PATTERN='company-private'\n",
    );
    const res = runGuard({ OSS_READINESS_ENV_FILE: file });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skipped/);
  });
});

describe("findOffenders", () => {
  it("detects a fixture token in tracked files", () => {
    const offenders = findOffenders(/company-private/i);
    expect(offenders.some((o) => o.path === "scripts/check-no-corporate-refs.test.mjs")).toBe(true);
  });

  it("LIVE GATE: no private refs outside the allowlist (only with a configured pattern)", () => {
    const pattern = loadInternalPattern();
    if (pattern === null) return;
    const allowed = new Set([...PERMANENT_ALLOWLIST, ...TEMPORARY_ALLOWLIST]);
    const unexpected = findOffenders(pattern).filter((o) => !allowed.has(o.path));
    expect(unexpected.map((o) => `${o.path}:${o.line}`)).toEqual([]);
  });
});

describe("allowlist hygiene", () => {
  it("flags missing and token-free entries as dead", () => {
    const dead = deadAllowlistEntries(
      new Set(["scripts/does-not-exist.mjs", "scripts/check-no-corporate-refs.mjs"]),
      new Set(),
    );
    expect(dead).toHaveLength(2);
    expect(dead[0]).toMatch(/missing on disk/);
    expect(dead[1]).toMatch(/remove from allowlist/);
  });

  it("does not flag an entry that still has hits", () => {
    expect(
      deadAllowlistEntries(
        new Set(["scripts/check-no-corporate-refs.mjs"]),
        new Set(["scripts/check-no-corporate-refs.mjs"]),
      ),
    ).toEqual([]);
  });

  it("PERMANENT_ALLOWLIST and TEMPORARY_ALLOWLIST are empty", () => {
    expect([...PERMANENT_ALLOWLIST]).toEqual([]);
    expect([...TEMPORARY_ALLOWLIST]).toEqual([]);
  });
});

describe("listScanFiles", () => {
  it("returns tracked files with only scannable extensions", () => {
    const files = listScanFiles();
    expect(files.length).toBeGreaterThan(0);
    const allowedExt = new Set([
      ".md",
      ".ts",
      ".tsx",
      ".js",
      ".mjs",
      ".cjs",
      ".json",
      ".yaml",
      ".yml",
      ".sh",
      ".bash",
      ".toml",
      ".py",
      ".bats",
      ".example",
    ]);
    for (const f of files) {
      expect(allowedExt.has(f.slice(f.lastIndexOf(".")))).toBe(true);
    }
  });
});
