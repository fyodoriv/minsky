// @ts-check
// Paired tests for the pure toolchain classifier (slice 1 of
// `commit-hook-chain-node-version-and-platform-resilience`).
//
// The three load-bearing cases mirror the 2026-05-17 live incident and
// the parent task's § Success acceptance line:
//   - node-version-mismatch  (interactive v24.15.0 vs pinned v24.14.0)
//   - missing-arm64-biome    (Darwin arm64 host, only cli-darwin-x64)
//   - all-green              (pinned node + every binary resolves)
// Slice ≥2 (verify/pre-pr-lint wiring, lefthook phase-split) is gated
// against this fixed pure seam.

import { describe, expect, it } from "vitest";

import {
  classifyToolchain,
  formatReport,
  parseMajorMinor,
  runCheckToolchain,
} from "./check-toolchain.mjs";

/** @type {import("./check-toolchain.mjs").BinaryProbe} */
const BIOME_OK = { name: "biome", resolved: true, hint: "n/a" };
/** @type {import("./check-toolchain.mjs").BinaryProbe} */
const LEFTHOOK_OK = { name: "lefthook", resolved: true, hint: "n/a" };
/** @type {import("./check-toolchain.mjs").BinaryProbe} */
const SCAN_OK = { name: "scan-secrets", resolved: true, hint: "n/a" };
const ALL_BINS_OK = [BIOME_OK, LEFTHOOK_OK, SCAN_OK];

describe("parseMajorMinor (pure helper)", () => {
  it("parses a bare .node-version body", () => {
    expect(parseMajorMinor("24.14.0")).toEqual({ major: 24, minor: 14 });
  });

  it("parses a v-prefixed process.version", () => {
    expect(parseMajorMinor("v24.15.0")).toEqual({ major: 24, minor: 15 });
  });

  it("tolerates surrounding whitespace and a missing patch", () => {
    expect(parseMajorMinor("  20.11  ")).toEqual({ major: 20, minor: 11 });
  });

  it("returns null for an unparseable pin (classifier then skips it)", () => {
    expect(parseMajorMinor("lts/iron")).toBeNull();
    expect(parseMajorMinor("")).toBeNull();
    // @ts-expect-error — defensive: non-string input must not throw.
    expect(parseMajorMinor(null)).toBeNull();
  });
});

