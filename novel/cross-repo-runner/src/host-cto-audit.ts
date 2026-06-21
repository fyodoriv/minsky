// <!-- scope: human-approved cto-audit-rule-9-field-quality -->
// Pattern: pre-write validator + retry loop (Munafò et al. 2017 — pre-registration
//   discipline enforced mechanically before write, not post-hoc). The validator
//   calls `scripts/check-rule-9-tasksmd-fields.mjs --input <text>` as a subprocess;
//   on failure it retries the LLM up to MAX_RETRIES times with the first-error-line
//   appended to the system prompt; on persistent failure it logs an `audit-skip`
//   entry to `.minsky/audit-log.jsonl` and skips the write.
// Source: TASKS.md `cto-audit-rule-9-field-quality`; user-stories/007 § "Pattern
//   conformance" — "Sustained-quality work tracked as cto-audit-rule-9-field-quality P1".
// Parity: scripts/build_cto_brief.py is the Python parity port of buildHostCtoBrief;
//   bin/minsky-run.sh §§ 568/1588 are the bash parity ports of runHostCtoAudit.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../..");

/** Max retries before giving up and logging an audit-skip. */
export const MAX_RETRIES = 2;

/** PR label applied to all CTO-audit PRs — parity with build_cto_brief.py constant. */
export const HOST_CTO_AUDIT_PR_LABEL = "minsky:cto-audit";

export type HostCtoTriggerReason = "post-iteration" | "queue-empty";

/** Signals passed to buildHostCtoBrief — parity with the Python HostCtoSignals dataclass. */
export interface HostCtoSignals {
  readonly hostRepo: string;
  readonly hostRoot: string;
  readonly tasksMdPath: string;
  readonly reason: HostCtoTriggerReason;
  readonly utcDate: string;
  readonly completedTaskId?: string;
  readonly prUrl?: string;
  readonly filesChanged?: readonly string[];
}

/** Result of a single call to `check-rule-9-tasksmd-fields.mjs --input`. */
export interface ValidationResult {
  readonly valid: boolean;
  /** First line of stderr when the validator exits non-zero. */
  readonly firstErrorLine?: string;
}

/**
 * Re-invoke the LLM with a validation-error suffix appended to the system
 * prompt. Returns the new proposed task block text, or throws on failure.
 */
export type TaskRetryer = (validationError: string) => Promise<string>;

/** Options for writeProposedTask. */
export interface WriteProposedTaskOptions {
  /** The LLM-generated task block text to write. */
  readonly taskText: string;
  /** The kebab-case task ID (used in audit-log entries). */
  readonly taskId: string;
  /** Absolute path to `.minsky/audit-log.jsonl`. */
  readonly auditLogPath: string;
  /** Absolute repo root (for resolving the validator script). */
  readonly repoRoot: string;
  /** Re-invoke the LLM with the error appended; returns the corrected block. */
  readonly retryLlm: TaskRetryer;
  /** Override max retries (default: MAX_RETRIES). */
  readonly maxRetries?: number;
  // --- DI seams for testing ------------------------------------------------
  readonly runValidator?: (text: string, repoRoot: string) => ValidationResult;
  readonly appendLog?: (path: string, entry: AuditLogEntry) => void;
  readonly writeTask?: (text: string, repoRoot: string) => void;
}

/** Result of writeProposedTask. */
export interface WriteProposedTaskResult {
  /** Whether the task was written to TASKS.md. */
  readonly written: boolean;
  /** Number of LLM retries attempted (0 = written on first valid proposal). */
  readonly retriesAttempted: number;
  /** Reason for skipping (only set when written=false). */
  readonly reason?: string;
}

/** Shape of an entry in `.minsky/audit-log.jsonl`. */
export interface AuditLogEntry {
  readonly ts: string;
  readonly event: "audit-skip" | "audit-retry-success";
  readonly task: string;
  readonly reason?: string;
  readonly retriesAttempted?: number;
  readonly retryCount?: number;
}

