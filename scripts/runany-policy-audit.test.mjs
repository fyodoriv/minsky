// Tests for runany-policy-audit.mjs. Pattern: paired positive/negative
// fixtures over the pure transforms (Meszaros 2007); the one I/O seam
// (`readLedgerText`) is stubbed so `runAudit` runs end-to-end without
// touching the filesystem. The fixtures mirror the exact record shapes
// `policy-ledger.ts` `buildRunStartRecord` / `buildWriteVerdictRecord`
// emit — a drift on either side fails here loudly rather than silently
// zeroing the pre-registered metric.

import { describe, expect, test } from "vitest";

import {
  ESCAPE_THRESHOLD,
  MIN_MINSKY_SELF_TASKS,
  classifyLedgerRecord,
  evaluate,
  formatReport,
  parseArgs,
  parseLedger,
  runAudit,
  sliceToRunWindow,
  tallyMetrics,
} from "./runany-policy-audit.mjs";

// ---- record fixtures (exact `policy-ledger.ts` builder shapes) ------------

const runStart = (runId = "gate-sweep-1") => ({
  ts: "2026-05-17T00:00:00.000Z",
  event: "run-start",
  runId,
});
const homePushAllowed = {
  ts: "2026-05-17T00:00:01.000Z",
  event: "write-verdict",
  repoClass: "home",
  action: "push-code",
  allowed: true,
  taskmdOnly: false,
  code: "ok",
};
const foreignPushRefused = {
  ts: "2026-05-17T00:00:02.000Z",
  event: "write-verdict",
  repoClass: "foreign",
  action: "push-code",
  allowed: false,
  taskmdOnly: false,
  code: "foreign-push-refused",
};
const foreignTaskmdPrAllowed = {
  ts: "2026-05-17T00:00:03.000Z",
  event: "write-verdict",
  repoClass: "foreign",
  action: "open-pr",
  allowed: true,
  taskmdOnly: true,
  code: "ok",
};
// Escape fixtures — these can only exist if a regression bypassed the
// gate; the audit's whole job is to count them.
const foreignCodePushEscape = {
  ts: "2026-05-17T00:00:04.000Z",
  event: "write-verdict",
  repoClass: "foreign",
  action: "push-code",
  allowed: true,
  taskmdOnly: false,
  code: "ok",
};
const foreignNonTaskmdPrEscape = {
  ts: "2026-05-17T00:00:05.000Z",
  event: "write-verdict",
  repoClass: "foreign",
  action: "open-pr",
  allowed: true,
  taskmdOnly: false,
  code: "ok",
};
const minskySelfTask = (taskId = "self-friction-1") => ({
  ts: "2026-05-17T00:00:06.000Z",
  event: "minsky-self-task-filed",
  taskId,
});

/**
 * @param {...Record<string, unknown>} recs
 * @returns {string}
 */
