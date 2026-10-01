#!/usr/bin/env node
// <!-- scope: TASKS.md `runany-permission-scoped-writes` Measurement —
//   promotes the pre-registered run-window metric command
//   (`node scripts/runany-policy-audit.mjs --window=run --json` →
//   `{foreign_code_pushes:0, foreign_prs_nontaskmd:0,
//   minsky_self_tasks_filed:>=1}`) from prose in the task block into a
//   versioned, paired-tested operator-facing script. This is the
//   instrumentation-first preparation PR (global rule: add the
//   instrumentation, land it, then the wiring PR carries real
//   before/after numbers). Acceptance (1) — the pure `classifyRepo` /
//   `assertWriteAllowed` seam — shipped in b65e707; the
//   orchestrate.mjs / local-gate-merge.mjs wiring that *emits* the
//   verdict ledger this script reads lands in a follow-up iteration
//   (same staged pattern as #591 scan-processes). -->
//
// Ledger schema — `.minsky/runany-policy.jsonl`, one JSON object per
// line (append-ordered; tolerant reader skips blank / malformed lines
// so a single corrupt write never blinds the metric — rule #6):
//
//   run-start marker (delimits the `--window=run` slice):
//     {"ts":"…","event":"run-start","runId":"…"}
//
//   write-verdict (the wiring emits one per assertWriteAllowed call;
//   `allowed:true` on a foreign push / non-TASKS.md PR is a policy
//   ESCAPE — the gate should make those impossible, so the metric
//   counts them and the threshold is 0):
//     {"ts":"…","event":"write-verdict","repoClass":"home|foreign",
//      "action":"push-code|open-pr","allowed":true|false,
//      "taskmdOnly":true|false,"code":"foreign-code-push|…"}
//
//   minsky-self-task-filed (scout-and-record across the fleet — every
//   run that observes minsky-on-itself friction files one):
//     {"ts":"…","event":"minsky-self-task-filed","taskId":"…"}
//
// Pattern: pure transforms (`parseLedger`, `selectWindow`,
//   `tallyPolicy`, `evaluate`, `formatReport`) composed with ONE
//   injected I/O seam (`readLedger`) above a thin CLI — same shape as
//   `scripts/daemon-pr-lint-metrics.mjs` so the operator surface stays
//   uniform (rule #2 data-not-code: the threshold constants are
//   exported so the report formatter, the tests, and any future
//   self-diagnose invariant share one source).
// Anchor: rule #13 (security/privacy — least authority across repos);
//   Saltzer & Schroeder 1975 (least privilege + fail-safe defaults);
//   Munafò et al. 2017 (pre-registration — the thresholds are committed
//   in TASKS.md `runany-permission-scoped-writes` *before* the result
//   is observed; this script evaluates them deterministically).
// Conformance: full — the pure transforms have no I/O; the orchestrator
//   composes the injected `readLedger`; the CLI is the only fs call site.
// Pivot (TASKS.md `runany-permission-scoped-writes` Pivot): if the
//   `gh pr diff`-shaped enforcement the wiring relies on proves
//   bypassable, gate at the git layer (refuse a push whose remote ≠
//   home origin). This script does not enforce that pivot — it reports
//   the escape counters the pivot keys off.
//
// Usage:
//   node scripts/runany-policy-audit.mjs [--window=run|all] [--json] [--ledger=PATH]
//     --window=run : count only records since the last `run-start`
//                    marker (default; the pre-registered window).
//     --window=all : count over the whole ledger.
//     --json       : emit the machine-readable metric object.
//     --ledger=P   : override the ledger path (tests / ad-hoc audits).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO = process.env["MINSKY_HOME"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Default verdict-ledger path. The wiring layer
 *  (`scripts/orchestrate.mjs`, `scripts/local-gate-merge.mjs`) appends
 *  here; this script is the only reader. */
export const RUNANY_POLICY_LEDGER = join(REPO, ".minsky", "runany-policy.jsonl");

