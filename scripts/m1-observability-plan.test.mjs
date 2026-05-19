// Smoke tests for `m1-observability-plan.mjs`. Lifts L6 coverage.
//
// Source: rule #4 (everything measurable, everything visible);
// rule #17 (proactive healing — observed L6 gap is a fix).

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "m1-observability-plan.mjs");

function run(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 15_000,
    });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", status: err.status ?? 1 };
  }
}

describe("m1-observability-plan smoke", () => {
  test("--json returns parseable JSON", () => {
    const r = run(["--json"]);
    expect(r.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed).toBe("object");
  });

  test("--gaps-only emits a non-empty subset", () => {
    const r = run(["--gaps-only"]);
    // Even if all M1 tasks have full observability, the script should
    // exit cleanly with informative output.
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  test("default (non-json) output references one of the 6 observability signals", () => {
    const r = run([]);
    expect(r.stdout).toMatch(/(OTEL|daemon log|dashboard|experiment store|invariant|METRICS\.md)/i);
  });
});
