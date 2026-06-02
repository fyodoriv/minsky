// Tests for scripts/measure-agent-install.mjs — the harness that
// closes parent P0 `agent-mediated-install`'s Success #1 criterion.
//
// Hypothesis (rule #9): the harness is pure modulo (Date.now,
// readingFn), so the pure `buildReport()` and `liveVerdict()` functions
// can be exercised fully with deterministic inputs. Mock-mode is the CI
// gate; live mode spawns a real agent (operator-side only) but its
// scoring is the pure `liveVerdict()` fixture-tested against committed
// transcripts, and `liveReading` skips gracefully when the CLI is absent.
//
// Success: ≥10 test cases covering args parsing, threshold semantics,
// aggregate verdict logic, mock-vs-live dispatch, JSON shape, per-provider
// prompt-count parsing, and the binary-absent graceful-skip path.
// Pivot: live invocation stays out of CI (cost) — the mock path and the
// fixture-replayed liveVerdict path are the load-bearing CI invariants.
// Measurement: this test file.
// Anchor: rule #9 (pre-registered metrics); rule #11 (no flaky
// metrics — mock determinism is the anti-flake guarantee).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as claudeCodeParser from "./measure-agent-install/parsers/claude-code.mjs";
import * as cursorParser from "./measure-agent-install/parsers/cursor.mjs";
import * as devinParser from "./measure-agent-install/parsers/devin.mjs";
import {
  buildReport,
  liveVerdict,
  mockReading,
  PROVIDER_PARSERS,
} from "./measure-agent-install.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = resolve(HERE, "measure-agent-install.mjs");
const FIXTURES = resolve(HERE, "..", "test", "fixtures", "agent-install");

/** @param {string} provider */
function readFixture(provider) {
  return readFileSync(join(FIXTURES, provider, "run-1.transcript.txt"), "utf8");
}

describe("measure-agent-install.mjs — buildReport (pure function)", () => {
  test("mock provider with 3 runs and default thresholds: all pass, aggregate=pass", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 3,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.runs).toHaveLength(3);
    expect(r.totals.passed).toBe(3);
    expect(r.totals.failed).toBe(0);
    expect(r.totals.skipped).toBe(0);
    expect(r.aggregate_verdict).toBe("pass");
    expect(r.runs_passed).toBe(3);
  });

  test("mock provider with threshold-seconds=1 (impossible): all fail, aggregate=fail", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 3,
      thresholdSeconds: 1,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.totals.failed).toBe(3);
    expect(r.totals.passed).toBe(0);
    expect(r.aggregate_verdict).toBe("fail");
    expect(r.runs_passed).toBe(0);
  });

  test("mock provider with threshold-prompts=0: all fail (mock asks 1 prompt)", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 3,
      thresholdSeconds: 90,
      thresholdPrompts: 0,
      live: false,
    });
    expect(r.totals.failed).toBe(3);
    expect(r.aggregate_verdict).toBe("fail");
  });

  test("real provider without --live: emits skipped readings with a reason", () => {
    const r = buildReport({
      providers: ["claude-code"],
      runsPerProvider: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.totals.skipped).toBe(2);
    expect(r.totals.passed).toBe(0);
    expect(r.aggregate_verdict).toBe("fail");
    expect(r.runs[0]?.reason).toMatch(/requires --live/);
  });

  test("real provider WITH --live but CLI absent: skips gracefully with 'not on PATH' reason", () => {
    // Inject a readingFn that mimics liveReading's binary-absent branch so
    // the test never spawns a real agent (and stays deterministic even if
    // `claude` happens to be installed on the CI/dev host).
    const r = buildReport({
      providers: ["claude-code"],
      runsPerProvider: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: true,
      readingFn: ({ provider, runIndex }) => ({
        provider,
        run_index: runIndex,
        duration_seconds: -1,
        prompt_count: -1,
        verdict: "skipped",
        reason: `agent CLI "claude" not on PATH — install it to run --live for ${provider}`,
      }),
    });
    expect(r.totals.skipped).toBe(2);
    expect(r.aggregate_verdict).toBe("fail");
    expect(r.runs[0]?.reason).toMatch(/not on PATH/);
  });

  test("mock + real (no --live): mock passes, real skips → aggregate fails", () => {
    const r = buildReport({
      providers: ["mock", "devin"],
      runsPerProvider: 1,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.totals.total).toBe(2);
    expect(r.totals.passed).toBe(1);
    expect(r.totals.skipped).toBe(1);
    // Aggregate=pass requires every run to pass.
    expect(r.aggregate_verdict).toBe("fail");
  });

  test("9-run cross-provider mock matrix (3 providers × 3 runs): all pass via mock", () => {
    // Simulates the parent task's Success criterion shape, but with
    // mock providers so CI can run it deterministically.
    const r = buildReport({
      providers: ["mock", "mock", "mock"],
      runsPerProvider: 3,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.runs).toHaveLength(9);
    expect(r.totals.passed).toBe(9);
    expect(r.aggregate_verdict).toBe("pass");
    expect(r.runs_passed).toBe(9);
  });

  test("report has stable JSON shape with all documented fields", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 1,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(typeof r.timestamp).toBe("string");
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.config).toEqual({
      providers: ["mock"],
      runs_per_provider: 1,
      threshold_seconds: 90,
      threshold_prompts: 1,
      live: false,
    });
    expect(r.runs[0]).toMatchObject({
      provider: "mock",
      run_index: 1,
      duration_seconds: expect.any(Number),
      prompt_count: expect.any(Number),
      verdict: "pass",
    });
  });
});

