// Tests for check-supervisor-sandbox.mjs. Pattern: paired positive/negative
// fixtures (Meszaros 2007, *xUnit Test Patterns*) over a deterministic
// preflight gate. The pure decision (`assessToolchainProbes`) +
// skip-resolution + binary-resolution are driven via injected inputs so no
// sandbox-exec child is spawned, keeping the suite hermetic on Linux CI.

import { describe, expect, test } from "vitest";

import {
  assessToolchainProbes,
  CLAUDE_AUTH_ENV,
  renderReport,
  resolveBinary,
  resolveSkipReason,
  TOOLCHAIN_PROBES,
} from "./check-supervisor-sandbox.mjs";

/**
 * @typedef {{ name: string, gap: number, ok: boolean, exitCode: number | null, stderr?: string, skipReason?: string }} TestProbeResult
 */

/**
 * Synthesize a passing probe-result for every declared probe so each test can
 * mutate exactly one entry to pin the specific gap.
 * @returns {TestProbeResult[]}
 */
function allPassing() {
  return TOOLCHAIN_PROBES.map((spec) => ({
    name: spec.name,
    gap: spec.gap,
    ok: true,
    exitCode: 0,
  }));
}

/**
 * Flip one probe (by name) to a failed result, preserving every required field.
 * Avoids the `...probes[idx]` spread pattern that loses required-ness under
 * `noUncheckedIndexedAccess + exactOptionalPropertyTypes`.
 *
 * @param {TestProbeResult[]} probes
 * @param {string} name
 * @param {{ exitCode: number, stderr?: string }} fail
 */
function fail(probes, name, { exitCode, stderr }) {
  const idx = probes.findIndex((p) => p.name === name);
  if (idx < 0) throw new Error(`no probe named ${name}`);
  const prev = probes[idx];
  if (!prev) throw new Error(`no probe at index ${idx}`);
  /** @type {TestProbeResult} */
  const next = { name: prev.name, gap: prev.gap, ok: false, exitCode };
  if (stderr !== undefined) next.stderr = stderr;
  probes[idx] = next;
}

describe("TOOLCHAIN_PROBES (pinning the six gap classes)", () => {
  test("covers all six gap classes from the task header", () => {
    const gaps = new Set(TOOLCHAIN_PROBES.map((s) => s.gap));
    for (const g of [1, 2, 3, 4, 5, 6]) {
      expect(gaps.has(g)).toBe(true);
    }
  });

  test("every probe carries a non-empty remediation string", () => {
    for (const spec of TOOLCHAIN_PROBES) {
      expect(typeof spec.remediation).toBe("string");
      expect(spec.remediation.length).toBeGreaterThan(0);
    }
  });
});

describe("assessToolchainProbes (pure)", () => {
  test("all probes ok + claude auth env present → ok:true, not skipped", () => {
    const a = assessToolchainProbes({
      probes: allPassing(),
      claudeAuthEnvPresent: true,
    });
    expect(a.ok).toBe(true);
    expect(a.skipped).toBe(false);
    expect(a.claude_auth_env_present).toBe(true);
  });

  test("one probe fails → overall ok:false even when env is present", () => {
    const probes = allPassing();
    const first = probes[0];
    if (!first) throw new Error("no first probe");
    fail(probes, first.name, { exitCode: 1 });
    const a = assessToolchainProbes({ probes, claudeAuthEnvPresent: true });
    expect(a.ok).toBe(false);
  });

  test("all probes ok but claude auth env MISSING → ok:false (gap 6)", () => {
    const a = assessToolchainProbes({
      probes: allPassing(),
      claudeAuthEnvPresent: false,
    });
    expect(a.ok).toBe(false);
    expect(a.claude_auth_env_present).toBe(false);
  });

  test("skip set → graceful-degrade ok:true, skipped:true, reason surfaced (rule #7)", () => {
    const a = assessToolchainProbes({
      probes: [],
      claudeAuthEnvPresent: false,
      skip: "not macOS (platform=linux); sandbox-exec is macOS-only",
    });
    expect(a.skipped).toBe(true);
    expect(a.ok).toBe(true);
    expect(a.skip_reason).toContain("not macOS");
  });
});

