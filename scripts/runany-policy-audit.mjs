#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-16 operator "runany-permission-scoped-writes" P0 directive — the pre-registered Measurement command for the cross-repo least-authority gate -->
//
// The pre-registered Measurement of TASKS.md `runany-permission-scoped
// -writes`. Slice 1 shipped the pure gate (`repo-policy.ts`), slice 2
// wired it into the conductor write-site + appends a verdict ledger
// (`policy-ledger.ts` → `.minsky/runany-policy.jsonl`). This slice ships
// the *instrument* that reads that ledger and emits the exact numbers
// the task's Measurement line promises:
//
//   node scripts/runany-policy-audit.mjs --window=run --json
//   # → {foreign_code_pushes:0, foreign_prs_nontaskmd:0,
//   #    minsky_self_tasks_filed:>=1, pass:true}
//
// Preparation-PR pattern (global rule): the minsky-self scout (Acceptance
// 3) emits `minsky-self-task-filed` records — this instrument must exist
// FIRST so that slice's PR can carry a real before/after `minsky_self
// _tasks_filed` delta instead of a promise to "measure later".
//
// Pattern: pure transforms (`parseLedger`, `sliceToRunWindow`,
//   `classifyLedgerRecord`, `tallyMetrics`, `evaluate`, `formatReport`)
//   composed with ONE injected I/O seam (`readLedgerText`) above a thin
//   CLI — same shape as `cto-audit-metrics.mjs` so the operator surface
//   stays uniform. Rule #10 — no model, no clock, no env inside the
//   transforms; same ledger bytes → same verdict.
// Source: TASKS.md `runany-permission-scoped-writes` Measurement;
//   docs/run-anywhere.md § Measurement; rule #13 (least authority);
//   Munafò et al. 2017 (pre-registration — the thresholds below are
//   committed BEFORE the result is observed, here and in TASKS.md).
// Conformance: full — pure transforms have zero I/O; the orchestrator
//   composes the injected `readLedgerText`; the CLI is the only fs call.
// Pivot (rule #13 / task Pivot): if `gh pr diff`-shaped enforcement is
//   bypassable, the git-layer guard in `local-gate-merge.mjs` is the hard
//   backstop; this audit's `foreign_code_pushes` counter is exactly the
//   tripwire that would surface such an escape loudly rather than hide it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const REPO = process.env["MINSKY_HOME"] ?? "/Users/cbrwizard/apps/tooling/minsky";

/** Default verdict-ledger path. Mirrors `RUNANY_LEDGER` in
 *  `scripts/local-gate-merge.mjs`; drift on this path silently zeroes
 *  every metric, so it is pinned in the paired test on both sides. */
export const DEFAULT_LEDGER_PATH = join(REPO, ".minsky", "runany-policy.jsonl");

/** Pre-registered escape threshold. An *allowed* foreign code push OR an
 *  *allowed* non-`TASKS.md` foreign PR is a least-authority escape; the
 *  pre-registered success value is exactly 0 (TASKS.md Measurement /
 *  docs/run-anywhere.md § Measurement). Exported so the formatter and the
 *  tests pin one source. */
export const ESCAPE_THRESHOLD = 0;

/** Pre-registered minimum minsky-self scout tasks filed per run that
 *  observes a friction (TASKS.md Success: `minsky_self_tasks_filed:>=1`).
 *  The scout that emits these records is a later slice (Acceptance 3);
 *  until it lands this stays 0 and `pass` is honestly `false` — the
 *  instrument tells the truth, it does not flatter the experiment. */
export const MIN_MINSKY_SELF_TASKS = 1;

/**
 * One parsed ledger line. The wire schema is the cross-module contract
 * documented in `policy-ledger.ts`; every field is optional so a
 * malformed/forward-compatible record never widens the type, and the
 * audit narrows at each comparison site (a missing field simply fails
 * the `=== literal` check and the record classifies as inert).
 *
 * @typedef {object} LedgerRecord
 * @property {string} [ts]          ISO timestamp (informational)
 * @property {string} [event]       `run-start` | `write-verdict` | `minsky-self-task-filed`
 * @property {string} [runId]       run-start delimiter id
 * @property {string} [repoClass]   `home` | `foreign`
 * @property {string} [action]      `push-code` | `open-pr`
 * @property {boolean} [allowed]    gate verdict
 * @property {boolean} [taskmdOnly] true only for an allowed foreign TASKS.md PR
 * @property {string} [code]        `ok` or a typed refusal reason
 * @property {string} [taskId]      minsky-self scout task id
 */

