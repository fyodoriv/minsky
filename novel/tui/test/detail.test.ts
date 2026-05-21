import type { MinskyProc } from "@minsky/cross-repo-runner";
import { describe, expect, it } from "vitest";
import { type DetailModel, formatLogRow, renderDetail } from "../src/index.js";

function proc(over: Partial<MinskyProc> = {}): MinskyProc {
  return {
    pid: 4242,
    kind: "worker",
    repo: "/Users/op/apps/minsky",
    runId: "daemon-10",
    argv: "node /x/novel/tick-loop/bin/tick-loop.mjs",
    ...over,
  };
}

function model(over: Partial<DetailModel> = {}): DetailModel {
  return {
    proc: proc(),
    model: "claude-opus-4-7",
    provider: "anthropic",
    launchdLabel: "com.minsky.daemon-10",
    ledger: ["last tick 12:00:01Z", "iters 7"],
    merges: ["#604 daemon-duplicate-work-detection"],
    logs: [
      { name: "tick-loop.log", sizeBytes: 2048 },
      { name: "orchestrate.log", sizeBytes: 512 },
    ],
    selectedLogIndex: 1,
    ...over,
  };
}

describe("formatLogRow", () => {
  it("1-indexes the row and shows name + human size", () => {
    const row = formatLogRow({ name: "tick-loop.log", sizeBytes: 2048 }, 0);
    expect(row).toContain("1 ");
    expect(row).toContain("tick-loop.log");
    expect(row).toContain("2.0K");
  });

  it("renders bytes under 1K verbatim and a '?' for an un-stat-ed size (rule #7)", () => {
    expect(formatLogRow({ name: "a.log", sizeBytes: 900 }, 0)).toContain("900B");
    expect(formatLogRow({ name: "a.log", sizeBytes: -1 }, 0)).toContain("?");
  });

  it("truncates an over-long log name with an ellipsis", () => {
    const long = `${"x".repeat(60)}.log`;
    expect(formatLogRow({ name: long, sizeBytes: 1 }, 0)).toContain("…");
  });
});

describe("renderDetail", () => {
  it("pads every line to exactly the box width (default 80, no ANSI)", () => {
    for (const line of renderDetail(model())) {
      expect([...line]).toHaveLength(80);
    }
  });

  it("honours a custom width", () => {
    for (const line of renderDetail(model(), { width: 100 })) {
      expect([...line]).toHaveLength(100);
    }
  });

  it("includes the banner, identity, env, ledger, merges and every log", () => {
    const out = renderDetail(model()).join("\n");
    expect(out).toContain("MINSKY // PROCESS DETAIL");
    expect(out).toContain("daemon-10");
    expect(out).toContain("minsky"); // repo basename
    expect(out).toContain("claude-opus-4-7");
    expect(out).toContain("anthropic");
    expect(out).toContain("com.minsky.daemon-10");
    expect(out).toContain("iters 7");
    expect(out).toContain("#604 daemon-duplicate-work-detection");
    expect(out).toContain("tick-loop.log");
    expect(out).toContain("orchestrate.log");
  });

  it("emits ANSI escapes only when color is enabled", () => {
    expect(renderDetail(model()).join("")).not.toContain("\x1b[");
    expect(renderDetail(model(), { color: true }).join("")).toContain("\x1b[");
  });

  it("inverts only the selected log row", () => {
    const lines = renderDetail(model(), { color: true });
    const rows = lines.filter((l) => l.includes("tick-loop.log") || l.includes("orchestrate.log"));
    const selected = rows.filter((l) => l.includes("\x1b[7m"));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain("orchestrate.log");
  });

  it("degrades an empty log list to a notice (rule #7)", () => {
    const out = renderDetail(model({ logs: [], selectedLogIndex: -1 }));
    expect(out.join("\n")).toContain("(no .minsky/*.log files)");
    for (const line of out) expect([...line]).toHaveLength(80);
  });

  it("degrades empty ledger / merge sections to an em-dash row (rule #7)", () => {
    const out = renderDetail(model({ ledger: [], merges: [] })).join("\n");
    expect(out).toContain("LEDGER");
    expect(out).toContain("RECENT MERGES");
    expect(out).toContain("—");
  });
});
