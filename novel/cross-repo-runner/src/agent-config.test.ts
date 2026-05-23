// Tests for the per-machine cloud-agent matrix and resolver.
// xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { AGENT_MATRIX, resolveCloudAgent } from "./agent-config.js";

describe("AGENT_MATRIX", () => {
  test("contains exactly 4 rows", () => {
    expect(AGENT_MATRIX).toHaveLength(4);
  });

  test("row order is claude / devin / aider / openhands", () => {
    expect(AGENT_MATRIX.map((r) => r.id)).toEqual(["claude", "devin", "aider", "openhands"]);
  });

  test("every row has a valid briefDeliveryShape", () => {
    const validShapes = new Set(["stdin", "prompt-file", "message-file"]);
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

  test("shipped agents have pendingExternalDep === null", () => {
    const shippedIds = ["claude", "devin", "aider"] as const;
    for (const id of shippedIds) {
      const row = AGENT_MATRIX.find((r) => r.id === id);
      expect(row?.pendingExternalDep).toBeNull();
    }
  });

  test("openhands row carries pendingExternalDep: 2026-06-01", () => {
    const row = AGENT_MATRIX.find((r) => r.id === "openhands");
    expect(row?.pendingExternalDep).toBe("2026-06-01");
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

describe("resolveCloudAgent — pending external dep (openhands)", () => {
  test("returns pending-external-dep status for openhands", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "openhands" });
    expect(r.status).toBe("pending-external-dep");
    if (r.status === "pending-external-dep") {
      expect(r.agent).toBe("openhands");
      expect(r.row.pendingExternalDep).toBe("2026-06-01");
    }
  });

  test("error message names the openhands agent and the June 1 date", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "openhands" });
    if (r.status !== "pending-external-dep") {
      throw new Error(`expected pending-external-dep, got ${r.status}`);
    }
    expect(r.error).toContain("openhands");
    expect(r.error).toContain("2026-06-01");
  });

  test("error message includes the GHE issue reference for traceability", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "openhands" });
    if (r.status !== "pending-external-dep") {
      throw new Error(`expected pending-external-dep, got ${r.status}`);
    }
    expect(r.error).toContain("OpenHands/OpenHands#14374");
  });

  test("error message names the fallback agents (claude / devin)", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "openhands" });
    if (r.status !== "pending-external-dep") {
      throw new Error(`expected pending-external-dep, got ${r.status}`);
    }
    expect(r.error).toMatch(/claude.*devin|devin.*claude/);
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

  test("defaults to claude when both env and config are undefined", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: undefined });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("claude");
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
  test("OPENHANDS uppercase resolves to openhands row", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "OPENHANDS" });
    expect(r.status).toBe("pending-external-dep");
  });

  test("mixed case Claude resolves to claude row", () => {
    const r = resolveCloudAgent({ envValue: undefined, configValue: "Claude" });
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.agent).toBe("claude");
  });
});