describe("measure-agent-install.mjs — mockReading (deterministic)", () => {
  test("same (provider, runIndex) → same reading across calls", () => {
    const a = mockReading({
      provider: "mock",
      runIndex: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    const b = mockReading({
      provider: "mock",
      runIndex: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(a.duration_seconds).toBe(b.duration_seconds);
    expect(a.prompt_count).toBe(b.prompt_count);
    expect(a.verdict).toBe(b.verdict);
  });

  test("different runIndex → different duration (proves non-constant) but always ≤ 90s default", () => {
    const a = mockReading({
      provider: "mock",
      runIndex: 1,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    const b = mockReading({
      provider: "mock",
      runIndex: 5,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(a.duration_seconds).not.toBe(b.duration_seconds);
    expect(a.duration_seconds).toBeLessThanOrEqual(90);
    expect(b.duration_seconds).toBeLessThanOrEqual(90);
  });
});

describe("measure-agent-install.mjs — CLI integration", () => {
  /**
   * @param {readonly string[]} args
   * @param {Record<string, unknown>} [opts]
   */
  function runCli(args, opts = {}) {
    return spawnSync("node", [HARNESS_PATH, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      ...opts,
    });
  }

  test("--providers=mock --runs-per-provider=3 --threshold-seconds=90 --threshold-prompts=1: exits 0 with aggregate pass", () => {
    const r = runCli([
      "--providers=mock",
      "--runs-per-provider=3",
      "--threshold-seconds=90",
      "--threshold-prompts=1",
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.aggregate_verdict).toBe("pass");
    expect(report.runs_passed).toBe(3);
  });

  test("invalid provider name: exits 2 with helpful error", () => {
    const r = runCli(["--providers=unknown-provider", "--runs-per-provider=1"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown provider");
  });

  test("--runs-per-provider=0: exits 2 (must be positive integer)", () => {
    const r = runCli(["--providers=mock", "--runs-per-provider=0"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--runs-per-provider");
  });

  test("--out=<file> writes the report JSON to the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "measure-agent-test-"));
    try {
      const outFile = join(dir, "report.json");
      const r = runCli([
        "--providers=mock",
        "--runs-per-provider=2",
        `--out=${outFile}`,
        "--quiet",
      ]);
      expect(r.status).toBe(0);
      expect(existsSync(outFile)).toBe(true);
      const report = JSON.parse(readFileSync(outFile, "utf8"));
      expect(report.aggregate_verdict).toBe("pass");
      expect(report.runs).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--providers=cursor --live with CLI absent: exits 1, run skipped, no spawn", () => {
    // PATH points at a scratch dir containing only a symlink to the real
    // `node` binary — so the harness itself launches, but the agent CLI
    // (`cursor-agent`) is NOT resolvable and the run skips gracefully
    // rather than spawning anything. `git`/`cat` are also absent, proving
    // no transcript capture is attempted on the skip path.
    const dir = mkdtempSync(join(tmpdir(), "measure-agent-nopath-"));
    try {
      symlinkSync(process.execPath, join(dir, "node"));
      const r = runCli(["--providers=cursor", "--runs-per-provider=1", "--live"], {
        env: { ...process.env, PATH: dir },
      });
      expect(r.status).toBe(1);
      const report = JSON.parse(r.stdout);
      expect(report.runs[0].verdict).toBe("skipped");
      expect(report.runs[0].reason).toMatch(/not on PATH/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("per-provider parsers — fixture-tested prompt counting", () => {
  test("registry maps each known provider to its parser module", () => {
    expect(PROVIDER_PARSERS["claude-code"]).toBe(claudeCodeParser);
    expect(PROVIDER_PARSERS["devin"]).toBe(devinParser);
    expect(PROVIDER_PARSERS["cursor"]).toBe(cursorParser);
    for (const [name, parser] of Object.entries(PROVIDER_PARSERS)) {
      expect(parser.PROVIDER).toBe(name);
      expect(typeof parser.BINARY).toBe("string");
      expect(parser.BINARY.length).toBeGreaterThan(0);
      expect(typeof parser.parsePromptCount).toBe("function");
    }
  });

  test("claude-code: conforming transcript has exactly 1 operator prompt", () => {
    expect(claudeCodeParser.parsePromptCount(readFixture("claude-code"))).toBe(1);
  });

  test("devin: conforming transcript has exactly 1 operator prompt", () => {
    expect(devinParser.parsePromptCount(readFixture("devin"))).toBe(1);
  });

  test("cursor: conforming transcript has exactly 1 operator prompt", () => {
    expect(cursorParser.parsePromptCount(readFixture("cursor"))).toBe(1);
  });

  test("empty / non-string transcript → 0 prompts (no crash)", () => {
    for (const parser of [claudeCodeParser, devinParser, cursorParser]) {
      expect(parser.parsePromptCount("")).toBe(0);
      // @ts-expect-error — exercising the defensive non-string guard
      expect(parser.parsePromptCount(undefined)).toBe(0);
    }
  });

  test("claude-code: two AskUserQuestion blocks → 2 prompts (over-prompt detected)", () => {
    const t = "[AskUserQuestion]\nfirst\n[AskUserQuestion]\nsecond\n";
    expect(claudeCodeParser.parsePromptCount(t)).toBe(2);
  });

  test("devin: falls back to verbatim consent text when no primary marker", () => {
    const t = "[devin] Do you agree to submit these anonymized telemetry events?\n";
    expect(devinParser.parsePromptCount(t)).toBe(1);
  });
});

describe("liveVerdict — pure scoring of a captured transcript", () => {
  test("conforming claude-code transcript under thresholds → pass with measured prompt_count", () => {
    const v = liveVerdict({
      provider: "claude-code",
      runIndex: 1,
      durationSeconds: 42.5,
      transcript: readFixture("claude-code"),
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(v.verdict).toBe("pass");
    expect(v.prompt_count).toBe(1);
    expect(v.duration_seconds).toBe(42.5);
    expect(v.provider).toBe("claude-code");
  });

  test("over-duration → fail even with a conforming prompt count", () => {
    const v = liveVerdict({
      provider: "cursor",
      runIndex: 1,
      durationSeconds: 120,
      transcript: readFixture("cursor"),
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(v.verdict).toBe("fail");
  });

  test("over-prompt (2 prompts vs threshold 1) → fail", () => {
    const v = liveVerdict({
      provider: "claude-code",
      runIndex: 1,
      durationSeconds: 10,
      transcript: "[AskUserQuestion]\na\n[AskUserQuestion]\nb\n",
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(v.verdict).toBe("fail");
    expect(v.prompt_count).toBe(2);
  });

  test("unregistered provider → skipped with a reason (never throws)", () => {
    const v = liveVerdict({
      provider: "not-a-provider",
      runIndex: 1,
      durationSeconds: 10,
      transcript: "anything",
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(v.verdict).toBe("skipped");
    expect(v.reason).toMatch(/no parser registered/);
  });
});
