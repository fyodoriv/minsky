import { describe, expect, it } from "vitest";
import {
  AUTO_SCALE_RUNNER_DEFAULTS,
  AutoScaleRunner,
  type ObservableEvent,
} from "./auto-scale-runner.js";

function makeIterationEvent(attributes: Record<string, unknown> = {}): ObservableEvent {
  return {
    name: "tick-loop.iteration",
    attributes: {
      "iteration.status": "completed",
      "iteration.reason": "ok",
      ...attributes,
    },
  };
}

describe("AutoScaleRunner", () => {
  it("doesn't spawn before evalEveryN iterations", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    for (let i = 0; i < 4; i++) runner.observeEvent(makeIterationEvent());
    expect(spawnCalls).toHaveLength(0);
  });

  it("spawns on the Nth iteration when conditions are favourable", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    for (let i = 0; i < 5; i++) runner.observeEvent(makeIterationEvent());
    expect(spawnCalls).toEqual([{ workerId: 1, totalAfter: 2 }]);
  });

  it("doesn't spawn when ceiling reached", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 1,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    for (let i = 0; i < 5; i++) runner.observeEvent(makeIterationEvent());
    expect(spawnCalls).toHaveLength(0);
  });

  it("doesn't spawn when budget is paused", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "weekly-cap-paused",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    for (let i = 0; i < 5; i++) runner.observeEvent(makeIterationEvent());
    expect(spawnCalls).toHaveLength(0);
  });

  it("ramps from 1 to maxWorkers across multiple eval cycles", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 4,
      initialWorkers: 1,
      getEligibleTaskCount: () => 100,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    // 5 iterations × 4 (to spawn 4 times → total 5? no, max is 4)
    for (let i = 0; i < 25; i++) runner.observeEvent(makeIterationEvent());
    expect(spawnCalls).toEqual([
      { workerId: 1, totalAfter: 2 },
      { workerId: 2, totalAfter: 3 },
      { workerId: 3, totalAfter: 4 },
      // Cap at 4 — no more spawns
    ]);
  });

  it("counts failed iterations from event attributes", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    // 3 failed iterations → trips system-unstable threshold (>= 3) → hold.
    runner.observeEvent(makeIterationEvent({ "iteration.status": "failed" }));
    runner.observeEvent(makeIterationEvent({ "iteration.status": "failed" }));
    runner.observeEvent(makeIterationEvent({ "iteration.status": "failed" }));
    runner.observeEvent(makeIterationEvent());
    runner.observeEvent(makeIterationEvent());
    expect(spawnCalls).toHaveLength(0);
  });

  it("counts collision-prevented from iteration.reason", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    // 5 collision-prevented → trips contention-high threshold (>= 5) → hold.
    for (let i = 0; i < 5; i++) {
      runner.observeEvent(
        makeIterationEvent({ "iteration.reason": "claim-collision-prevented-by-PR-#1" }),
      );
    }
    expect(spawnCalls).toHaveLength(0);
  });

  it("decays counters every decayEveryN iterations", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 999, // never auto-eval; test the decay only via getState
      decayEveryN: 4,
    });
    runner.observeEvent(makeIterationEvent({ "iteration.status": "failed" }));
    runner.observeEvent(makeIterationEvent({ "iteration.status": "failed" }));
    expect(runner.getState().recentFailedIterations).toBe(2);
    runner.observeEvent(makeIterationEvent());
    runner.observeEvent(makeIterationEvent()); // 4th — decay fires
    expect(runner.getState().recentFailedIterations).toBe(1); // halved
  });

  it("ignores non-iteration events", () => {
    const spawnCalls: { workerId: number; totalAfter: number }[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: (input) => {
        spawnCalls.push(input);
      },
      evalEveryN: 5,
    });
    for (let i = 0; i < 10; i++) {
      runner.observeEvent({
        name: "tick-loop.dispatch",
        attributes: {},
      });
    }
    // No spawn — these aren't iteration spans.
    expect(spawnCalls).toHaveLength(0);
  });

  it("emits a tick-loop.auto-scale.decision span on every eval", () => {
    const spans: ObservableEvent[] = [];
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 1,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: () => {},
      emit: (s) => spans.push(s),
      evalEveryN: 5,
    });
    for (let i = 0; i < 10; i++) runner.observeEvent(makeIterationEvent());
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.name).toBe("tick-loop.auto-scale.decision");
      expect(["spawn", "hold"]).toContain(span.attributes["verdict"]);
      expect(typeof span.attributes["reason"]).toBe("string");
      expect(typeof span.attributes["auto-scale.currentWorkers"]).toBe("number");
    }
  });

  it("getState exposes the current state including iterationsSinceLastEval", () => {
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 2,
      getEligibleTaskCount: () => 7,
      getBudgetState: () => "normal",
      spawn: () => {},
      evalEveryN: 99,
    });
    runner.observeEvent(makeIterationEvent());
    runner.observeEvent(makeIterationEvent());
    const state = runner.getState();
    expect(state).toMatchObject({
      currentWorkers: 2,
      maxWorkers: 5,
      eligibleTaskCount: 7,
      iterationsSinceLastEval: 2,
    });
  });

  it("starts at initialWorkers (e.g., when CLI passes --workers-total=2)", () => {
    const runner = new AutoScaleRunner({
      maxWorkers: 5,
      initialWorkers: 3,
      getEligibleTaskCount: () => 10,
      getBudgetState: () => "normal",
      spawn: () => {},
      evalEveryN: 99,
    });
    expect(runner.getState().currentWorkers).toBe(3);
  });

  it("AUTO_SCALE_RUNNER_DEFAULTS is frozen and declares the documented cadences", () => {
    expect(Object.isFrozen(AUTO_SCALE_RUNNER_DEFAULTS)).toBe(true);
    expect(AUTO_SCALE_RUNNER_DEFAULTS.evalEveryNIterations).toBe(5);
    expect(AUTO_SCALE_RUNNER_DEFAULTS.decayEveryNIterations).toBe(10);
  });
});