/** Pre-registered success thresholds (TASKS.md
 *  `runany-permission-scoped-writes` Measurement). Committed before the
 *  result is observed; the report formatter and the tests share this
 *  single source so the task block and the verdict can never disagree. */
export const POLICY_THRESHOLDS = Object.freeze({
  /** Foreign-repo code pushes that escaped the gate. Must be exactly 0. */
  maxForeignCodePushes: 0,
  /** Foreign-repo non-TASKS.md PRs that escaped the gate. Must be 0. */
  maxForeignPrsNonTaskmd: 0,
  /** Minsky-self improvement tasks filed in the window. Must be ≥ 1
   *  (scout-and-record: every run that observes friction files one). */
  minMinskySelfTasksFiled: 1,
});

/**
 * Parse `.minsky/runany-policy.jsonl` text into typed records. Tolerant
 * by design (rule #6): a blank line or a single corrupt JSON write is
 * skipped, never thrown — a partial ledger must still yield a metric,
 * because the metric exists precisely to catch a misbehaving run.
 *
 * @param {string} text
 * @returns {Array<Record<string, unknown>>}
 */
export function parseLedger(text) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        out.push(/** @type {Record<string, unknown>} */ (obj));
      }
    } catch {
      // rule #6: one malformed line must not blind the whole audit.
    }
  }
  return out;
}

/**
 * Slice the records to the requested window. `run` returns every record
 * at or after the LAST `run-start` marker (the ledger is append-ordered,
 * so position is time); with no marker the whole ledger is the window
 * (fail-safe — never silently report an empty slice when data exists).
 * `all` returns every record.
 *
 * @param {Array<Record<string, unknown>>} records
 * @param {"run" | "all"} window
 * @returns {Array<Record<string, unknown>>}
 */
export function selectWindow(records, window) {
  if (window === "all") return records;
  let lastStart = -1;
  records.forEach((r, i) => {
    if (r["event"] === "run-start") lastStart = i;
  });
  return lastStart === -1 ? records : records.slice(lastStart);
}

/**
 * Which counter (if any) a single ledger record increments, or `null`
 * for a record outside the metric. An ALLOWED foreign write is an
 * escape — the gate should refuse every one — so a foreign push-code
 * that got through, or a foreign open-pr that was not TASKS.md-only,
 * maps to its escape counter. Extracted so {@link tallyPolicy} stays a
 * flat single-pass loop under the cognitive-complexity budget; pure,
 * no I/O (rule #10), exported so the tests share this one source.
 *
 * @param {Record<string, unknown>} r
 * @returns {"foreign_code_pushes" | "foreign_prs_nontaskmd" | "minsky_self_tasks_filed" | null}
 */
export function classifyLedgerRecord(r) {
  if (r["event"] === "minsky-self-task-filed") return "minsky_self_tasks_filed";
  const foreignAllowed =
    r["event"] === "write-verdict" && r["repoClass"] === "foreign" && r["allowed"] === true;
  if (!foreignAllowed) return null;
  if (r["action"] === "push-code") return "foreign_code_pushes";
  if (r["action"] === "open-pr" && r["taskmdOnly"] !== true) return "foreign_prs_nontaskmd";
  return null;
}

/**
 * Single-pass tally of the three pre-registered counters. One O(n)
 * traversal computes all three rather than three separate filter+length
 * passes over the ledger — the metric is read on every conductor tick,
 * so the hot path stays one pass (round-trip elimination).
 *
 * @param {Array<Record<string, unknown>>} records
 * @returns {{foreign_code_pushes:number, foreign_prs_nontaskmd:number, minsky_self_tasks_filed:number}}
 */
