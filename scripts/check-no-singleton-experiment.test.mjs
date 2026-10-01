// Tests for the pure function in check-no-singleton-experiment.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures (Meszaros 2007).
// Source: rule #10 (vision.md § 10); rule #1 (singleton retired by
// experiments-directory-migration).

import { describe, expect, test } from "vitest";

import { checkNoSingletonExperiment } from "./check-no-singleton-experiment.mjs";

describe("checkNoSingletonExperiment", () => {
  test("ok when the singleton path does not exist", () => {
    const result = checkNoSingletonExperiment(() => false, "/repo/EXPERIMENT.yaml");
    expect(result.ok).toBe(true);
  });

  test("violation when the singleton path exists", () => {
    const result = checkNoSingletonExperiment(() => true, "/repo/EXPERIMENT.yaml");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.path).toBe("/repo/EXPERIMENT.yaml");
  });

  test("checker is a pure function over the injected fileExists predicate", () => {
    let calls = 0;
    /** @param {string} p */
    const fileExists = (p) => {
      calls += 1;
      return p === "/repo/EXPERIMENT.yaml";
    };
    expect(checkNoSingletonExperiment(fileExists, "/repo/EXPERIMENT.yaml").ok).toBe(false);
    expect(checkNoSingletonExperiment(fileExists, "/repo/other.yaml").ok).toBe(true);
    expect(calls).toBe(2);
  });
});
