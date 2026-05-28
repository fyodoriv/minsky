// Tests for heal-ollama-down
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md.

import { describe, expect, test } from "vitest";
import * as heal from "./heal-ollama-down.js";
import type { OllamaDownSeams } from "./heal-ollama-down.js";

function makeSeams(overrides: Partial<OllamaDownSeams> = {}): {
  seams: OllamaDownSeams;
  kicks: number;
  setProbeUp: (up: boolean) => void;
} {
  let kicks = 0;
  let probeUp = false;
  const seams: OllamaDownSeams = {
    stderr: "",
    kickFn: () => {
      kicks++;
    },
    probeFn: () => probeUp,
    ...overrides,
  };
  return {
    seams,
    get kicks() {
      return kicks;
    },
    setProbeUp: (up) => {
      probeUp = up;
    },
  };
}

describe("heal-ollama-down", () => {
  test.each([
    "Error: connect ECONNREFUSED 127.0.0.1:11434",
    "FetchError: connect ECONNREFUSED localhost:11434",
    "ECONNREFUSED ::1:11434",
    "openhands: Connection error: cannot reach ollama",
    "ollama: connection refused at port 11434",
    "ollama daemon not running",
    "ollama is unreachable",
  ])("detects ollama-down signal in stderr: %s", (stderr) => {
    const { seams } = makeSeams({ stderr });
    const result = heal.detect(seams);
    expect(result.present).toBe(true);
    if (result.present) {
      expect(result.signal).toBe("ollama-down");
    }
  });

  test.each([
    "",
    "ECONNREFUSED on port 5432 (postgres)",
    "rate limit exceeded",
    "MODULE_NOT_FOUND: vitest",
    "Some other unrelated error",
  ])("does NOT detect on non-ollama stderr: %s", (stderr) => {
    const { seams } = makeSeams({ stderr });
    expect(heal.detect(seams).present).toBe(false);
  });

  test("apply kicks the daemon when the signal is present", () => {
    const fixture = makeSeams({
      stderr: "Error: connect ECONNREFUSED 127.0.0.1:11434",
    });
    const result = heal.apply(fixture.seams);
    expect(result.applied).toBe(true);
    expect(fixture.kicks).toBe(1);
    expect(result.notes).toContain("kicked ollama");
  });

  test("apply is a no-op when stderr has no ollama-down signal", () => {
    const fixture = makeSeams({ stderr: "ERR_NETWORK_TIMEOUT" });
    const result = heal.apply(fixture.seams);
    expect(result.applied).toBe(false);
    expect(fixture.kicks).toBe(0);
    expect(result.notes).toContain("no-op");
  });

  test("apply is idempotent — re-applying after success kicks again (launchctl is a no-op against healthy)", () => {
    const fixture = makeSeams({
      stderr: "Error: connect ECONNREFUSED 127.0.0.1:11434",
    });
    heal.apply(fixture.seams);
    heal.apply(fixture.seams);
    expect(fixture.kicks).toBe(2);
  });

  test("verify returns healed when the probe succeeds", () => {
    const fixture = makeSeams({});
    fixture.setProbeUp(true);
    expect(heal.verify(fixture.seams).healed).toBe(true);
  });

  test("verify returns not-healed when the probe fails", () => {
    const fixture = makeSeams({});
    fixture.setProbeUp(false);
    const result = heal.verify(fixture.seams);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.residualSignal).toBe("ollama-down");
    }
  });

  test("end-to-end: detect → apply → verify-healed after probe flips up", () => {
    const fixture = makeSeams({
      stderr: "FetchError: connect ECONNREFUSED localhost:11434",
    });
    const detection = heal.detect(fixture.seams);
    expect(detection.present).toBe(true);
    heal.apply(fixture.seams);
    expect(fixture.kicks).toBe(1);
    fixture.setProbeUp(true);
    expect(heal.verify(fixture.seams).healed).toBe(true);
  });

  test("kickFn throw propagates (rule #6 — let-it-crash at the I/O boundary)", () => {
    const fixture = makeSeams({
      stderr: "Error: connect ECONNREFUSED 127.0.0.1:11434",
      kickFn: () => {
        throw new Error("launchctl: kickstart failed");
      },
    });
    expect(() => heal.apply(fixture.seams)).toThrow("launchctl: kickstart failed");
  });
});
