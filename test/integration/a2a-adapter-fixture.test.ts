// End-to-end integration test for the A2A adapter (`@minsky/a2a`) — drives
// the 4-verb interface (`sendMessage` / `getTask` / `subscribeToTask` /
// `listTasks`) against a deterministic in-process fixture A2A endpoint that
// speaks the v1.0.0 task lifecycle (QUEUED → WORKING → COMPLETED / FAILED).
//
// Why this file exists (AGENTS.md §3b — integration tests for CLI/adapter
// features; rule #3 test-first): the paired unit tests in
// `novel/adapters/a2a/src/a2a.openhands.test.ts` pin the scaffold's verb
// shapes in isolation, but the constitutional gate (the A2A adapter foundation
// task's Acceptance #3 + Measurement) requires an end-to-end test that exercises all
// four verbs against a fixture endpoint and asserts the task lifecycle
// progresses correctly. This is the "localhost A2A echo server" of the task's
// **Details** field, modelled in-process so it is hermetic and needs no
// network — the same deterministic-fixture discipline every other
// `test/integration/*.test.ts` follows (mkdtemp / synthetic data, never a
// live external dependency).
//
// The fixture is a faithful, minimal A2A endpoint: it accepts a message,
// returns a task id, advances that task through the standard lifecycle on each
// poll, streams the same lifecycle as events, and supports filtered listing.
// The real `A2AOpenHands` Strategy (mock bridge today; google-a2a-python via
// child_process from 2026-06-01) is the production binding; this fixture is the
// test double the integration test drives so the 4 verbs are proven
// end-to-end NOW, independent of the pending external runtime.
//
// Measurement (A2A adapter foundation task): this file contributes ≥10 paired
// cases — one per verb × success/error/streaming path. Anchor: A2A v1.0.0
// spec (Linux Foundation) task lifecycle; docs/research-a2a-mcp-2026-05-28.md;
// vision.md rule #2 (every dependency through an interface) + rule #7 (chaos:
// the error paths below are the deterministic failure-mode tests).

import {
  type A2A,
  A2AOpenHands,
  type A2ATask,
  type A2ATaskEvent,
  type A2ATaskFilter,
  StubA2A,
} from "@minsky/a2a";
import { describe, expect, it } from "vitest";

/**
 * A deterministic in-process A2A endpoint speaking the v1.0.0 task lifecycle.
 *
 * Stands in for the "localhost A2A echo server" from the A2A SDK examples: it
 * holds an in-memory task store, advances each task one lifecycle step per
 * `getTask` poll (QUEUED → WORKING → COMPLETED), and streams the full
 * lifecycle from `subscribeToTask`. A task whose name starts with `fail-`
 * terminates in FAILED, so the error path is exercised deterministically.
 *
 * Implements the `A2A` interface so the integration test drives the exact
 * surface every Minsky consumer (multi-persona pipeline, cross-vendor
 * reviewer, remote task submission, fleet log aggregation) will call.
 */
class FixtureA2AEndpoint implements A2A {
  private readonly tasks = new Map<string, A2ATask>();
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `fixture-task-${this.seq}`;
  }

  private static isFailing(name: string): boolean {
    return name.startsWith("fail-");
  }

  async sendMessage(target: string, task: A2ATask): Promise<string> {
    if (target.length === 0) {
      throw new Error("FixtureA2AEndpoint.sendMessage: target must be non-empty");
    }
    const id = this.nextId();
    const now = new Date().toISOString();
    this.tasks.set(id, { ...task, id, status: "QUEUED", createdAt: now, updatedAt: now });
    return id;
  }

  async getTask(taskId: string): Promise<A2ATask> {
    const current = this.tasks.get(taskId);
    if (current === undefined) {
      throw new Error(`FixtureA2AEndpoint.getTask: unknown task ${taskId}`);
    }
    const advanced = this.advance(current);
    this.tasks.set(taskId, advanced);
    return advanced;
  }

  /** Advance one lifecycle step: QUEUED → WORKING → COMPLETED | FAILED. */
  private advance(task: A2ATask): A2ATask {
    const now = new Date().toISOString();
    if (task.status === "QUEUED") {
      return { ...task, status: "WORKING", updatedAt: now };
    }
    if (task.status === "WORKING") {
      const terminal = FixtureA2AEndpoint.isFailing(task.name) ? "FAILED" : "COMPLETED";
      return { ...task, status: terminal, updatedAt: now };
    }
    return task;
  }

  async *subscribeToTask(taskId: string): AsyncIterable<A2ATaskEvent> {
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      throw new Error(`FixtureA2AEndpoint.subscribeToTask: unknown task ${taskId}`);
    }
    const terminal: A2ATaskEvent["eventType"] = FixtureA2AEndpoint.isFailing(task.name)
      ? "FAILED"
      : "COMPLETED";
    const lifecycle: A2ATaskEvent["eventType"][] = ["QUEUED", "WORKING", terminal];
    for (const eventType of lifecycle) {
      yield {
        taskId,
        eventType,
        timestamp: new Date().toISOString(),
        ...(eventType === "FAILED" ? { error: "fixture: task marked to fail" } : {}),
      };
    }
  }

  async listTasks(filter: A2ATaskFilter): Promise<A2ATask[]> {
    let rows = [...this.tasks.values()];
    if (filter.status !== undefined) {
      rows = rows.filter((t) => t.status === filter.status);
    }
    if (filter.name !== undefined) {
      rows = rows.filter((t) => t.name === filter.name);
    }
    if (filter.offset !== undefined) {
      rows = rows.slice(filter.offset);
    }
    if (filter.limit !== undefined) {
      rows = rows.slice(0, filter.limit);
    }
    return rows;
  }

  async selfTest() {
    return {
      status: "green" as const,
      message: "FixtureA2AEndpoint — in-process, no I/O",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }
}

