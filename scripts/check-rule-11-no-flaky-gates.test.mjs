// Tests for the pure functions in check-rule-11-no-flaky-gates.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).
//
// Each test pins a single decision branch (above-threshold / below /
// sample-size guard / pair ordering / empty) so a regression surfaces
// as one targeted failure, not a vague suite-wide red.

import { describe, expect, test } from "vitest";

import {
  FLAKE_RATE_THRESHOLD,
  MIN_PAIRS_FOR_REPORT,
  detectFlakeRate,
  formatReportLine,
  parseCliArgs,
  runCli,
} from "./check-rule-11-no-flaky-gates.mjs";

/**
 * Minimal `WorkflowRun` factory — keeps fixtures readable. The `iso`
 * counter generates strictly-increasing timestamps so pair ordering
 * is deterministic.
 *
 * @param {string} workflowName
 * @param {string} name
 * @param {string} headSha
 * @param {string} conclusion
 * @param {number} iso  Monotonically-increasing counter (encoded as `0001`, `0002`, ...).
 * @returns {import("./check-rule-11-no-flaky-gates.mjs").WorkflowRun}
 */
function run(workflowName, name, headSha, conclusion, iso) {
  return {
    workflowName,
    name,
    headSha,
    conclusion,
    createdAt: `2026-05-04T00:${String(iso).padStart(2, "0")}:00.000Z`,
  };
}

/**
 * Build N same-SHA pairs for a single (workflow, job). Each pair has
 * one `failure` then one `success` if `flakey[i]` is true; otherwise
 * two `success` runs (a "clean" pair).
 *
 * @param {string} workflowName
 * @param {string} job
 * @param {readonly boolean[]} flakey  Per-pair flag — true → flake pair.
 * @returns {import("./check-rule-11-no-flaky-gates.mjs").WorkflowRun[]}
 */
function pairs(workflowName, job, flakey) {
  /** @type {import("./check-rule-11-no-flaky-gates.mjs").WorkflowRun[]} */
  const out = [];
  flakey.forEach((isFlake, i) => {
    const sha = `sha${String(i).padStart(3, "0")}`;
    if (isFlake) {
      out.push(run(workflowName, job, sha, "failure", i * 2 + 1));
      out.push(run(workflowName, job, sha, "success", i * 2 + 2));
    } else {
      out.push(run(workflowName, job, sha, "success", i * 2 + 1));
      out.push(run(workflowName, job, sha, "success", i * 2 + 2));
    }
  });
  return out;
}