describe("classifyToolchain — node-version policy", () => {
  it("flags a minor-version mismatch (the 2026-05-17 incident shape)", () => {
    const v = classifyToolchain({
      runtimeNode: "24.15.0",
      pinnedNode: "24.14.0",
      binaries: ALL_BINS_OK,
    });
    expect(v.ok).toBe(false);
    expect(v.violations).toHaveLength(1);
    expect(v.violations[0]?.code).toBe("node-version-mismatch");
    // The remediation must name the concrete fix, not a trace (rule #6).
    expect(v.violations[0]?.remediation).toContain("fnm use");
    expect(v.violations[0]?.remediation).toContain("v24.15.0");
    expect(v.violations[0]?.remediation).toContain("v24.14.0");
  });

  it("flags a major-version mismatch", () => {
    const v = classifyToolchain({
      runtimeNode: "22.14.0",
      pinnedNode: "24.14.0",
      binaries: ALL_BINS_OK,
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toEqual(["node-version-mismatch"]);
  });

  it("tolerates patch drift (ABI-compatible — node_modules resolves identically)", () => {
    const v = classifyToolchain({
      runtimeNode: "24.14.9",
      pinnedNode: "24.14.0",
      binaries: ALL_BINS_OK,
    });
    expect(v.ok).toBe(true);
    expect(v.violations).toEqual([]);
  });

  it("skips the node check when there is no pin file (fail-open on the pin)", () => {
    const v = classifyToolchain({
      runtimeNode: "18.0.0",
      pinnedNode: null,
      binaries: ALL_BINS_OK,
    });
    expect(v.ok).toBe(true);
  });

  it("skips the node check when the pin is unparseable (never self-blocks)", () => {
    const v = classifyToolchain({
      runtimeNode: "24.14.0",
      pinnedNode: "lts/iron",
      binaries: ALL_BINS_OK,
    });
    expect(v.ok).toBe(true);
  });
});

describe("classifyToolchain — platform-binary completeness", () => {
  it("flags a missing arm64 biome CLI (Darwin arm64 host, only cli-darwin-x64)", () => {
    const v = classifyToolchain({
      runtimeNode: "24.14.0",
      pinnedNode: "24.14.0",
      binaries: [
        { name: "biome", resolved: false, hint: "@biomejs/cli-darwin-arm64 does not resolve" },
        LEFTHOOK_OK,
        SCAN_OK,
      ],
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toEqual(["biome-unresolved"]);
    expect(v.violations[0]?.remediation).toContain("@biomejs/cli-darwin-arm64");
  });

  it("flags an unresolved lefthook (node-version drift downstream symptom)", () => {
    const v = classifyToolchain({
      runtimeNode: "24.14.0",
      pinnedNode: "24.14.0",
      binaries: [
        BIOME_OK,
        { name: "lefthook", resolved: false, hint: "lefthook missing" },
        SCAN_OK,
      ],
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toEqual(["lefthook-unresolved"]);
  });

  it("orders node-version (upstream cause) before binary symptoms", () => {
    const v = classifyToolchain({
      runtimeNode: "24.15.0",
      pinnedNode: "24.14.0",
      binaries: [{ name: "biome", resolved: false, hint: "biome missing" }, LEFTHOOK_OK, SCAN_OK],
    });
    expect(v.ok).toBe(false);
    expect(v.violations.map((x) => x.code)).toEqual(["node-version-mismatch", "biome-unresolved"]);
  });
});

describe("classifyToolchain — all green", () => {
  it("passes when pinned node matches and every binary resolves", () => {
    const v = classifyToolchain({
      runtimeNode: "24.14.0",
      pinnedNode: "24.14.0",
      binaries: ALL_BINS_OK,
    });
    expect(v.ok).toBe(true);
    expect(v.violations).toEqual([]);
  });
});

describe("formatReport — operator-actionable, never an opaque trace", () => {
  it("emits a stable ok token on a green verdict", () => {
    const report = formatReport({ ok: true, violations: [] });
    expect(report).toMatch(/^\[check-toolchain\] ok:/);
  });

  it("emits one self-contained actionable line per violation and forbids --no-verify", () => {
    const report = formatReport({
      ok: false,
      violations: [
        { code: "node-version-mismatch", remediation: "run `fnm use`" },
        { code: "biome-unresolved", remediation: "pnpm install" },
      ],
    });
    expect(report).toMatch(/^\[check-toolchain\] FAIL:/);
    expect(report).toContain("--no-verify");
    expect(report).toContain("[node-version-mismatch] run `fnm use`");
    expect(report).toContain("[biome-unresolved] pnpm install");
    expect(report).not.toMatch(/MODULE_NOT_FOUND|at Object\.<anonymous>/);
  });
});

describe("runCheckToolchain — exit-code contract", () => {
  it("exit 0 + ok report when the toolchain is healthy", () => {
    const { exitCode, report } = runCheckToolchain({
      runtimeNode: "24.14.0",
      pinnedNode: "24.14.0",
      binaries: ALL_BINS_OK,
    });
    expect(exitCode).toBe(0);
    expect(report).toContain("[check-toolchain] ok");
  });

  it("exit 1 + actionable report when any divergence is present", () => {
    const { exitCode, report } = runCheckToolchain({
      runtimeNode: "24.15.0",
      pinnedNode: "24.14.0",
      binaries: ALL_BINS_OK,
    });
    expect(exitCode).toBe(1);
    expect(report).toContain("[node-version-mismatch]");
  });
});
