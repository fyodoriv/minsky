// Tests for daemon-pr-lint-metrics.mjs. Pattern: paired positive/negative
// fixtures over pure transforms (Meszaros 2007); the I/O seam (`runGh`) is
// stubbed so the orchestrator runs end-to-end without touching `gh`.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  CANONICAL_REPO,
  GH_PR_LIST_LIMIT,
  ROLLING_30D_MIN_N,
  ROLLING_30D_MIN_PASS_RATE,
  ROLLING_WINDOW_DAYS,
  buildRecentPrListGhArgs,
  computeStats,
  daysAgoUtc,
  formatDateUtcYmd,
  formatReport,
  parsePrList,
  parsePrListEntries,
  runDaemonPrLintMetrics,
} from "./daemon-pr-lint-metrics.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("pre-registered constants", () => {
  test("ROLLING_30D_MIN_PASS_RATE matches the TASKS.md threshold (0.80)", () => {
    expect(ROLLING_30D_MIN_PASS_RATE).toBeCloseTo(0.8, 5);
  });

  test("ROLLING_30D_MIN_N matches the self-diagnose windowMinPrs default (10)", () => {
    // Drift on this constant silently lets the verdict flip OK below
    // statistical significance. Pinned at this single source —
    // scripts/self-diagnose.mjs daemonPrLintPassRateInvariant imports
    // ROLLING_30D_MIN_N from this file rather than re-declaring it.
    expect(ROLLING_30D_MIN_N).toBe(10);
  });

  test("ROLLING_WINDOW_DAYS matches the brief's 30d window", () => {
    expect(ROLLING_WINDOW_DAYS).toBe(30);
  });

  test("CANONICAL_REPO matches the daemon's PR target — owner/name shape", () => {
    // Slice 14: pinned so `gh`'s origin-inference can't silently zero the
    // metric. The exact value is the only repo this daemon ever ships PRs
    // against; if that ever changes, both the metric script and the
    // self-diagnose invariant flip together (single-source).
    expect(CANONICAL_REPO).toBe("fyodoriv/minsky");
    expect(CANONICAL_REPO).toMatch(/^[\w.-]+\/[\w.-]+$/);
  });
});

describe("formatDateUtcYmd", () => {
  test("formats a known UTC instant as YYYY-MM-DD", () => {
    expect(formatDateUtcYmd(new Date("2026-05-06T18:30:00Z"))).toBe("2026-05-06");
  });

  test("rolls over the date boundary at UTC midnight, not local midnight", () => {
    expect(formatDateUtcYmd(new Date("2026-05-06T23:59:59Z"))).toBe("2026-05-06");
    expect(formatDateUtcYmd(new Date("2026-05-07T00:00:01Z"))).toBe("2026-05-07");
  });
});

describe("daysAgoUtc", () => {
  test("subtracts whole-day windows correctly across month boundaries", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(formatDateUtcYmd(daysAgoUtc(now, 30))).toBe("2026-04-06");
  });

  test("days=0 returns the same instant", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(daysAgoUtc(now, 0).getTime()).toBe(now.getTime());
  });

  test("rejects negative or non-integer days", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    expect(() => daysAgoUtc(now, -1)).toThrow(/non-negative integer/);
    expect(() => daysAgoUtc(now, 1.5)).toThrow(/non-negative integer/);
  });
});

describe("parsePrList", () => {
  test("empty array → []", () => {
    expect(parsePrList("[]")).toEqual([]);
  });

  test("PR with no statusCheckRollup → hasFailure false", () => {
    const out = parsePrList(JSON.stringify([{ number: 7 }]));
    expect(out).toEqual([{ number: 7, hasFailure: false }]);
  });

  test("PR with all SUCCESS checks → hasFailure false", () => {
    const out = parsePrList(
      JSON.stringify([
        {
          number: 7,
          statusCheckRollup: [
            { conclusion: "SUCCESS", state: "SUCCESS" },
            { conclusion: "SUCCESS", state: "SUCCESS" },
          ],
        },
      ]),
    );
    expect(out[0]?.hasFailure).toBe(false);
  });

  test("PR with one FAILURE check → hasFailure true (conclusion field)", () => {
    const out = parsePrList(
      JSON.stringify([
        {
          number: 7,
          statusCheckRollup: [
            { conclusion: "SUCCESS" },
            { conclusion: "FAILURE", name: "rule-7-chaos-coverage" },
          ],
        },
      ]),
    );
    expect(out[0]?.hasFailure).toBe(true);
  });

  test("PR with state=FAILURE (older gh schema) is also caught", () => {
    // Mirrors scripts/self-diagnose.mjs's check — both fields are
    // recognised so the metric stays correct across gh CLI upgrades.
    const out = parsePrList(
      JSON.stringify([{ number: 7, statusCheckRollup: [{ state: "FAILURE" }] }]),
    );
    expect(out[0]?.hasFailure).toBe(true);
  });

  test("malformed JSON throws", () => {
    expect(() => parsePrList("{not json")).toThrow();
  });

  test("non-array JSON throws with explanatory message", () => {
    expect(() => parsePrList(JSON.stringify({ number: 1 }))).toThrow(/array/);
  });
});

