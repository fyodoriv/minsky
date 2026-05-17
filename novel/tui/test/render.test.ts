import type { MinskyProc } from "@minsky/cross-repo-runner";
import { describe, expect, it } from "vitest";
import {
  type DashboardModel,
  type MachineInfo,
  formatProcRow,
  renderDashboard,
  repoBasename,
} from "../src/index.js";

const machine: MachineInfo = {
  host: "op-mbp",
  load: "2.10 1.80 1.55",
  cpu: "8 cores",
  mem: "9.5/16.0 GiB (59%)",
  disk: "412.0/930.0 GiB (44%)",
  time: "2026-05-17T12:00:00.000Z",
  procs: "3 minsky procs",
};

function proc(over: Partial<MinskyProc>): MinskyProc {
  return {
    pid: 1,
    kind: "worker",
    repo: "/Users/op/apps/r",
    runId: "main",
    argv: "node /x/novel/tick-loop/bin/tick-loop.mjs",
    ...over,
  };
}

describe("repoBasename", () => {
  it("returns the trailing path segment", () => {
    expect(repoBasename("/Users/op/apps/foo")).toBe("foo");
    expect(repoBasename("/Users/op/apps/bar/")).toBe("bar");
    expect(repoBasename("solo")).toBe("solo");
  });

  it("renders an em dash for an empty path (rule #7)", () => {
    expect(repoBasename("")).toBe("—");
    expect(repoBasename("/")).toBe("—");
  });
});

describe("formatProcRow", () => {
  it("1-indexes the row and shows kind / repo basename / runId", () => {
    const row = formatProcRow(
      proc({ pid: 999, kind: "orchestrator", repo: "/Users/op/apps/svc", runId: "w3" }),
      0,
    );
    expect(row).toContain("1 ");
    expect(row).toContain("999");
    expect(row).toContain("orchestrator");
    expect(row).toContain("svc");
    expect(row).toContain("w3");
  });
});

describe("renderDashboard", () => {
  const procs = [
    proc({ pid: 100, kind: "orchestrator", repo: "/Users/op/apps/apps", runId: "main" }),
    proc({ pid: 200, kind: "worker", repo: "/Users/op/apps/foo", runId: "w1" }),
  ];
  const model: DashboardModel = { machine, procs, selectedIndex: 1 };

  it("pads every line to exactly the box width (default 80, no ANSI)", () => {
    for (const line of renderDashboard(model)) {
      expect([...line]).toHaveLength(80);
    }
  });

  it("honours a custom width", () => {
    for (const line of renderDashboard(model, { width: 100 })) {
      expect([...line]).toHaveLength(100);
    }
  });

  it("includes the banner, machine panel and every process row", () => {
    const out = renderDashboard(model).join("\n");
    expect(out).toContain("MINSKY // MACHINE DASHBOARD");
    expect(out).toContain("op-mbp");
    expect(out).toContain("412.0/930.0 GiB (44%)");
    expect(out).toContain("orchestrator");
    expect(out).toContain("w1");
  });

  it("emits ANSI escapes only when color is enabled", () => {
    expect(renderDashboard(model).join("")).not.toContain("\x1b[");
    expect(renderDashboard(model, { color: true }).join("")).toContain("\x1b[");
  });

  it("inverts only the selected row", () => {
    const lines = renderDashboard(model, { color: true });
    const rows = lines.filter((l) => l.includes(" 200 ") || l.includes(" 100 "));
    const selected = rows.filter((l) => l.includes("\x1b[7m"));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain("200");
  });

  it("degrades an empty process list to a notice (rule #7)", () => {
    const out = renderDashboard({ machine, procs: [], selectedIndex: -1 });
    expect(out.join("\n")).toContain("(no running minsky processes)");
    for (const line of out) expect([...line]).toHaveLength(80);
  });
});
