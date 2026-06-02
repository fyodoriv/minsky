// @ts-check
// Tests for `scripts/llm-provider-throughput.mjs` — slice 5 substrate of
// `local-llm-fallback-on-budget-pause`.

import { describe, expect, it } from "vitest";

import {
  aggregate,
  main,
  parseArgs,
  parseIterationLine,
  renderText,
} from "./llm-provider-throughput.mjs";

describe("llm-provider-throughput / parseArgs", () => {
  it("returns defaults when no args", () => {
    const { logPath, json } = parseArgs([]);
    expect(logPath).toBeUndefined();
    expect(json).toBe(false);
  });

  it("--since= parses ISO date", () => {
    const { since } = parseArgs(["--since=2026-01-01"]);
    expect(since.getUTCFullYear()).toBe(2026);
  });

  it("--log= overrides default log path", () => {
    const { logPath } = parseArgs(["--log=/tmp/foo.log"]);
    expect(logPath).toBe("/tmp/foo.log");
  });

  it("--json sets json=true", () => {
    const { json } = parseArgs(["--json"]);
    expect(json).toBe(true);
  });
});

describe("llm-provider-throughput / parseIterationLine", () => {
  it("parses an iteration span with provider", () => {
    const line =
      '[span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed","iteration.provider":"claude"}';
    expect(parseIterationLine(line)).toEqual({
      index: 7,
      status: "completed",
      provider: "claude",
    });
  });

  it("missing provider falls back to empty string", () => {
    const line = '[span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed"}';
    expect(parseIterationLine(line)).toEqual({
      index: 7,
      status: "completed",
      provider: "",
    });
  });

  it("returns null for non-iteration lines", () => {
    expect(parseIterationLine("[tick-loop] notifier wired")).toBeNull();
    expect(parseIterationLine("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseIterationLine("[span] tick-loop.iteration {not json")).toBeNull();
  });

  it("returns null when index is missing or wrong type", () => {
    expect(
      parseIterationLine(
        '[span] tick-loop.iteration {"iteration.status":"completed","iteration.provider":"claude"}',
      ),
    ).toBeNull();
    expect(
      parseIterationLine(
        '[span] tick-loop.iteration {"iteration.index":"seven","iteration.status":"completed"}',
      ),
    ).toBeNull();
  });
});

describe("llm-provider-throughput / aggregate", () => {
  it("counts iterations and completed per provider", () => {
    const records = [
      { index: 0, status: "completed", provider: "claude" },
      { index: 1, status: "completed", provider: "claude" },
      { index: 2, status: "failed", provider: "claude" },
      { index: 3, status: "completed", provider: "local" },
      { index: 4, status: "failed", provider: "local" },
      { index: 5, status: "failed", provider: "hold" },
    ];
    const out = aggregate(records);
    expect(out.claude).toEqual({ iterations: 3, completed: 2 });
    expect(out.local).toEqual({ iterations: 2, completed: 1 });
    expect(out.hold).toEqual({ iterations: 1, completed: 0 });
    expect(out.untagged).toEqual({ iterations: 0, completed: 0 });
  });

  it("untagged bucket catches empty-string provider", () => {
    const records = [
      { index: 0, status: "completed", provider: "" },
      { index: 1, status: "completed", provider: "" },
    ];
    expect(aggregate(records).untagged).toEqual({ iterations: 2, completed: 2 });
  });

  it("counts switches between non-empty providers in time order", () => {
    const records = [
      { index: 0, status: "completed", provider: "claude" }, // 0 → no switch
      { index: 1, status: "completed", provider: "claude" }, // claude → claude: 0
      { index: 2, status: "completed", provider: "local" }, // claude → local: 1
      { index: 3, status: "completed", provider: "local" }, // local → local: 0
      { index: 4, status: "completed", provider: "claude" }, // local → claude: 1
    ];
    expect(aggregate(records).switches).toBe(2);
  });

  it("does not count empty-string transitions as switches", () => {
    const records = [
      { index: 0, status: "completed", provider: "claude" },
      { index: 1, status: "completed", provider: "" }, // ignored for switch tracking
      { index: 2, status: "completed", provider: "claude" }, // claude → claude: 0
    ];
    expect(aggregate(records).switches).toBe(0);
  });

  it("empty input returns zeros", () => {
    expect(aggregate([])).toEqual({
      claude: { iterations: 0, completed: 0 },
      local: { iterations: 0, completed: 0 },
      hold: { iterations: 0, completed: 0 },
      untagged: { iterations: 0, completed: 0 },
      switches: 0,
    });
  });
});

describe("llm-provider-throughput / renderText", () => {
  it("renders a human-readable summary", () => {
    const report = {
      since: "2026-04-30T00:00:00.000Z",
      until: "2026-05-07T00:00:00.000Z",
      claude: { iterations: 187, completed: 42 },
      local: { iterations: 47, completed: 3 },
      hold: { iterations: 2, completed: 0 },
      untagged: { iterations: 0, completed: 0 },
      switches: 4,
    };
    const text = renderText(report);
    expect(text).toContain("Window: 2026-04-30");
    expect(text).toContain("claude");
    expect(text).toContain("187");
    expect(text).toContain("42");
    expect(text).toContain("Switches:    4");
  });
});

describe("llm-provider-throughput / main", () => {
  it("writes JSON line on stdout when --json is set", async () => {
    /** @type {string[]} */
    const out = [];
    const code = await main({
      argv: ["--log=/synthetic.log", "--json"],
      stdout: { write: (s) => out.push(s) },
      stderr: {
        write: () => {
          /* no-op */
        },
      },
      exists: () => true,
      readFile: () =>
        '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","iteration.provider":"claude"}\n' +
        '[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","iteration.provider":"local"}\n',
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const first = out[0];
    if (first === undefined) throw new Error("expected stdout");
    const parsed = JSON.parse(first);
    expect(parsed.claude.iterations).toBe(1);
    expect(parsed.local.iterations).toBe(1);
    expect(parsed.switches).toBe(1);
  });

  it("writes plain text when --json is unset", async () => {
    /** @type {string[]} */
    const out = [];
    await main({
      argv: ["--log=/synthetic.log"],
      stdout: { write: (s) => out.push(s) },
      stderr: {
        write: () => {
          /* no-op */
        },
      },
      exists: () => true,
      readFile: () =>
        '[span] tick-loop.iteration {"iteration.index":0,"iteration.status":"completed","iteration.provider":"claude"}\n',
    });
    const first = out[0];
    if (first === undefined) throw new Error("expected stdout");
    expect(first).toContain("claude");
    expect(first).toContain("Window:");
    expect(() => JSON.parse(first)).toThrow();
  });

  it("returns 0 with empty report when log is missing", async () => {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const err = [];
    const code = await main({
      argv: ["--log=/nonexistent", "--json"],
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
      exists: () => false,
      readFile: () => "",
    });
    expect(code).toBe(0);
    expect(err.some((s) => s.includes("log not found"))).toBe(true);
    const first = out[0];
    if (first === undefined) throw new Error("expected stdout");
    const parsed = JSON.parse(first);
    expect(parsed.claude).toEqual({ iterations: 0, completed: 0 });
  });
});