describe("parsePrListEntries (already-decoded array path)", () => {
  // Slice 12: self-diagnose.mjs reaches `gh` via `ghJson` which JSON-parses
  // before handing back, so the invariant cannot share `parsePrList`'s
  // string entrypoint. `parsePrListEntries` is the post-JSON.parse seam
  // both surfaces share — drift on the per-PR FAILURE rule is now a
  // single-line edit, not two.
  test("idempotent against the same data parsePrList sees", () => {
    const fixture = [
      { number: 1, statusCheckRollup: [{ conclusion: "SUCCESS" }] },
      { number: 2, statusCheckRollup: [{ state: "FAILURE" }] },
    ];
    expect(parsePrListEntries(fixture)).toEqual(parsePrList(JSON.stringify(fixture)));
  });

  test("rejects non-array (matches parsePrList semantics)", () => {
    expect(() => parsePrListEntries({ number: 1 })).toThrow(/array/);
    expect(() => parsePrListEntries(null)).toThrow(/array/);
  });
});

describe("buildRecentPrListGhArgs (canonical query — slice 12)", () => {
  // The args used to live inline in two places: `runDaemonPrLintMetrics`
  // here, and `recentDaemonPrs` in scripts/self-diagnose.mjs. Both used
  // `--author @me`, `--state all`, `created:>=YYYY-MM-DD`, but if either
  // drifted (e.g., one added `--state open`) the metric and the invariant
  // would silently report on different PR sets. This helper is the seam.
  test("threads the date into the search predicate", () => {
    const args = buildRecentPrListGhArgs("2026-04-06");
    expect(args).toContain("--search");
    expect(args).toContain("created:>=2026-04-06");
  });

  test("pins the canonical selector + json shape (drift guard)", () => {
    const args = buildRecentPrListGhArgs("2026-04-06");
    expect(args[0]).toBe("pr");
    expect(args[1]).toBe("list");
    expect(args).toContain("--author");
    expect(args).toContain("@me");
    expect(args).toContain("--state");
    expect(args).toContain("all");
    expect(args).toContain("--json");
    expect(args).toContain("number,statusCheckRollup");
    expect(args).toContain("--limit");
    expect(args).toContain(String(GH_PR_LIST_LIMIT));
  });

  test("GH_PR_LIST_LIMIT is high enough to satisfy the n≥10 threshold", () => {
    // The threshold is the data-not-code source of "verdict can fire";
    // shrinking the limit below it would silently leave the verdict
    // INSUFFICIENT-DATA forever even when the gate is failing.
    expect(GH_PR_LIST_LIMIT).toBeGreaterThanOrEqual(ROLLING_30D_MIN_N);
  });

  test("threads -R CANONICAL_REPO so the query is immune to origin pollution (slice 14)", () => {
    // Without `-R`, gh infers the repo from the working dir's `origin`
    // remote. The cross-repo-runner integration tests have been observed
    // mutating that URL to a fake test-org/test-iep-capabilities path,
    // which silently zeroes the PR set. Pin -R + CANONICAL_REPO so the
    // query never depends on local remote state.
    const args = buildRecentPrListGhArgs("2026-04-06");
    const rIdx = args.indexOf("-R");
    expect(rIdx).toBeGreaterThanOrEqual(0);
    expect(args[rIdx + 1]).toBe(CANONICAL_REPO);
  });

  test("output is shaped like a flat string[] — no nesting, no undefined entries", () => {
    const args = buildRecentPrListGhArgs("2026-04-06");
    expect(Array.isArray(args)).toBe(true);
    for (const a of args) expect(typeof a).toBe("string");
  });
});