/**
 * The three pre-registered observables (TASKS.md Measurement).
 * @typedef {{foreign_code_pushes: number, foreign_prs_nontaskmd: number, minsky_self_tasks_filed: number}} Metrics
 */

/**
 * {@link Metrics} plus the AND-of-thresholds verdict.
 * @typedef {Metrics & {pass: boolean}} AuditResult
 */

/**
 * Parse a `.minsky/runany-policy.jsonl` blob into records. JSONL: one
 * JSON object per line. Blank lines and unparseable lines are skipped
 * (rule #6 — a corrupt ledger line must not throw and hide every other
 * verdict; a swallowed line can only *under*-count escapes, never
 * manufacture a false-green, because escapes are counted from records
 * that DID parse). Non-object JSON (array/scalar) is also skipped.
 *
 * @param {string} text  raw ledger contents (`""` for a missing ledger)
 * @returns {LedgerRecord[]}   parsed records, file order preserved
 */
export function parseLedger(text) {
  /** @type {LedgerRecord[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec !== null && typeof rec === "object" && !Array.isArray(rec)) {
        out.push(rec);
      }
    } catch {
      /* rule #6: skip a corrupt line, keep auditing the rest */
    }
  }
  return out;
}

/**
 * `--window=run` slice: keep only records from the LAST `run-start`
 * marker onward (that sweep's verdicts). The `run-start` delimiter
 * itself is retained — it classifies as `other`, so it never inflates a
 * counter, and keeping it makes the window boundary visible in `--json`
 * record dumps.
 *
 * Fail-safe (Saltzer & Schroeder 1975): when NO `run-start` marker
 * exists (a ledger written before slice-2's delimiter, or a manual
 * append), the whole ledger is the window. Surfacing every record can
 * only *over*-report an escape; silently dropping pre-delimiter records
 * could *hide* one — and hiding an escape is the failure mode this whole
 * task exists to prevent.
 *
 * @param {LedgerRecord[]} records  parsed ledger, file order
 * @returns {LedgerRecord[]}        the run-window slice
 */
export function sliceToRunWindow(records) {
  let lastStart = -1;
  for (let i = 0; i < records.length; i++) {
    if (records[i]?.event === "run-start") lastStart = i;
  }
  return lastStart === -1 ? records.slice() : records.slice(lastStart);
}

/**
 * Classify one ledger record into exactly one audit category. This is
 * the cross-module contract documented in `policy-ledger.ts` (the
 * builder side keys the same `event`/`repoClass`/`action`/`allowed`/
 * `taskmdOnly` field names).
 *
 *   - `foreign-code-push` — an **allowed** foreign `push-code`. By
 *     construction `assertWriteAllowed` never returns `allowed:true` for
 *     a foreign push, so this category should be unreachable; if the
 *     audit ever counts one, a regression bypassed the gate and the
 *     metric MUST surface it (this is the tripwire).
 *   - `foreign-pr-nontaskmd` — an **allowed** foreign `open-pr` whose
 *     `taskmdOnly` flag is not exactly `true`. A legitimate foreign
 *     TASKS.md PR carries `taskmdOnly:true` and is NOT an escape.
 *   - `minsky-self-task` — a `minsky-self-task-filed` scout record.
 *   - `other` — run-start markers, refused verdicts, home writes,
 *     unknown/forward-compatible events: none move a pre-registered
 *     counter.
 *
 * Default-deny shape: only the two explicitly-allowed-and-foreign cells
 * score as escapes; everything else is inert.
 *
 * @param {unknown} raw
 * @returns {"foreign-code-push"|"foreign-pr-nontaskmd"|"minsky-self-task"|"other"}
 */
export function classifyLedgerRecord(raw) {
  if (raw === null || typeof raw !== "object") return "other";
  const rec = /** @type {LedgerRecord} */ (raw);
  if (rec.event === "minsky-self-task-filed") return "minsky-self-task";
  if (rec.event !== "write-verdict") return "other";
  if (rec.repoClass !== "foreign" || rec.allowed !== true) return "other";
  if (rec.action === "push-code") return "foreign-code-push";
  if (rec.action === "open-pr" && rec.taskmdOnly !== true) {
    return "foreign-pr-nontaskmd";
  }
  return "other";
}

/**
 * Single-pass tally of the windowed records into the three pre-registered
 * observables. One O(n) scan (not three filter passes) — the only
 * round-trip the instrument makes over the ledger.
 *
 * @param {LedgerRecord[]} records  the windowed slice
 * @returns {Metrics}
 */