/**
 * Validate a proposed task block by calling
 * `scripts/check-rule-9-tasksmd-fields.mjs --input <text>` as a subprocess.
 *
 * @param taskText the proposed task block markdown text
 * @param repoRoot absolute repo root (resolved for the script path)
 * @returns validation result (pure in tests via runValidator DI)
 */
export function validateProposedTask(taskText: string, repoRoot: string): ValidationResult {
  const scriptPath = resolve(repoRoot, "scripts", "check-rule-9-tasksmd-fields.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--input", taskText], {
    encoding: "utf8",
  });
  if (result.status === 0) return { valid: true };
  const firstErrorLine = (result.stderr ?? "").split("\n").find((l) => l.trim().length > 0);
  return firstErrorLine !== undefined ? { valid: false, firstErrorLine } : { valid: false };
}

/**
 * Append a JSON entry to the JSONL audit log, creating the directory if needed.
 * This is the default production write; tests inject a mock via deps.appendLog.
 */
function appendAuditLog(auditLogPath: string, entry: AuditLogEntry): void {
  mkdirSync(dirname(auditLogPath), { recursive: true });
  appendFileSync(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Write the accepted task block text to TASKS.md (appended at the end of the
 * P1 section). This is the default production write; tests inject a mock via
 * deps.writeTask. In production the bash runner performs the actual git-commit
 * step; this function only appends to the file.
 *
 * NOTE: this default implementation is a stub that logs to stdout — the real
 * write happens in the bash runner after `runHostCtoAudit` returns. The DI
 * seam exists so unit tests can assert without touching the filesystem.
 */
function writeTaskToTasksMd(taskText: string, _repoRoot: string): void {
  process.stdout.write(`[host-cto-audit] writeProposedTask: accepted\n${taskText}\n`);
}

/**
 * Pre-write validator + retry loop for a single CTO-audit-proposed task block.
 *
 * 1. Validate `opts.taskText` via `check-rule-9-tasksmd-fields.mjs --input`.
 * 2. If valid → write immediately (retriesAttempted=0).
 * 3. If invalid → retry `retryLlm` up to `maxRetries` times, appending the
 *    first-error-line to the prompt each time. If a retry returns a valid block,
 *    write it (retriesAttempted=N).
 * 4. If still invalid after maxRetries → log `audit-skip` to audit-log and skip
 *    (written=false, retriesAttempted=maxRetries).
 *
 * @otel host-cto-audit.write-proposed-task
 */
export async function writeProposedTask(
  opts: WriteProposedTaskOptions,
): Promise<WriteProposedTaskResult> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const validate = opts.runValidator ?? validateProposedTask;
  const appendLog = opts.appendLog ?? appendAuditLog;
  const writeTask = opts.writeTask ?? writeTaskToTasksMd;

  let taskText = opts.taskText;
  let validation = validate(taskText, opts.repoRoot);

  // Happy path: valid on first attempt
  if (validation.valid) {
    writeTask(taskText, opts.repoRoot);
    return { written: true, retriesAttempted: 0 };
  }

  // Retry loop: up to maxRetries attempts
  let retriesAttempted = 0;
  while (retriesAttempted < maxRetries) {
    const errorMsg = validation.firstErrorLine ?? "rule-9 field missing";
    retriesAttempted += 1;
    taskText = await opts.retryLlm(`\n\nValidation error: ${errorMsg}`);
    validation = validate(taskText, opts.repoRoot);
    if (validation.valid) {
      appendLog(opts.auditLogPath, {
        ts: new Date().toISOString(),
        event: "audit-retry-success",
        task: opts.taskId,
        retryCount: retriesAttempted,
      });
      writeTask(taskText, opts.repoRoot);
      return { written: true, retriesAttempted };
    }
  }

  // Persistent failure after maxRetries
  const reason = validation.firstErrorLine ?? "rule-9 field missing";
  appendLog(opts.auditLogPath, {
    ts: new Date().toISOString(),
    event: "audit-skip",
    task: opts.taskId,
    reason: `rule-9-validation-failed: ${reason}`,
    retriesAttempted,
  });
  process.stderr.write(
    `audit-skip: rule-9-validation-failed task=${opts.taskId} reason=${reason}\n`,
  );
  return { written: false, retriesAttempted, reason };
}