describe("computeStats", () => {
  test("zero PRs → passRate null", () => {
    expect(computeStats([])).toEqual({ total: 0, clean: 0, dirtyNumbers: [], passRate: null });
  });

  test("all clean → passRate 1.0", () => {
    const stats = computeStats([
      { number: 1, hasFailure: false },
      { number: 2, hasFailure: false },
    ]);
    expect(stats).toEqual({ total: 2, clean: 2, dirtyNumbers: [], passRate: 1 });
  });

  test("all dirty → passRate 0", () => {
    const stats = computeStats([
      { number: 1, hasFailure: true },
      { number: 2, hasFailure: true },
    ]);
    expect(stats.passRate).toBe(0);
    expect(stats.dirtyNumbers).toEqual([1, 2]);
  });

  test("mixed → fraction matches", () => {
    const stats = computeStats([
      { number: 1, hasFailure: false },
      { number: 2, hasFailure: true },
      { number: 3, hasFailure: false },
      { number: 4, hasFailure: false },
    ]);
    expect(stats.total).toBe(4);
    expect(stats.clean).toBe(3);
    expect(stats.dirtyNumbers).toEqual([2]);
    expect(stats.passRate).toBeCloseTo(0.75, 5);
  });
});

describe("formatReport", () => {
  const baseDates = { dateNow: "2026-05-06", date30dAgo: "2026-04-06" };

  test("zero-data → INSUFFICIENT-DATA verdict, no NaN, no /0 in the value cell", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 0, clean: 0, dirtyNumbers: [], passRate: null },
    });
    expect(report).toMatch(/Verdict: +INSUFFICIENT-DATA/);
    expect(report).not.toMatch(/NaN/);
    expect(report).toMatch(/no PRs in window/);
    expect(report).toMatch(/Failed: +none/);
  });

  test("below-min-N (n=9, all clean) → INSUFFICIENT-DATA, not OK — pinned threshold ≥10", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 9, clean: 9, dirtyNumbers: [], passRate: 1 },
    });
    expect(report).toMatch(/Verdict: +INSUFFICIENT-DATA/);
  });

  test("at-min-N (n=10, all clean) → OK", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 10, dirtyNumbers: [], passRate: 1 },
    });
    expect(report).toMatch(/Verdict: +OK/);
  });

  test("at the 0.80 boundary (passRate exactly 0.8) → OK (boundary is ≥)", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 8, dirtyNumbers: [101, 102], passRate: 0.8 },
    });
    expect(report).toMatch(/Verdict: +OK/);
    expect(report).toMatch(/#101, #102/);
  });

  test("just below the 0.80 boundary (passRate 0.7) → BELOW", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 7, dirtyNumbers: [201, 202, 203], passRate: 0.7 },
    });
    expect(report).toMatch(/Verdict: +BELOW/);
    // And the value cell shows the actual ratio so the operator sees the gap.
    expect(report).toMatch(/7\/10 \(0\.700\)/);
  });

  test("includes the canonical selector + window so the report is self-describing", () => {
    const report = formatReport({
      ...baseDates,
      stats: { total: 10, clean: 10, dirtyNumbers: [], passRate: 1 },
    });
    expect(report).toContain("--author @me");
    expect(report).toContain(`-R ${CANONICAL_REPO}`);
    expect(report).toContain(">= 2026-04-06");
    expect(report).toContain("docs/daemon-pre-pr-gate.md");
  });
});

describe("runDaemonPrLintMetrics", () => {
  test("fires one gh call with the canonical selector + 30d window", async () => {
    /** @type {string[][]} */
    const ghCalls = [];
    const runGh = async (/** @type {ReadonlyArray<string>} */ args) => {
      ghCalls.push([...args]);
      return "[]";
    };
    await runDaemonPrLintMetrics({
      clock: () => new Date("2026-05-06T12:00:00Z"),
      runGh,
    });
    expect(ghCalls).toHaveLength(1);
    const [call] = ghCalls;
    expect(call).toContain("-R");
    expect(call).toContain(CANONICAL_REPO);
    expect(call).toContain("--author");
    expect(call).toContain("@me");
    expect(call).toContain("--state");
    expect(call).toContain("all");
    expect(call).toContain("--search");
    expect(call).toContain("created:>=2026-04-06");
    expect(call).toContain("--json");
    expect(call).toContain("number,statusCheckRollup");
    expect(call).toContain("--limit");
    expect(call).toContain(String(GH_PR_LIST_LIMIT));
  });

  test("threads parsed stats back into the result + report", async () => {
    const runGh = async () =>
      JSON.stringify([
        // 1 dirty (FAILURE)
        { number: 100, statusCheckRollup: [{ conclusion: "FAILURE" }] },
        // 9 clean
        ...Array.from({ length: 9 }, (_, i) => ({
          number: 101 + i,
          statusCheckRollup: [{ conclusion: "SUCCESS" }],
        })),
      ]);
    const result = await runDaemonPrLintMetrics({
      clock: () => new Date("2026-05-06T12:00:00Z"),
      runGh,
    });
    expect(result.stats.total).toBe(10);
    expect(result.stats.clean).toBe(9);
    expect(result.stats.dirtyNumbers).toEqual([100]);
    expect(result.stats.passRate).toBeCloseTo(0.9, 5);
    expect(result.report).toMatch(/Verdict: +OK/);
    expect(result.report).toMatch(/9\/10 \(0\.900\)/);
  });

  test("propagates a runGh rejection (no graceful-degrade — operator must see the gh outage)", async () => {
    const runGh = async () => {
      throw new Error("gh: not authenticated");
    };
    await expect(
      runDaemonPrLintMetrics({
        clock: () => new Date("2026-05-06T12:00:00Z"),
        runGh,
      }),
    ).rejects.toThrow(/not authenticated/);
  });
});

