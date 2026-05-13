/**
 * Paired tests for `claude-exhaustion-state.ts` — slice 4 of
 * `minsky-claude-exhaustion-persisted-state`.
 *
 * The helper reads/writes `.minsky/state.json::last_claude_hard_limit`
 * to persist hard-limit hits across `minsky` invocations. Pure-over-
 * injection: the test layer simulates the file-system seams.
 */

import { describe, expect, it } from "vitest";
import {
  type ReadClaudeHealthyOutcome,
  type ReadHardLimitOutcome,
  readLastClaudeHealthy,
  readLastHardLimit,
  writeLastClaudeHealthy,
  writeLastHardLimit,
} from "./claude-exhaustion-state.js";

const NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z; arbitrary fixed
const ONE_HOUR_MS = 60 * 60 * 1000;

describe("readLastHardLimit — state file absent", () => {
  it("returns { exhausted: false } when state file does not exist", () => {
    const result = readLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => {
        throw new Error("ENOENT");
      },
      existsSyncFn: () => false,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result).toEqual<ReadHardLimitOutcome>({ exhausted: false });
  });
});

describe("readLastHardLimit — state file present, field absent", () => {
  it("returns { exhausted: false } when last_claude_hard_limit is unset", () => {
    const result = readLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => '{"schema_version":"1","ledger":{}}',
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.exhausted).toBe(false);
  });
});

describe("readLastHardLimit — field present, within TTL", () => {
  it("returns { exhausted: true, ageMs, reason, ts } for a recent hit", () => {
    const tsRecent = new Date(NOW_MS - 10 * 60 * 1000).toISOString(); // 10 min ago
    const result = readLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_hard_limit: { ts: tsRecent, reason: "hit usage limit" },
        }),
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.exhausted).toBe(true);
    if (result.exhausted) {
      expect(result.ts).toBe(tsRecent);
      expect(result.reason).toBe("hit usage limit");
      expect(result.ageMs).toBe(10 * 60 * 1000);
    }
  });
});

describe("readLastHardLimit — field present, stale (beyond TTL)", () => {
  it("returns { exhausted: false } when ts is older than TTL", () => {
    const tsStale = new Date(NOW_MS - 2 * ONE_HOUR_MS).toISOString(); // 2 hours ago, TTL=1h
    const result = readLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_hard_limit: { ts: tsStale, reason: "old hit" },
        }),
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.exhausted).toBe(false);
  });
});

describe("readLastHardLimit — corrupt JSON", () => {
  it("returns { exhausted: false } when state.json is unparseable (graceful-degrade)", () => {
    const result = readLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => "{not valid json",
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.exhausted).toBe(false);
  });
});

describe("readLastHardLimit — invalid ts string", () => {
  it("returns { exhausted: false } when ts is not a parseable date", () => {
    const result = readLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_hard_limit: { ts: "not-a-date", reason: "x" },
        }),
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.exhausted).toBe(false);
  });
});

describe("writeLastHardLimit — state file absent", () => {
  it("creates a fresh state.json with the new field", () => {
    let written: { path: string; content: string } | undefined;
    writeLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => {
        throw new Error("ENOENT");
      },
      writeFileSyncFn: (p, c) => {
        written = { path: p, content: c };
      },
      ts: "2026-05-08T19:00:00Z",
      reason: "hit usage limit",
    });
    expect(written).toBeDefined();
    expect(written?.path).toBe("/repo/.minsky/state.json");
    const parsed = JSON.parse(written?.content ?? "{}");
    expect(parsed.last_claude_hard_limit).toEqual({
      ts: "2026-05-08T19:00:00Z",
      reason: "hit usage limit",
    });
  });
});

describe("writeLastHardLimit — state file present, field absent", () => {
  it("preserves existing fields and adds last_claude_hard_limit", () => {
    let written: string | undefined;
    writeLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({ schema_version: "1", ntfy: { topic: "minsky-abc" }, ledger: {} }),
      writeFileSyncFn: (_p, c) => {
        written = c;
      },
      ts: "2026-05-08T19:00:00Z",
      reason: "hit usage limit",
    });
    const parsed = JSON.parse(written ?? "{}");
    expect(parsed.schema_version).toBe("1");
    expect(parsed.ntfy.topic).toBe("minsky-abc");
    expect(parsed.last_claude_hard_limit).toEqual({
      ts: "2026-05-08T19:00:00Z",
      reason: "hit usage limit",
    });
  });
});

