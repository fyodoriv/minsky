// Paired tests for the ledger-record builders (rule #3 — test-first).
// The grid is the full {home,foreign} × {push,pr} × {allowed,refused}
// matrix plus the run-start marker. The security-critical assertions
// are the ones that decide whether the audit scores a record as an
// ESCAPE, so they mirror `scripts/runany-policy-audit.mjs`
// `classifyLedgerRecord`'s exact predicate — if the two ever diverge,
// the metric silently zeroes, so the divergence is asserted here.
//
// Pattern: table-driven, literal-input (pure builders; `ts` is an arg,
//   not a clock, so records are deterministic).
// Source: Bentley 1986 (table-driven tests); Munafò et al. 2017
//   (the asserted escape predicate is the pre-registered metric).

import { describe, expect, it } from "vitest";
import { buildRunStartRecord, buildWriteVerdictRecord, ledgerAction } from "./policy-ledger.js";
import { assertWriteAllowed } from "./repo-policy.js";

const TS = "2026-05-17T12:00:00.000Z";

/**
 * The audit's escape predicate, copied verbatim from
 * `scripts/runany-policy-audit.mjs` `classifyLedgerRecord`. A record
 * the builder emits MUST be scored by this exactly as intended;
 * pinning it here fails the build the moment the wire contract drifts.
 */
function auditCounter(
  rec: object,
): "foreign_code_pushes" | "foreign_prs_nontaskmd" | "minsky_self_tasks_filed" | null {
  const r = rec as Record<string, unknown>;
  if (r["event"] === "minsky-self-task-filed") return "minsky_self_tasks_filed";
  const foreignAllowed =
    r["event"] === "write-verdict" && r["repoClass"] === "foreign" && r["allowed"] === true;
  if (!foreignAllowed) return null;
  if (r["action"] === "push-code") return "foreign_code_pushes";
  if (r["action"] === "open-pr" && r["taskmdOnly"] !== true) return "foreign_prs_nontaskmd";
  return null;
}

describe("ledgerAction", () => {
  it("push → push-code, pr → open-pr (the audit's vocabulary)", () => {
    expect(ledgerAction("push")).toBe("push-code");
    expect(ledgerAction("pr")).toBe("open-pr");
  });
});

describe("buildRunStartRecord", () => {
  it("is the window delimiter the audit slices on", () => {
    expect(buildRunStartRecord("sweep-42", TS)).toEqual({
      ts: TS,
      event: "run-start",
      runId: "sweep-42",
    });
  });
});

describe("buildWriteVerdictRecord — home cells (never an escape)", () => {
  it("home + push allowed → recorded, audit ignores (not foreign)", () => {
    const rec = buildWriteVerdictRecord({
      repoClass: "home",
      writeKind: "push",
      decision: assertWriteAllowed({ repoClass: "home", writeKind: "push" }),
      ts: TS,
    });
    expect(rec).toEqual({
      ts: TS,
      event: "write-verdict",
      repoClass: "home",
      action: "push-code",
      allowed: true,
      taskmdOnly: false,
      code: "ok",
    });
    expect(auditCounter(rec)).toBeNull();
  });

  it("home + pr allowed → recorded, audit ignores (not foreign)", () => {
    const rec = buildWriteVerdictRecord({
      repoClass: "home",
      writeKind: "pr",
      decision: assertWriteAllowed({ repoClass: "home", writeKind: "pr" }),
      ts: TS,
    });
    expect(rec.action).toBe("open-pr");
    expect(rec.allowed).toBe(true);
    expect(auditCounter(rec)).toBeNull();
  });
});

describe("buildWriteVerdictRecord — foreign cells (the gate's teeth)", () => {
  it("foreign + push → REFUSED record; audit does NOT score it (gate did its job)", () => {
    const decision = assertWriteAllowed({ repoClass: "foreign", writeKind: "push" });
    const rec = buildWriteVerdictRecord({
      repoClass: "foreign",
      writeKind: "push",
      decision,
      ts: TS,
    });
    expect(rec.allowed).toBe(false);
    expect(rec.code).toBe("foreign-push-refused");
    expect(rec.taskmdOnly).toBe(false);
    // Refused ⇒ not an escape ⇒ foreign_code_pushes stays 0.
    expect(auditCounter(rec)).toBeNull();
  });

  it("foreign + pr, TASKS.md-only → ALLOWED record with taskmdOnly:true; audit does NOT score it", () => {
    const decision = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: ["TASKS.md", "novel/x/TASKS.md"],
    });
    const rec = buildWriteVerdictRecord({
      repoClass: "foreign",
      writeKind: "pr",
      decision,
      ts: TS,
    });
    expect(rec.allowed).toBe(true);
    expect(rec.taskmdOnly).toBe(true);
    // Allowed foreign TASKS.md PR is the INTENDED path — not an escape.
    expect(auditCounter(rec)).toBeNull();
  });

  it("foreign + pr touching code → REFUSED record; audit does NOT score it (gate refused)", () => {
    const decision = assertWriteAllowed({
      repoClass: "foreign",
      writeKind: "pr",
      diffPaths: ["TASKS.md", "src/evil.ts"],
    });
    const rec = buildWriteVerdictRecord({
      repoClass: "foreign",
      writeKind: "pr",
      decision,
      ts: TS,
    });
    expect(rec.allowed).toBe(false);
    expect(rec.code).toBe("foreign-pr-non-taskmd");
    expect(auditCounter(rec)).toBeNull();
  });

  it("foreign + pr with no diff → REFUSED (fail-safe); audit does NOT score it", () => {
    const decision = assertWriteAllowed({ repoClass: "foreign", writeKind: "pr" });
    const rec = buildWriteVerdictRecord({
      repoClass: "foreign",
      writeKind: "pr",
      decision,
      ts: TS,
    });
    expect(rec.allowed).toBe(false);
    expect(rec.code).toBe("foreign-pr-no-diff");
    expect(auditCounter(rec)).toBeNull();
  });
});

describe("escape detection (the pre-registered invariant)", () => {
  it("a HYPOTHETICAL allowed foreign push IS scored as foreign_code_pushes", () => {
    // assertWriteAllowed can never produce this; the builder must still
    // map it to the escape counter so a future regression that wrongly
    // allows a foreign push is caught by the metric, not hidden by it.
    const rec = buildWriteVerdictRecord({
      repoClass: "foreign",
      writeKind: "push",
      decision: { allowed: true, logLine: "(simulated regression)" },
      ts: TS,
    });
    expect(auditCounter(rec)).toBe("foreign_code_pushes");
  });
});