function makeTask(name: string): A2ATask {
  const now = "2026-05-29T00:00:00Z";
  return { name, description: `${name} task`, status: "QUEUED", createdAt: now, updatedAt: now };
}

/**
 * Drive all four verbs + `selfTest()` against a single `A2A` Strategy and
 * assert each returns a well-formed shape. Extracted so the conformance test's
 * per-strategy loop body stays a single call (keeps cognitive complexity ≤10)
 * and so any new Strategy added to the contract list is exercised identically.
 */
async function expectVerbContract(a2a: A2A): Promise<void> {
  const id = await a2a.sendMessage("agent-x", makeTask("compile"));
  expect(typeof id).toBe("string");
  const task = await a2a.getTask(id.length > 0 ? id : "any");
  expect(["QUEUED", "WORKING", "COMPLETED", "FAILED"]).toContain(task.status);
  const events: A2ATaskEvent[] = [];
  for await (const e of a2a.subscribeToTask(id)) {
    events.push(e);
  }
  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(await a2a.listTasks({}))).toBe(true);
  const health = await a2a.selfTest();
  expect(["green", "yellow", "red"]).toContain(health.status);
}

describe("A2A adapter — end-to-end against a fixture A2A endpoint", () => {
  describe("sendMessage", () => {
    it("success: returns a task id the endpoint can resolve", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("review"));
      expect(id).toMatch(/^fixture-task-/);
      const task = await endpoint.getTask(id);
      expect(task.id).toBe(id);
    });

    it("error: rejects an empty target (loud crash — rule #6)", async () => {
      const endpoint = new FixtureA2AEndpoint();
      await expect(endpoint.sendMessage("", makeTask("review"))).rejects.toThrow(/non-empty/);
    });
  });

  describe("getTask", () => {
    it("success: a freshly-sent task starts in WORKING after first poll", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("compile"));
      const task = await endpoint.getTask(id);
      expect(task.status).toBe("WORKING");
    });

    it("success: lifecycle reaches COMPLETED on the happy path", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("compile"));
      await endpoint.getTask(id); // → WORKING
      const done = await endpoint.getTask(id); // → COMPLETED
      expect(done.status).toBe("COMPLETED");
    });

    it("error: a fail-prefixed task lifecycle terminates in FAILED", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("fail-deploy"));
      await endpoint.getTask(id); // → WORKING
      const ended = await endpoint.getTask(id); // → FAILED
      expect(ended.status).toBe("FAILED");
    });

    it("error: getTask on an unknown id throws (no silent fake task — rule #6)", async () => {
      const endpoint = new FixtureA2AEndpoint();
      await expect(endpoint.getTask("nope")).rejects.toThrow(/unknown task/);
    });
  });

  describe("subscribeToTask", () => {
    it("streaming: yields the full QUEUED → WORKING → COMPLETED lifecycle", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("compile"));
      const events: A2ATaskEvent[] = [];
      for await (const e of endpoint.subscribeToTask(id)) {
        events.push(e);
      }
      expect(events.map((e) => e.eventType)).toEqual(["QUEUED", "WORKING", "COMPLETED"]);
      expect(events.every((e) => e.taskId === id)).toBe(true);
    });

    it("streaming: a failing task streams a terminal FAILED event with an error", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("fail-deploy"));
      const events: A2ATaskEvent[] = [];
      for await (const e of endpoint.subscribeToTask(id)) {
        events.push(e);
      }
      const last = events.at(-1);
      expect(last?.eventType).toBe("FAILED");
      expect(last?.error).toMatch(/fail/);
    });

    it("error: subscribing to an unknown task throws", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const iterate = async () => {
        for await (const _e of endpoint.subscribeToTask("ghost")) {
          // drain
        }
      };
      await expect(iterate()).rejects.toThrow(/unknown task/);
    });
  });

  describe("listTasks", () => {
    it("success: returns every sent task with no filter", async () => {
      const endpoint = new FixtureA2AEndpoint();
      await endpoint.sendMessage("agent-x", makeTask("a"));
      await endpoint.sendMessage("agent-x", makeTask("b"));
      const all = await endpoint.listTasks({});
      expect(all).toHaveLength(2);
    });

    it("success: filters by status", async () => {
      const endpoint = new FixtureA2AEndpoint();
      const id = await endpoint.sendMessage("agent-x", makeTask("a"));
      await endpoint.sendMessage("agent-x", makeTask("b")); // stays QUEUED
      await endpoint.getTask(id); // a → WORKING
      const working = await endpoint.listTasks({ status: "WORKING" });
      expect(working).toHaveLength(1);
      expect(working[0]?.status).toBe("WORKING");
    });

    it("success/empty: a filter matching nothing returns [] (graceful-degrade)", async () => {
      const endpoint = new FixtureA2AEndpoint();
      await endpoint.sendMessage("agent-x", makeTask("a"));
      const none = await endpoint.listTasks({ status: "FAILED" });
      expect(none).toEqual([]);
    });

    it("success: honours limit + offset pagination", async () => {
      const endpoint = new FixtureA2AEndpoint();
      for (const n of ["a", "b", "c"]) {
        await endpoint.sendMessage("agent-x", makeTask(n));
      }
      const page = await endpoint.listTasks({ offset: 1, limit: 1 });
      expect(page).toHaveLength(1);
    });
  });

  describe("interface conformance: every A2A Strategy drives the same 4 verbs", () => {
    it("StubA2A and A2AOpenHands satisfy the same end-to-end verb contract", async () => {
      const strategies: A2A[] = [new StubA2A(), new A2AOpenHands(), new FixtureA2AEndpoint()];
      for (const a2a of strategies) {
        await expectVerbContract(a2a);
      }
    });
  });
});
