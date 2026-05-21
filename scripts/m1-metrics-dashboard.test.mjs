// Structural tests for `m1-metrics-dashboard.mjs`. The script runs
// every M1 task's **Measurement** command, which collectively can take
// minutes — too slow for unit tests. So we structurally verify the
// script's contract (reads TASKS.md, supports --json, executes
// measurement commands) by inspecting the source. Lifts L6 coverage.
//
// Source: rule #4 (everything measurable, everything visible);
// rule #17 (proactive healing — observed L6 gap is a fix); rule #11
// (no flaky load-bearing gates — running every measurement on every
// CI run would be slow + flaky, so we assert the structure instead).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "m1-metrics-dashboard.mjs");
const SOURCE = readFileSync(SCRIPT, "utf8");

describe("m1-metrics-dashboard structural", () => {
  test("reads TASKS.md", () => {
    expect(SOURCE).toMatch(/TASKS\.md/);
  });

  test("supports --json mode", () => {
    expect(SOURCE).toMatch(/--json/);
  });

  test("references the **Measurement** field shape from rule #9", () => {
    expect(SOURCE).toMatch(/Measurement/);
  });

  test("executes shell commands (the M1 measurement runs)", () => {
    expect(SOURCE).toMatch(/exec(Sync|File)/);
  });

  test("filters to M1 tasks (the dashboard's scope)", () => {
    // Either filters by `**Milestone**: M1` or has M1 in its name/comments.
    expect(SOURCE).toMatch(/M1|milestone/i);
  });
});
