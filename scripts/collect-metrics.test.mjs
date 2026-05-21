// Smoke tests for `collect-metrics.mjs` — collects daemon metrics into
// a JSONL snapshot file. Lifts L6 coverage.
//
// Source: rule #4 (everything measurable, everything visible);
// rule #17 (proactive healing — observed L6 gap is a fix).

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "collect-metrics.mjs");

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function run(args, env) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 15_000,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = /** @type {{ stdout?: string; stderr?: string; status?: number }} */ (err);
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? 1,
    };
  }
}

describe("collect-metrics smoke", () => {
  test("--json returns valid JSON (after the 'Collecting…' progress prefix)", () => {
    const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "collect-home-")) };
    const r = run(["--json"], env);
    expect(r.stdout.length).toBeGreaterThan(0);
    // The script prints a progress line before the JSON; pull the first
    // `{` and parse from there.
    const firstBrace = r.stdout.indexOf("{");
    expect(firstBrace).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(r.stdout.slice(firstBrace));
    expect(typeof parsed).toBe("object");
  });

  test("default (non-json) output is non-empty (header or summary)", () => {
    const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "collect-home-")) };
    const r = run([], env);
    // Always some output (even an empty-state header).
    expect((r.stdout ?? "").length + (r.stderr ?? "").length).toBeGreaterThan(0);
  });
});
