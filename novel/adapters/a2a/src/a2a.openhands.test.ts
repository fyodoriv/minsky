// Paired tests for the A2A adapter (rule #3 test-first; rule #7 chaos row in
// the package README). Covers the StubA2A fake's record/return contract and
// the A2AOpenHands scaffold's four verbs + the yellow self-test verdict
// (scaffold present, real google-a2a-python bridge pending 2026-06-01).
// Pattern: parametric paired fixtures per Meszaros, *xUnit Test Patterns*, 2007.

import { describe, expect, it } from "vitest";
import { A2AOpenHands, type A2ATask, StubA2A } from "./index.js";

const sampleTask: A2ATask = {
  name: "demo",
  description: "demo task",
  status: "QUEUED",
  createdAt: "2026-05-29T00:00:00Z",
  updatedAt: "2026-05-29T00:00:00Z",
};

describe("StubA2A (test fake)", () => {
  it("records each call in FIFO order with its args", async () => {
    const stub = new StubA2A();
    await stub.sendMessage("agent-x", sampleTask);
    await stub.getTask("task-1");
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.method).toBe("sendMessage");
    expect(stub.calls[0]?.args[0]).toBe("agent-x");
    expect(stub.calls[1]?.method).toBe("getTask");
  });

  it("returns a well-formed task from getTask", async () => {
    const stub = new StubA2A();
    const task = await stub.getTask("task-42");
    expect(task.id).toBe("task-42");
    expect(task.status).toBe("COMPLETED");
  });

  it("yields a COMPLETED event from subscribeToTask", async () => {
    const stub = new StubA2A();
    const events = [];
    for await (const e of stub.subscribeToTask("task-7")) {
      events.push(e);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("COMPLETED");
    expect(events[0]?.taskId).toBe("task-7");
  });

  it("selfTest is unconditionally green (no I/O)", async () => {
    const result = await new StubA2A().selfTest();
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBe(0);
  });

  it("reset() drops recorded calls", async () => {
    const stub = new StubA2A();
    await stub.listTasks({});
    expect(stub.calls).toHaveLength(1);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });
});

describe("A2AOpenHands (scaffold — mock bridge pending 2026-06-01)", () => {
  const adapter = new A2AOpenHands();

  it("sendMessage returns a task id", async () => {
    const id = await adapter.sendMessage("agent-x", sampleTask);
    expect(id).toMatch(/^task-/);
  });

  it("getTask returns a well-formed A2ATask", async () => {
    const task = await adapter.getTask("task-1");
    expect(task.status).toBe("COMPLETED");
    expect(task.name).toBe("scaffold-task");
  });

  it("subscribeToTask yields at least one lifecycle event", async () => {
    const events = [];
    for await (const e of adapter.subscribeToTask("task-1")) {
      events.push(e);
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.eventType).toBe("COMPLETED");
  });

  it("listTasks returns an array", async () => {
    expect(Array.isArray(await adapter.listTasks({}))).toBe(true);
  });

  it("selfTest reports yellow (scaffold present, real bridge pending) — never a false green", async () => {
    const result = await adapter.selfTest();
    expect(result.status).toBe("yellow");
    expect(result.message).toContain("2026-06-01");
  });
});