/**
 * Slice the `daemon-pre-pr-lint-gate` task block out of TASKS.md so parity
 * checks don't accidentally pass on an unrelated `0.8` / `80%` / `≥10`
 * mention elsewhere in the file (other tasks have their own percentage and
 * count figures). The block starts at the
 * `- [ ] \`daemon-pre-pr-lint-gate\`` line and runs until the next top-level
 * `- [ ]` / `- [x]` task entry. Lifted to module scope (slice 27/N) so the
 * `ROLLING_30D_MIN_PASS_RATE` and `ROLLING_30D_MIN_N` parity describes share
 * a single extractor — same shape as slice 26/N's helper, no semantic drift.
 *
 * @param {string} tasksMd
 * @returns {string}
 */
function extractDaemonPrePrLintGateBlock(tasksMd) {
  const startRe = /^- \[ \] `daemon-pre-pr-lint-gate`/m;
  const startMatch = startRe.exec(tasksMd);
  if (startMatch === null) {
    throw new Error("TASKS.md has no `daemon-pre-pr-lint-gate` task block");
  }
  const tail = tasksMd.slice(startMatch.index);
  const nextTaskRe = /\n- \[[ x]\] `[a-z][a-z0-9-]*`/;
  const nextMatch = nextTaskRe.exec(tail.slice(1));
  return nextMatch === null ? tail : tail.slice(0, 1 + nextMatch.index);
}