describe("per-gap detection (the doctor catches each of the 6 gap classes)", () => {
  // Each test builds an all-passing probe set, flips ONE probe to failed, and
  // asserts the verdict goes red. This pins the file-header gap → probe map.
  /** @type {ReadonlyArray<{ gap: number, label: string }>} */
  const gapToLabel = [
    { gap: 1, label: "python3 exec" },
    { gap: 2, label: "gh --version" },
    { gap: 3, label: "git config" },
    { gap: 4, label: "claude --version" },
    { gap: 5, label: "uv venv python read" },
    { gap: 6, label: "claude session read" },
  ];
  for (const { gap, label } of gapToLabel) {
    test(`gap ${gap} (${label}): regression flips ok:false`, () => {
      const probes = allPassing();
      fail(probes, label, { exitCode: 1, stderr: "Operation not permitted" });
      const a = assessToolchainProbes({ probes, claudeAuthEnvPresent: true });
      expect(a.ok).toBe(false);
      const failed = a.probes.find((p) => p.name === label);
      expect(failed?.ok).toBe(false);
      expect(failed?.gap).toBe(gap);
    });
  }
});

describe("resolveSkipReason (pure over injected predicates)", () => {
  test("non-darwin platform → skip names the platform", () => {
    const reason = resolveSkipReason({ platform: "linux" });
    expect(reason).toBeDefined();
    expect(reason).toContain("linux");
  });

  test("darwin + sandbox-exec absent → skip names sandbox-exec", () => {
    const reason = resolveSkipReason({
      platform: "darwin",
      sandboxExecExists: false,
      profileExists: true,
    });
    expect(reason).toContain("sandbox-exec");
  });

  test("darwin + profile missing → skip names the profile path", () => {
    const reason = resolveSkipReason({
      platform: "darwin",
      sandboxExecExists: true,
      profileExists: false,
    });
    expect(reason).toContain("SBPL profile");
  });

  test("darwin + sandbox-exec + profile present → no skip (run the probes)", () => {
    const reason = resolveSkipReason({
      platform: "darwin",
      sandboxExecExists: true,
      profileExists: true,
    });
    expect(reason).toBeUndefined();
  });
});

describe("resolveBinary (pure over injected PATH + existsSync)", () => {
  test("returns the first existing absolute path", () => {
    /** @type {Set<string>} */
    const present = new Set(["/usr/local/bin/claude"]);
    const abs = resolveBinary({
      binary: "claude",
      pathEnv: "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
      exists: (p) => present.has(p),
    });
    expect(abs).toBe("/usr/local/bin/claude");
  });

  test("returns undefined when binary is not under any PATH entry", () => {
    const abs = resolveBinary({
      binary: "missing-binary",
      pathEnv: "/usr/bin:/bin",
      exists: () => false,
    });
    expect(abs).toBeUndefined();
  });

  test("ignores empty PATH segments", () => {
    /** @type {Set<string>} */
    const present = new Set(["/usr/bin/git"]);
    const abs = resolveBinary({
      binary: "git",
      pathEnv: "::/usr/bin:",
      exists: (p) => present.has(p),
    });
    expect(abs).toBe("/usr/bin/git");
  });
});

describe("renderReport", () => {
  test("ok run: ✅ verdict and no per-gap remediation block", () => {
    const text = renderReport({
      ok: true,
      skipped: false,
      probes: allPassing(),
      claude_auth_env_present: true,
    });
    expect(text).toContain("✅ sandbox-toolchain doctor");
    expect(text).not.toContain("Per-gap remediation");
  });

  test("failing run: ❌ verdict + remediation per failed probe", () => {
    const probes = allPassing();
    fail(probes, "gh --version", { exitCode: 1, stderr: "EPERM" });
    const text = renderReport({
      ok: false,
      skipped: false,
      probes,
      claude_auth_env_present: true,
    });
    expect(text).toContain("❌ sandbox-toolchain doctor");
    expect(text).toContain("Per-gap remediation");
    expect(text).toContain("~/.config/gh");
  });

  test("missing claude auth env: explicit env-line remediation", () => {
    const text = renderReport({
      ok: false,
      skipped: false,
      probes: allPassing(),
      claude_auth_env_present: false,
    });
    expect(text).toContain(CLAUDE_AUTH_ENV);
    expect(text).toContain("launchctl setenv");
  });

  test("skipped run: SKIPPED line with reason and no probe table", () => {
    const text = renderReport({
      ok: true,
      skipped: true,
      skip_reason: "not macOS (platform=linux); sandbox-exec is macOS-only",
      probes: [],
      claude_auth_env_present: false,
    });
    expect(text).toContain("SKIPPED");
    expect(text).toContain("linux");
    expect(text).not.toContain("Per-gap remediation");
  });
});
