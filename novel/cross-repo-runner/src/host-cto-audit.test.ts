import { describe, expect, it } from "vitest";

import {
  type AuditLogEntry,
  HOST_CTO_AUDIT_PR_LABEL,
  MAX_RETRIES,
  type ValidationResult,
  type WriteProposedTaskOptions,
  writeProposedTask,
} from "./host-cto-audit.js";

const REPO_ROOT = "/fake/repo";

const VALID_TASK = `- [ ] test-task — desc
  - **ID**: test-task
  - **Hypothesis**: X improves Y
  - **Success**: metric ≥0.9
  - **Pivot**: metric <0.5
  - **Measurement**: node scripts/m.mjs --json
  - **Anchor**: Munafò 2017
`;

const INVALID_TASK = `- [ ] test-task — desc
  - **ID**: test-task
  - **Hypothesis**: X improves Y
`;

function makeOpts(
  taskText: string,
  overrides: Partial<WriteProposedTaskOptions> = {},
): WriteProposedTaskOptions {
  return {
    taskText,
    taskId: "test-task",
    auditLogPath: "/fake/.minsky/audit-log.jsonl",
    repoRoot: REPO_ROOT,
    retryLlm: async () => VALID_TASK,
    ...overrides,
  };
}

describe("constants", () => {
  it("MAX_RETRIES is 2", () => {
    expect(MAX_RETRIES).toBe(2);
  });

  it("HOST_CTO_AUDIT_PR_LABEL is the canonical label", () => {
    expect(HOST_CTO_AUDIT_PR_LABEL).toBe("minsky:cto-audit");
  });
});

describe("writeProposedTask — valid on first attempt", () => {
  it("writes without retrying when validator says valid", async () => {
    const written: string[] = [];
    const alwaysValid: (text: string) => ValidationResult = () => ({ valid: true });

    const result = await writeProposedTask(
      makeOpts(VALID_TASK, {
        runValidator: alwaysValid,
        appendLog: () => {
          // noop
        },
        writeTask: (t) => {
          written.push(t);
        },
      }),
    );

    expect(result.written).toBe(true);
    expect(result.retriesAttempted).toBe(0);
    expect(written).toHaveLength(1);
  });
});

describe("writeProposedTask — retry loop", () => {
  it("retries once and writes corrected block on retry success", async () => {
    const written: string[] = [];
    const logs: AuditLogEntry[] = [];
    let calls = 0;
    const validator: (text: string) => ValidationResult = () => {
      calls += 1;
      return calls === 1 ? { valid: false, firstErrorLine: "missing Pivot" } : { valid: true };
    };

    const result = await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: validator,
        retryLlm: async (_err) => VALID_TASK,
        appendLog: (_p, e) => {
          logs.push(e);
        },
        writeTask: (t) => {
          written.push(t);
        },
      }),
    );

    expect(result.written).toBe(true);
    expect(result.retriesAttempted).toBe(1);
    expect(written).toHaveLength(1);
    expect(logs[0]?.event).toBe("audit-retry-success");
  });

  it("skips and logs audit-skip after max retries exhausted", async () => {
    const logs: AuditLogEntry[] = [];
    const alwaysInvalid: (text: string) => ValidationResult = () => ({
      valid: false,
      firstErrorLine: "missing Pivot, Measurement",
    });

    const result = await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: alwaysInvalid,
        retryLlm: async () => INVALID_TASK,
        appendLog: (_p, e) => {
          logs.push(e);
        },
        writeTask: () => {
          // noop
        },
        maxRetries: 2,
      }),
    );

    expect(result.written).toBe(false);
    expect(result.retriesAttempted).toBe(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe("audit-skip");
    expect(logs[0]?.task).toBe("test-task");
    expect(logs[0]?.retriesAttempted).toBe(2);
  });

  it("passes firstErrorLine to retryLlm call", async () => {
    const suffixes: string[] = [];
    const alwaysInvalid: (text: string) => ValidationResult = () => ({
      valid: false,
      firstErrorLine: "test-task missing Anchor",
    });

    await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: alwaysInvalid,
        retryLlm: async (suffix) => {
          suffixes.push(suffix);
          return INVALID_TASK;
        },
        appendLog: () => {
          // noop
        },
        writeTask: () => {
          // noop
        },
        maxRetries: 1,
      }),
    );

    expect(suffixes).toHaveLength(1);
    expect(suffixes[0]).toContain("Validation error: test-task missing Anchor");
  });
});
