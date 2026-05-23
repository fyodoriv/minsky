// Integration tests for `bin/minsky consent` — slice (2) of P0
// `agent-mediated-install` per INSTALL.md Step 5.
//
// Hypothesis (rule #9): collapsing the inline shell snippet to one
// CLI invocation removes per-agent transcript-format divergence
// (claude-code / devin / cursor all spawn a process and parse exit
// code identically, where a multi-line shell snippet is where they
// drift).
//
// Success: every test below passes against the real bin/minsky binary
// against a temporary MINSKY_STATE_DIR fixture; the produced JSON has
// all 4 documented fields with correct shapes; idempotent re-runs do
// not corrupt the file; --yes / --no flip atomically; POST is
// fire-and-forget (no block on unreachable endpoint).
//
// Pivot: if the atomic-write semantics turn out to require a
// third-party lib on Windows, drop the atomic guarantee for v1 and
// document in INSTALL.md.
//
// Measurement: this test file.
//
// Anchor: rule #9 (pre-registered metrics); rule #16 (default by
// default — one command, not ten lines); RFC 8615 (canonical-path
// convention); INSTALL.md Step 5.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const MINSKY_BIN = resolve(HERE, "../../bin/minsky");

function makeFixtureStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "minsky-consent-test-"));
  return dir;
}

function runConsent(
  args: readonly string[],
  opts: {
    stateDir: string;
    env?: Record<string, string>;
  },
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    MINSKY_STATE_DIR: opts.stateDir,
    ...opts.env,
  };
  const result = spawnSync(MINSKY_BIN, ["consent", ...args], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

interface ConsentRecord {
  consent: boolean;
  timestamp: string;
  host_path_hash: string;
  agent: string;
}

function readConsentRecord(stateDir: string): ConsentRecord {
  const text = readFileSync(join(stateDir, "telemetry-consent.json"), "utf8");
  return JSON.parse(text) as ConsentRecord;
}

let stateDir: string;
beforeEach(() => {
  stateDir = makeFixtureStateDir();
});
afterEach(() => {
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true, force: true });
});

describe("bin/minsky consent — one-command telemetry recording", () => {
  test("--yes writes a consent record with all 4 documented fields", () => {
    const r = runConsent(["--yes"], { stateDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("recorded yes");
    const rec = readConsentRecord(stateDir);
    expect(rec.consent).toBe(true);
    expect(typeof rec.timestamp).toBe("string");
    expect(rec.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(rec.host_path_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof rec.agent).toBe("string");
    expect(rec.agent.length).toBeGreaterThan(0);
  });

  test("--no writes consent: false but keeps the same field shape", () => {
    const r = runConsent(["--no"], { stateDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("recorded no");
    const rec = readConsentRecord(stateDir);
    expect(rec.consent).toBe(false);
    expect(rec.host_path_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("re-running --yes is idempotent (consent stays true; timestamp updates)", () => {
    const first = runConsent(["--yes"], { stateDir });
    expect(first.status).toBe(0);
    const rec1 = readConsentRecord(stateDir);
    // Sleep a bit so timestamp is observably different
    spawnSync("sleep", ["1.1"]);
    const second = runConsent(["--yes"], { stateDir });
    expect(second.status).toBe(0);
    const rec2 = readConsentRecord(stateDir);
    expect(rec2.consent).toBe(true);
    expect(rec2.host_path_hash).toBe(rec1.host_path_hash);
    expect(rec2.timestamp).not.toBe(rec1.timestamp);
  });

  test("--no after --yes flips the consent value atomically", () => {
    runConsent(["--yes"], { stateDir });
    const recYes = readConsentRecord(stateDir);
    expect(recYes.consent).toBe(true);
    runConsent(["--no"], { stateDir });
    const recNo = readConsentRecord(stateDir);
    expect(recNo.consent).toBe(false);
    expect(recNo.host_path_hash).toBe(recYes.host_path_hash);
  });

  test("both --yes and --no together: exits 2 with ambiguous error", () => {
    const r = runConsent(["--yes", "--no"], { stateDir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mutually exclusive");
    expect(existsSync(join(stateDir, "telemetry-consent.json"))).toBe(false);
  });

  test("neither flag: exits 2 with --yes/--no guidance", () => {
    const r = runConsent([], { stateDir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--yes or --no");
    expect(existsSync(join(stateDir, "telemetry-consent.json"))).toBe(false);
  });

  test("MINSKY_AGENT env overrides the default in the agent field", () => {
    runConsent(["--yes"], {
      stateDir,
      env: { MINSKY_AGENT: "devin" },
    });
    const rec = readConsentRecord(stateDir);
    expect(rec.agent).toBe("devin");
  });

  test("machine-salt file is created once and reused", () => {
    runConsent(["--yes"], { stateDir });
    const salt1 = readFileSync(join(stateDir, "machine-salt"), "utf8");
    expect(salt1.length).toBeGreaterThan(16);
    runConsent(["--no"], { stateDir });
    const salt2 = readFileSync(join(stateDir, "machine-salt"), "utf8");
    expect(salt2).toBe(salt1);
  });

  test("MINSKY_TELEMETRY_ENDPOINT unset: no network attempt (no error)", () => {
    const r = runConsent(["--yes"], { stateDir });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("telemetry POST");
  });

  test("MINSKY_TELEMETRY_ENDPOINT pointed at unreachable host: consent still recorded", () => {
    // Endpoint is fire-and-forget — a 3s timeout against an
    // unreachable endpoint must NOT block the install or fail the
    // command. Consent still lands locally.
    const r = runConsent(["--yes"], {
      stateDir,
      env: {
        MINSKY_TELEMETRY_ENDPOINT: "http://127.0.0.1:1/never-listening",
      },
    });
    expect(r.status).toBe(0);
    expect(readConsentRecord(stateDir).consent).toBe(true);
    expect(r.stderr).toContain("telemetry POST");
  });
});