describe("detectFlakeRate", () => {
  test("surfaces a job whose rate is ≥10 % across ≥5 pairs", () => {
    // 11 % rate (1 flake / 9 pairs) — but only 9 pairs, so the rate
    // calculation kicks in. We need ≥5 pairs (sample-size guard) AND
    // rate ≥ 0.10. 1/9 ≈ 0.111 > 0.10 → surfaces.
    const flakey = [true, false, false, false, false, false, false, false, false];
    const reports = detectFlakeRate(pairs("ci", "lighthouse-mobile", flakey));
    expect(reports).toHaveLength(1);
    const r = reports[0];
    if (r === undefined) throw new Error("unreachable: length 1");
    expect(r).toMatchObject({
      workflowName: "ci",
      jobName: "lighthouse-mobile",
      flakePairs: 1,
      totalPairs: 9,
    });
    expect(r.rate).toBeCloseTo(1 / 9, 5);
    expect(r.rate).toBeGreaterThanOrEqual(FLAKE_RATE_THRESHOLD);
  });

  test("does NOT surface a job whose rate is <10 % over ≥5 pairs", () => {
    // 1 flake / 11 pairs ≈ 9.09 % — below the 10 % threshold.
    const flakey = [true, false, false, false, false, false, false, false, false, false, false];
    const reports = detectFlakeRate(pairs("ci", "stable-job", flakey));
    expect(reports).toHaveLength(0);
  });

  test("does NOT surface a job with rate ≥10 % but <MIN_PAIRS_FOR_REPORT pairs (sample-size guard)", () => {
    // 1 flake / 4 pairs = 25 % — but only 4 pairs, below MIN_PAIRS_FOR_REPORT.
    const flakey = [true, false, false, false];
    expect(flakey.length).toBeLessThan(MIN_PAIRS_FOR_REPORT);
    const reports = detectFlakeRate(pairs("ci", "thin-evidence", flakey));
    expect(reports).toHaveLength(0);
  });

  test("returns empty for empty input", () => {
    expect(detectFlakeRate([])).toEqual([]);
  });

  test("ignores singleton runs (no pair to evaluate)", () => {
    // 5 SHAs but each only has one run → 0 pairs total → no report
    // even though 0/0 would NaN; the guard is `totalPairs >= 5`.
    const runs = ["sha0", "sha1", "sha2", "sha3", "sha4"].map((sha, i) =>
      run("ci", "single", sha, "failure", i + 1),
    );
    expect(detectFlakeRate(runs)).toEqual([]);
  });

  test("classifies success → failure as NOT a flake (only failure → success counts)", () => {
    // Same SHA, ordered: success first, then failure. This is a
    // genuine new failure on a re-run, not a flake recovered.
    const runs = [
      run("ci", "regression", "shaA", "success", 1),
      run("ci", "regression", "shaA", "failure", 2),
      run("ci", "regression", "shaB", "success", 3),
      run("ci", "regression", "shaB", "success", 4),
      run("ci", "regression", "shaC", "success", 5),
      run("ci", "regression", "shaC", "success", 6),
      run("ci", "regression", "shaD", "success", 7),
      run("ci", "regression", "shaD", "success", 8),
      run("ci", "regression", "shaE", "success", 9),
      run("ci", "regression", "shaE", "success", 10),
    ];
    const reports = detectFlakeRate(runs);
    expect(reports).toHaveLength(0);
  });

  test("surfaces only the flaky job in a mixed-job input", () => {
    const flakeyRuns = pairs("ci", "lighthouse-mobile", [
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]); // 2/10 = 20 % — surfaces
    const cleanRuns = pairs("ci", "stable-test", [false, false, false, false, false, false]);
    // 0/6 = 0 % — does not surface
    const reports = detectFlakeRate([...flakeyRuns, ...cleanRuns]);
    expect(reports).toHaveLength(1);
    const r = reports[0];
    if (r === undefined) throw new Error("unreachable: length 1");
    expect(r.jobName).toBe("lighthouse-mobile");
    expect(r.rate).toBeCloseTo(0.2, 5);
  });

  test("respects createdAt ordering when classifying pairs (out-of-order input)", () => {
    // Same SHA, two runs: ordered chronologically by createdAt the
    // sequence is failure → success (a flake). Input order is
    // shuffled to confirm `detectFlakeRate` sorts internally.
    const runs = [
      // Insert success first by array order, but with later createdAt.
      run("ci", "ordering-test", "shaX", "success", 99),
      run("ci", "ordering-test", "shaX", "failure", 1),
      ...pairs("ci", "ordering-test", [false, false, false, false]),
    ];
    const reports = detectFlakeRate(runs);
    // 1 flake / 5 pairs = 20 % — surfaces (≥10 % AND ≥5 pairs).
    expect(reports).toHaveLength(1);
    const r = reports[0];
    if (r === undefined) throw new Error("unreachable: length 1");
    expect(r.flakePairs).toBe(1);
    expect(r.totalPairs).toBe(5);
  });

  test("treats jobs with the same name across different workflows as separate", () => {
    const ciFlaky = pairs("ci", "build", [true, true, false, false, false, false]);
    const lighthouseClean = pairs("lighthouse", "build", [
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    const reports = detectFlakeRate([...ciFlaky, ...lighthouseClean]);
    expect(reports).toHaveLength(1);
    const r = reports[0];
    if (r === undefined) throw new Error("unreachable: length 1");
    expect(r.workflowName).toBe("ci");
    expect(r.jobName).toBe("build");
  });
});

describe("parseCliArgs", () => {
  test("parses --fixture <space> value", () => {
    expect(parseCliArgs(["--fixture", "/tmp/x.json"])).toEqual({
      fixturePath: "/tmp/x.json",
      workflowNames: [],
    });
  });

  test("parses --fixture=value", () => {
    expect(parseCliArgs(["--fixture=/tmp/x.json"])).toEqual({
      fixturePath: "/tmp/x.json",
      workflowNames: [],
    });
  });

  test("parses --workflows ci,lighthouse", () => {
    expect(parseCliArgs(["--workflows", "ci,lighthouse"])).toEqual({
      fixturePath: undefined,
      workflowNames: ["ci", "lighthouse"],
    });
  });
});

describe("formatReportLine", () => {
  test("renders <workflow>:<job> rate=<n>/<d> (<pct>%)", () => {
    expect(
      formatReportLine({
        workflowName: "ci",
        jobName: "lighthouse-mobile",
        flakePairs: 2,
        totalPairs: 7,
        rate: 2 / 7,
      }),
    ).toBe("ci:lighthouse-mobile rate=2/7 (28.6%)");
  });
});

describe("runCli", () => {
  test("prints clean message and exits 0 on a non-flaky fixture", () => {
    /** @type {string[]} */
    const lines = [];
    const code = runCli(["--fixture", "test/fixtures/rule-11-flake-detection/clean.json"], (l) =>
      lines.push(l),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/^rule-11 ok:/);
  });

  test("prints one report line per flaky job and exits 1", () => {
    /** @type {string[]} */
    const lines = [];
    const code = runCli(["--fixture", "test/fixtures/rule-11-flake-detection/flaky.json"], (l) =>
      lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines).toEqual(["ci:lighthouse-mobile rate=2/7 (28.6%)"]);
  });

  test("prints usage and exits 2 when neither --fixture nor --workflows is provided", () => {
    /** @type {string[]} */
    const lines = [];
    const code = runCli([], (l) => lines.push(l));
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/^usage:/);
  });
});