describe("ROLLING_30D_MIN_PASS_RATE prose ↔ canonical constant parity", () => {
  // Slice 26/N: the rolling-window pass-rate threshold (0.8) lives canonically
  // as `ROLLING_30D_MIN_PASS_RATE` in this module; `scripts/self-diagnose.mjs`
  // and `formatReport` import it directly, so the in-code dependency stays
  // tight (the `pre-registered constants` block above pins the constant's
  // value). Three operator-facing surfaces still cite the threshold inline as
  // prose:
  //
  //   - `docs/daemon-pre-pr-gate.md` (the gate's explanation page —
  //     "≥80%" / "Below 0.8").
  //   - `TASKS.md` `daemon-pre-pr-lint-gate` block (the task's pre-registered
  //     metric — Hypothesis "≥80%", Details "below 80%", Measurement "≥0.80").
  //   - `novel/tick-loop/src/daemon.ts` § buildDaemonBrief (the daemon's
  //     iteration prompt — "≥80% of daemon-authored PRs ...").
  //
  // A future PR tightening the threshold to 0.85 would update the constant +
  // its in-code imports without tripping any test, while the prose silently
  // continued to claim "≥80%" / "below 0.8". Operators reading any surface
  // would see a stale number; the daemon's prompt would announce a different
  // threshold than the one its self-diagnose actually applies.
  //
  // Slice 26/N closes the surface: derive the percent and decimal forms from
  // the canonical constant, then assert each surface contains both shapes
  // verbatim. Same pattern as slices 24/N (noop-exit token brief↔invariant↔docs)
  // and 25/N (invariant-id ↔ docs/TASKS.md jq-selector) — single source of
  // truth in code, prose surfaces pinned to it.

  /**
   * Render the canonical fraction in the two textual shapes that appear in
   * prose: "0.8" decimal and "80%" percent. Both are the natural `String(...)`
   * form a writer would type, so both must update in lockstep when the
   * constant moves.
   *
   * @param {number} fraction
   * @returns {{ percent: string, decimal: string }}
   */
  function thresholdProseShapes(fraction) {
    return {
      percent: `${Math.round(fraction * 100)}%`,
      decimal: String(fraction),
    };
  }

  test("docs/daemon-pre-pr-gate.md cites the threshold in both percent and decimal forms", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const { percent, decimal } = thresholdProseShapes(ROLLING_30D_MIN_PASS_RATE);
    expect(doc).toContain(percent);
    expect(doc).toContain(decimal);
  });

  test("TASKS.md `daemon-pre-pr-lint-gate` block cites the threshold in both percent and decimal forms", () => {
    const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");
    const block = extractDaemonPrePrLintGateBlock(tasksMd);
    const { percent, decimal } = thresholdProseShapes(ROLLING_30D_MIN_PASS_RATE);
    expect(block).toContain(percent);
    expect(block).toContain(decimal);
  });

  test("daemon brief (novel/tick-loop/src/daemon.ts) cites the threshold's percent form", () => {
    // The brief at line ~1010 ("Pre-registered (TASKS.md
    // `daemon-pre-pr-lint-gate`): post-fix, ≥80% of daemon-authored PRs ...")
    // is the load-bearing prompt the inner Claude reads every iteration; if
    // the constant moves and the brief's percent token is stale, the daemon
    // announces a threshold its self-diagnose no longer applies. Pinning the
    // percent form alone is sufficient — the brief is one paragraph, the
    // decimal form is not used there.
    const brief = readFileSync(resolve(REPO_ROOT, "novel/tick-loop/src/daemon.ts"), "utf8");
    const { percent } = thresholdProseShapes(ROLLING_30D_MIN_PASS_RATE);
    expect(brief).toContain(percent);
  });

  test("extractDaemonPrePrLintGateBlock parses to a non-trivial block bounded by the next task (parser sanity)", () => {
    const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");
    const block = extractDaemonPrePrLintGateBlock(tasksMd);
    expect(block).toContain("daemon-pre-pr-lint-gate");
    expect(block.length).toBeGreaterThan(500);
    // The next task in TASKS.md is `daemon-fix-own-pr-on-ci-failure`; the
    // extractor must stop before that block begins, otherwise the parity
    // assertions can pass on prose belonging to a sibling task.
    expect(block).not.toContain("daemon-fix-own-pr-on-ci-failure");
  });
});

describe("ROLLING_30D_MIN_N prose ↔ canonical constant parity", () => {
  // Slice 27/N: extends slice 26/N's drift-gate family to the second
  // load-bearing number in this module — the minimum-sample-size threshold
  // (n=10) below which the verdict is INSUFFICIENT-DATA, not OK/BELOW.
  // `scripts/self-diagnose.mjs` imports `ROLLING_30D_MIN_N` directly, so the
  // in-code dependency is tight; two operator-facing surfaces still cite the
  // value as inline prose:
  //
  //   - `docs/daemon-pre-pr-gate.md` (Operator commands § self-diagnose
  //     example — "fires only with ≥10 daemon PRs in the rolling window").
  //   - `TASKS.md` `daemon-pre-pr-lint-gate` block — Measurement line
  //     ("rolling 30d window holds ≥10 PRs" + "minimum sample size ≥10 in
  //     `ROLLING_30D_MIN_N`").
  //
  // A future PR tightening n from 10 to 20 would update the constant and its
  // self-diagnose import without tripping any existing test, while the prose
  // silently kept claiming "≥10". Operators reading either surface would see
  // a stale number; the doc's example invariant query and the task block's
  // pre-registered minimum would announce a smaller window than the verdict
  // actually requires. Same shape as slice 26/N — the daemon brief is not
  // covered because n=10 isn't cited there (only the percent threshold is).

  /**
   * Render the canonical sample-size threshold in the prose form both
   * surfaces use: "≥10". The "≥" + integer shape is the natural way a
   * writer cites a non-strict lower bound; pinning that exact byte sequence
   * forces a prose update in lockstep with the constant.
   *
   * @param {number} n
   * @returns {string}
   */
  function minNProseShape(n) {
    return `≥${n}`;
  }

  test("docs/daemon-pre-pr-gate.md cites the n threshold in ≥N form", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    expect(doc).toContain(minNProseShape(ROLLING_30D_MIN_N));
  });

  test("TASKS.md `daemon-pre-pr-lint-gate` block cites the n threshold in ≥N form", () => {
    const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");
    const block = extractDaemonPrePrLintGateBlock(tasksMd);
    expect(block).toContain(minNProseShape(ROLLING_30D_MIN_N));
  });
});
