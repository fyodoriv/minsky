// Tests for the MTTR ledger writer.
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import { buildHealEvent, recordHealEvent } from "./ledger.js";
import type { LedgerSeams } from "./ledger.js";
import type { HealEvent } from "./types.js";

function makeSeams(initialDirs: Set<string>): {
  seams: LedgerSeams;
  appended: { path: string; data: string }[];
  dirs: Set<string>;
} {
  const dirs = new Set(initialDirs);
  const appended: { path: string; data: string }[] = [];
  const seams: LedgerSeams = {
    ledgerPath: "/tmp/host/.minsky/heal-events.jsonl",
    appendFileSyncFn: (path, data) => {
      appended.push({ path, data });
    },
    mkdirSyncFn: (path) => {
      dirs.add(path);
    },
    existsSyncFn: (path) => dirs.has(path),
    dirnameFn: (path) => {
      const lastSlash = path.lastIndexOf("/");
      return lastSlash === -1 ? "." : path.slice(0, lastSlash);
    },
  };
  return { seams, appended, dirs };
}

const sampleEvent: HealEvent = {
  ts_observed: "2026-05-20T20:00:00.000Z",
  ts_fixed: "2026-05-20T20:00:01.000Z",
  failure_class: "stale-pid",
  fix_applied: "heal-stale-pid",
  duration_ms: 1000,
  host: "host-1",
  outcome: "healed",
};

describe("ledger.recordHealEvent", () => {
  // scenario: "heal-ledger appends an event entry with all required fields"
  test("appends a JSONL line with all 7 fields", () => {
    const { seams, appended } = makeSeams(new Set(["/tmp/host/.minsky"]));
    recordHealEvent({ event: sampleEvent, seams });
    expect(appended).toHaveLength(1);
    const first = appended[0];
    if (!first) throw new Error("expected one appended entry");
    expect(first.path).toBe("/tmp/host/.minsky/heal-events.jsonl");
    expect(first.data.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(first.data.trim()) as HealEvent;
    expect(parsed).toEqual(sampleEvent);
  });

  // scenario: "heal-ledger creates the parent directory if missing"
  test("creates the parent directory when it does not exist", () => {
    const { seams, dirs } = makeSeams(new Set()); // no dirs exist
    recordHealEvent({ event: sampleEvent, seams });
    expect(dirs.has("/tmp/host/.minsky")).toBe(true);
  });

  test("does not call mkdir when the directory already exists", () => {
    const { seams, dirs } = makeSeams(new Set(["/tmp/host/.minsky"]));
    const initialSize = dirs.size;
    recordHealEvent({ event: sampleEvent, seams });
    expect(dirs.size).toBe(initialSize); // no new dir added
  });

  // scenario: "heal-ledger is monotonic — entries appear in call order"
  test("appends multiple events in call order", () => {
    const { seams, appended } = makeSeams(new Set(["/tmp/host/.minsky"]));
    const e1 = { ...sampleEvent, ts_observed: "2026-05-20T20:00:00.000Z" };
    const e2 = { ...sampleEvent, ts_observed: "2026-05-20T20:00:10.000Z" };
    const e3 = { ...sampleEvent, ts_observed: "2026-05-20T20:00:20.000Z" };
    recordHealEvent({ event: e1, seams });
    recordHealEvent({ event: e2, seams });
    recordHealEvent({ event: e3, seams });
    expect(appended).toHaveLength(3);
    const [row0, row1, row2] = appended;
    if (!row0 || !row1 || !row2) throw new Error("expected three appended entries");
    expect(JSON.parse(row0.data.trim()).ts_observed).toBe(e1.ts_observed);
    expect(JSON.parse(row1.data.trim()).ts_observed).toBe(e2.ts_observed);
    expect(JSON.parse(row2.data.trim()).ts_observed).toBe(e3.ts_observed);
  });
});

describe("ledger.buildHealEvent", () => {
  test("computes duration_ms as ts_fixed - ts_observed", () => {
    const event = buildHealEvent({
      tsObservedMs: 1_000_000,
      tsFixedMs: 1_001_500,
      failureClass: "stale-pid",
      fixApplied: "heal-stale-pid",
      host: "host-1",
      outcome: "healed",
    });
    expect(event.duration_ms).toBe(1500);
    expect(event.ts_observed).toBe(new Date(1_000_000).toISOString());
    expect(event.ts_fixed).toBe(new Date(1_001_500).toISOString());
  });

  test("clamps negative duration to 0 (clock skew protection)", () => {
    const event = buildHealEvent({
      tsObservedMs: 1_001_000,
      tsFixedMs: 1_000_000, // fixed before observed (impossible but defended)
      failureClass: "stale-pid",
      fixApplied: "heal-stale-pid",
      host: "host-1",
      outcome: "healed",
    });
    expect(event.duration_ms).toBe(0);
  });
});
