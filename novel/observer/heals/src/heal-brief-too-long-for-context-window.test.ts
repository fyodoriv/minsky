// Tests for heal-brief-too-long-for-context-window
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import * as heal from "./heal-brief-too-long-for-context-window.js";
import type { BriefTooLongSeams } from "./heal-brief-too-long-for-context-window.js";

function makeSeams(overrides: Partial<BriefTooLongSeams> = {}): {
  seams: BriefTooLongSeams;
  rebuildCalls: Array<{ maxTokens: number; path: string }>;
  setByteCount: (n: number) => void;
} {
  const rebuildCalls: Array<{ maxTokens: number; path: string }> = [];
  let byteCount = 0;
  const seams: BriefTooLongSeams = {
    stderr: "",
    briefFilePath: "/tmp/brief.md",
    rebuildFn: (maxTokens, path) => {
      rebuildCalls.push({ maxTokens, path });
    },
    briefByteCountFn: () => byteCount,
    ...overrides,
  };
  return {
    seams,
    rebuildCalls,
    setByteCount: (n) => {
      byteCount = n;
    },
  };
}

describe("heal-brief-too-long-for-context-window", () => {
  test.each([
    "Error: context window exceeded",
    "input too long for context window",
    'BadRequestError: {"error":{"code":"context_length_exceeded"}}',
    "prompt_tokens (250000) > model_max_input_tokens (200000)",
    "Anthropic: maximum context length is 200000 tokens",
    "Error: maximum context length is 128000 tokens",
    "context length exceeded",
  ])("detects context-window-exceeded signal in stderr: %s", (stderr) => {
    const { seams } = makeSeams({ stderr });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("brief-too-long-for-context-window");
    }
  });

  test.each([
    "",
    "429 too many requests",
    "ECONNREFUSED 127.0.0.1:11434",
    "MODULE_NOT_FOUND",
    "ETIMEDOUT during TLS handshake",
  ])("does NOT detect on non-context-window stderr: %s", (stderr) => {
    const { seams } = makeSeams({ stderr });
    expect(heal.detect(seams).present).toBe(false);
  });

  test("apply invokes rebuildFn with DEFAULT_MAX_TOKENS and the brief path", () => {
    const fixture = makeSeams({
      stderr: "context window exceeded",
      briefFilePath: "/tmp/brief-x.md",
    });
    const result = heal.apply(fixture.seams);
    expect(result.applied).toBe(true);
    expect(fixture.rebuildCalls).toEqual([{ maxTokens: 100_000, path: "/tmp/brief-x.md" }]);
    expect(result.changedFiles).toEqual(["/tmp/brief-x.md"]);
    expect(result.notes).toContain("max-tokens=100000");
  });

  test("apply honors injected custom maxTokens", () => {
    const fixture = makeSeams({
      stderr: "input too long",
      maxTokens: 32_000,
    });
    heal.apply(fixture.seams);
    expect(fixture.rebuildCalls[0]?.maxTokens).toBe(32_000);
  });

  test("apply is a no-op when stderr has no context-window signal", () => {
    const fixture = makeSeams({ stderr: "ECONNRESET" });
    const result = heal.apply(fixture.seams);
    expect(result.applied).toBe(false);
    expect(fixture.rebuildCalls).toEqual([]);
    expect(result.notes).toContain("no-op");
  });

  test("verify returns healed when regenerated brief is within byte budget", () => {
    const fixture = makeSeams({ maxTokens: 100_000 });
    fixture.setByteCount(300_000); // 100k tokens × 4 bytes/token = 400k budget
    expect(heal.verify(fixture.seams).healed).toBe(true);
  });

  test("verify returns healed at exactly the byte budget boundary", () => {
    const fixture = makeSeams({ maxTokens: 100_000 });
    fixture.setByteCount(400_000); // exactly at budget
    expect(heal.verify(fixture.seams).healed).toBe(true);
  });

  test("verify returns not-healed when brief is still over budget", () => {
    const fixture = makeSeams({ maxTokens: 100_000 });
    fixture.setByteCount(500_000); // 100k bytes over budget
    const result = heal.verify(fixture.seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("brief-too-long-for-context-window");
    }
  });

  test("rebuildFn throw propagates (rule #6)", () => {
    const fixture = makeSeams({
      stderr: "context window exceeded",
      rebuildFn: () => {
        throw new Error("build_brief.py: --max-tokens not supported yet");
      },
    });
    expect(() => heal.apply(fixture.seams)).toThrow("build_brief.py");
  });

  test("end-to-end: detect → apply → verify-healed with shrunk brief", () => {
    const fixture = makeSeams({
      stderr: "Error: context window exceeded",
      maxTokens: 50_000,
    });
    // Simulate the production rebuild: after rebuildFn runs, the byte
    // count drops below the budget.
    fixture.seams.rebuildFn = (_maxTokens, _path) => {
      fixture.setByteCount(150_000); // 50k tokens × 4 = 200k budget
    };
    const detection = heal.detect(fixture.seams);
    expect(detection.present).toBe(true);
    heal.apply(fixture.seams);
    expect(heal.verify(fixture.seams).healed).toBe(true);
  });
});
