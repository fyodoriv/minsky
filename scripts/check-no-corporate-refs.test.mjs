// @ts-check
// Paired test + live gate for `check-no-corporate-refs.mjs`.
//
// The "live repo scan" case IS the CI enforcement: it fails the `test` job
// the moment any tracked file gains a corporate identifier outside the
// allowlist. The other cases pin the regex taxonomy and the allowlist-rot
// guard. This file intentionally contains corporate tokens in its fixtures,
// which is why `check-no-corporate-refs.mjs` allowlists its own path.

import { describe, expect, it } from "vitest";

import {
  CORPORATE_PATTERN,
  deadAllowlistEntries,
  findOffenders,
  listScanFiles,
  PERMANENT_ALLOWLIST,
  TEMPORARY_ALLOWLIST,
} from "./check-no-corporate-refs.mjs";

describe("CORPORATE_PATTERN", () => {
  it("matches corporate identifiers (case-insensitive)", () => {
    for (const token of [
      "intuit",
      "Intuit",
      "INTUIT",
      "workday",
      "appfabric",
      "expertnetwrk",
      "oncall-hub",
      "github.intuit",
      "jira.cloud.intuit",
      "federation.intuit",
      "AIFN-123",
    ]) {
      expect(CORPORATE_PATTERN.test(token)).toBe(true);
    }
    // NOTE: @-prefixed alternates (@iep/, @ids-ts/) are in the pattern for
    // parity with the agentbrew taxonomy, but the leading \b cannot precede
    // a non-word char like '@', so they only match mid-token (e.g. "x@iep/").
    // minsky has zero such tokens; this is a documented taxonomy limitation.
  });

  it("does not match generic words that merely contain a token substring", () => {
    for (const word of ["intuitively", "intuition", "workflow", "genosynthesis", "example"]) {
      expect(CORPORATE_PATTERN.test(word)).toBe(false);
    }
  });
});

describe("findOffenders / live repo scan", () => {
  it("LIVE GATE: no corporate refs outside the allowlist", () => {
    const allowed = new Set([...PERMANENT_ALLOWLIST, ...TEMPORARY_ALLOWLIST]);
    const unexpected = findOffenders().filter((o) => !allowed.has(o.path));
    if (unexpected.length > 0) {
      throw new Error(
        [
          "Corporate references found outside allowlist:",
          ...unexpected.map((o) => `  ${o.path}:${o.line} [${o.match}]`),
        ].join("\n"),
      );
    }
    expect(unexpected).toEqual([]);
  });

  it("detects a token in a fixture line", () => {
    const offenders = findOffenders();
    // This very test file carries fixtures and must be detected (it is allowlisted).
    expect(offenders.some((o) => o.path === "scripts/check-no-corporate-refs.test.mjs")).toBe(true);
  });
});

describe("allowlist hygiene", () => {
  it("PERMANENT_ALLOWLIST has no dead entries (rot guard)", () => {
    const offendingPaths = new Set(findOffenders().map((o) => o.path));
    expect(deadAllowlistEntries(PERMANENT_ALLOWLIST, offendingPaths)).toEqual([]);
  });

  it("TEMPORARY_ALLOWLIST has no dead entries (rot guard)", () => {
    const offendingPaths = new Set(findOffenders().map((o) => o.path));
    expect(deadAllowlistEntries(TEMPORARY_ALLOWLIST, offendingPaths)).toEqual([]);
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
      const ext = f.slice(f.lastIndexOf("."));
      expect(allowedExt.has(ext)).toBe(true);
    }
  });
});
