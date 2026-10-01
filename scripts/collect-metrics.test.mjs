// Smoke tests for `collect-metrics.mjs` — collects daemon metrics into
// a JSONL snapshot file. Lifts L6 coverage.
//
// Source: rule #4 (everything measurable, everything visible);
// rule #17 (proactive healing — observed L6 gap is a fix).

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "collect-metrics.mjs");

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(args, env) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      // 60s: collect-metrics.mjs runs ~15 collectors including a
      // `gh pr list` + `gh run list` (5s timeout each on network),
      // 3 python3 forks for the ledger-backed M1.2/M1.5/M1.7
      // collectors, and ~10 fast git/grep collectors. The script
      // total can hit ~20s under slow-network CI; 60s gives 3x
      // headroom against the existing tail. Was 15s — that bound
      // started failing when the python forks landed (this PR).
      timeout: 60_000,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = /** @type {{ stdout?: string; stderr?: string; status?: number }} */ (err);
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? 1,
    };
  }
}

describe("collect-metrics smoke", () => {
  test("--json returns valid JSON (after the 'Collecting…' progress prefix)", () => {
    const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "collect-home-")) };
    const r = run(["--json"], env);
    expect(r.stdout.length).toBeGreaterThan(0);
    // The script prints a progress line before the JSON; pull the first
    // `{` and parse from there.
    const firstBrace = r.stdout.indexOf("{");
    expect(firstBrace).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(firstBrace));
    expect(typeof parsed).toBe("object");
  });

  test("default (non-json) output is non-empty (header or summary)", () => {
    const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "collect-home-")) };
    const r = run([], env);
    // Always some output (even an empty-state header).
    expect((r.stdout ?? "").length + (r.stderr ?? "").length).toBeGreaterThan(0);
  });
});

describe("collect-metrics — ledger-backed M1 formatters (pure)", () => {
  // The 3 formatters below project the python aggregators'
  // `transform_trend.py` / `transform_knowledge.py` JSON output into
  // the `{ value, higherIsBetter }` shape every collector emits. Pure
  // — no `execFileSync` — so tests are sub-millisecond and don't hit
  // the subprocess-timeout tail. The honest-zero invariant (Ries
  // 2011 — never (stub), always a descriptive string when n=0) is
  // verified end-to-end for every documented fallback path.
  //
  // M1.2 / M1.5 / M1.7 alignment depends on `(stub)` not appearing
  // in METRICS.md for these metric ids. Every test below asserts the
  // formatter's output does NOT start with `(stub)`.

  test("formatFleetStability — undefined hostsDir → honest 'no fleet'", async () => {
    const { formatFleetStability } = await import("./collect-metrics.mjs");
    const r = formatFleetStability(undefined, null);
    expect(r).not.toBeNull();
    expect(String(r.value).startsWith("(stub)")).toBe(false);
    expect(r.value).toContain("no fleet");
  });

  test("formatFleetStability — host_count 0 → honest 'n=0 hosts'", async () => {
    const { formatFleetStability } = await import("./collect-metrics.mjs");
    const r = formatFleetStability("/tmp/fleet", { host_count: 0, per_host: [] });
    expect(String(r.value).startsWith("(stub)")).toBe(false);
    expect(r.value).toContain("n=0 hosts");
  });

  test("formatFleetStability — all hosts have null lint_pass_fraction → honest n=0 sessions", async () => {
    const { formatFleetStability } = await import("./collect-metrics.mjs");
    const r = formatFleetStability("/tmp/fleet", {
      host_count: 2,
      per_host: [
        { session_count: 0, lint_pass_fraction: null },
        { session_count: 0, lint_pass_fraction: null },
      ],
    });
    expect(String(r.value).startsWith("(stub)")).toBe(false);
    expect(r.value).toContain("n=0 sessions");
    expect(r.value).toContain("2 hosts");
  });

  test("formatFleetStability — weighted average across 2 hosts", async () => {
    const { formatFleetStability } = await import("./collect-metrics.mjs");
    // alpha: 3 sessions, lint_pass=1.0 → contributes 3 weighted pass
    // bravo: 1 session,  lint_pass=0.0 → contributes 0 weighted pass
    // total: 4 sessions, weighted_pass=3 → 75%
    const r = formatFleetStability("/tmp/fleet", {
      host_count: 2,
      per_host: [
        { session_count: 3, lint_pass_fraction: 1.0 },
        { session_count: 1, lint_pass_fraction: 0.0 },
      ],
    });
    expect(r.value).toContain("75.0% lint-pass");
    expect(r.value).toContain("2 hosts");
    expect(r.value).toContain("4 sessions");
  });

  test("formatSessionConvertsRepo — null input → honest 'ledger not yet created'", async () => {
    const { formatSessionConvertsRepo } = await import("./collect-metrics.mjs");
    const r = formatSessionConvertsRepo(null);
    expect(String(r.value).startsWith("(stub)")).toBe(false);
    expect(r.value).toContain("ledger not yet created");
  });

  test("formatSessionConvertsRepo — session_count 0 → honest 'n=0 sessions'", async () => {
    const { formatSessionConvertsRepo } = await import("./collect-metrics.mjs");
    const r = formatSessionConvertsRepo({
      session_count: 0,
      files_delta_per_session: [],
      tests_delta_per_session: [],
      loc_delta_per_session: [],
    });
    expect(String(r.value).startsWith("(stub)")).toBe(false);
    expect(r.value).toContain("n=0 sessions");
  });

  test("formatSessionConvertsRepo — 3 sessions, 2 converted → 66.7%", async () => {
    const { formatSessionConvertsRepo } = await import("./collect-metrics.mjs");
    const r = formatSessionConvertsRepo({
      session_count: 3,
      files_delta_per_session: [2, 0, 3], // session 1 + 3 converted
      tests_delta_per_session: [1, 0, 1],
      loc_delta_per_session: [40, 0, 40],
    });
    expect(r.value).toContain("66.7%");
    expect(r.value).toContain("2/3");
  });

  test("formatSessionConvertsRepo — non-zero in any axis counts as converted", async () => {
    const { formatSessionConvertsRepo } = await import("./collect-metrics.mjs");
    // 1 session with only tests_delta != 0 → still counts as converted
    const r = formatSessionConvertsRepo({
      session_count: 1,
      files_delta_per_session: [0],
      tests_delta_per_session: [1],
      loc_delta_per_session: [0],
    });
    expect(r.value).toContain("100.0%");
  });

  test("formatBaselineDeltaPerCycle — null input → honest 'ledger not yet created'", async () => {
    const { formatBaselineDeltaPerCycle } = await import("./collect-metrics.mjs");
    const r = formatBaselineDeltaPerCycle(null);
    expect(String(r.value).startsWith("(stub)")).toBe(false);
    expect(r.value).toContain("ledger not yet created");
  });

  test("formatBaselineDeltaPerCycle — 3 sessions with cumulative deltas → per-cycle average", async () => {
    const { formatBaselineDeltaPerCycle } = await import("./collect-metrics.mjs");
    const r = formatBaselineDeltaPerCycle({
      session_count: 3,
      files_delta_cumulative: [2, 2, 5], // last = 5, /3 = 1.7
      tests_delta_cumulative: [1, 1, 2], // last = 2, /3 = 0.7
      loc_delta_cumulative: [40, 40, 80], // last = 80, /3 = 26.7
    });
    expect(r.value).toContain("+1.7 files");
    expect(r.value).toContain("+0.7 tests");
    expect(r.value).toContain("+26.7 loc");
    expect(r.value).toContain("n=3");
  });
});
