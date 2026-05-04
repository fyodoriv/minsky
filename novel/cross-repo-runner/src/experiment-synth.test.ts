// Tests for experiment-synth. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { synthesiseExperimentYaml } from "./experiment-synth.js";
import type { ParsedTask } from "./task-finder.js";

const completeTask: ParsedTask = {
  id: "test-task",
  title: "Test task",
  priority: "P0",
  tags: ["bug"],
  details: "Some details.",
  hypothesis: "Replacing X with Y closes the gap.",
  success: ">= 10 percent",
  pivot: "< 5 percent",
  measurement: "test -f /tmp/foo && grep -q bar",
  anchor: "rule #9 (vision.md § 9 — pre-registration)",
};

describe("synthesiseExperimentYaml — happy path", () => {
  test("produces a YAML string with all 5 rule-#9 fields", () => {
    const result = synthesiseExperimentYaml(completeTask);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.experimentId).toBe("test-task");
    expect(result.yaml).toContain("id: test-task");
    expect(result.yaml).toContain("hypothesis:");
    expect(result.yaml).toContain("success:");
    expect(result.yaml).toContain("pivot:");
    expect(result.yaml).toContain("measurement:");
    expect(result.yaml).toContain("anchor:");
  });

  test("hypothesis is rendered as a multi-line block (`|`)", () => {
    const result = synthesiseExperimentYaml(completeTask);
    if (!result.ok) return;
    expect(result.yaml).toContain("hypothesis: |\n  Replacing X with Y closes the gap.");
  });

  test("success / pivot / measurement are rendered as JSON-quoted scalars", () => {
    const result = synthesiseExperimentYaml(completeTask);
    if (!result.ok) return;
    expect(result.yaml).toContain('success: ">= 10 percent"');
    expect(result.yaml).toContain('pivot: "< 5 percent"');
  });

  test("anchor is rendered as a multi-line block", () => {
    const result = synthesiseExperimentYaml(completeTask);
    if (!result.ok) return;
    expect(result.yaml).toContain("anchor: |\n  rule #9");
  });
});

describe("synthesiseExperimentYaml — rule-#9 iron rule (missing fields)", () => {
  test("missing hypothesis fails loudly", () => {
    const result = synthesiseExperimentYaml({ ...completeTask, hypothesis: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toContain("Hypothesis");
  });

  test("missing pivot fails loudly", () => {
    const result = synthesiseExperimentYaml({ ...completeTask, pivot: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toContain("Pivot");
  });

  test("multiple missing fields are all reported", () => {
    const result = synthesiseExperimentYaml({
      ...completeTask,
      hypothesis: null,
      success: null,
      anchor: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(["Hypothesis", "Success", "Anchor"]);
  });

  test("all 5 missing fails with all 5 in the list", () => {
    const result = synthesiseExperimentYaml({
      ...completeTask,
      hypothesis: null,
      success: null,
      pivot: null,
      measurement: null,
      anchor: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual([
      "Hypothesis",
      "Success",
      "Pivot",
      "Measurement",
      "Anchor",
    ]);
  });
});
