// @ts-check
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PII_WORDS,
  checkFile,
  classifySpanAttribute,
  extractLiteralKeys,
  normalizeKey,
} from "./check-rule-otel-no-pii.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// ---- normalizeKey ----------------------------------------------------------

describe("normalizeKey", () => {
  it("converts camelCase to snake_case", () => {
    expect(normalizeKey("apiKey")).toBe("api_key");
    expect(normalizeKey("userEmail")).toBe("user_email");
  });

  it("lowercases and replaces dots with underscores", () => {
    expect(normalizeKey("user.email")).toBe("user_email");
    expect(normalizeKey("API.KEY")).toBe("api_key");
  });

  it("leaves already-normalized keys unchanged", () => {
    expect(normalizeKey("task_id")).toBe("task_id");
    expect(normalizeKey("iteration_status")).toBe("iteration_status");
  });
});

// ---- classifySpanAttribute -------------------------------------------------

describe("classifySpanAttribute", () => {
  it("flags PII-shaped keys", () => {
    const cases = [
      "email",
      "userEmail",
      "user.email",
      "password",
      "passwd",
      "secret",
      "token",
      "auth_token",
      "apiKey",
      "api_key",
      "api.key",
      "access_key",
      "private_key",
      "credential",
      "ssn",
      "phone",
      "credit_card",
      "authorization",
      "ANTHROPIC_API_KEY",
    ];
    for (const name of cases) {
      const r = classifySpanAttribute(name);
      expect(r.ok, `expected ${name} to be flagged`).toBe(false);
      expect(r.reason).toMatch(/PII pattern/);
    }
  });

  it("passes safe keys used in existing spans", () => {
    const safe = [
      "iteration.index",
      "iteration.status",
      "iteration.reason",
      "task.id",
      "audit.outcome",
      "audit.skip_reason",
      "audit.exit_code",
      "audit.duration_ms",
      "violations.count",
      "ci.failures",
      "advisories.count",
      "warnings.count",
      "constraint.ruleId",
      "constraint.severity",
      "constraint.violationCount",
      "execute.decision",
      "execute.winner",
      "execute.reason",
      "knowledge.calibrationMae",
      "knowledge.calibrationSampleSize",
      "knowledge.amendmentProposed",
      "count",
      "signal",
      "selfTest.signal",
      "task.id",
      "changelog.outcome",
      "snapshot.outcome",
    ];
    for (const name of safe) {
      const r = classifySpanAttribute(name);
      expect(r.ok, `expected '${name}' to pass`).toBe(true);
    }
  });

  it("accepts an optional value argument without error", () => {
    expect(() => classifySpanAttribute("email", "test@example.com")).not.toThrow();
    const r = classifySpanAttribute("task.id", "some-task");
    expect(r.ok).toBe(true);
  });

  it("PII_WORDS covers expected entries", () => {
    expect(PII_WORDS).toContain("email");
    expect(PII_WORDS).toContain("token");
    expect(PII_WORDS).toContain("api_key");
    expect(PII_WORDS).toContain("secret");
  });
});

// ---- extractLiteralKeys ----------------------------------------------------

describe("extractLiteralKeys", () => {
  it("extracts quoted string keys", () => {
    const keys = extractLiteralKeys(`"task.id": result.taskId, "audit.outcome": x`);
    expect(keys).toContain("task.id");
    expect(keys).toContain("audit.outcome");
  });

  it("extracts unquoted camelCase keys", () => {
    const keys = extractLiteralKeys("apiKey: env.ANTHROPIC_API_KEY, count: 1");
    expect(keys).toContain("apiKey");
    expect(keys).toContain("count");
  });

  it("does not return TypeScript keywords", () => {
    const keys = extractLiteralKeys("return: x, const: y, if: z");
    expect(keys).not.toContain("return");
    expect(keys).not.toContain("const");
    expect(keys).not.toContain("if");
  });
});

// ---- checkFile -------------------------------------------------------------

describe("checkFile — safe production-like spans", () => {
  it("passes inline attributes object with safe keys", () => {
    const source = `
emit({ name: "tick-loop.iteration", attributes: {
  "iteration.index": result.iteration,
  "iteration.status": result.status,
  "task.id": result.taskId ?? "",
  "iteration.reason": result.reason ?? "",
}});
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs).toHaveLength(0);
  });

  it("passes when attributes are a variable reference (not inline)", () => {
    const source = `
const base = { "task.id": taskId, "audit.outcome": outcome };
emit({ name: "tick-loop.cto-audit", attributes: base });
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs).toHaveLength(0);
  });

  it("passes mape-k-loop style attribute helpers", () => {
    const source = `
function snapshotAttrs(snapshot) {
  return {
    "violations.count": snapshot.violations.length,
    "ci.failures": snapshot.ciFailureCount,
  };
}
emit({ name: "mape.monitor.snapshot", attributes: snapshotAttrs(snapshot) });
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs).toHaveLength(0);
  });
});

describe("checkFile — PII violations", () => {
  it("flags apiKey in a record() call", () => {
    const source = "recorder.record({apiKey: env.ANTHROPIC_API_KEY})";
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs.length).toBeGreaterThan(0);
    expect(vs[0]?.key).toBe("apiKey");
  });

  it("flags email key in an attributes block", () => {
    const source = `
emit({ name: "user.span", attributes: {
  "user.email": user.email,
  "task.id": taskId,
}});
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs).toHaveLength(1);
    expect(vs[0]?.key).toBe("user.email");
    expect(vs[0]?.line).toBe(3);
  });

  it("flags password in an attributes block", () => {
    const source = `emit({ name: "auth", attributes: { password: input.password } });`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs.some((v) => v.key === "password")).toBe(true);
  });

  it("flags secret token key", () => {
    const source = `
const attrs = {};
emit({ name: "span", attributes: {
  "auth.token": req.headers.authorization,
} });
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs.some((v) => v.key === "auth.token")).toBe(true);
  });
});

describe("checkFile — allow-list suppression", () => {
  it("suppresses violation when @otel-pii-allowed comment is on the same line", () => {
    const source = `emit({ name: "span", attributes: { "session.token": tok } }); // @otel-pii-allowed: opaque session id, not a credential`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs).toHaveLength(0);
  });

  it("suppresses violation when @otel-pii-allowed is on the preceding line", () => {
    const source = `
emit({ name: "span", attributes: {
  // @otel-pii-allowed: TASKS-abc — hashed, not raw
  "api.token": hashedToken,
}});
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs).toHaveLength(0);
  });

  it("does NOT suppress when @otel-pii-allowed is two lines above", () => {
    const source = `
// @otel-pii-allowed: some reason
const x = 1;
emit({ name: "span", attributes: { "user.email": e } });
`;
    const vs = checkFile({ path: "novel/test.ts", source });
    expect(vs.length).toBeGreaterThan(0);
  });
});

// ---- fixture file ----------------------------------------------------------

describe("leaking-span fixture", () => {
  it("the fixture file contains a PII-flagged attribute (apiKey)", () => {
    const fixturePath = join(REPO_ROOT, "test/fixtures/otel-pii/leaking-span.ts");
    const source = readFileSync(fixturePath, "utf8");
    const vs = checkFile({ path: "test/fixtures/otel-pii/leaking-span.ts", source });
    expect(vs.length).toBeGreaterThan(0);
    const keys = vs.map((v) => v.key);
    expect(keys).toContain("apiKey");
  });
});
