// Tests for run-pre-pr-lint-stack.mjs. The runner is a pure orchestrator over
// the manifest + an injected `runStep`; tests stub `runStep` and assert the
// stage filter + green/red verdict logic.

import { describe, expect, test } from "vitest";

import {
  STACK_MANIFEST,
  buildStepResult,
  parseArgs,
  runStack,
  selectSteps,
} from "./run-pre-pr-lint-stack.mjs";

describe("STACK_MANIFEST", () => {
  test("every entry has name / cmd / args / stages", () => {
    for (const step of STACK_MANIFEST) {
      expect(typeof step.name).toBe("string");
      expect(step.name.length).toBeGreaterThan(0);
      expect(typeof step.cmd).toBe("string");
      expect(Array.isArray(step.args)).toBe(true);
      expect(Array.isArray(step.stages)).toBe(true);
      expect(step.stages.length).toBeGreaterThan(0);
      for (const s of step.stages) {
        expect(s === "fast" || s === "full").toBe(true);
      }
    }
  });

  test("every step name is unique (drift-protection — manifest collisions silently mask failures)", () => {
    const names = STACK_MANIFEST.map((s) => s.name);
    const uniq = new Set(names);
    expect(uniq.size).toBe(names.length);
  });

  test("the fast stage exercises biome / typecheck / markdownlint / tasks-lint / rule-2 / rule-3 / rule-6 / rule-12", () => {
    // Pre-registered scope of the daemon's pre-PR gate (TASKS.md
    // `daemon-pre-pr-lint-gate` Pivot — fast lints close ~80% of the failure
    // modes the operator cleans up). Drift here is what the manifest is
    // supposed to detect; pin the set explicitly.
    const fastNames = selectSteps("fast")
      .map((s) => s.name)
      .sort();
    expect(fastNames).toEqual(
      [
        "biome",
        "markdownlint",
        "rule-12-scope-discipline",
        "rule-2-dep-coverage",
        "rule-3-doc-first",
        "rule-6-let-it-crash",
        "tasks-lint",
        "typecheck",
      ].sort(),
    );
  });

  test("full ⊇ fast — every fast step also runs in full", () => {
    const fastSet = new Set(selectSteps("fast").map((s) => s.name));
    const fullSet = new Set(selectSteps("full").map((s) => s.name));
    for (const n of fastSet) expect(fullSet.has(n)).toBe(true);
  });

  test("full strictly extends fast (the slow lints exist in full only)", () => {
    expect(selectSteps("full").length).toBeGreaterThan(selectSteps("fast").length);
  });
});

describe("runStack", () => {
  /** @type {{ name: string, stages: ("fast" | "full")[], cmd: string, args: string[] }[]} */
  const fixtureManifest = [
    { name: "alpha", stages: ["fast", "full"], cmd: "noop", args: [] },
    { name: "beta", stages: ["fast", "full"], cmd: "noop", args: [] },
    { name: "gamma", stages: ["full"], cmd: "noop", args: [] },
  ];

  test("returns allPass=true when every step passes", async () => {
    const result = await runStack(
      "fast",
      async (s) => ({ name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 }),
      fixtureManifest,
    );
    expect(result.allPass).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(result.stage).toBe("fast");
  });

  test("returns allPass=false when any step fails", async () => {
    const result = await runStack(
      "fast",
      async (s) => {
        if (s.name === "beta") {
          return {
            name: s.name,
            verdict: "fail",
            durationMs: 1,
            exitCode: 1,
            stderrTail: "boom",
          };
        }
        return { name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 };
      },
      fixtureManifest,
    );
    expect(result.allPass).toBe(false);
    const beta = result.steps.find((s) => s.name === "beta");
    expect(beta?.verdict).toBe("fail");
    expect(beta?.stderrTail).toBe("boom");
  });

  test("stage=full includes the full-only steps", async () => {
    const result = await runStack(
      "full",
      async (s) => ({ name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 }),
      fixtureManifest,
    );
    expect(result.steps.map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("steps run in manifest order (sequential — daemon spawn budget is finite)", async () => {
    /** @type {string[]} */
    const observed = [];
    await runStack(
      "full",
      async (s) => {
        observed.push(s.name);
        return { name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 };
      },
      fixtureManifest,
    );
    expect(observed).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("buildStepResult", () => {
  test("err=null → pass with exitCode 0 and no stderrTail", () => {
    const r = buildStepResult("alpha", null, "ignored", 42);
    expect(r).toEqual({ name: "alpha", verdict: "pass", durationMs: 42, exitCode: 0 });
  });

  test("err with numeric code → fail carrying that code + stderr tail", () => {
    const err = Object.assign(new Error("boom"), { code: 7 });
    const r = buildStepResult("beta", err, "line1\nline2", 11);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(7);
    expect(r.stderrTail).toBe("line1\nline2");
  });

  test("err with non-numeric code → fail with synthesised exitCode 1 (rule-6 let-it-crash equivalent)", () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const r = buildStepResult("gamma", err, "", 0);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(1);
  });

  test("stderr tail is bounded to ~80 lines (long output truncates)", () => {
    const huge = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    const err = Object.assign(new Error("boom"), { code: 1 });
    const r = buildStepResult("delta", err, huge, 1);
    const tailLineCount = (r.stderrTail ?? "").split("\n").length;
    expect(tailLineCount).toBeLessThanOrEqual(80);
    expect(r.stderrTail).toContain("line199");
    expect(r.stderrTail).not.toContain("line0\n");
  });
});

describe("parseArgs", () => {
  test("default stage is fast (the daemon's gate)", () => {
    expect(parseArgs([])).toEqual({ stage: "fast", json: false });
  });

  test("--stage=full opts into the operator-side gate", () => {
    expect(parseArgs(["--stage=full"])).toEqual({ stage: "full", json: false });
  });

  test("--json toggles machine-readable output", () => {
    expect(parseArgs(["--json"])).toEqual({ stage: "fast", json: true });
  });

  test("unknown flags are ignored (forward-compat)", () => {
    expect(parseArgs(["--unknown", "--stage=full"])).toEqual({ stage: "full", json: false });
  });
});
