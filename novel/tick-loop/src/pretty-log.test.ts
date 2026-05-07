import { describe, expect, it } from "vitest";
import { formatLogLine } from "./pretty-log.js";

const NO_COLOR = { color: false } as const;

describe("formatLogLine — span rendering", () => {
  it("renders a `completed` iteration span with badge, task, iteration, reason", () => {
    const raw = `[span] tick-loop.iteration {"iteration.index":42,"iteration.status":"completed","task.id":"my-task","iteration.reason":"shipped PR #500"}`;
    const out = formatLogLine(raw, NO_COLOR);
    expect(out).toContain("✓");
    expect(out).toContain("my-task");
    expect(out).toContain("#42");
    expect(out).toContain("shipped PR #500");
  });

  it("renders status badges for each known iteration status", () => {
    const cases: Array<{ status: string; sym: string }> = [
      { status: "completed", sym: "✓" },
      { status: "failed", sym: "✗" },
      { status: "no-task", sym: "○" },
      { status: "paused", sym: "⏸" },
      { status: "budget-paused", sym: "⏳" },
      { status: "missing-tasks-md", sym: "⚠" },
    ];
    for (const { status, sym } of cases) {
      const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"${status}","task.id":"t","iteration.reason":"r"}`;
      expect(formatLogLine(raw, NO_COLOR)).toContain(sym);
    }
  });

  it("collapses multi-line reasons to a single line + truncates with ellipsis", () => {
    const reason =
      "line one\nline two\nline three with lots of detail that goes on and on and on and exceeds the cap";
    const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","task.id":"t","iteration.reason":${JSON.stringify(reason)}}`;
    const out = formatLogLine(raw, { color: false, maxReasonChars: 40 });
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThan(120); // sanity: should be one short line
    expect(out).toContain("…");
  });

  it("handles missing fields gracefully", () => {
    const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed"}`;
    const out = formatLogLine(raw, NO_COLOR);
    expect(out).toContain("✓");
    expect(out).toContain("(no-task)");
  });

  it("renders ANSI color codes when color: true (default)", () => {
    const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","task.id":"t","iteration.reason":"r"}`;
    const out = formatLogLine(raw); // default color: true
    expect(out).toContain(`${String.fromCharCode(0x1b)}[`); // has at least one ANSI escape
  });

  it("does not render ANSI codes when color: false", () => {
    const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","task.id":"t","iteration.reason":"r"}`;
    const out = formatLogLine(raw, NO_COLOR);
    expect(out).not.toContain(`${String.fromCharCode(0x1b)}[`);
  });
});

describe("formatLogLine — passthrough", () => {
  it("dims [tick-loop] prefix lines but preserves content", () => {
    const raw = "[tick-loop] no notifier wired (set MINSKY_NTFY_TOPIC to enable)";
    expect(formatLogLine(raw, NO_COLOR)).toBe(raw);
    expect(formatLogLine(raw)).toContain("\x1b[2m"); // dim ansi
  });

  it("passes through arbitrary non-span lines unchanged (no color)", () => {
    const lines = [
      "WARNING: something",
      "tick-loop: worker 0 of 2 (branches: daemon/0/<task-id>)",
      "Error: ENOENT",
      "",
    ];
    for (const line of lines) {
      expect(formatLogLine(line, NO_COLOR)).toBe(line);
    }
  });

  it("strips trailing newlines from the input before formatting", () => {
    const raw = "WARNING: with a newline\n";
    expect(formatLogLine(raw, NO_COLOR)).toBe("WARNING: with a newline");
  });

  it("falls through to passthrough on malformed span JSON", () => {
    const raw = "[span] tick-loop.iteration {not valid json}";
    expect(formatLogLine(raw, NO_COLOR)).toBe(raw);
  });

  it("falls through to passthrough on span lines with unrecognized shape", () => {
    const raw = "[span] tick-loop.something-else not-json-here";
    expect(formatLogLine(raw, NO_COLOR)).toBe(raw);
  });
});

describe("formatLogLine — output shape", () => {
  it("is single-line (no newlines in the output)", () => {
    const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","task.id":"multi\\nline\\ntask","iteration.reason":"a\\nb\\nc"}`;
    const out = formatLogLine(raw, NO_COLOR);
    expect(out).not.toContain("\n");
  });

  it("includes a HH:MM:SS time prefix", () => {
    const raw = `[span] tick-loop.iteration {"iteration.index":1,"iteration.status":"completed","task.id":"t","iteration.reason":"r"}`;
    const out = formatLogLine(raw, NO_COLOR);
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}/);
  });
});
