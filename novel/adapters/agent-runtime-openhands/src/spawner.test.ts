// SpawnConfigBuilder unit tests — pure spawn-config construction, no IO.
//
// These tests cover the rule-#2 adapter shape: given a brief, repo path,
// and model name, produce the exact subprocess invocation the daemon
// will execute. Wire shape matches the existing claude/devin builders
// in bin/minsky-run.mjs (see § "buildAgentConfig"). The Python shim
// itself is exercised by the E2E smoke test in
// `test/integration/openhands-spawn.test.mjs` (not this file) — these
// unit tests verify the argv contract is correct regardless of whether
// the shim actually runs.

import { describe, expect, it } from "vitest";
import { buildOpenHandsInvocation, resolveShimPath } from "./spawner.js";

describe("buildOpenHandsInvocation", () => {
  const fixture = {
    brief: "Implement the feature described in user-stories/001.md.",
    repoRoot: "/host/repo",
    model: "claude-sonnet-4-20250514",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    shimPath: "/abs/path/to/minsky-openhands-spawn.py",
    pythonBin: "python3",
  };

  it("returns command=python3 (or operator override) for OpenHands spawns", () => {
    const inv = buildOpenHandsInvocation(fixture);
    expect(inv.command).toBe("python3");
  });

  it("first argv arg is the absolute path to the shim script", () => {
    const inv = buildOpenHandsInvocation(fixture);
    expect(inv.argv[0]).toBe("/abs/path/to/minsky-openhands-spawn.py");
  });

  it("passes the brief via --brief-file pointing at a written temp file", () => {
    const inv = buildOpenHandsInvocation(fixture);
    const flagIdx = inv.argv.indexOf("--brief-file");
    expect(flagIdx).toBeGreaterThan(0);
    expect(inv.argv[flagIdx + 1]).toMatch(/\.md$/);
    expect(inv.briefFilePath).toBe(inv.argv[flagIdx + 1]);
  });

  it("passes --model with the requested model name verbatim", () => {
    const inv = buildOpenHandsInvocation(fixture);
    const flagIdx = inv.argv.indexOf("--model");
    expect(flagIdx).toBeGreaterThan(0);
    expect(inv.argv[flagIdx + 1]).toBe("claude-sonnet-4-20250514");
  });

  it("passes --repo with the absolute host repo path", () => {
    const inv = buildOpenHandsInvocation(fixture);
    const flagIdx = inv.argv.indexOf("--repo");
    expect(flagIdx).toBeGreaterThan(0);
    expect(inv.argv[flagIdx + 1]).toBe("/host/repo");
  });

  it("passes --api-key-env with the operator-configured env name", () => {
    const inv = buildOpenHandsInvocation(fixture);
    const flagIdx = inv.argv.indexOf("--api-key-env");
    expect(flagIdx).toBeGreaterThan(0);
    expect(inv.argv[flagIdx + 1]).toBe("ANTHROPIC_API_KEY");
  });

  it("does NOT pipe stdin (brief is delivered via file, not pipe)", () => {
    const inv = buildOpenHandsInvocation(fixture);
    expect(inv.stdin).toBeUndefined();
  });

  it("cwd is the host repo root (OpenHands workspace expectation)", () => {
    const inv = buildOpenHandsInvocation(fixture);
    expect(inv.cwd).toBe("/host/repo");
  });

  it("rejects briefs longer than 1 MB to prevent runaway prompt explosions", () => {
    const overlong = "x".repeat(1024 * 1024 + 1);
    expect(() => buildOpenHandsInvocation({ ...fixture, brief: overlong })).toThrow(
      /brief exceeds 1 MB/,
    );
  });

  it("rejects empty briefs (no useful work for the agent)", () => {
    expect(() => buildOpenHandsInvocation({ ...fixture, brief: "" })).toThrow(/brief is empty/);
  });

  it("rejects whitespace-only briefs", () => {
    expect(() => buildOpenHandsInvocation({ ...fixture, brief: "   \n\n  " })).toThrow(
      /brief is empty/,
    );
  });

  it("uses operator override for pythonBin when provided", () => {
    const inv = buildOpenHandsInvocation({
      ...fixture,
      pythonBin: "/usr/local/bin/python3.13",
    });
    expect(inv.command).toBe("/usr/local/bin/python3.13");
  });

  it("emits a deterministic ordered argv (snapshot-shaped for the lint)", () => {
    const inv = buildOpenHandsInvocation(fixture);
    const flagsOnly = inv.argv.filter((a) => a.startsWith("--"));
    expect(flagsOnly).toEqual(["--brief-file", "--model", "--repo", "--api-key-env"]);
  });
});

describe("resolveShimPath", () => {
  it("returns an absolute path containing the shim filename", () => {
    const p = resolveShimPath();
    expect(p).toMatch(/^\//);
    expect(p).toMatch(/minsky-openhands-spawn\.py$/);
  });
});
