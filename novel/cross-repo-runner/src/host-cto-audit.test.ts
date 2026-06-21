import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type AuditLogEntry,
  HOST_CTO_AUDIT_PR_LABEL,
  MAX_RETRIES,
  type ValidationResult,
  validateProposedTask,
  type WriteProposedTaskOptions,
  writeProposedTask,
} from "./host-cto-audit.js";

const REPO_ROOT = "/fake/repo";
// Real repo root so validateProposedTask resolves the real
// `scripts/check-rule-9-tasksmd-fields.mjs` for the subprocess tests.
const REAL_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

describe("validateProposedTask — real check-rule-9 subprocess", () => {
  it("returns valid for a rule-9-complete block", () => {
    const result = validateProposedTask(VALID_TASK, REAL_REPO_ROOT);
    expect(result.valid).toBe(true);
  });

  it("returns invalid with a firstErrorLine for an incomplete block", () => {
    const result = validateProposedTask(INVALID_TASK, REAL_REPO_ROOT);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(typeof result.firstErrorLine).toBe("string");
      expect((result.firstErrorLine ?? "").length).toBeGreaterThan(0);
    }
  });
});

describe("writeProposedTask — default (non-DI) implementations", () => {
  it("uses the default stdout writer when writeTask DI is omitted", async () => {
    const result = await writeProposedTask(
      makeOpts(VALID_TASK, {
        runValidator: () => ({ valid: true }),
        appendLog: () => {
          // noop
        },
        // writeTask omitted → exercises the default writeTaskToTasksMd
      }),
    );
    expect(result.written).toBe(true);
    expect(result.retriesAttempted).toBe(0);
  });

  it("uses the default real validator when runValidator DI is omitted", async () => {
    const result = await writeProposedTask(
      makeOpts(VALID_TASK, {
        repoRoot: REAL_REPO_ROOT,
        appendLog: () => {
          // noop
        },
        writeTask: () => {
          // noop
        },
        // runValidator omitted → exercises the default validateProposedTask
      }),
    );
    expect(result.written).toBe(true);
  });

  it("falls back to a default reason when the validator gives no firstErrorLine", async () => {
    const logs: AuditLogEntry[] = [];
    const result = await writeProposedTask(
      makeOpts(INVALID_TASK, {
        runValidator: () => ({ valid: false }),
        retryLlm: async () => INVALID_TASK,
        appendLog: (_p, e) => {
          logs.push(e);
        },
        writeTask: () => {
          // noop
        },
        maxRetries: 1,
      }),
    );
    expect(result.written).toBe(false);
    expect(result.reason).toBe("rule-9 field missing");
    expect(logs[0]?.event).toBe("audit-skip");
  });

  it("uses the default file appendLog when appendLog DI is omitted", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cto-audit-"));
    const logPath = resolve(dir, "nested", "audit-log.jsonl");
    try {
      const result = await writeProposedTask(
        makeOpts(INVALID_TASK, {
          runValidator: () => ({ valid: false, firstErrorLine: "missing Pivot" }),
          retryLlm: async () => INVALID_TASK,
          writeTask: () => {
            // noop
          },
          auditLogPath: logPath,
          maxRetries: 1,
          // appendLog omitted → exercises the default appendAuditLog (mkdir + append)
        }),
      );
      expect(result.written).toBe(false);
      expect(readFileSync(logPath, "utf8")).toContain("audit-skip");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
