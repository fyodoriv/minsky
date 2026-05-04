import { describe, expect, it } from "vitest";

import { type Notification, StubNotifier } from "./index.js";

describe("StubNotifier", () => {
  it("records each push call in FIFO order with full payload", async () => {
    const stub = new StubNotifier();
    const a: Notification = { title: "morning", body: "4 tasks done" };
    const b: Notification = {
      title: "alert",
      body: "budget exhausted",
      priority: "high",
      tags: ["warning"],
    };
    const ra = await stub.push(a);
    const rb = await stub.push(b);
    expect(ra).toEqual({ ok: true });
    expect(rb).toEqual({ ok: true });
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]).toEqual(a);
    expect(stub.calls[1]).toEqual(b);
  });

  it("starts with zero recorded calls", async () => {
    const stub = new StubNotifier();
    expect(stub.calls).toHaveLength(0);
  });

  it("selfTest returns green with no I/O", async () => {
    const stub = new StubNotifier();
    const r = await stub.selfTest();
    expect(r.status).toBe("green");
    expect(r.latencyMs).toBe(0);
    expect(Number.isNaN(Date.parse(r.lastCheck))).toBe(false);
  });

  it("reset() clears recorded calls (test-fixture reuse)", async () => {
    const stub = new StubNotifier();
    await stub.push({ title: "x", body: "y" });
    expect(stub.calls).toHaveLength(1);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });

  it("calls getter returns a stable snapshot reference (test inspection)", async () => {
    const stub = new StubNotifier();
    await stub.push({ title: "a", body: "b", priority: "normal" });
    // The getter exposes the internal array via a readonly view; iteration
    // works as expected and the consumer cannot mutate it through `calls`.
    expect(Array.from(stub.calls)).toEqual([{ title: "a", body: "b", priority: "normal" }]);
  });
});
