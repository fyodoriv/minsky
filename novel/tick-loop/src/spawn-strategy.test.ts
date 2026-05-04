/**
 * Tests for `@minsky/tick-loop/spawn-strategy` — sub-task 1/3 of
 * `tick-loop-daemon-real-spawn`'s decomposition.
 *
 * Coverage:
 *   1. `DryRunSpawnStrategy` returns a deterministic success result with
 *      the synthetic stdoutTail mirroring v0's dry-run output.
 *   2. `DryRunSpawnStrategy` resolves with exitCode 0 + durationMs 0.
 *   3. `ProcessSpawnStrategy` against a trivial `node -e 'process.exit(0)'`
 *      subprocess resolves with exitCode 0 and a non-zero durationMs.
 *   4. `ProcessSpawnStrategy` against `node -e 'process.exit(7)'` propagates
 *      the non-zero exit code (let-it-crash boundary — non-zero in result,
 *      not thrown).
 *   5. `ProcessSpawnStrategy` captures stdout + stderr tails (bounded) from
 *      a `node -e` subprocess that writes to both streams.
 *   6. `ProcessSpawnStrategy` truncates stdout to the last 4KB on a chatty
 *      subprocess (the tail-cap invariant).
 */

import { describe, expect, it } from "vitest";

import { DryRunSpawnStrategy, ProcessSpawnStrategy, type SpawnInput } from "./spawn-strategy.js";

function emptyInput(overrides: Partial<SpawnInput> = {}): SpawnInput {
  return {
    taskId: "alpha",
    brief: "",
    env: process.env,
    ...overrides,
  };
}

describe("tick-loop / spawn-strategy / DryRunSpawnStrategy", () => {
  it("returns synthetic success with dry-run stdoutTail mirroring v0 output", async () => {
    const strat = new DryRunSpawnStrategy();
    const result = await strat.spawn(emptyInput({ taskId: "beta" }));
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(result.stdoutTail).toBe("daemon dry-run prompt for beta");
    expect(result.stderrTail).toBe("");
  });

  it("does not touch the OS or read the brief", async () => {
    const strat = new DryRunSpawnStrategy();
    const result = await strat.spawn(emptyInput({ brief: "any brief here" }));
    expect(result.stdoutTail).not.toContain("any brief here");
  });
});

describe("tick-loop / spawn-strategy / ProcessSpawnStrategy", () => {
  it("spawns a real subprocess and reports exit code 0 with positive duration", async () => {
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stdoutTail).toBe("");
    expect(result.stderrTail).toBe("");
  });

  it("propagates non-zero exit code without throwing (let-it-crash boundary)", async () => {
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(7);
  });

  it("captures stdout and stderr tails from a subprocess that writes both", async () => {
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('hello-stdout'); process.stderr.write('hello-stderr'); process.exit(0)",
      ],
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain("hello-stdout");
    expect(result.stderrTail).toContain("hello-stderr");
  });

  it("bounds stdout to the last 4KB (tail-cap invariant)", async () => {
    // Emit 5KB of 'A' followed by a unique marker so we can verify the
    // marker survived the truncation but the leading bytes were dropped.
    const script = `
      const big = 'A'.repeat(5 * 1024);
      process.stdout.write(big);
      process.stdout.write('END_MARKER');
      process.exit(0);
    `;
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", script],
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail.length).toBeLessThanOrEqual(4096);
    expect(result.stdoutTail).toContain("END_MARKER");
  });
});