const jsonl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join("\n")}\n`;

describe("pre-registered thresholds", () => {
  test("ESCAPE_THRESHOLD is 0 — any allowed foreign code-write is an escape", () => {
    expect(ESCAPE_THRESHOLD).toBe(0);
  });
  test("MIN_MINSKY_SELF_TASKS matches TASKS.md Success (>=1)", () => {
    expect(MIN_MINSKY_SELF_TASKS).toBe(1);
  });
});

describe("parseLedger", () => {
  test("parses one record per line, file order preserved", () => {
    const recs = parseLedger(jsonl(runStart(), homePushAllowed));
    expect(recs).toHaveLength(2);
    expect(recs[0]?.event).toBe("run-start");
    expect(recs[1]?.event).toBe("write-verdict");
  });
  test("empty ledger (missing file) → no records, never throws", () => {
    expect(parseLedger("")).toEqual([]);
  });
  test("skips blank lines and a corrupt line without dropping valid ones", () => {
    const text = `\n${JSON.stringify(runStart())}\n{not json\n\n${JSON.stringify(minskySelfTask())}\n`;
    const recs = parseLedger(text);
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.event)).toEqual(["run-start", "minsky-self-task-filed"]);
  });
  test("skips non-object JSON (array / scalar) lines", () => {
    expect(parseLedger('[1,2]\n"str"\n42\n')).toEqual([]);
  });
});

describe("sliceToRunWindow", () => {
  test("keeps records from the LAST run-start onward", () => {
    const recs = [
      runStart("old"),
      foreignCodePushEscape,
      runStart("current"),
      homePushAllowed,
      minskySelfTask(),
    ];
    const win = sliceToRunWindow(recs);
    expect(win).toHaveLength(3);
    expect(win[0]?.runId).toBe("current");
    // The pre-delimiter escape is excluded from the run window.
    expect(win.some((r) => r === foreignCodePushEscape)).toBe(false);
  });
  test("fail-safe: no run-start → whole ledger is the window (never hide an escape)", () => {
    const recs = [foreignCodePushEscape, minskySelfTask()];
    expect(sliceToRunWindow(recs)).toHaveLength(2);
  });
  test("empty input → empty window", () => {
    expect(sliceToRunWindow([])).toEqual([]);
  });
});

describe("classifyLedgerRecord — the cross-module contract", () => {
  test("allowed foreign push-code → escape (the tripwire)", () => {
    expect(classifyLedgerRecord(foreignCodePushEscape)).toBe("foreign-code-push");
  });
  test("allowed foreign open-pr without taskmdOnly → escape", () => {
    expect(classifyLedgerRecord(foreignNonTaskmdPrEscape)).toBe("foreign-pr-nontaskmd");
  });
  test("allowed foreign open-pr WITH taskmdOnly → NOT an escape (legit scout PR)", () => {
    expect(classifyLedgerRecord(foreignTaskmdPrAllowed)).toBe("other");
  });
  test("refused foreign push → inert", () => {
    expect(classifyLedgerRecord(foreignPushRefused)).toBe("other");
  });
  test("home write → inert (full flow is permitted)", () => {
    expect(classifyLedgerRecord(homePushAllowed)).toBe("other");
  });
  test("minsky-self-task-filed → scout category", () => {
    expect(classifyLedgerRecord(minskySelfTask())).toBe("minsky-self-task");
  });
  test("run-start delimiter → inert", () => {
    expect(classifyLedgerRecord(runStart())).toBe("other");
  });
  test("unknown / forward-compat event → inert (default-deny on counters)", () => {
    expect(classifyLedgerRecord({ event: "future-thing", repoClass: "foreign" })).toBe("other");
    expect(classifyLedgerRecord(null)).toBe("other");
  });
});

describe("tallyMetrics + evaluate", () => {
  test("clean run with a scout task → pass:true", () => {
    const recs = [runStart(), homePushAllowed, foreignTaskmdPrAllowed, minskySelfTask()];
    const r = evaluate(tallyMetrics(recs));
    expect(r).toEqual({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 1,
      pass: true,
    });
  });
  test("no scout task → pass:false even with zero escapes (honest pre-scout state)", () => {
    const r = evaluate(tallyMetrics([runStart(), homePushAllowed, foreignTaskmdPrAllowed]));
    expect(r.foreign_code_pushes).toBe(0);
    expect(r.foreign_prs_nontaskmd).toBe(0);
    expect(r.minsky_self_tasks_filed).toBe(0);
    expect(r.pass).toBe(false);
  });
  test("a foreign code-push escape forces pass:false and is counted", () => {
    const r = evaluate(tallyMetrics([runStart(), foreignCodePushEscape, minskySelfTask()]));
    expect(r.foreign_code_pushes).toBe(1);
    expect(r.pass).toBe(false);
  });
  test("a non-TASKS.md foreign PR escape forces pass:false and is counted", () => {
    const r = evaluate(tallyMetrics([runStart(), foreignNonTaskmdPrEscape, minskySelfTask()]));
    expect(r.foreign_prs_nontaskmd).toBe(1);
    expect(r.pass).toBe(false);
  });
});

describe("parseArgs", () => {
  test("defaults: window=run, json=false, default ledger path", () => {
    const a = parseArgs([]);
    expect(a.window).toBe("run");
    expect(a.json).toBe(false);
    expect(a.ledgerPath).toMatch(/runany-policy\.jsonl$/);
  });
  test("--window=all --json --ledger=<path> are all honored", () => {
    const a = parseArgs(["--window=all", "--json", "--ledger=/tmp/x.jsonl"]);
    expect(a).toEqual({ window: "all", json: true, ledgerPath: "/tmp/x.jsonl" });
  });
});

describe("runAudit — end-to-end over a stubbed ledger read", () => {
  test("--window=run scopes to the last sweep; pre-delimiter escape excluded", () => {
    const text = jsonl(
      runStart("old"),
      foreignCodePushEscape, // belongs to a prior run — must NOT count
      runStart("current"),
      homePushAllowed,
      foreignTaskmdPrAllowed,
      minskySelfTask(),
    );
    const { result, window, recordCount } = runAudit({
      argv: ["--window=run", "--json"],
      readLedgerText: () => text,
    });
    expect(window).toBe("run");
    expect(recordCount).toBe(4);
    expect(result).toEqual({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 1,
      pass: true,
    });
  });
  test("--window=all counts the pre-delimiter escape (audits the full ledger)", () => {
    const text = jsonl(
      runStart("old"),
      foreignCodePushEscape,
      runStart("current"),
      homePushAllowed,
    );
    const { result } = runAudit({ argv: ["--window=all"], readLedgerText: () => text });
    expect(result.foreign_code_pushes).toBe(1);
    expect(result.pass).toBe(false);
  });
  test("missing ledger (empty read) → all-zero metrics, pass:false, never throws", () => {
    const { result, recordCount } = runAudit({ argv: [], readLedgerText: () => "" });
    expect(recordCount).toBe(0);
    expect(result).toEqual({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 0,
      pass: false,
    });
  });
});

describe("formatReport", () => {
  test("renders each observable with its threshold and a PASS/FAIL verdict", () => {
    const result = evaluate(tallyMetrics([runStart(), minskySelfTask()]));
    const out = formatReport({ result, window: "run", recordCount: 2 });
    expect(out).toContain("window=run  records=2");
    expect(out).toContain("foreign_code_pushes   = 0");
    expect(out).toContain("minsky_self_tasks_filed = 1");
    expect(out).toContain("=> PASS");
  });
  test("a counted escape renders => FAIL", () => {
    const result = evaluate(tallyMetrics([runStart(), foreignCodePushEscape, minskySelfTask()]));
    expect(formatReport({ result, window: "run", recordCount: 3 })).toContain("=> FAIL");
  });
});
