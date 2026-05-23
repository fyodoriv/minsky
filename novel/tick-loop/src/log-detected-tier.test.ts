import { describe, expect, it } from "vitest";

import type { DetectAgentTeamsResult } from "./detect-agent-teams-support.js";
import { TIER_LOG_PREFIX, formatTierLogLine } from "./log-detected-tier.js";

describe("formatTierLogLine", () => {
  it("renders the tier + the joined reasons for native-agent-teams", () => {
    const decision: DetectAgentTeamsResult = {
      tier: "native-agent-teams",
      reasons: [
        "agent is Claude Code",
        "claude 2.1.40 >= 2.1.32",
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS enabled",
      ],
    };

    expect(formatTierLogLine(decision)).toBe(
      'tick-loop: agent-team-tier=native-agent-teams reasons="agent is Claude Code | claude 2.1.40 >= 2.1.32 | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS enabled"',
    );
  });

  it("renders the process-fan-out fallback when the agent is non-Claude", () => {
    const decision: DetectAgentTeamsResult = {
      tier: "process-fan-out",
      reasons: ["agent=devin is not Claude Code → non-native fan-out"],
    };

    expect(formatTierLogLine(decision)).toBe(
      'tick-loop: agent-team-tier=process-fan-out reasons="agent=devin is not Claude Code → non-native fan-out"',
    );
  });

  it("renders native-subagents (the Claude-Code-without-flag fallback)", () => {
    const decision: DetectAgentTeamsResult = {
      tier: "native-subagents",
      reasons: [
        "agent is Claude Code",
        "claude 2.1.40 >= 2.1.32",
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=unset (disabled) → native-subagents",
      ],
    };

    expect(formatTierLogLine(decision)).toBe(
      'tick-loop: agent-team-tier=native-subagents reasons="agent is Claude Code | claude 2.1.40 >= 2.1.32 | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=unset (disabled) → native-subagents"',
    );
  });

  it("tolerates an empty reasons array (single-line, empty quoted string)", () => {
    const decision: DetectAgentTeamsResult = {
      tier: "process-fan-out",
      reasons: [],
    };

    expect(formatTierLogLine(decision)).toBe(
      'tick-loop: agent-team-tier=process-fan-out reasons=""',
    );
  });

  it("joins multi-reason arrays with ' | ' separator (grep-friendly single record)", () => {
    const decision: DetectAgentTeamsResult = {
      tier: "native-agent-teams",
      reasons: ["r1", "r2", "r3"],
    };

    expect(formatTierLogLine(decision)).toBe(
      'tick-loop: agent-team-tier=native-agent-teams reasons="r1 | r2 | r3"',
    );
  });

  it("always emits TIER_LOG_PREFIX at the start (Splunk/grep key)", () => {
    const decision: DetectAgentTeamsResult = {
      tier: "native-subagents",
      reasons: ["x"],
    };

    expect(formatTierLogLine(decision).startsWith(TIER_LOG_PREFIX)).toBe(true);
    expect(TIER_LOG_PREFIX).toBe("tick-loop: agent-team-tier=");
  });
});
