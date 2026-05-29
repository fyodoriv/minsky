/**
 * A2A adapter implementation for OpenHands (Strategy per Gamma et al. 1994).
 *
 * SCAFFOLD STATUS (2026-05-29): the four verbs are wired against a
 * deterministic in-process mock — they return well-formed `A2ATask` /
 * `A2ATaskEvent` shapes so the interface, the `StubA2A` fake, and downstream
 * consumers can be built + tested NOW. The real bridge (spawn the
 * google-a2a-python SDK via `child_process`) ships when the OpenHands runtime
 * lands — gated to 2026-06-01 per `competitors/openhands.md` and the
 * `AGENT_MATRIX` `pendingExternalDep`. Until then `runViaPythonBridge` returns
 * mock data and `selfTest()` reports `yellow` (scaffold present, real bridge
 * pending) so the operator is never told a non-existent integration is healthy.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994 (Strategy).
 *   - Helland, P., "Building on Quicksand", 2009 (visible-not-silent — a
 *     scaffold reports `yellow`, not a false `green`).
 */

import type { SelfTestResult } from "@minsky/adapter-types";
import type { A2A, A2ATask, A2ATaskEvent, A2ATaskFilter } from "./index.js";

/** Shape returned by the (currently mocked) Python A2A bridge. */
interface BridgeResult {
  readonly task_id?: string;
  readonly task?: A2ATask;
  readonly events?: readonly A2ATaskEvent[];
  readonly tasks?: readonly A2ATask[];
}

/**
 * A2A adapter implementation for OpenHands. See file header for SCAFFOLD
 * STATUS — the real Python bridge is pending the 2026-06-01 OpenHands runtime.
 */
export class A2AOpenHands implements A2A {
  /**
   * @otel a2a.send-message
   */
  async sendMessage(target: string, task: A2ATask): Promise<string> {
    const result = await this.runViaPythonBridge("send_message", { target, task });
    return result.task_id ?? `task-${Date.now()}`;
  }

  /**
   * @otel a2a.get-task
   */
  async getTask(taskId: string): Promise<A2ATask> {
    const result = await this.runViaPythonBridge("get_task", { task_id: taskId });
    if (result.task === undefined) {
      throw new Error(`A2AOpenHands.getTask: bridge returned no task for ${taskId}`);
    }
    return result.task;
  }

  /**
   * @otel a2a.subscribe-to-task
   */
  async *subscribeToTask(taskId: string): AsyncIterable<A2ATaskEvent> {
    const result = await this.runViaPythonBridge("subscribe_to_task", { task_id: taskId });
    for (const event of result.events ?? []) {
      yield event;
    }
  }

  /**
   * @otel a2a.list-tasks
   */
  async listTasks(filter: A2ATaskFilter): Promise<A2ATask[]> {
    const result = await this.runViaPythonBridge("list_tasks", { filter });
    return [...(result.tasks ?? [])];
  }

  /**
   * Mock stand-in for the google-a2a-python bridge. Real implementation
   * (pending 2026-06-01) spawns `python3 node_modules/google-a2a-python/
   * a2a_client.py`, writes `{command, args}` to stdin, and parses the JSON
   * response.
   *
   * @otel-exempt internal bridge — the public verb's span (@otel a2a.*) covers the call; a nested span would double-count
   */
  private async runViaPythonBridge(
    command: string,
    _args: Record<string, unknown>,
  ): Promise<BridgeResult> {
    const now = new Date().toISOString();
    switch (command) {
      case "send_message":
        return { task_id: `task-${Date.now()}` };
      case "get_task":
        return {
          task: {
            id: `task-${Date.now()}`,
            name: "scaffold-task",
            description: "mock task — real bridge pending 2026-06-01",
            status: "COMPLETED",
            createdAt: now,
            updatedAt: now,
          },
        };
      case "subscribe_to_task":
        return {
          events: [{ taskId: `task-${Date.now()}`, eventType: "COMPLETED", timestamp: now }],
        };
      case "list_tasks":
        return { tasks: [] };
      default:
        return {};
    }
  }

  /**
   * @otel a2a.self-test
   */
  async selfTest(): Promise<SelfTestResult> {
    const startTime = Date.now();
    try {
      await this.runViaPythonBridge("ping", {});
      return {
        status: "yellow",
        message:
          "A2AOpenHands — scaffold healthy; real google-a2a-python bridge pending 2026-06-01 OpenHands runtime",
        latencyMs: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
      // rule-6: handled-locally — selfTest is the supervisor's health probe; it converts a crash into a `red` verdict (the probe's contract) rather than re-throw and take down the doctor aggregation that calls it.
    } catch (error) {
      return {
        status: "red",
        message: `A2AOpenHands adapter failed self-test: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
    }
  }
}
