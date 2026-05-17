// <!-- scope: human-approved 2026-05-16 operator "runany-permission-scoped-writes" P0 directive — wiring substrate (ledger-record builders) for the pre-registered cross-repo least-authority gate -->
//
// Ledger-record builders for the run-anywhere permission gate. The pure
// `repo-policy` module *decides* (home/foreign × push/pr); this module
// turns one decision into the exact `.minsky/runany-policy.jsonl`
// record that `scripts/runany-policy-audit.mjs` reads — the
// pre-registered Measurement of TASKS.md `runany-permission-scoped
// -writes`. Kept out of `repo-policy.ts` so the decision core never
// carries the audit's wire format (one concern per module; also keeps
// this slice's diff off the file the sibling instrumentation PR edits).
//
// Schema contract — the audit's `classifyLedgerRecord` keys on
// `event` / `repoClass` / `action` / `allowed` / `taskmdOnly`. Those
// field names and value vocabularies are a cross-module contract: a
// change here without the matching change in
// `scripts/runany-policy-audit.mjs` silently zeroes the metric.
//
//   run-start     {ts, event:"run-start",     runId}
//   write-verdict {ts, event:"write-verdict", repoClass, action,
//                  allowed, taskmdOnly, code}
//
// Pattern: pure builders (rule #10 — same input → same output, zero
//   I/O; `ts` is caller-supplied, never `Date.now()` inside, so the
//   records are deterministic and unit-testable). The conductor
//   (`scripts/local-gate-merge.mjs`) owns the fs append.
// Source: TASKS.md `runany-permission-scoped-writes` Acceptance (2);
//   rule #13 (least authority across repos); Saltzer & Schroeder 1975
//   (fail-safe defaults).
// Conformance: full — no fs, no env, no clock inside the builders.

import type { RepoClass, WriteDecision, WriteKind } from "./repo-policy.js";

/**
 * The audit's action vocabulary. A `git push` / `gh pr merge --admin`
 * writes code → `push-code`; a `gh pr create` → `open-pr`. These two
 * literals are the contract `scripts/runany-policy-audit.mjs`
 * `classifyLedgerRecord` switches on.
 */
export type LedgerAction = "push-code" | "open-pr";

/** Window delimiter — the audit's `--window=run` slices at the LAST one. */
export interface RunStartRecord {
  readonly ts: string;
  readonly event: "run-start";
  readonly runId: string;
}

/** One record per `assertWriteAllowed` call the conductor makes. */
export interface WriteVerdictRecord {
  readonly ts: string;
  readonly event: "write-verdict";
  readonly repoClass: RepoClass;
  readonly action: LedgerAction;
  readonly allowed: boolean;
  /**
   * True ONLY for an allowed foreign PR (the gate proved the diff
   * `TASKS.md`-only). This flag is exactly what keeps a legitimate
   * foreign TASKS.md PR OFF the audit's `foreign_prs_nontaskmd` escape
   * counter — `classifyLedgerRecord` counts an allowed foreign open-pr
   * as an escape *unless* `taskmdOnly === true`.
   */
  readonly taskmdOnly: boolean;
  /**
   * `"ok"` on allow, else the typed {@link WriteDecision} refusal
   * reason. Informational for the operator-facing report; the audit
   * keys on `allowed`, never on `code`.
   */
  readonly code: string;
}

/** `push` → `push-code`, `pr` → `open-pr` (the audit's vocabulary). */
export function ledgerAction(writeKind: WriteKind): LedgerAction {
  return writeKind === "push" ? "push-code" : "open-pr";
}

/**
 * Build the run-start marker. One per non-dry conductor sweep, appended
 * before any write-verdict, so the audit's `--window=run` slice is
 * exactly this run's verdicts.
 */
export function buildRunStartRecord(runId: string, ts: string): RunStartRecord {
  return { ts, event: "run-start", runId };
}

export interface WriteVerdictInputs {
  readonly repoClass: RepoClass;
  readonly writeKind: WriteKind;
  readonly decision: WriteDecision;
  /** Caller-supplied ISO timestamp — keeps the builder pure/testable. */
  readonly ts: string;
}

/**
 * Map an `assertWriteAllowed` outcome to its ledger record.
 *
 * `taskmdOnly` is true iff the write was an ALLOWED foreign PR — the
 * only cell the gate permits for a foreign repo, and the cell the audit
 * must NOT score as an escape. Every refused write (and every home
 * write) carries `taskmdOnly:false`; the audit ignores the flag for
 * those because `classifyLedgerRecord` returns early unless the record
 * is a foreign + allowed write.
 *
 * Invariant this preserves: `assertWriteAllowed` never returns
 * `allowed:true` for a foreign `push`, so a `{repoClass:"foreign",
 * action:"push-code", allowed:true}` record can never be emitted —
 * which is exactly why the audit's `foreign_code_pushes` counter stays
 * 0 by construction (the pre-registered success threshold).
 */
export function buildWriteVerdictRecord(i: WriteVerdictInputs): WriteVerdictRecord {
  const allowed = i.decision.allowed;
  const action = ledgerAction(i.writeKind);
  const taskmdOnly = allowed && i.repoClass === "foreign" && action === "open-pr";
  return {
    ts: i.ts,
    event: "write-verdict",
    repoClass: i.repoClass,
    action,
    allowed,
    taskmdOnly,
    code: allowed ? "ok" : i.decision.reason,
  };
}