describe("writeLastHardLimit — field present, overwrites", () => {
  it("overwrites the existing last_claude_hard_limit field", () => {
    let written: string | undefined;
    writeLastHardLimit({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_hard_limit: { ts: "old", reason: "old" },
        }),
      writeFileSyncFn: (_p, c) => {
        written = c;
      },
      ts: "2026-05-08T19:00:00Z",
      reason: "hit usage limit",
    });
    const parsed = JSON.parse(written ?? "{}");
    expect(parsed.last_claude_hard_limit.ts).toBe("2026-05-08T19:00:00Z");
    expect(parsed.last_claude_hard_limit.reason).toBe("hit usage limit");
  });
});

// ---------------------------------------------------------------------------
// readLastClaudeHealthy — slice 69 of minsky-cli-auto-bootstrap-local-llm
// ---------------------------------------------------------------------------

describe("readLastClaudeHealthy — state file absent", () => {
  it("returns { healthy: false } when state file does not exist", () => {
    const result = readLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => {
        throw new Error("ENOENT");
      },
      existsSyncFn: () => false,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result).toEqual<ReadClaudeHealthyOutcome>({ healthy: false });
  });
});

describe("readLastClaudeHealthy — field absent", () => {
  it("returns { healthy: false } when last_claude_healthy is unset", () => {
    const result = readLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => '{"schema_version":"1","ledger":{}}',
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.healthy).toBe(false);
  });
});

describe("readLastClaudeHealthy — field present, within TTL", () => {
  it("returns { healthy: true, ageMs, ts } for a recent record", () => {
    const tsRecent = new Date(NOW_MS - 5 * 60 * 1000).toISOString(); // 5 min ago
    const result = readLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_healthy: { ts: tsRecent },
        }),
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.healthy).toBe(true);
    if (result.healthy) {
      expect(result.ts).toBe(tsRecent);
      expect(result.ageMs).toBe(5 * 60 * 1000);
    }
  });
});

describe("readLastClaudeHealthy — field present, stale (beyond TTL)", () => {
  it("returns { healthy: false } when ts is older than TTL", () => {
    const tsStale = new Date(NOW_MS - 2 * ONE_HOUR_MS).toISOString(); // 2 hours ago
    const result = readLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_healthy: { ts: tsStale },
        }),
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.healthy).toBe(false);
  });
});

describe("readLastClaudeHealthy — corrupt JSON", () => {
  it("returns { healthy: false } when state.json is unparseable (graceful-degrade)", () => {
    const result = readLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => "{not valid json",
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.healthy).toBe(false);
  });
});

describe("readLastClaudeHealthy — invalid ts string", () => {
  it("returns { healthy: false } when ts is not a parseable date", () => {
    const result = readLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_healthy: { ts: "not-a-date" },
        }),
      existsSyncFn: () => true,
      nowFn: () => NOW_MS,
      ttlMs: ONE_HOUR_MS,
    });
    expect(result.healthy).toBe(false);
  });
});

describe("writeLastClaudeHealthy — state file absent", () => {
  it("creates a fresh state.json with the new field", () => {
    let written: { path: string; content: string } | undefined;
    writeLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () => {
        throw new Error("ENOENT");
      },
      writeFileSyncFn: (p, c) => {
        written = { path: p, content: c };
      },
      ts: "2026-05-13T10:00:00Z",
    });
    expect(written).toBeDefined();
    expect(written?.path).toBe("/repo/.minsky/state.json");
    const parsed = JSON.parse(written?.content ?? "{}");
    expect(parsed.last_claude_healthy).toEqual({ ts: "2026-05-13T10:00:00Z" });
  });
});

describe("writeLastClaudeHealthy — state file present, preserves other fields", () => {
  it("preserves existing fields and adds last_claude_healthy", () => {
    let written: string | undefined;
    writeLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({ schema_version: "1", ntfy: { topic: "minsky-abc" }, ledger: {} }),
      writeFileSyncFn: (_p, c) => {
        written = c;
      },
      ts: "2026-05-13T10:00:00Z",
    });
    const parsed = JSON.parse(written ?? "{}");
    expect(parsed.schema_version).toBe("1");
    expect(parsed.ntfy.topic).toBe("minsky-abc");
    expect(parsed.last_claude_healthy).toEqual({ ts: "2026-05-13T10:00:00Z" });
  });
});

describe("writeLastClaudeHealthy — field present, overwrites", () => {
  it("overwrites the existing last_claude_healthy field", () => {
    let written: string | undefined;
    writeLastClaudeHealthy({
      stateFilePath: "/repo/.minsky/state.json",
      readFileSyncFn: () =>
        JSON.stringify({
          schema_version: "1",
          last_claude_healthy: { ts: "old" },
        }),
      writeFileSyncFn: (_p, c) => {
        written = c;
      },
      ts: "2026-05-13T10:00:00Z",
    });
    const parsed = JSON.parse(written ?? "{}");
    expect(parsed.last_claude_healthy.ts).toBe("2026-05-13T10:00:00Z");
  });
});
