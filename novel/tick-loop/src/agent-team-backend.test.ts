import { describe, expect, it } from "vitest";

import type { AgentCapabilityTier, AgentTeamBackend } from "./agent-team-backend.js";

// A minimal conforming implementation. Its only job is to make the
// `AgentTeamBackend` contract a compile-time guard (slice 1 ships the
// seam; real backends land in later slices) and to exercise the shape.
class MockBackend implements AgentTeamBackend {
  readonly tier: AgentCapabilityTier = "process-fan-out";
  readonly log: string[] = [];
  private idleHandler?: (t: string) => void;
  private doneHandler?: (id: string) => void;

  async createTeam(teamName: string): Promise<void> {
    this.log.push(`createTeam:${teamName}`);
  }
  async spawnTeammate(input: {
    name: string;
    prompt: string;
  }): Promise<{ name: string }> {
    this.log.push(`spawn:${input.name}`);
    return { name: input.name };
  }
  async assignTask(taskId: string, teammate: string): Promise<void> {
    this.log.push(`assign:${taskId}->${teammate}`);
  }
  async claimTask(teammate: string): Promise<string | null> {
    this.log.push(`claim:${teammate}`);
    return null;
  }
  async message(to: string, body: string): Promise<void> {
    this.log.push(`msg:${to}:${body}`);
  }
  onTeammateIdle(handler: (t: string) => void): void {
    this.idleHandler = handler;
  }
  onTaskCompleted(handler: (id: string) => void): void {
    this.doneHandler = handler;
  }
  async shutdownTeammate(teammate: string): Promise<void> {
    this.log.push(`shutdown:${teammate}`);
  }
  async cleanupTeam(): Promise<void> {
    this.log.push("cleanup");
  }
  fireIdle(t: string): void {
    this.idleHandler?.(t);
  }
  fireDone(id: string): void {
    this.doneHandler?.(id);
  }
}

describe("AgentTeamBackend contract", () => {
  it("a conforming backend exercises the full seam", async () => {
    const b = new MockBackend();
    await b.createTeam("t1");
    const mate = await b.spawnTeammate({ name: "reviewer", prompt: "go" });
    expect(mate.name).toBe("reviewer");
    await b.assignTask("task-a", "reviewer");
    expect(await b.claimTask("reviewer")).toBeNull();
    await b.message("reviewer", "ping");
    await b.shutdownTeammate("reviewer");
    await b.cleanupTeam();
    expect(b.log).toEqual([
      "createTeam:t1",
      "spawn:reviewer",
      "assign:task-a->reviewer",
      "claim:reviewer",
      "msg:reviewer:ping",
      "shutdown:reviewer",
      "cleanup",
    ]);
  });

  it("delivers idle + task-completed callbacks", () => {
    const b = new MockBackend();
    const seen: string[] = [];
    b.onTeammateIdle((t) => seen.push(`idle:${t}`));
    b.onTaskCompleted((id) => seen.push(`done:${id}`));
    b.fireIdle("reviewer");
    b.fireDone("task-a");
    expect(seen).toEqual(["idle:reviewer", "done:task-a"]);
  });

  it("tier is one of the four known values", () => {
    const tiers: AgentCapabilityTier[] = [
      "native-agent-teams",
      "native-agent-view",
      "native-subagents",
      "process-fan-out",
    ];
    expect(tiers).toContain(new MockBackend().tier);
  });
});
