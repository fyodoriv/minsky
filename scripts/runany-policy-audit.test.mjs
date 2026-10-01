// Tests for runany-policy-audit.mjs. Pattern: paired positive/negative
// fixtures over the pure transforms (Meszaros 2007); the fs seam
// (`readLedger`) is a string-returning stub so the orchestrator runs
// end-to-end without touching the filesystem.

import { describe, expect, test } from "vitest";

import {
  classifyLedgerRecord,
  evaluate,
  formatReport,
  POLICY_THRESHOLDS,
  parseLedger,
  runRunanyPolicyAudit,
  selectWindow,
  tallyPolicy,
} from "./runany-policy-audit.mjs";

/** A clean run: a refused foreign push + a refused non-TASKS.md foreign
 *  PR + an ALLOWED TASKS.md-only foreign PR + a minsky-self task filed.
 *  Zero escapes, scout fired ⇒ PASS. */
const CLEAN_RUN = [
  { ts: "2026-05-17T00:00:00Z", event: "run-start", runId: "r1" },
  {
    ts: "2026-05-17T00:01:00Z",
    event: "write-verdict",
    repoClass: "foreign",
    action: "push-code",
    allowed: false,
    code: "foreign-code-push",
  },
  {
    ts: "2026-05-17T00:02:00Z",
    event: "write-verdict",
    repoClass: "foreign",
    action: "open-pr",
    allowed: false,
    code: "foreign-nontaskmd-pr",
  },
  {
    ts: "2026-05-17T00:03:00Z",
    event: "write-verdict",
    repoClass: "foreign",
    action: "open-pr",
    allowed: true,
    taskmdOnly: true,
  },
  {
    ts: "2026-05-17T00:04:00Z",
    event: "write-verdict",
    repoClass: "home",
    action: "push-code",
    allowed: true,
  },
  { ts: "2026-05-17T00:05:00Z", event: "minsky-self-task-filed", taskId: "x" },
].map((r) => JSON.stringify(r));

describe("pre-registered constants", () => {
  test("thresholds match the TASKS.md Measurement line", () => {
    // Drift here silently flips the verdict; pinned at one source.
    expect(POLICY_THRESHOLDS.maxForeignCodePushes).toBe(0);
    expect(POLICY_THRESHOLDS.maxForeignPrsNonTaskmd).toBe(0);
    expect(POLICY_THRESHOLDS.minMinskySelfTasksFiled).toBe(1);
  });
});

describe("parseLedger — tolerant (rule #6)", () => {
  test("skips blank and malformed lines, keeps valid objects", () => {
    const text = ['{"event":"run-start"}', "", "  ", "not json", "[1,2]", '{"event":"x"}'].join(
      "\n",
    );
    const recs = parseLedger(text);
    expect(recs).toHaveLength(2);
    expect(recs[0]?.["event"]).toBe("run-start");
    expect(recs[1]?.["event"]).toBe("x");
  });

  test("empty text ⇒ empty array, never throws", () => {
    expect(parseLedger("")).toEqual([]);
  });
});

describe("selectWindow", () => {
  const recs = parseLedger(CLEAN_RUN.join("\n"));

  test("run window starts at the LAST run-start marker", () => {
    const withSecondRun = parseLedger(
      [
        ...CLEAN_RUN,
        JSON.stringify({ event: "run-start", runId: "r2" }),
        JSON.stringify({ event: "minsky-self-task-filed", taskId: "y" }),
      ].join("\n"),
    );
    const w = selectWindow(withSecondRun, "run");
    // Only the r2 slice: the marker + the one task after it.
    expect(w).toHaveLength(2);
    expect(w[0]?.["runId"]).toBe("r2");
  });

  test("run window with NO marker falls back to the whole ledger (fail-safe)", () => {
    const noMarker = parseLedger(JSON.stringify({ event: "minsky-self-task-filed", taskId: "z" }));
    expect(selectWindow(noMarker, "run")).toHaveLength(1);
  });

  test("all window returns every record regardless of markers", () => {
    expect(selectWindow(recs, "all")).toHaveLength(recs.length);
  });
});

