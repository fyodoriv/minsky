// E2E smoke test for the Python shim's input-validation contract.
//
// This test spawns the actual Python script with deliberately-bad
// arguments and asserts the exit code + stderr message. It catches
// regressions in the shim's argument-handling that unit tests can't
// see (because the unit tests are TS-side; the shim is Python).
//
// We do NOT test the live LLM call — that requires a real API key,
// burns tokens, and is non-deterministic. A separate integration
// test at `test/integration/openhands-live.test.mjs` will cover that
// (filed as `openhands-live-smoke-integration-test` in TASKS.md).
//
// Skips automatically if python3 is unavailable on the runner. That
// keeps CI green on machines without Python while still catching the
// regression on developer machines + the dogfood loop.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM = resolve(__dirname, "..", "bin", "minsky-openhands-spawn.py");

function python3Available() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

const py3 = python3Available();
const describeIf = py3 ? describe : describe.skip;

describeIf("minsky-openhands-spawn.py — argument contract", () => {
  it("the shim file exists and is executable from the package", () => {
    expect(existsSync(SHIM)).toBe(true);
  });

  it("--help returns 0 and lists every required flag", () => {
    const r = spawnSync("python3", [SHIM, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--brief-file/);
    expect(r.stdout).toMatch(/--model/);
    expect(r.stdout).toMatch(/--repo/);
    expect(r.stdout).toMatch(/--api-key-env/);
  });

  it("missing required args returns argparse's exit code 2", () => {
    const r = spawnSync("python3", [SHIM], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/required/);
  });

  it("nonexistent brief-file exits 64 with an actionable message", () => {
    const dir = mkdtempSync(join(tmpdir(), "oh-shim-test-"));
    const r = spawnSync(
      "python3",
      [
        SHIM,
        "--brief-file",
        "/nope/does-not-exist.md",
        "--model",
        "claude-sonnet-4-20250514",
        "--repo",
        dir,
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/brief-file not found/);
  });

  it("nonexistent repo dir exits 64 with an actionable message", () => {
    const dir = mkdtempSync(join(tmpdir(), "oh-shim-test-"));
    const brief = join(dir, "brief.md");
    writeFileSync(brief, "do nothing", "utf8");
    const r = spawnSync(
      "python3",
      [
        SHIM,
        "--brief-file",
        brief,
        "--model",
        "claude-sonnet-4-20250514",
        "--repo",
        "/nope/does-not-exist",
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/repo dir not found/);
  });

  it("missing API key env var exits 64 with the env var name in the error", () => {
    const dir = mkdtempSync(join(tmpdir(), "oh-shim-test-"));
    const brief = join(dir, "brief.md");
    writeFileSync(brief, "do nothing", "utf8");
    const r = spawnSync(
      "python3",
      [
        SHIM,
        "--brief-file",
        brief,
        "--model",
        "claude-sonnet-4-20250514",
        "--repo",
        dir,
        "--api-key-env",
        "DEFINITELY_UNSET_KEY_FOR_TEST_12345",
      ],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    );
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/DEFINITELY_UNSET_KEY_FOR_TEST_12345/);
    expect(r.stderr).toMatch(/missing API key/);
  });
});
