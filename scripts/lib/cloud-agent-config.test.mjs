// <!-- scope: human-approved phase-7b step 3 (PR #879) — paired tests for the ported `cloud-agent-config.mjs` module. Originally migrated from `novel/cross-repo-runner/src/agent-config.test.ts` before that directory was removed. -->
// Migration history: phase-7b deletion of novel/cross-repo-runner/
// shipped via PRs #878-#883; this file is the canonical surface today.
// Tests for the per-machine cloud-agent matrix and resolver. xUnit
// paired fixtures (Meszaros 2007).
//
// History: originally `novel/cross-repo-runner/src/agent-config.test.ts`.
// Ported to .mjs in PR #879 (phase-7b step 3) alongside the source
// module (`cloud-agent-config.mjs`). Same 19 assertions; JSDoc
// instead of TS types.

import { describe, expect, test } from "vitest";

import { AGENT_MATRIX, resolveCloudAgent } from "./cloud-agent-config.mjs";

describe("AGENT_MATRIX", () => {
  test("contains exactly 4 rows", () => {
    expect(AGENT_MATRIX).toHaveLength(4);
  });

  test("openhands is first row (canonical default since 2026-05-24)", () => {
    expect(AGENT_MATRIX[0]?.id).toBe("openhands");
  });

  test("row order is openhands / claude / devin / aider", () => {
    expect(AGENT_MATRIX.map((r) => r.id)).toEqual(["openhands", "claude", "devin", "aider"]);
  });

  test("every row has a valid briefDeliveryShape", () => {
    const validShapes = new Set(["brief-file", "stdin", "prompt-file", "message-file"]);
    for (const row of AGENT_MATRIX) {
      expect(validShapes.has(row.briefDeliveryShape)).toBe(true);
    }
  });

  test("every row's modelFlag matches the flag pattern", () => {
    const flagPattern = /^--?[a-z][a-z0-9-]*$/;
    for (const row of AGENT_MATRIX) {
      expect(row.modelFlag).toMatch(flagPattern);
    }
  });

  test("all four agents have pendingExternalDep === null (integration complete)", () => {
    // June-1-2026 dep lifted on 2026-05-24 when the Python-SDK shim
    // adapter shipped. No row carries an external-dep gate today.
    for (const row of AGENT_MATRIX) {
      expect(row.pendingExternalDep).toBeNull();
    }
  });

  test("openhands row uses brief-file delivery shape (via Python shim)", () => {
    const row = AGENT_MATRIX.find((r) => r.id === "openhands");
    expect(row?.briefDeliveryShape).toBe("brief-file");
  });

  test("every row's pendingExternalDep is null or a YYYY-MM-DD ISO date", () => {
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    for (const row of AGENT_MATRIX) {
      if (row.pendingExternalDep !== null) {
        expect(row.pendingExternalDep).toMatch(isoDate);
      }
    }
  });
});

describe("resolveCloudAgent — shipped agents", () => {
  test("ok status for openhands (canonical default, brief-file shape)", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "openhands" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.agent).toBe("openhands");
      expect(r.row.briefDeliveryShape).toBe("brief-file");
    }
  });

  test("ok status for claude", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "claude" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.agent).toBe("claude");
      expect(r.row.briefDeliveryShape).toBe("stdin");
    }
  });

  test("ok status for devin (prompt-file shape)", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "devin" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.agent).toBe("devin");
      expect(r.row.briefDeliveryShape).toBe("prompt-file");
    }
  });

  test("ok status for aider (message-file shape)", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "aider" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.agent).toBe("aider");
      expect(r.row.briefDeliveryShape).toBe("message-file");
    }
  });
});

describe("resolveCloudAgent — unknown agent", () => {
  test("returns unknown status for an unmatched id", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "gpt-cli" });
    expect(r.status).toBe("unknown");
    if (r.status === "unknown") {
      expect(r.error).toContain("Unknown cloud_agent");
      expect(r.error).toContain("gpt-cli");
    }
  });

  test("unknown-agent error lists all 4 valid ids", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "made-up" });
    if (r.status !== "unknown") throw new Error(`expected unknown, got ${r.status}`);
    expect(r.error).toContain("claude");
    expect(r.error).toContain("devin");
    expect(r.error).toContain("aider");
    expect(r.error).toContain("openhands");
  });
});

describe("resolveCloudAgent — priority (env > config > default)", () => {
  test("env value wins over config", () => {
    const r = resolveCloudAgent({ envValue: "devin", configValue: "claude" });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("devin");
  });

  test("config used when env is undefined", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "devin" });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("devin");
  });

  test("defaults to openhands when both env and config are undefined", () => {
    // Default flipped 2026-05-24: openhands is now Minsky's canonical
    // agent runtime. Legacy "claude" default removed per operator
    // "make openhands default" directive.
    const r = resolveCloudAgent({ envValue: undefined, configValue: undefined });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("openhands");
  });

  test("defaultAgent override is honored when env + config are undefined", () => {
    const r = resolveCloudAgent({
      envValue: undefined,
      configValue: undefined,
      defaultAgent: "devin",
    });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("devin");
  });
});

describe("resolveCloudAgent — case insensitivity", () => {
  test("OPENHANDS uppercase resolves to openhands row (now ok status)", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "OPENHANDS" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.agent).toBe("openhands");
  });

  test("mixed case Claude resolves to claude row", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "Claude" });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("claude");
  });
});
