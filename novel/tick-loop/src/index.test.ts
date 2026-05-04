/**
 * Tests for `@minsky/tick-loop` — sub-task 2/3 of `first-integration-test`.
 *
 * Coverage targets (parent task Verification cell):
 *   1. Single tick succeeds  — `tick(...)` returns `status: 'completed'`.
 *   2. Tick respects mock-anthropic 5xx — `status: 'failed'` (chaos branch).
 *   3. Smoke runs 4 ticks within budget.
 *   4. ≥1 OTEL span per tick (in-memory `SpanRecorder` substitutes for the
 *      real collector).
 *
 * Plus a few extra cases for the chaos table rows declared in `README.md`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type MockAnthropicClient,
  type MockAnthropicRequest,
  type MockAnthropicResponse,
  SpanRecorder,
  TestFakeMockAnthropic,
  type TickSpan,
  parseFixtureTaskIds,
  runSmoke,
  tick,
} from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, "../test/fixtures/synthetic-tasks.md");

describe("tick-loop / tick", () => {
  it("single tick succeeds — status: 'completed' (failure-mode row 0)", async () => {
    const client = new TestFakeMockAnthropic();
    const result = await tick({
      taskId: "smoke-task-one",
      prompt: "anything",
      client,
      now: makeFakeClock([0, 5]),
    });
    expect(result.status).toBe("completed");
    expect(result.taskId).toBe("smoke-task-one");
    expect(result.spanName).toBe("tick-loop.tick");
    expect(result.durationMs).toBe(5);
    expect(result.output).toBe("mock-success");
  });

  it("tick respects mock-anthropic 5xx — status: 'failed' (chaos row 1: mock-anthropic-error)", async () => {
    const client = new TestFakeMockAnthropic({ failureMode: "http-5xx" });
    const result = await tick({
      taskId: "smoke-task-two",
      prompt: "anything",
      client,
    });
    expect(result.status).toBe("failed");
    expect(result.output).toContain("5xx");
  });

  it("emits one OTEL span per tick (failure-mode row: observability)", async () => {
    const client = new TestFakeMockAnthropic();
    const recorder = new SpanRecorder();
    await tick({
      taskId: "smoke-task-one",
      prompt: "anything",
      client,
      emit: (e) => recorder.record(e),
    });
    expect(recorder.spans).toHaveLength(1);
    const first = recorder.spans[0] as TickSpan;
    expect(first.name).toBe("tick-loop.tick");
    expect(first.attributes["task.id"]).toBe("smoke-task-one");
    expect(first.attributes["tick.status"]).toBe("completed");
  });

  it("maps client rejection to status: 'failed' without throwing (chaos row 2: lease-expiry mid-tick)", async () => {
    const client: MockAnthropicClient = {
      respond: async (_req: MockAnthropicRequest): Promise<MockAnthropicResponse> => {
        // Simulate a lease-expiry mid-tick — the upstream throws.
        throw new Error("lease-expired");
      },
    };
    const result = await tick({
      taskId: "smoke-task-three",
      prompt: "x",
      client,
    });
    expect(result.status).toBe("failed");
    expect(result.output).toContain("lease-expired");
  });

  it("malformed-output mode returns success status with garbage payload (chaos row 3: malformed-task fixture)", async () => {
    const client = new TestFakeMockAnthropic({ failureMode: "malformed-output" });
    const result = await tick({
      taskId: "smoke-task-four",
      prompt: "x",
      client,
    });
    // The mock returns success at the transport layer, but the output is
    // garbage — downstream code MUST validate. The tick itself reports
    // 'completed' because the transport said 200 OK.
    expect(result.status).toBe("completed");
    expect(result.output).toBe("<<<MALFORMED>>>");
  });
});

describe("tick-loop / runSmoke", () => {
  it("runs 4 ticks within budget against the synthetic fixture", async () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf-8");
    const taskIds = parseFixtureTaskIds(fixture);
    expect(taskIds).toHaveLength(4);

    const client = new TestFakeMockAnthropic();
    const result = await runSmoke({
      client,
      taskIds,
      now: makeFakeClock(stepClock(10, 20)),
      budgetMs: 60_000,
      maxTicks: 4,
    });
    expect(result.results).toHaveLength(4);
    expect(result.results.every((r) => r.status === "completed")).toBe(true);
    expect(result.budgetExhausted).toBe(false);
    expect(result.totalDurationMs).toBeLessThanOrEqual(60_000);
  });

  it("emits ≥1 span per tick across the smoke run", async () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf-8");
    const taskIds = parseFixtureTaskIds(fixture);
    const client = new TestFakeMockAnthropic();
    const recorder = new SpanRecorder();
    await runSmoke({
      client,
      taskIds,
      emit: (e) => recorder.record(e),
      budgetMs: 60_000,
    });
    // One span per tick = one per task.
    expect(recorder.spans.length).toBeGreaterThanOrEqual(taskIds.length);
    const distinctTaskIds = new Set(recorder.spans.map((s) => s.attributes["task.id"]));
    expect(distinctTaskIds.size).toBe(taskIds.length);
  });

  it("halts when wall-clock budget is exhausted (chaos row: budget-exhaustion)", async () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf-8");
    const taskIds = parseFixtureTaskIds(fixture);
    const client = new TestFakeMockAnthropic();
    // Clock that jumps past the budget on the second sample so the loop
    // halts after one tick. Sequence: start=0; pre-loop guard before tick
    // 1=0; tick1 start/end=1,2; pre-loop guard before tick 2=10_000 (≥
    // budget) → halt; final totalDurationMs sample=10_000.
    const result = await runSmoke({
      client,
      taskIds,
      budgetMs: 5,
      now: makeFakeClock([0, 0, 1, 2, 10_000, 10_000]),
    });
    expect(result.budgetExhausted).toBe(true);
    expect(result.results.length).toBeLessThan(taskIds.length);
  });

  it("respects maxTicks cap below taskIds.length", async () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf-8");
    const taskIds = parseFixtureTaskIds(fixture);
    const client = new TestFakeMockAnthropic();
    const result = await runSmoke({ client, taskIds, maxTicks: 2 });
    expect(result.results).toHaveLength(2);
    expect(result.budgetExhausted).toBe(false);
  });
});

describe("tick-loop / parseFixtureTaskIds", () => {
  it("extracts every **ID** marker from the synthetic fixture", () => {
    const fixture = readFileSync(FIXTURE_PATH, "utf-8");
    const ids = parseFixtureTaskIds(fixture);
    expect(ids).toEqual([
      "smoke-task-one",
      "smoke-task-two",
      "smoke-task-three",
      "smoke-task-four",
    ]);
  });

  it("returns empty array for source with no markers (malformed-task fixture)", () => {
    expect(parseFixtureTaskIds("# no markers here")).toEqual([]);
  });
});

// ---- helpers --------------------------------------------------------------

function makeFakeClock(samples: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = samples[i] ?? samples[samples.length - 1] ?? 0;
    i++;
    return v;
  };
}

/** Generate a sequence: [0, step, step*2, …] of given length. */
function stepClock(step: number, length: number): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(i * step);
  return out;
}
