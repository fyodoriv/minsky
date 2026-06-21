// Integration test for the throughput-at-scale benchmark — the "code
// factory" pillar made falsifiable. Exercises the real script + the real
// `bin/minsky benchmark --throughput` wiring against a copied fixture
// fleet, and pins the scorecard JSON contract the
// `throughput-at-scale-benchmark` task's Success criterion names.
//
// Hypothesis (rule #9): `bin/minsky benchmark --throughput` walks the
// fixture fleet, writes a `competitive-scorecard.json` with the three
// throughput rows, and the rows are well-typed and non-negative —
// regardless of whether the host environment has a configured runner.
// Success: every assertion below passes. Measurement: this file.
// Anchor: TASKS.md `throughput-at-scale-benchmark`; AGENTS.md §3b
// (integration test exercises the real binary, not a mock);
// Forsgren-Humble-Kim 2018 (DORA deployment-frequency SLI).

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const BIN_MINSKY = join(REPO_ROOT, "bin", "minsky");
const SCRIPT = join(REPO_ROOT, "scripts", "throughput-benchmark.mjs");
const FIXTURES = join(REPO_ROOT, "test-fixtures", "throughput");
const BENCHMARK_EXEC_TIMEOUT_MS = 120_000;
const BENCHMARK_TEST_TIMEOUT_MS = BENCHMARK_EXEC_TIMEOUT_MS + 10_000;

let fleet: string;
let scorecardPath: string;
let configPath: string;

beforeAll(() => {
  fleet = mkdtempSync(join(tmpdir(), "minsky-throughput-"));
  // Copy the five committed seed hosts into the temp fleet. We do NOT
  // git-init them — the benchmark's dry-run walk records a non-PR
  // verdict for an unbootstrapped/unconfigured host, which is the honest
  // falsifiable outcome (PRs/day = 0) and keeps the test hermetic + fast.
  for (const host of ["host-01", "host-02", "host-03", "host-04", "host-05"]) {
    cpSync(join(FIXTURES, host), join(fleet, host), { recursive: true });
  }
  scorecardPath = join(fleet, "scorecard.json");
  configPath = join(fleet, "config.json");
  writeFileSync(configPath, JSON.stringify({ cloud_agent: "claude", local_llm_enabled: false }));
});

afterAll(() => {
  rmSync(fleet, { recursive: true, force: true });
});

describe("throughput-benchmark — scorecard contract", () => {
  it(
    "writes the three falsifiable rows for the full fixture fleet",
    () => {
      const out = execFileSync(
        "node",
        [
          SCRIPT,
          `--hosts-dir`,
          fleet,
          `--fixture-hosts=5`,
          `--duration=24h`,
          `--scorecard`,
          scorecardPath,
          `--json`,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, MINSKY_CONFIG: configPath },
          timeout: BENCHMARK_EXEC_TIMEOUT_MS,
        },
      );
      const report = JSON.parse(out);
      expect(report.fixture_hosts).toBe(5);
      expect(report.duration_seconds).toBe(86400);

      const doc = JSON.parse(readFileSync(scorecardPath, "utf8"));
      const values = doc.competitors["minsky-self"].values;
      // The two task-named rows plus the iterations companion must exist and
      // be well-typed + non-negative. We pin the CONTRACT (keys, types,
      // sign), not the live values — the actual PRs/day depends on whether
      // the host has a configured runner, which is an environment fact, not
      // a benchmark-correctness fact.
      expect(typeof values.minsky_throughput_prs_per_day).toBe("number");
      expect(values.minsky_throughput_prs_per_day).toBeGreaterThanOrEqual(0);
      expect(typeof values.minsky_draft_acceptance_rate).toBe("number");
      expect(values.minsky_draft_acceptance_rate).toBeGreaterThanOrEqual(0);
      expect(values.minsky_draft_acceptance_rate).toBeLessThanOrEqual(1);
      expect(typeof values.minsky_throughput_iterations_per_day).toBe("number");
      expect(typeof values.measured_at).toBe("string");
    },
    BENCHMARK_TEST_TIMEOUT_MS,
  );

  it(
    "honours --fixture-hosts=3 (walks a subset of the fleet)",
    () => {
      const out = execFileSync(
        "node",
        [
          SCRIPT,
          `--hosts-dir`,
          fleet,
          `--fixture-hosts=3`,
          `--duration=90m`,
          `--json`,
          `--scorecard`,
          scorecardPath,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, MINSKY_CONFIG: configPath },
          timeout: BENCHMARK_EXEC_TIMEOUT_MS,
        },
      );
      const report = JSON.parse(out);
      expect(report.fixture_hosts).toBe(3);
      expect(report.duration_seconds).toBe(5400);
    },
    BENCHMARK_TEST_TIMEOUT_MS,
  );
});

describe("throughput-benchmark — CLI surface", () => {
  it("`bin/minsky benchmark --throughput --help` prints usage and exits 0", () => {
    const out = execFileSync("bash", [BIN_MINSKY, "benchmark", "--throughput", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(out).toMatch(/--throughput/);
    expect(out.toLowerCase()).toContain("usage");
  });

  it(
    "`bin/minsky benchmark --throughput` routes to the throughput runner",
    () => {
      const out = execFileSync(
        "bash",
        [
          BIN_MINSKY,
          "benchmark",
          "--throughput",
          "--hosts-dir",
          fleet,
          "--fixture-hosts=2",
          "--json",
          "--scorecard",
          scorecardPath,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, MINSKY_CONFIG: configPath },
          timeout: BENCHMARK_EXEC_TIMEOUT_MS,
        },
      );
      const report = JSON.parse(out);
      // The throughput runner emits `fixture_hosts`; the plain benchmark
      // runner emits `iterations`. Asserting the former proves the
      // `--throughput` flag routed correctly.
      expect(report.fixture_hosts).toBe(2);
      expect(report).not.toHaveProperty("pass_rate");
    },
    BENCHMARK_TEST_TIMEOUT_MS,
  );

  it("rejects an empty fleet with exit 2 and an actionable message", () => {
    const empty = mkdtempSync(join(tmpdir(), "minsky-throughput-empty-"));
    try {
      execFileSync("node", [SCRIPT, `--hosts-dir`, empty, `--json`], {
        encoding: "utf8",
        env: { ...process.env, MINSKY_CONFIG: configPath },
        timeout: 30_000,
      });
      throw new Error("expected non-zero exit for an empty fleet");
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(2);
      expect(String(e.stderr)).toContain("no fixture hosts");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("rejects a malformed --duration with exit 2", () => {
    try {
      execFileSync("node", [SCRIPT, `--hosts-dir`, fleet, `--duration=soon`, `--json`], {
        encoding: "utf8",
        env: { ...process.env, MINSKY_CONFIG: configPath },
        timeout: 30_000,
      });
      throw new Error("expected non-zero exit for a malformed duration");
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(2);
      expect(String(e.stderr)).toContain("--duration");
    }
  });
});
