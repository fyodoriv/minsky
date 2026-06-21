/**
 * User-story 007 — "Minsky files new to-do tasks from what it noticed while working"
 * (`user-stories/007-cto-audit-files-new-tasks.md`).
 *
 * Tests for the pre-write rule-9 validator introduced by
 * `cto-audit-rule-9-field-quality` (TASKS.md). Exercises:
 *   (b) malformed proposal → retry LLM → success on retry
 *   (c) malformed → 2 failures → skip + `.minsky/audit-log.jsonl` entry
 *
 * Hypothesis (rule #9): `writeProposedTask` with a 2-retry loop raises the
 * rule-9 pass rate from the estimated ~70% baseline to ≥95%.
 * Success: all test assertions below pass.
 * Pivot: if `writeProposedTask` tests here pass but the 7-day
 *   `rule_9_reject_rate` stays ≥0.05, the retry approach is insufficient;
 *   apply the template-filler pivot described in the task block.
 * Measurement: `pnpm vitest run user-stories/007-cto-audit-files-new-tasks.test.ts`
 * Anchor: Munafò et al., "A Manifesto for Reproducible Science",
 *   Nature Human Behaviour 1, 0021, 2017 (pre-registration = commit metric
 *   before observing result).
 */

import { join } from "node:path";
import {
  type AuditLogEntry,
  type ValidationResult,
  type WriteProposedTaskOptions,
  writeProposedTask,
} from "@minsky/cross-repo-runner";
import { describe, expect, it, vi } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

const VALID_TASK = `- [ ] example-task — description
  - **ID**: example-task
  - **Tags**: p1
  - **Hypothesis**: adding X will improve Y by Z
  - **Success**: metric ≥0.9
  - **Pivot**: metric <0.5 after 48h
  - **Measurement**: node scripts/measure.mjs --json | jq '.value'
  - **Anchor**: Munafò et al. 2017
`;

const INVALID_TASK = `- [ ] example-task — description
  - **ID**: example-task
  - **Tags**: p1
  - **Hypothesis**: adding X will improve Y by Z
`;

function makeOpts(
  taskText: string,
  overrides: Partial<WriteProposedTaskOptions> = {},
): WriteProposedTaskOptions {
  return {
    taskText,
    taskId: "example-task",
    auditLogPath: "/tmp/test-audit-log.jsonl",
    repoRoot: REPO_ROOT,
    retryLlm: async () => VALID_TASK,
    ...overrides,
  };
}

describe("writeProposedTask — valid task on first attempt", () => {
  it("writes directly and reports 0 retries attempted", async () => {
    const written: string[] = [];
    const logs: AuditLogEntry[] = [];
    const alwaysValid: (text: string) => ValidationResult = () => ({ valid: true });

    const result = await writeProposedTask(
      makeOpts(VALID_TASK, {
        runValidator: alwaysValid,
        appendLog: (_path, entry) => {
          logs.push(entry);
        },
        writeTask: (text) => {
          written.push(text);
        },
      }),
    );

    expect(result.written).toBe(true);
    expect(result.retriesAttempted).toBe(0);
    expect(written).toHaveLength(1);
    expect(logs).toHaveLength(0);
  });
});

describe("writeProposedTask — malformed proposal → retry → success", () => {
  it("calls retryLlm once and writes the corrected block", async () => {
    const written: string[] = [];
    const logs: AuditLogEntry[] = [];
    const retryCalls: string[] = [];

    let callCount = 0;
    const validator: (text: string) => ValidationResult = () => {
      callCount += 1;
      // First call (original) → invalid; second call (after retry) → valid
      return callCount === 1
        ? {
            valid: false,
            firstErrorLine:
              "rule-9-tasksmd-fields violation: example-task missing Pivot, Measurement, Anchor",
          }
        : { valid: true };
    };

    const result = await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: validator,
        retryLlm: async (errSuffix) => {
          retryCalls.push(errSuffix);
          return VALID_TASK;
        },
        appendLog: (_path, entry) => {
          logs.push(entry);
        },
        writeTask: (text) => {
          written.push(text);
        },
      }),
    );

    expect(result.written).toBe(true);
    expect(result.retriesAttempted).toBe(1);
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0]).toContain("Validation error:");
    expect(written).toHaveLength(1);
    // On retry-success an audit-retry-success entry is logged
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe("audit-retry-success");
    expect(logs[0]?.task).toBe("example-task");
    expect(logs[0]?.retryCount).toBe(1);
  });
});

describe("writeProposedTask — malformed → 2 failures → skip + audit-log entry", () => {
  it("exhausts 2 retries, skips write, appends audit-skip to log", async () => {
    const written: string[] = [];
    const logs: AuditLogEntry[] = [];
    const retryCalls: string[] = [];

    const alwaysInvalid: (text: string) => ValidationResult = () => ({
      valid: false,
      firstErrorLine:
        "rule-9-tasksmd-fields violation: example-task missing Pivot, Measurement, Anchor",
    });

    const result = await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: alwaysInvalid,
        retryLlm: async (errSuffix) => {
          retryCalls.push(errSuffix);
          return INVALID_TASK;
        },
        appendLog: (_path, entry) => {
          logs.push(entry);
        },
        writeTask: (text) => {
          written.push(text);
        },
        maxRetries: 2,
      }),
    );

    expect(result.written).toBe(false);
    expect(result.retriesAttempted).toBe(2);
    expect(retryCalls).toHaveLength(2);
    expect(written).toHaveLength(0);
    // An audit-skip entry must be in the log
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe("audit-skip");
    expect(logs[0]?.task).toBe("example-task");
    expect(logs[0]?.reason).toMatch(/rule-9-validation-failed/);
    expect(logs[0]?.retriesAttempted).toBe(2);
    expect(logs[0]?.ts).toBeTruthy();
  });

  it("appends the validation error in the retryLlm call suffix", async () => {
    const retrySuffixes: string[] = [];
    const alwaysInvalid: (text: string) => ValidationResult = () => ({
      valid: false,
      firstErrorLine: "example-task missing Measurement",
    });

    await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: alwaysInvalid,
        retryLlm: async (suffix) => {
          retrySuffixes.push(suffix);
          return INVALID_TASK;
        },
        appendLog: vi.fn(),
        writeTask: vi.fn(),
        maxRetries: 2,
      }),
    );

    expect(retrySuffixes).toHaveLength(2);
    for (const suffix of retrySuffixes) {
      expect(suffix).toContain("Validation error:");
      expect(suffix).toMatch(/\n\nValidation error:/);
    }
  });
});
