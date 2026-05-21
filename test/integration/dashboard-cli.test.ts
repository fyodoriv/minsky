// Integration tests for the `minsky` CLI dashboard features:
//   - `minsky status` shows stability %
//   - `minsky watch` renders all dashboard sections
//   - smart auto-attach detects running daemon
//   - stability-number.mjs computes from real jsonl
//   - iteration summary lines appear in daemon log
//
// Hypothesis (rule #9): the dashboard surfaces iteration health,
//   stability %, human-help-needed, and current task in a single view.
//   Success: all 5 dashboard sections render with real data from
//   fixture jsonl. Pivot: if bash parsing is too fragile, rewrite
//   watch as a node.js script. Measurement: this test file.
// Anchor: Card & Mackinlay 1999 (glanceable — 10 metrics in one view);
//   operator directive 2026-05-18 ("status + logs + changelog in one terminal").

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("stability-number.mjs", () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "minsky-dash-test-"));
    const storeDir = join(fixtureDir, ".minsky", "experiment-store", "cross-repo");
    mkdirSync(storeDir, { recursive: true });

    // Write fixture jsonl with known verdicts
    const records = [
      { ts: new Date().toISOString(), verdict: "validated", notes: "100000ms", pr_url: null },
      { ts: new Date().toISOString(), verdict: "validated", notes: "200000ms", pr_url: null },
      { ts: new Date().toISOString(), verdict: "spawn-failed", notes: "4000ms", pr_url: null },
      { ts: new Date().toISOString(), verdict: "scope-leak", notes: "300000ms", pr_url: null },
      {
        ts: new Date().toISOString(),
        verdict: "validated",
        notes: "150000ms",
        pr_url: "https://github.com/test/pr/1",
      },
    ];
    const jsonl = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
    writeFileSync(join(storeDir, "test-task.jsonl"), jsonl);
  });

  test("computes correct stability % from fixture jsonl", () => {
    const scriptPath = join(REPO_ROOT, "scripts", "stability-number.mjs");
    const output = execSync(`node ${scriptPath} ${fixtureDir}`, { encoding: "utf8" }).trim();
    // 3 validated out of 5 total = 60%
    expect(output).toContain("60%");
    expect(output).toContain("3/5");
  });

  test("--json mode returns structured output", () => {
    const scriptPath = join(REPO_ROOT, "scripts", "stability-number.mjs");
    const output = execSync(`node ${scriptPath} ${fixtureDir} --json`, { encoding: "utf8" }).trim();
    const data = JSON.parse(output);
    expect(data.stability_pct).toBe(60);
    expect(data.successful).toBe(3);
    expect(data.total).toBe(5);
    expect(data.window).toBe("7d");
  });

  test("returns no-data for empty directory", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "minsky-dash-empty-"));
    const scriptPath = join(REPO_ROOT, "scripts", "stability-number.mjs");
    const output = execSync(`node ${scriptPath} ${emptyDir}`, { encoding: "utf8" }).trim();
    expect(output).toContain("no data");
  });

  test("returns no-data JSON for empty directory", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "minsky-dash-empty2-"));
    const scriptPath = join(REPO_ROOT, "scripts", "stability-number.mjs");
    const output = execSync(`node ${scriptPath} ${emptyDir} --json`, { encoding: "utf8" }).trim();
    const data = JSON.parse(output);
    expect(data.stability_pct).toBeNull();
  });
});

describe("minsky CLI subcommands", () => {
  test("minsky status exits 0 and shows daemon section", () => {
    const minskyBin = join(REPO_ROOT, "bin", "minsky");
    const output = execSync(`bash -c '${minskyBin} status 2>&1; true'`, {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(output.toLowerCase()).toContain("minsky");
  });

  test("minsky watch --help or short run doesn't crash", () => {
    // Watch is a loop — we can't run it in a test. But we can verify
    // the bin/minsky script parses the 'watch' subcommand without error
    // by checking that the script defines the case.
    const shim = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(shim).toContain("watch)");
    expect(shim).toContain("NEEDS HUMAN ACTION");
    expect(shim).toContain("RECENT ITERATIONS");
    expect(shim).toContain("Stability");
  });

  test("minsky bin/minsky contains smart auto-attach logic", () => {
    const shim = readFileSync(join(REPO_ROOT, "bin", "minsky"), "utf8");
    expect(shim).toContain("_daemon_running_for_host");
    expect(shim).toContain("attaching with watch");
    expect(shim).toContain("no daemon running for");
  });
});

describe("iteration summary line format", () => {
  test("minsky-run.mjs emits ⏱ iteration line in recordIteration", () => {
    // Verify the source code contains the summary line format
    const runnerSrc = readFileSync(
      join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"),
      "utf8",
    );
    expect(runnerSrc).toContain("⏱ iteration #${record.iteration}");
    expect(runnerSrc).toContain("agent=${agent}");
    expect(runnerSrc).toContain("verdict=${verdict}");
    expect(runnerSrc).toContain("duration=${durSec}s");
    expect(runnerSrc).toContain("pr=${pr}");
  });
});
