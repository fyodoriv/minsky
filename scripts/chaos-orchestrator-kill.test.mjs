// Tests for chaos-orchestrator-kill.mjs. Pins the task's steady state: when the
// orchestrator (brain) is killed, 0 workers (hands) survive as zombies — every
// worker finishes or self-terminates (deterministic, no process spawn).
import { describe, expect, it } from "vitest";
import { allClear, parseArgs, simulateOrchestratorKill } from "./chaos-orchestrator-kill.mjs";

describe("chaos-orchestrator-kill simulation", () => {
  it("steady state holds — 0 zombies, every worker terminal (N=3)", () => {
    const r = simulateOrchestratorKill({ workers: 3 });
    expect(r.zombies).toBe(0);
    expect(r.nonTerminal).toBe(0);
    expect(r.terminated).toBe(3);
    expect(r.total).toBe(3);
    expect(allClear(r)).toBe(true);
  });

  it("holds at higher fan-out (N=20)", () => {
    const r = simulateOrchestratorKill({ workers: 20 });
    expect(r.zombies).toBe(0);
    expect(r.terminated).toBe(20);
    expect(allClear(r)).toBe(true);
  });

  it("holds at N=0 (no workers, nothing to orphan)", () => {
    const r = simulateOrchestratorKill({ workers: 0 });
    expect(r).toEqual({ zombies: 0, terminated: 0, nonTerminal: 0, total: 0 });
    expect(allClear(r)).toBe(true);
  });

  it("is deterministic — same result every run", () => {
    expect(simulateOrchestratorKill({ workers: 7 })).toEqual(
      simulateOrchestratorKill({ workers: 7 }),
    );
  });

  it("a busy worker that overruns the grace window is a zombie (tight grace exposes it)", () => {
    // With a 1-second grace window, every busy worker's finish (≥300s) overruns,
    // so the sim must surface them as zombies — proving the assertion isn't a
    // tautology that can never fail.
    const r = simulateOrchestratorKill({ workers: 4, graceSec: 1 });
    expect(r.zombies).toBeGreaterThan(0);
    expect(allClear(r)).toBe(false);
  });
});

describe("allClear", () => {
  it("rejects any zombie", () => {
    expect(allClear({ zombies: 1, nonTerminal: 0 })).toBe(false);
  });
  it("rejects any non-terminal worker (the forbidden continue path)", () => {
    expect(allClear({ zombies: 0, nonTerminal: 1 })).toBe(false);
  });
  it("accepts the all-terminal, zero-zombie steady state", () => {
    expect(allClear({ zombies: 0, nonTerminal: 0 })).toBe(true);
  });
});

describe("parseArgs", () => {
  it("defaults to N=3 workers, 1800s grace, human output", () => {
    expect(parseArgs([])).toEqual({ workers: 3, graceSec: 1800, jsonOnly: false });
  });
  it("parses --workers / --grace-sec / --json", () => {
    expect(parseArgs(["--workers=10", "--grace-sec=600", "--json"])).toEqual({
      workers: 10,
      graceSec: 600,
      jsonOnly: true,
    });
  });
  it("falls back to defaults on a malformed value (rule #7)", () => {
    // `--workers=` doesn't match the \d+ regex, so the default stands.
    expect(parseArgs(["--workers=", "--grace-sec=abc"])).toEqual({
      workers: 3,
      graceSec: 1800,
      jsonOnly: false,
    });
  });
});
