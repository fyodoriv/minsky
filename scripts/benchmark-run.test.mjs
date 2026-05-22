// Tests for the benchmark-run.mjs CLI shim. Pure-function level
// tests are in novel/competitive-benchmark/; this file tests the
// CLI smoke path against a fixture host.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "benchmark-run.mjs");
const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Run benchmark-run.mjs against a fixture host directory.
 *
 * @param {string} host
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runBenchmark(host, args = []) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, "--host", host, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, MINSKY_HOME: host },
      timeout: 30000,
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    const err =
      /** @type {{ status?: number | null, stdout?: string | Buffer, stderr?: string | Buffer }} */ (
        e
      );
    const code = err.status ?? 1;
    return {
      code,
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString() ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? ""),
    };
  }
}

describe("benchmark-run.mjs CLI", () => {
  test("(a) --help prints usage and exits 0", () => {
    const r = execFileSync(process.execPath, [SCRIPT, "--help"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(r).toContain("Usage:");
    expect(r).toContain("--write-to");
    expect(r).toContain("--json");
    expect(r).toContain("M1.10");
  });

  test("(b) rejects unknown args with exit 64", () => {
    const host = mkdtempSync(join(tmpdir(), "minsky-bench-"));
    execFileSync("git", ["init", host], { stdio: "ignore" });
    const r = runBenchmark(host, ["--bogus"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("unknown argument: --bogus");
  });

  test("(c) empty-ledger host: writes scorecard, exits 0 (M1.10 shape gate MET on corpus alone)", () => {
    const host = mkdtempSync(join(tmpdir(), "minsky-bench-"));
    execFileSync("git", ["init", host], { stdio: "ignore" });
    const r = runBenchmark(host);
    // After the 2026-05-22 corpus expansion the published corpus
    // carries ≥4 competitors × ≥5 shared metrics, so the M1.10 shape
    // gate is met regardless of Minsky-side measurement.
    expect(r.code).toBe(0);
    const writePath = join(host, ".minsky", "competitive-scorecard.json");
    expect(existsSync(writePath)).toBe(true);
    const sc = JSON.parse(readFileSync(writePath, "utf8"));
    expect(sc.acceptance.meetsM110).toBe(true);
    expect(sc.acceptance.gap).toBe("");
    // Cold-start: no Minsky readings yet (informational).
    expect(sc.acceptance.liveDeltaCount).toBe(0);
  });

  test("(d) fixture ledger producing autonomous-merge-rate yields live deltas against Devin/Claude Code/Cursor", () => {
    const host = mkdtempSync(join(tmpdir(), "minsky-bench-"));
    execFileSync("git", ["init", host], { stdio: "ignore" });
    const minskyDir = join(host, ".minsky");
    execFileSync("mkdir", ["-p", minskyDir]);
    const ledger = [
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/1",
        prState: "merged",
        humanEdits: false,
        ciFirstPushGreen: true,
        durationSec: 3600,
        costUsd: 0.5,
      },
      {
        verdict: "pr-open",
        pr: "https://example.com/pr/2",
        prState: "merged",
        humanEdits: false,
        ciFirstPushGreen: true,
        durationSec: 1800,
        costUsd: 0.3,
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    writeFileSync(join(minskyDir, "orchestrate.jsonl"), `${ledger}\n`);

    const r = runBenchmark(host);
    // Shape gate met (corpus is fine) → exit 0.
    expect(r.code).toBe(0);
    const sc = JSON.parse(
      readFileSync(join(host, ".minsky", "competitive-scorecard.json"), "utf8"),
    );
    expect(sc.acceptance.meetsM110).toBe(true);
    // The Minsky ledger now produces autonomous-merge-rate = 1.0
    // (2 merged / 2 opened) — joins against Devin (0.67), Claude Code
    // (0.726), Cursor (0.804). Also mean-autonomous-merge-latency = 2700s
    // and cost-per-merged-pr = 0.4 USD — join against OpenHands/Devin.
    expect(sc.acceptance.liveDeltaCount).toBeGreaterThanOrEqual(3);
  });

  test("(e) --write-to redirects the output file", () => {
    const host = mkdtempSync(join(tmpdir(), "minsky-bench-"));
    execFileSync("git", ["init", host], { stdio: "ignore" });
    const customOut = join(host, "out.json");
    runBenchmark(host, ["--write-to", customOut]);
    expect(existsSync(customOut)).toBe(true);
    const sc = JSON.parse(readFileSync(customOut, "utf8"));
    expect(sc.generatedAt).toBeTruthy();
    expect(sc.cells).toBeInstanceOf(Array);
  });

  test("(f) --json prints raw JSON to stdout, exits 0 on M1.10 shape gate met", () => {
    const host = mkdtempSync(join(tmpdir(), "minsky-bench-"));
    execFileSync("git", ["init", host], { stdio: "ignore" });
    const r = runBenchmark(host, ["--json"]);
    expect(r.code).toBe(0);
    // JSON should be parseable
    const parsed = JSON.parse(r.stdout);
    expect(parsed.acceptance).toBeDefined();
    expect(parsed.acceptance.meetsM110).toBe(true);
    expect(parsed.cellCount).toBeGreaterThan(0);
  });
});
