import { describe, expect, it } from "vitest";

import {
  AGENT_TEAMS_ENV,
  AGENT_TEAMS_MIN_VERSION,
  detectAgentTeamsSupport,
  isClaudeCodeAgent,
  parseSemver,
  semverGte,
} from "./detect-agent-teams-support.js";

describe("isClaudeCodeAgent", () => {
  it("recognises claude / claude-code (any case) and the prefixed form", () => {
    expect(isClaudeCodeAgent("claude")).toBe(true);
    expect(isClaudeCodeAgent("claude-code")).toBe(true);
    expect(isClaudeCodeAgent("Claude-Code")).toBe(true);
    expect(isClaudeCodeAgent("claude-code-cli")).toBe(true);
    expect(isClaudeCodeAgent("  claude  ")).toBe(true);
  });

  it("rejects non-Claude / empty / non-string identities", () => {
    expect(isClaudeCodeAgent("devin")).toBe(false);
    expect(isClaudeCodeAgent("aider")).toBe(false);
    expect(isClaudeCodeAgent("")).toBe(false);
    expect(isClaudeCodeAgent(null)).toBe(false);
    expect(isClaudeCodeAgent(undefined)).toBe(false);
  });
});

describe("parseSemver", () => {
  it("extracts the first MAJOR.MINOR.PATCH triple, tolerating noise", () => {
    expect(parseSemver("2.1.32")).toEqual([2, 1, 32]);
    expect(parseSemver("v2.1.32")).toEqual([2, 1, 32]);
    expect(parseSemver("2.1.32 (Claude Code)")).toEqual([2, 1, 32]);
    expect(parseSemver("claude 10.20.300 build")).toEqual([10, 20, 300]);
  });

  it("returns null for unparseable / non-string input", () => {
    expect(parseSemver("garbage")).toBeNull();
    expect(parseSemver("2.1")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver(null)).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });
});

describe("semverGte", () => {
  it("compares MAJOR.MINOR.PATCH numerically", () => {
    expect(semverGte([2, 1, 32], [2, 1, 32])).toBe(true);
    expect(semverGte([2, 1, 33], [2, 1, 32])).toBe(true);
    expect(semverGte([2, 1, 31], [2, 1, 32])).toBe(false);
    expect(semverGte([2, 2, 0], [2, 1, 32])).toBe(true);
    expect(semverGte([2, 0, 99], [2, 1, 32])).toBe(false);
    expect(semverGte([3, 0, 0], [2, 1, 32])).toBe(true);
    expect(semverGte([1, 9, 9], [2, 1, 32])).toBe(false);
  });
});

describe("detectAgentTeamsSupport", () => {
  it("non-Claude agent → process-fan-out", () => {
    const r = detectAgentTeamsSupport({ agent: "devin" });
    expect(r.tier).toBe("process-fan-out");
    expect(r.reasons.join(" ")).toContain("not Claude Code");
  });

  it("unknown/missing agent → process-fan-out", () => {
    expect(detectAgentTeamsSupport({}).tier).toBe("process-fan-out");
  });

  it("Claude Code + unparseable version → native-subagents", () => {
    const r = detectAgentTeamsSupport({
      agent: "claude",
      claudeVersion: "unknown",
      env: { [AGENT_TEAMS_ENV]: "1" },
    });
    expect(r.tier).toBe("native-subagents");
    expect(r.reasons.join(" ")).toContain("unparseable");
  });

  it("Claude Code + version below minimum → native-subagents", () => {
    const r = detectAgentTeamsSupport({
      agent: "claude",
      claudeVersion: "2.1.31",
      env: { [AGENT_TEAMS_ENV]: "1" },
    });
    expect(r.tier).toBe("native-subagents");
    expect(r.reasons.join(" ")).toContain(`< ${AGENT_TEAMS_MIN_VERSION}`);
  });

  it("Claude Code + exact minimum version + flag on → native-agent-teams", () => {
    const r = detectAgentTeamsSupport({
      agent: "claude-code",
      claudeVersion: `${AGENT_TEAMS_MIN_VERSION} (Claude Code)`,
      env: { [AGENT_TEAMS_ENV]: "1" },
    });
    expect(r.tier).toBe("native-agent-teams");
  });

  it("Claude Code + newer version + flag on → native-agent-teams", () => {
    expect(
      detectAgentTeamsSupport({
        agent: "claude",
        claudeVersion: "2.5.0",
        env: { [AGENT_TEAMS_ENV]: "true" },
      }).tier,
    ).toBe("native-agent-teams");
  });

  it("accepts the documented truthy flag spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        detectAgentTeamsSupport({
          agent: "claude",
          claudeVersion: "3.0.0",
          env: { [AGENT_TEAMS_ENV]: v },
        }).tier,
      ).toBe("native-agent-teams");
    }
  });

  it("Claude Code + good version but flag off/unset → native-subagents", () => {
    for (const v of ["0", "false", "", undefined]) {
      const r = detectAgentTeamsSupport({
        agent: "claude",
        claudeVersion: "2.9.9",
        env: { [AGENT_TEAMS_ENV]: v },
      });
      expect(r.tier).toBe("native-subagents");
      expect(r.reasons.join(" ")).toContain("disabled");
    }
  });

  it("always returns a non-empty decision trail", () => {
    expect(
      detectAgentTeamsSupport({ agent: "claude", claudeVersion: "2.1.32" }).reasons.length,
    ).toBeGreaterThan(0);
  });
});
