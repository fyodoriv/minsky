import { describe, expect, it } from "vitest";

import { type PersonaSpawnOpts, StubPersonaSpawner } from "./index.js";

describe("StubPersonaSpawner", () => {
  it("records each spawn call in FIFO order with full opts", async () => {
    const stub = new StubPersonaSpawner();
    const a: PersonaSpawnOpts = {
      taskId: "task-001",
      persona: "engineer",
      workingDir: "/tmp/work-a",
    };
    const b: PersonaSpawnOpts = {
      taskId: "task-002",
      persona: "researcher",
      workingDir: "/tmp/work-b",
      teamName: "team-b",
    };
    const ra = await stub.spawn(a);
    const rb = await stub.spawn(b);
    expect(ra).toEqual({ exitCode: 0, durationMs: 100, omcStateDir: "/tmp/stub" });
    expect(rb).toEqual({ exitCode: 0, durationMs: 100, omcStateDir: "/tmp/stub" });
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.opts).toEqual(a);
    expect(stub.calls[1]?.opts).toEqual(b);
  });

  it("starts with zero recorded calls", () => {
    const stub = new StubPersonaSpawner();
    expect(stub.calls).toHaveLength(0);
  });

  it("selfTest returns green with no I/O", async () => {
    const stub = new StubPersonaSpawner();
    const r = await stub.selfTest();
    expect(r.status).toBe("green");
    expect(r.latencyMs).toBe(0);
    expect(Number.isNaN(Date.parse(r.lastCheck))).toBe(false);
  });

  it("returns the canned result on every call (default shape)", async () => {
    const stub = new StubPersonaSpawner();
    const r = await stub.spawn({
      taskId: "x",
      persona: "engineer",
      workingDir: "/tmp/x",
    });
    expect(r.exitCode).toBe(0);
    expect(r.durationMs).toBe(100);
    expect(r.omcStateDir).toBe("/tmp/stub");
  });

  it("honours an overridden cannedResult from the constructor", async () => {
    const stub = new StubPersonaSpawner({
      cannedResult: { exitCode: 7, durationMs: 42, omcStateDir: "/tmp/custom" },
    });
    const r = await stub.spawn({
      taskId: "x",
      persona: "engineer",
      workingDir: "/tmp/x",
    });
    expect(r).toEqual({ exitCode: 7, durationMs: 42, omcStateDir: "/tmp/custom" });
  });

  it("reset() clears recorded calls (test-fixture reuse)", async () => {
    const stub = new StubPersonaSpawner();
    await stub.spawn({ taskId: "x", persona: "engineer", workingDir: "/tmp/x" });
    expect(stub.calls).toHaveLength(1);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });
});
