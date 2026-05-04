// Tests for the iteration-record renderer.

import { describe, expect, test } from "vitest";

import { type IterationRecord, renderIterationRecord } from "./iteration-record.js";

const baseRecord: IterationRecord = {
  ts: "2026-05-04T17:00:00Z",
  experiment_id: "proj-840-slash-command-labels",
  host_repo: "example-org/example-capabilities",
  branch: "feat/proj-840-slash-command-labels",
  verdict: "validated",
  pr_url: "https://github.example/pulls/123",
  notes: "ok",
};

describe("renderIterationRecord", () => {
  test("renders a single-line JSONL with trailing newline", () => {
    const line = renderIterationRecord(baseRecord);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n").filter((l) => l.length > 0).length).toBe(1);
  });

  test("the line is valid JSON", () => {
    const line = renderIterationRecord(baseRecord);
    const parsed = JSON.parse(line);
    expect(parsed.experiment_id).toBe("proj-840-slash-command-labels");
    expect(parsed.verdict).toBe("validated");
  });

  test("preserves null pr_url", () => {
    const line = renderIterationRecord({ ...baseRecord, pr_url: null });
    const parsed = JSON.parse(line);
    expect(parsed.pr_url).toBeNull();
  });

  test("supports each verdict variant", () => {
    const verdicts: IterationRecord["verdict"][] = [
      "planned",
      "validated",
      "regressed",
      "inconclusive",
      "budget-paused",
      "scope-leak",
      "aborted",
    ];
    for (const verdict of verdicts) {
      const line = renderIterationRecord({ ...baseRecord, verdict });
      const parsed = JSON.parse(line);
      expect(parsed.verdict).toBe(verdict);
    }
  });
});
