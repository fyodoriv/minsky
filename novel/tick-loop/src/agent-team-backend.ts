/**
 * Slice 1 of `native-agent-teams-with-tiered-adapter`: the capability-tier
 * type + the `AgentTeamBackend` Strategy seam (vision.md rule #2 — every
 * dependency behind an interface). Implementations of this interface land
 * in later slices: `ClaudeAgentTeamsBackend` (the native coordinated
 * primitive), `ClaudeAgentViewBackend` (`claude --bg` isolated fan-out),
 * and `ProcessFanoutBackend` (the existing tick-loop worker spawn, kept
 * only for non-native agents). This module is pure types — no I/O — so it
 * is the stable contract the orchestrator selects against.
 */

/**
 * The parallel-execution capability tiers, highest first, matching the
 * operator's 2026-05-17 feature table:
 *
 * - `native-agent-teams` — Claude Code's experimental agent teams:
 *   lead + independent teammates, shared task list, mailbox, lifecycle
 *   hooks, file-locked task claiming (the *coordinated* tier).
 * - `native-agent-view` — `claude --bg` / agent-view: many isolated
 *   sessions, auto git-worktree per session, monitoring-only,
 *   fire-and-forget (the *high-parallelism / swarm* tier).
 * - `native-subagents` — in-session subagents (always available in
 *   Claude Code; report back to the caller only).
 * - `process-fan-out` — the hand-rolled tick-loop worker fan-out; the
 *   non-native fallback for Devin / aider / opencode / unknown agents.
 */
export type AgentCapabilityTier =
  | "native-agent-teams"
  | "native-agent-view"
  | "native-subagents"
  | "process-fan-out";

/** A teammate/worker identity within a team. */
export interface AgentTeammateRef {
  readonly name: string;
  readonly agentType?: string;
}

/** Spawn parameters for a single teammate. */
export interface SpawnTeammateInput {
  readonly name: string;
  readonly prompt: string;
  readonly model?: string;
  /** Optional subagent definition name to adopt as the teammate role. */
  readonly agentType?: string;
}

/**
 * The backend Strategy the orchestrator drives for parallel work. The
 * native implementations delegate to Claude Code's own team/task-list/
 * mailbox/hook machinery (rule #1 — do not reinvent what the runtime now
 * ships); the fallback wraps the existing process fan-out. Slice 1 only
 * defines the contract; methods are implemented per-backend in later
 * slices.
 */
export interface AgentTeamBackend {
  /** Which tier this backend implements. */
  readonly tier: AgentCapabilityTier;
  /** Create the shared team/coordination context. */
  createTeam(teamName: string): Promise<void>;
  /** Spawn one teammate; resolves with its assigned ref. */
  spawnTeammate(input: SpawnTeammateInput): Promise<AgentTeammateRef>;
  /** Assign a task id to a named teammate (lead-driven). */
  assignTask(taskId: string, teammate: string): Promise<void>;
  /** Self-claim the next unblocked task; resolves the claimed id or null. */
  claimTask(teammate: string): Promise<string | null>;
  /** Direct message from one agent to another by name. */
  message(to: string, body: string): Promise<void>;
  /** Register a callback for when a teammate goes idle. */
  onTeammateIdle(handler: (teammate: string) => void): void;
  /** Register a callback for when a task is marked complete. */
  onTaskCompleted(handler: (taskId: string) => void): void;
  /** Gracefully shut a teammate down. */
  shutdownTeammate(teammate: string): Promise<void>;
  /** Tear down shared team resources (lead only). */
  cleanupTeam(): Promise<void>;
}
