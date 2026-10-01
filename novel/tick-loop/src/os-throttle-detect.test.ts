import { describe, expect, test } from "vitest";

import {
  detectThrottles,
  isBudgetReachable,
  MIN_NOFILE_FOR_BUDGET,
  renderMirrorTasks,
  TRIVIAL_BUDGET_PCT,
} from "./os-throttle-detect.js";

describe("detectThrottles", () => {
  test("ProcessType=Background contradicts a non-trivial budget", () => {
    const f = detectThrottles({ budgetPct: 70, processType: "Background" });
    expect(f.map((x) => x.kind)).toContain("process-type-background");
    expect(f[0]?.mirrorRepo).toBe("dotfiles");
    expect(f[0]?.remediation).toMatch(/Standard/);
  });

  test("ProcessType=Standard is clean", () => {
    expect(detectThrottles({ budgetPct: 70, processType: "Standard" })).toEqual([]);
    expect(isBudgetReachable({ budgetPct: 70, processType: "Standard" })).toBe(true);
  });

  test("positive Nice deprioritises and is flagged", () => {
    const f = detectThrottles({ budgetPct: 70, nice: 5 });
    expect(f.map((x) => x.kind)).toContain("nice");
  });

  test("low ulimit below the floor is flagged", () => {
    const f = detectThrottles({ budgetPct: 70, ulimitNofile: MIN_NOFILE_FOR_BUDGET - 1 });
    expect(f.map((x) => x.kind)).toContain("ulimit-nofile");
  });

  test("ulimit at/above the floor is clean", () => {
    expect(detectThrottles({ budgetPct: 70, ulimitNofile: MIN_NOFILE_FOR_BUDGET })).toEqual([]);
  });

  test("stale MINSKY cap routes to the agentbrew mirror", () => {
    const f = detectThrottles({
      budgetPct: 70,
      staleMinskyCaps: { MINSKY_SPAWN_ADDITIONAL_WORKERS: "4" },
    });
    expect(f[0]?.kind).toBe("stale-minsky-cap");
    expect(f[0]?.mirrorRepo).toBe("agentbrew");
  });

  test("a trivial budget tolerates throttles (deliberately idle box)", () => {
    expect(detectThrottles({ budgetPct: TRIVIAL_BUDGET_PCT, processType: "Background" })).toEqual(
      [],
    );
  });

  test("partial evidence (no launchd fields) degrades to clean", () => {
    expect(detectThrottles({ budgetPct: 70 })).toEqual([]);
  });
});

describe("renderMirrorTasks", () => {
  test("batches findings per mirror repo into one tasks.md block each", () => {
    const findings = detectThrottles({
      budgetPct: 70,
      processType: "Background",
      nice: 5,
      staleMinskyCaps: { MINSKY_SPAWN_ADDITIONAL_WORKERS: "4" },
    });
    const tasks = renderMirrorTasks(findings);
    expect(tasks.map((t) => t.mirrorRepo).sort()).toEqual(["agentbrew", "dotfiles"]);
    const dotfiles = tasks.find((t) => t.mirrorRepo === "dotfiles");
    expect(dotfiles?.tasksMdPath).toBe("~/apps/dotfiles/TASKS.md");
    expect(dotfiles?.taskBlock).toMatch(/- \[ \] minsky-budget-throttle-dotfiles/);
    expect(dotfiles?.taskBlock).toMatch(/\*\*ID\*\*: minsky-budget-throttle-dotfiles/);
    expect(dotfiles?.taskBlock).toMatch(/process-type-background/);
    expect(dotfiles?.taskBlock).toMatch(/nice/);
  });

  test("no findings → no tasks", () => {
    expect(renderMirrorTasks([])).toEqual([]);
  });
});