export function tallyPolicy(records) {
  /** @type {{foreign_code_pushes:number, foreign_prs_nontaskmd:number, minsky_self_tasks_filed:number}} */
  const acc = {
    foreign_code_pushes: 0,
    foreign_prs_nontaskmd: 0,
    minsky_self_tasks_filed: 0,
  };
  for (const r of records) {
    const key = classifyLedgerRecord(r);
    if (key !== null) acc[key] += 1;
  }
  return acc;
}

/**
 * Apply the pre-registered thresholds to a tally. `pass` is the
 * AND of all three — the conductor only declares the least-authority
 * invariant healthy when no escape occurred AND scout-and-record fired.
 *
 * @param {{foreign_code_pushes:number, foreign_prs_nontaskmd:number, minsky_self_tasks_filed:number}} metric
 * @returns {{foreign_code_pushes:number, foreign_prs_nontaskmd:number, minsky_self_tasks_filed:number, pass:boolean}}
 */
export function evaluate(metric) {
  const pass =
    metric.foreign_code_pushes <= POLICY_THRESHOLDS.maxForeignCodePushes &&
    metric.foreign_prs_nontaskmd <= POLICY_THRESHOLDS.maxForeignPrsNonTaskmd &&
    metric.minsky_self_tasks_filed >= POLICY_THRESHOLDS.minMinskySelfTasksFiled;
  return { ...metric, pass };
}

/**
 * Render the evaluated metric. `--json` emits the exact object the
 * TASKS.md Measurement line names; the human form is a one-glance
 * operator summary.
 *
 * @param {{foreign_code_pushes:number, foreign_prs_nontaskmd:number, minsky_self_tasks_filed:number, pass:boolean}} result
 * @param {{json:boolean, window:"run"|"all"}} opts
 * @returns {string}
 */
export function formatReport(result, opts) {
  if (opts.json) return JSON.stringify(result);
  const tag = result.pass ? "PASS" : "FAIL";
  return [
    `runany-policy-audit [${tag}] window=${opts.window}`,
    `  foreign_code_pushes    = ${result.foreign_code_pushes} (max ${POLICY_THRESHOLDS.maxForeignCodePushes})`,
    `  foreign_prs_nontaskmd  = ${result.foreign_prs_nontaskmd} (max ${POLICY_THRESHOLDS.maxForeignPrsNonTaskmd})`,
    `  minsky_self_tasks_filed= ${result.minsky_self_tasks_filed} (min ${POLICY_THRESHOLDS.minMinskySelfTasksFiled})`,
  ].join("\n");
}

/**
 * Orchestrator — composes the pure transforms over an injected ledger
 * reader (rule #2: the CLI passes the real `readFileSync`; tests pass a
 * fixture string, no fs). A missing ledger is an empty window, not an
 * error: a run that performed zero writes legitimately has no records,
 * and the metric should read `0 / 0 / 0` (which fails the ≥1
 * self-task threshold loudly — the correct signal, not a crash).
 *
 * @param {{readLedger:() => string, window:"run"|"all"}} deps
 * @returns {{foreign_code_pushes:number, foreign_prs_nontaskmd:number, minsky_self_tasks_filed:number, pass:boolean}}
 */
export function runRunanyPolicyAudit(deps) {
  let text = "";
  try {
    text = deps.readLedger();
  } catch {
    // rule #6: absent ledger ⇒ empty window, never a thrown audit.
  }
  const windowed = selectWindow(parseLedger(text), deps.window);
  return evaluate(tallyPolicy(windowed));
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const windowArg = args.find((a) => a.startsWith("--window="));
  const window = windowArg?.split("=")[1] === "all" ? "all" : "run";
  const ledgerArg = args.find((a) => a.startsWith("--ledger="));
  const ledgerPath = ledgerArg?.split("=")[1] ?? RUNANY_POLICY_LEDGER;
  const result = runRunanyPolicyAudit({
    readLedger: () => readFileSync(ledgerPath, "utf8"),
    window,
  });
  process.stdout.write(`${formatReport(result, { json, window })}\n`);
  process.exitCode = result.pass ? 0 : 1;
}