export function tallyMetrics(records) {
  let foreign_code_pushes = 0;
  let foreign_prs_nontaskmd = 0;
  let minsky_self_tasks_filed = 0;
  for (const rec of records) {
    switch (classifyLedgerRecord(rec)) {
      case "foreign-code-push":
        foreign_code_pushes++;
        break;
      case "foreign-pr-nontaskmd":
        foreign_prs_nontaskmd++;
        break;
      case "minsky-self-task":
        minsky_self_tasks_filed++;
        break;
      default:
        break;
    }
  }
  return { foreign_code_pushes, foreign_prs_nontaskmd, minsky_self_tasks_filed };
}

/**
 * Apply the pre-registered thresholds. `pass` is the AND of all three:
 * zero foreign code pushes, zero non-TASKS.md foreign PRs, and at least
 * one minsky-self scout task filed. The minsky-self term keeps `pass`
 * honestly `false` until the scout slice (Acceptance 3) lands — the
 * instrument never reports the experiment as won before it is.
 *
 * @param {Metrics} m
 * @returns {AuditResult}
 */
export function evaluate(m) {
  const pass =
    m.foreign_code_pushes <= ESCAPE_THRESHOLD &&
    m.foreign_prs_nontaskmd <= ESCAPE_THRESHOLD &&
    m.minsky_self_tasks_filed >= MIN_MINSKY_SELF_TASKS;
  return { ...m, pass };
}

/**
 * Human-readable report (non-`--json` mode). One line per observable
 * with its pre-registered threshold inline, then the verdict.
 *
 * @param {{result: AuditResult, window: string, recordCount: number}} args
 * @returns {string}
 */
export function formatReport({ result, window, recordCount }) {
  /** @type {(b: boolean) => string} */
  const ok = (b) => (b ? "OK " : "ESC");
  const lines = [
    `runany-policy-audit  window=${window}  records=${recordCount}`,
    `  foreign_code_pushes   = ${result.foreign_code_pushes}  (threshold ≤${ESCAPE_THRESHOLD})  [${ok(result.foreign_code_pushes <= ESCAPE_THRESHOLD)}]`,
    `  foreign_prs_nontaskmd = ${result.foreign_prs_nontaskmd}  (threshold ≤${ESCAPE_THRESHOLD})  [${ok(result.foreign_prs_nontaskmd <= ESCAPE_THRESHOLD)}]`,
    `  minsky_self_tasks_filed = ${result.minsky_self_tasks_filed}  (threshold ≥${MIN_MINSKY_SELF_TASKS})  [${ok(result.minsky_self_tasks_filed >= MIN_MINSKY_SELF_TASKS)}]`,
    `  => ${result.pass ? "PASS" : "FAIL"}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Parse the CLI argv into options. `--window=run` (default) | `all`,
 * `--json`, `--ledger=<path>` (test/override seam).
 *
 * @param {string[]} argv  `process.argv.slice(2)`-shaped
 * @returns {{window: "run"|"all", json: boolean, ledgerPath: string}}
 */
export function parseArgs(argv) {
  /** @type {"run"|"all"} */
  let window = "run";
  let json = false;
  let ledgerPath = DEFAULT_LEDGER_PATH;
  for (const a of argv) {
    if (a === "--json") json = true;
    else if (a === "--window=run") window = "run";
    else if (a === "--window=all") window = "all";
    else if (a.startsWith("--ledger=")) ledgerPath = a.slice("--ledger=".length);
  }
  return { window, json, ledgerPath };
}

/**
 * Compose the pure transforms over one injected ledger read. Returns
 * both the structured result and the windowed record count so the CLI
 * can render either `--json` or the human report without a second read.
 *
 * @param {{argv: string[], readLedgerText: (path: string) => string}} io
 * @returns {{result: AuditResult, window: "run"|"all", recordCount: number, json: boolean}}
 */
export function runAudit({ argv, readLedgerText }) {
  const { window, json, ledgerPath } = parseArgs(argv);
  const text = readLedgerText(ledgerPath);
  const all = parseLedger(text);
  const windowed = window === "run" ? sliceToRunWindow(all) : all;
  const result = evaluate(tallyMetrics(windowed));
  return { result, window, recordCount: windowed.length, json };
}

// ---- CLI thin wrapper -----------------------------------------------------

/** Read a ledger file; a missing/unreadable ledger is an empty audit
 *  (zero metrics → `pass:false`), never a crash — the instrument must
 *  produce a number on a fresh checkout too.
 * @param {string} path
 * @returns {string}
 */
function readLedgerTextFs(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const argv = process.argv.slice(2);
  const { result, window, recordCount, json } = runAudit({
    argv,
    readLedgerText: readLedgerTextFs,
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(formatReport({ result, window, recordCount }));
  }
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("runany-policy-audit.mjs");
if (invokedDirectly) {
  process.exit(main());
}
