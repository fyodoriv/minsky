// @ts-check
// Deterministic unit tests for `summarizeRun` — the pure core of the per-run
// observability summary (task `obs-run-session-ledger`). Fixtures in, known
// summary out (Avizienis 2004 — uptime/continuity as a measured dependability
// attribute). No I/O: the CLI wrapper does the file reads, this tests the math.
import { describe, expect, it } from "vitest";
import { buildRunLog, summarizeRun } from "./run-summary.mjs";

/**
 * Build an orchestrate.jsonl line.
 * @param {string} ts
 * @param {{ healed?: boolean, merged?: number[], runId?: string }} [opts]
 */
const tick = (
  ts,
  { healed = false, merged = /** @type {number[]} */ ([]), runId = "R1" } = {},
) => ({
  ts,
  workerAlive: !healed,
  healed,
  merged,
  skipped: 0,
  runId,
});

describe("summarizeRun", () => {
  it("derives uptime, restarts, and throughput from the ledger for one run", () => {
    const ledger = [
      tick("2026-06-03T00:00:00Z", { merged: [101] }),
      tick("2026-06-03T01:00:00Z", { merged: [102] }),
      tick("2026-06-03T02:00:00Z", { healed: true }), // worker restart at +2h
      tick("2026-06-03T04:00:00Z", { merged: [103] }),
    ];
    const s = summarizeRun({ ledger, runId: "R1" });
    expect(s.runId).toBe("R1");
    expect(s.startedAt).toBe("2026-06-03T00:00:00Z");
    expect(s.endedAt).toBe("2026-06-03T04:00:00Z");
    expect(s.totalUptimeSec).toBe(4 * 3600);
    // restart at +2h splits the run: spans [0h,2h]=7200s and [2h,4h]=7200s.
    expect(s.longestUninterruptedSec).toBe(2 * 3600);
    expect(s.restartCount).toBe(1);
    expect(s.tasksMerged).toBe(3); // 101,102,103 distinct
  });

  it("scopes to the most-recent run when runId is not given", () => {
    const ledger = [
      tick("2026-06-03T00:00:00Z", { merged: [1], runId: "OLD" }),
      tick("2026-06-03T05:00:00Z", { merged: [2], runId: "NEW" }),
      tick("2026-06-03T06:00:00Z", { merged: [3], runId: "NEW" }),
    ];
    const s = summarizeRun({ ledger });
    expect(s.runId).toBe("NEW");
    expect(s.tasksMerged).toBe(2); // only NEW's PRs
    expect(s.longestUninterruptedSec).toBe(3600); // 05:00→06:00, no heals
  });

  it("counts distinct merged PRs (a PR merged in two ticks counts once)", () => {
    const ledger = [
      tick("2026-06-03T00:00:00Z", { merged: [7] }),
      tick("2026-06-03T00:20:00Z", { merged: [7, 8] }),
    ];
    expect(summarizeRun({ ledger, runId: "R1" }).tasksMerged).toBe(2);
  });

  it("graceful-degrades to null fields on an empty ledger (never throws)", () => {
    const s = summarizeRun({ ledger: [] });
    expect(s.runId).toBeNull();
    expect(s.startedAt).toBeNull();
    expect(s.totalUptimeSec).toBeNull();
    expect(s.longestUninterruptedSec).toBeNull();
    expect(s.restartCount).toBe(0);
    expect(s.tasksMerged).toBe(0);
  });

  it("buildRunLog orders structured events by timestamp", () => {
    const log = buildRunLog([
      { ts: "2026-06-03T02:00:00Z", kind: "heal", detail: "restart" },
      { ts: "2026-06-03T00:00:00Z", kind: "tick", detail: "merged=[1]" },
    ]);
    const lines = log.trimEnd().split("\n");
    expect(lines[0]).toContain("2026-06-03T00:00:00Z");
    expect(lines[0]).toContain("[tick]");
    expect(lines[1]).toContain("[heal]");
  });

  it("buildRunLog returns empty string for no events (never throws)", () => {
    expect(buildRunLog([])).toBe("");
  });

  it("with no heals, longest-uninterrupted equals total uptime", () => {
    const ledger = [tick("2026-06-03T00:00:00Z"), tick("2026-06-03T03:00:00Z", { merged: [9] })];
    const s = summarizeRun({ ledger, runId: "R1" });
    expect(s.longestUninterruptedSec).toBe(s.totalUptimeSec);
    expect(s.restartCount).toBe(0);
  });
});
