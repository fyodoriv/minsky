/**
 * Slice 1 of `native-agent-teams-with-tiered-adapter`: pure capability
 * detection. Given the running agent identity, the `claude --version`
 * string, and the environment, decide which parallel-execution tier to
 * use. No I/O — the bin wires real values (agent id, `claude --version`
 * output, `process.env`); tests inject fakes (vision.md rule #2).
 *
 * Honesty boundary (slice 1): this detects the top tier
 * (`native-agent-teams`) and the safe fallbacks reliably. It deliberately
 * does NOT synthesise `native-agent-view` — the `claude --bg` / agent-view
 * probe is a later slice and over-claiming an unverified capability would
 * violate rule #6 (fail at the right boundary). Until that slice,
 * agent-view-capable hosts resolve to `native-subagents`, which is always
 * correct for Claude Code.
 */

import type { AgentCapabilityTier } from "./agent-team-backend.js";

/** Minimum Claude Code version that ships agent teams. */
export const AGENT_TEAMS_MIN_VERSION = "2.1.32" as const;

/** The env var that gates the experimental agent-teams feature. */
export const AGENT_TEAMS_ENV = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" as const;

export interface DetectAgentTeamsInput {
  /** Running agent identity, e.g. "claude" / "claude-code" / "devin". */
  readonly agent?: string | null;
  /** Raw `claude --version` output (may include extra text), or null. */
  readonly claudeVersion?: string | null;
  /** Environment snapshot (injected — never read process.env here). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface DetectAgentTeamsResult {
  readonly tier: AgentCapabilityTier;
  /** Human-readable decision trail (for the orchestrator log + tests). */
  readonly reasons: readonly string[];
}

/** True when the agent id denotes Claude Code. */
export function isClaudeCodeAgent(agent: string | null | undefined): boolean {
  if (typeof agent !== "string") return false;
  const a = agent.trim().toLowerCase();
  return a === "claude" || a === "claude-code" || a.startsWith("claude-code");
}

/**
 * Parse the first `MAJOR.MINOR.PATCH` triple out of a version string,
 * tolerating a leading `v` and trailing text like ` (Claude Code)`.
 */
export function parseSemver(
  raw: string | null | undefined,
): readonly [number, number, number] | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `a` >= `b` (both `MAJOR.MINOR.PATCH` numeric triples). */
export function semverGte(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 >= b2;
}

function envEnabled(v: string | undefined): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * Resolve the parallel-execution tier. Decision order:
 *
 * 1. Not Claude Code → `process-fan-out` (non-native fallback).
 * 2. Claude Code, but version < {@link AGENT_TEAMS_MIN_VERSION},
 *    unparseable, or the {@link AGENT_TEAMS_ENV} flag is off →
 *    `native-subagents` (always available in Claude Code).
 * 3. Claude Code + version OK + flag on → `native-agent-teams`.
 */
export function detectAgentTeamsSupport(input: DetectAgentTeamsInput): DetectAgentTeamsResult {
  const reasons: string[] = [];

  if (!isClaudeCodeAgent(input.agent)) {
    reasons.push(
      `agent=${String(input.agent ?? "unknown")} is not Claude Code → non-native fan-out`,
    );
    return { tier: "process-fan-out", reasons };
  }
  reasons.push("agent is Claude Code");

  const ver = parseSemver(input.claudeVersion);
  const min = parseSemver(AGENT_TEAMS_MIN_VERSION) as [number, number, number];
  if (ver === null) {
    reasons.push(
      `claude --version unparseable (${String(input.claudeVersion ?? "null")}) → native-subagents`,
    );
    return { tier: "native-subagents", reasons };
  }
  if (!semverGte(ver, min)) {
    reasons.push(`claude ${ver.join(".")} < ${AGENT_TEAMS_MIN_VERSION} → native-subagents`);
    return { tier: "native-subagents", reasons };
  }
  reasons.push(`claude ${ver.join(".")} >= ${AGENT_TEAMS_MIN_VERSION}`);

  const flag = input.env?.[AGENT_TEAMS_ENV];
  if (!envEnabled(flag)) {
    reasons.push(`${AGENT_TEAMS_ENV}=${String(flag ?? "unset")} (disabled) → native-subagents`);
    return { tier: "native-subagents", reasons };
  }
  reasons.push(`${AGENT_TEAMS_ENV} enabled`);

  return { tier: "native-agent-teams", reasons };
}
