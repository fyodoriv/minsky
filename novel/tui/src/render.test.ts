import { describe, expect, it } from "vitest";

import type { MachineInfo } from "./machine.js";
import { type DashboardModel, type ProcRow, WIDTH, renderDashboard } from "./render.js";

const machine: MachineInfo = {
  host: "build-01",
  load: "0.50 1.20 2.04",
  cpu: "8 cores",
  mem: "12.0G / 16.0G (75%)",
  disk: "120.0G / 460.0G (26%)",
  time: "2026-05-17 14:30:05 UTC",
  procs: "3 minsky procs",
};

const rows: ProcRow[] = [
  {
    runId: "abc123",
    repo: "minsky",
    role: "worker",
    uptime: "01h02m",
    model: "sonnet",
    state: "running",
  },
  {
    runId: "pid:678",
    repo: "foo",
    role: "orchestrator",
    uptime: "03m10s",
    model: "—",
    state: "stuck",
  },
];

const model: DashboardModel = { machine, procs: rows, selectedIndex: 0 };

/** ANSI CSI introducer (ESC). Built via `fromCharCode` so the source
 * carries no literal control character (no `noControlCharactersInRegex`
 * trip, no suppression needed — the rule's intent is satisfied by
 * construction). */
const ESC = String.fromCharCode(27);
/** Strip CSI sequences so visible width can be measured under color. */
const CSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

describe("renderDashboard", () => {
  it("frames every line to exactly WIDTH columns (color off)", () => {
    const lines = renderDashboard(model, { color: false }).split("\n");
    for (const l of lines) expect(l).toHaveLength(WIDTH);
    expect(WIDTH).toBe(80);
  });

  it("emits no ANSI when color is disabled", () => {
    expect(renderDashboard(model, { color: false })).not.toContain(ESC);
  });

  it("emits ANSI by default (color on)", () => {
    expect(renderDashboard(model)).toContain(ESC);
  });

  it("renders the retro frame corners and title", () => {
    const out = renderDashboard(model, { color: false });
    expect(out).toContain("╔");
    expect(out).toContain("╗");
    expect(out).toContain("╚");
    expect(out).toContain("╝");
    expect(out).toContain("MINSKY :: MACHINE DASHBOARD");
    expect(out).toContain("2026-05-17 14:30:05 UTC");
  });

  it("renders the machine vitals block", () => {
    const out = renderDashboard(model, { color: false });
    expect(out).toContain("build-01");
    expect(out).toContain("12.0G / 16.0G (75%)");
    expect(out).toContain("3 minsky procs");
  });

  it("marks the selected row and shows its state in the footer", () => {
    const out = renderDashboard({ ...model, selectedIndex: 1 }, { color: false });
    const line = out.split("\n").find((l) => l.includes("pid:678"));
    expect(line).toMatch(/^║\s*> 2\s+pid:678/);
    expect(out).toContain("state: orchestrator stuck");
  });

  it("lists every process with its run-id and repo", () => {
    const out = renderDashboard(model, { color: false });
    expect(out).toContain("abc123");
    expect(out).toContain("minsky");
    expect(out).toContain("sonnet");
  });

  it("renders an explicit empty state, never a blank table", () => {
    const out = renderDashboard({ machine, procs: [], selectedIndex: 0 }, { color: false });
    expect(out).toContain("(no running minsky processes)");
    expect(out).toContain("no process selected");
  });

  it("shows 'no process selected' when the index is out of range", () => {
    const out = renderDashboard({ ...model, selectedIndex: 9 }, { color: false });
    expect(out).toContain("no process selected");
    for (const l of out.split("\n")) expect(l).toHaveLength(WIDTH);
  });

  it("keeps visible width invariant under color (escapes stripped)", () => {
    const colored = renderDashboard(model).split("\n");
    for (const l of colored) expect(l.replace(CSI_RE, "")).toHaveLength(WIDTH);
  });
});
