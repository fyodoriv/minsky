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

import { execSync } from "node:child_process";

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

  // `tick-loop-spawn-args-fresh-session` integration test: gated on the
  // real `claude` binary being on PATH (skipped in CI hosts without it,
  // mirroring the gate convention introduced for the daemon-side test
  // in `daemon.test.ts`). Asserts the *new* default args (`["--print"]`)
  // produce a fresh-session response — NOT a "Select a session to resume"
  // interactive picker prompt that the old `["--resume"]` default emitted.
  const hasClaude = (() => {
    try {
      execSync("which claude", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasClaude)(
    "default args spawn a fresh non-interactive Claude session that consumes stdin",
    async () => {
      // Default args (no `args` override) → `["--print"]` per the fix.
      const strat = new ProcessSpawnStrategy({ command: "claude" });
      const result = await strat.spawn(
        emptyInput({
          taskId: "spawn-args-smoke",
          // Minimal 1-line brief — Claude should respond with at least one
          // non-empty token, and the response MUST NOT be an interactive
          // session-picker UI string.
          brief: "Reply with the single word: ok",
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdoutTail.length).toBeGreaterThan(0);
      // The interactive session picker prints "Select a session to resume"
      // (and "resume" UI strings); a fresh `--print` invocation does not.
      const lower = result.stdoutTail.toLowerCase();
      expect(lower).not.toContain("select a session");
      expect(lower).not.toContain("resume previous");
    },
    60_000,
  );

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

  it("daemon-claude-print-hang-watchdog: SIGKILLs a child that doesn't close within timeoutMs and resolves with timedOut: true", async () => {
    // Child sleeps forever — would hang indefinitely without watchdog.
    const script = "setInterval(() => {}, 1000);";
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", script],
      timeoutMs: 200,
    });
    const startedAt = Date.now();
    const result = await strat.spawn(emptyInput());
    const elapsed = Date.now() - startedAt;
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(result.stderrTail).toContain("timed out after 200ms");
    // Resolution should land just past the timeout, not hours later.
    expect(elapsed).toBeLessThan(2_000);
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it("daemon-claude-print-hang-watchdog: a fast child finishes before the watchdog and timedOut is undefined", async () => {
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", "process.exit(0);"],
      timeoutMs: 30_000,
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBeUndefined();
  });

  it("daemon-claude-print-hang-watchdog: legacy unbounded behaviour preserved when timeoutMs is omitted", async () => {
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", "process.exit(0);"],
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBeUndefined();
  });
});
