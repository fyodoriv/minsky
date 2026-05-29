/**
 * A2A adapter — interface (Adapter pattern, Gamma 1994) + a
 * `StubA2A` test fake (Meszaros 2007) + an `A2AOpenHands` implementation
 * (sibling file `./a2a.openhands.ts`).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral)
 *                            per Gamma, Helm, Johnson, Vlissides,
 *                            *Design Patterns*, 1994. Conformance: full.
 *   - `StubA2A`:             Test fake / spy hybrid per Meszaros, *xUnit
 *                            Test Patterns*, 2007 — records calls in-memory
 *                            and returns fixed values so tests
 *                            can assert request shape without a network.
 *                            Conformance: full.
 *   - `A2AOpenHands.selfTest`:   Health-probe shape — re-uses
 *                            {@link SelfTestResult} from `@minsky/adapter-types`
 *                            (leaf package per Martin, *Clean Architecture*,
 *                            2017 — acyclic dependency principle).
 *
 * Why an A2A adapter (rule #2): Minsky composes A2A as a dependency, contributing
 * back upstream on streaming + artifact + task-lifecycle feedback (rule #1 — don't reinvent).
 * The adapter exposes 4 verbs to Minsky's substrate:
 * `sendMessage(target, task) → taskId`, `getTask(taskId) → Task`,
 * `subscribeToTask(taskId) → AsyncIterable<TaskEvent>`, `listTasks(filter) → Task[]`.
 *
 * Anchors:
 *   - Hunt, A., Thomas, D., *The Pragmatic Programmer*, Addison-Wesley,
 *     1999, Tip 32 ("Crash Early — but the crash needs to reach the
 *     operator"); a notifier is the operator-facing channel that turns
 *     a let-it-crash event into actionable feedback.
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
 *     dependency principle — `@minsky/adapter-types` is the leaf).
 */

// Re-export the shared health-probe contract from the leaf types package so
// callers can keep doing `import { type SelfTestResult } from "@minsky/a2a"`
// without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * A2A Task - a task that can be sent via the A2A protocol
 */
export interface A2ATask {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status: "QUEUED" | "WORKING" | "COMPLETED" | "FAILED";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A2A Task Event - represents lifecycle events for a task
 */
export interface A2ATaskEvent {
  readonly taskId: string;
  readonly eventType: "QUEUED" | "WORKING" | "COMPLETED" | "FAILED" | "CANCELLED";
  readonly timestamp: string;
  readonly data?: unknown;
  readonly error?: string;
}

/**
 * A2A Task Filter - used to filter tasks when listing
 */
export interface A2ATaskFilter {
  readonly status?: "QUEUED" | "WORKING" | "COMPLETED" | "FAILED";
  readonly name?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * A2A adapter interface — Adapter pattern (Gamma et al., *Design
 * Patterns*, 1994). Strategy implementations live in sibling files
 * (e.g. {@link "./a2a.openhands".A2AOpenHands}).
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; the `minsky
 * doctor` aggregation runs each adapter's `selfTest()` via
 * `aggregateStatus()` from `@minsky/adapter-types`.
 */
export interface A2A {
  /**
   * Send a message to a target agent with a task
   * @param target - The target agent identifier
   * @param task - The task to send
   * @returns The task ID
   */
  sendMessage(target: string, task: A2ATask): Promise<string>;

  /**
   * Get a task by its ID
   * @param taskId - The task ID
   * @returns The task
   */
  getTask(taskId: string): Promise<A2ATask>;

  /**
   * Subscribe to task events for a specific task
   * @param taskId - The task ID
   * @returns Async iterable of task events
   */
  subscribeToTask(taskId: string): AsyncIterable<A2ATaskEvent>;

  /**
   * List tasks based on filter criteria
   * @param filter - The filter criteria
   * @returns Array of tasks
   */
  listTasks(filter: A2ATaskFilter): Promise<A2ATask[]>;

  /**
   * Perform a self-test of the A2A adapter
   * @returns Self test result
   */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * In-memory `A2A` for tests. Records every call's payload in order
 * (FIFO — first call is `calls[0]`) and returns fixed values.
 * Pattern: test fake per Meszaros, *xUnit Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the stub has
 * no I/O so any other status would be a lie.
 *
 * @example
 *   const stub = new StubA2A();
 *   await daemon.run({ a2a: stub });
 *   expect(stub.calls).toHaveLength(1);
 */
export class StubA2A implements A2A {
  private readonly recorded: { method: string; args: unknown[] }[] = [];

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly { method: string; args: unknown[] }[] {
    return this.recorded;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async sendMessage(target: string, task: A2ATask): Promise<string> {
    this.recorded.push({ method: "sendMessage", args: [target, task] });
    return `task-${Date.now()}`;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async getTask(taskId: string): Promise<A2ATask> {
    this.recorded.push({ method: "getTask", args: [taskId] });
    return {
      id: taskId,
      name: "stub-task",
      description: "stub task for testing",
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async *subscribeToTask(taskId: string): AsyncIterable<A2ATaskEvent> {
    this.recorded.push({ method: "subscribeToTask", args: [taskId] });
    // Yield a simple completed event
    yield {
      taskId,
      eventType: "COMPLETED",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async listTasks(filter: A2ATaskFilter): Promise<A2ATask[]> {
    this.recorded.push({ method: "listTasks", args: [filter] });
    return [];
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design, no value in a span
   */
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: "StubA2A — no I/O; recorded calls available via .calls",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Drop all recorded calls. Useful between test cases when the same
   * fixture is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
  }
}

// Re-export the OpenHands Strategy from the sibling module so consumers can
// `import { A2AOpenHands } from "@minsky/a2a"` without reaching for
// the `/a2a.openhands` subpath (mirrors `@minsky/token-monitor`'s pattern of
// re-exporting the Strategy from `index.ts`).
export { A2AOpenHands } from "./a2a.openhands.js";