describe("classifyLedgerRecord — escape mapping", () => {
  test("minsky-self-task-filed → minsky_self_tasks_filed", () => {
    expect(classifyLedgerRecord({ event: "minsky-self-task-filed", taskId: "t" })).toBe(
      "minsky_self_tasks_filed",
    );
  });

  test("refused foreign write → null (not an escape)", () => {
    expect(
      classifyLedgerRecord({
        event: "write-verdict",
        repoClass: "foreign",
        action: "push-code",
        allowed: false,
      }),
    ).toBeNull();
  });

  test("allowed foreign push-code → foreign_code_pushes", () => {
    expect(
      classifyLedgerRecord({
        event: "write-verdict",
        repoClass: "foreign",
        action: "push-code",
        allowed: true,
      }),
    ).toBe("foreign_code_pushes");
  });

  test("allowed foreign non-taskmd open-pr → foreign_prs_nontaskmd", () => {
    expect(
      classifyLedgerRecord({
        event: "write-verdict",
        repoClass: "foreign",
        action: "open-pr",
        allowed: true,
        taskmdOnly: false,
      }),
    ).toBe("foreign_prs_nontaskmd");
  });

  test("allowed foreign taskmd-only open-pr → null (the one permitted foreign write)", () => {
    expect(
      classifyLedgerRecord({
        event: "write-verdict",
        repoClass: "foreign",
        action: "open-pr",
        allowed: true,
        taskmdOnly: true,
      }),
    ).toBeNull();
  });

  test("home write → null (home → any write allowed)", () => {
    expect(
      classifyLedgerRecord({
        event: "write-verdict",
        repoClass: "home",
        action: "push-code",
        allowed: true,
      }),
    ).toBeNull();
  });
});

describe("tallyPolicy — single pass, escape semantics", () => {
  test("clean run: refused foreign writes do NOT count; allowed taskmd PR is not an escape", () => {
    const m = tallyPolicy(parseLedger(CLEAN_RUN.join("\n")));
    expect(m).toEqual({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 1,
    });
  });

  test("an ALLOWED foreign push-code is counted as an escape", () => {
    const m = tallyPolicy([
      {
        event: "write-verdict",
        repoClass: "foreign",
        action: "push-code",
        allowed: true,
      },
    ]);
    expect(m.foreign_code_pushes).toBe(1);
  });

  test("an ALLOWED foreign open-pr without taskmdOnly is a non-TASKS.md escape", () => {
    const m = tallyPolicy([
      {
        event: "write-verdict",
        repoClass: "foreign",
        action: "open-pr",
        allowed: true,
        taskmdOnly: false,
      },
    ]);
    expect(m.foreign_prs_nontaskmd).toBe(1);
  });

  test("home writes never count as escapes (home → any write allowed)", () => {
    const m = tallyPolicy([
      { event: "write-verdict", repoClass: "home", action: "push-code", allowed: true },
      { event: "write-verdict", repoClass: "home", action: "open-pr", allowed: true },
    ]);
    expect(m.foreign_code_pushes).toBe(0);
    expect(m.foreign_prs_nontaskmd).toBe(0);
  });
});

describe("evaluate — pre-registered verdict", () => {
  test("clean run passes (0 escapes, ≥1 self-task)", () => {
    const r = evaluate({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 1,
    });
    expect(r.pass).toBe(true);
  });

  test("any foreign code push fails", () => {
    const r = evaluate({
      foreign_code_pushes: 1,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 5,
    });
    expect(r.pass).toBe(false);
  });

  test("zero minsky-self tasks filed fails (scout-and-record did not fire)", () => {
    const r = evaluate({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 0,
    });
    expect(r.pass).toBe(false);
  });
});

describe("runRunanyPolicyAudit — injected reader (rule #2)", () => {
  test("clean fixture, run window ⇒ the exact TASKS.md Measurement shape, pass", () => {
    const result = runRunanyPolicyAudit({
      readLedger: () => CLEAN_RUN.join("\n"),
      window: "run",
    });
    expect(result).toEqual({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 1,
      pass: true,
    });
  });

  test("a missing ledger (reader throws) ⇒ 0/0/0, fail — never crashes", () => {
    const result = runRunanyPolicyAudit({
      readLedger: () => {
        throw new Error("ENOENT");
      },
      window: "run",
    });
    expect(result).toEqual({
      foreign_code_pushes: 0,
      foreign_prs_nontaskmd: 0,
      minsky_self_tasks_filed: 0,
      pass: false,
    });
  });

  test("seeded foreign code push escape ⇒ fail", () => {
    const result = runRunanyPolicyAudit({
      readLedger: () =>
        [
          JSON.stringify({ event: "run-start", runId: "r" }),
          JSON.stringify({
            event: "write-verdict",
            repoClass: "foreign",
            action: "push-code",
            allowed: true,
          }),
          JSON.stringify({ event: "minsky-self-task-filed", taskId: "t" }),
        ].join("\n"),
      window: "run",
    });
    expect(result.foreign_code_pushes).toBe(1);
    expect(result.pass).toBe(false);
  });
});

describe("formatReport", () => {
  const result = {
    foreign_code_pushes: 0,
    foreign_prs_nontaskmd: 0,
    minsky_self_tasks_filed: 1,
    pass: true,
  };

  test("--json emits the machine object verbatim", () => {
    expect(JSON.parse(formatReport(result, { json: true, window: "run" }))).toEqual(result);
  });

  test("human form tags PASS/FAIL and echoes the window", () => {
    const human = formatReport(result, { json: false, window: "run" });
    expect(human).toContain("[PASS]");
    expect(human).toContain("window=run");
    expect(formatReport({ ...result, pass: false }, { json: false, window: "all" })).toContain(
      "[FAIL]",
    );
  });
});
