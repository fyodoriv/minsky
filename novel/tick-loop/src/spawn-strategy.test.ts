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
  // in `daemon.test.ts`). Asserts the *new* default args
  // (`["--print","--setting-sources","project,local"]`) produce a
  // fresh-session response — NOT a "Select a session to resume"
  // interactive picker prompt that the legacy `["--resume"]` default
  // emitted. The `--setting-sources project,local` clause skips user-
  // level CLAUDE.md so the prompt fits within the model context.
  const hasClaude = (() => {
    try {
      execSync("which claude", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  // `spawn-strategy-claude-smoke-test-skip-on-rate-limit` (P1, 2026-05-19):
  // PATH presence is necessary but NOT sufficient — claude can also be
  // unauthenticated, rate-limited, or running in a misconfigured project
  // env. In any of these cases the binary returns non-zero output that
  // would make the assertions below hard-fail with no diagnostic value
  // (the binary IS there, it just can't do its job). Probe once at
  // module load with a 1-token request and skip the test when the probe
  // is unsuccessful — converts the env-dependent assertion into a
  // deterministic skip rather than a deterministic failure (rule #11
  // forbids load-bearing flaky gates).
  // Pivot per the TASKS.md task: if the probe itself becomes too slow
  // / costs tokens, gate on `MINSKY_SKIP_CLAUDE_SMOKE=1` instead.
  const claudeProbeOk = (() => {
    if (!hasClaude) return false;
    if (process.env["MINSKY_SKIP_CLAUDE_SMOKE"] === "1") return false;
    try {
      execSync("claude --print --max-tokens 1 'ok'", {
        stdio: "ignore",
        timeout: 30_000,
        input: "",
      });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!claudeProbeOk)(
    "default args spawn a fresh non-interactive Claude session that consumes stdin",
    async () => {
      // Default args (no `args` override) →
      // `["--print","--setting-sources","project,local"]` per the fix.
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

  it("spawn-failed-signal-capture: child killed by signal surfaces the signal in SpawnResult so daemon log can diagnose what killed it", async () => {
    // Surface for the spawn-failed-exit-minus-one-silent-empty-stderr P0:
    // when devin (or any cloud agent) gets SIGTERM/SIGKILL/SIGHUP'd by an
    // external party (parent process, launchd, OOM killer, dotfiles env
    // hook), we currently lose all diagnostic — exitCode collapses to -1
    // (because code === null when a signal kills the child) and we have
    // no way to distinguish "watchdog SIGKILL" from "mysterious SIGTERM".
    const script =
      "setTimeout(() => process.kill(process.pid, 'SIGKILL'), 100); setInterval(() => {}, 1000);";
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", script],
      timeoutMs: 5_000,
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(-1);
    expect(result.signal).toBe("SIGKILL");
    expect(result.timedOut).toBeUndefined();
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

// Slice 2 of `local-llm-fallback-on-budget-pause`: the `invocation` opt
// lets the slice-3 wiring layer hand a per-iteration builder that picks
// between `buildClaudePrintInvocation` and `buildAiderInvocation`. These
// tests pin the contract: the builder's output wins over the constructor
// defaults; stdin can be turned off; cwd flows through; argv override is
// applied.
describe("tick-loop / spawn-strategy / ProcessSpawnStrategy with invocation opt", () => {
  it("builder's argv overrides constructor's args", async () => {
    // Use a node subprocess that writes its argv to stdout so we can
    // observe what was actually spawned. Note: with `node -e <script>`,
    // process.argv[0] is the node binary and process.argv[1] is the first
    // positional arg after the script (Node strips `-e <script>` itself
    // from argv); slice(1) gives the positional args we passed.
    const script = "process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(0);";
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["should-be-overridden"],
      invocation: () => ({
        command: process.execPath,
        argv: ["-e", script, "from-builder"],
        stdin: undefined,
      }),
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdoutTail)).toEqual(["from-builder"]);
  });

  it("builder's stdin: undefined means stdin is closed without writing brief", async () => {
    // Child reads stdin to EOF and writes its length; if stdin gets the
    // brief, length > 0; if stdin closes without writing, length = 0.
    const script = `
      let n = 0;
      process.stdin.on('data', (c) => { n += c.length; });
      process.stdin.on('end', () => {
        process.stdout.write(String(n));
        process.exit(0);
      });
    `;
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      invocation: () => ({
        command: process.execPath,
        argv: ["-e", script],
        stdin: undefined,
      }),
    });
    const result = await strat.spawn(emptyInput({ brief: "this should NOT reach stdin" }));
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toBe("0");
  });

  it("builder's stdin: <string> writes that string to stdin (not the input.brief)", async () => {
    const script = `
      let s = '';
      process.stdin.on('data', (c) => { s += c.toString(); });
      process.stdin.on('end', () => {
        process.stdout.write(s);
        process.exit(0);
      });
    `;
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      invocation: () => ({
        command: process.execPath,
        argv: ["-e", script],
        stdin: "from-builder-stdin",
      }),
    });
    const result = await strat.spawn(emptyInput({ brief: "ignored" }));
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toBe("from-builder-stdin");
  });

  it("builder's cwd flows through to child's cwd", async () => {
    const script = "process.stdout.write(process.cwd());process.exit(0);";
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      invocation: () => ({
        command: process.execPath,
        argv: ["-e", script],
        stdin: undefined,
        cwd: "/tmp",
      }),
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    // /tmp may resolve to /private/tmp on macOS; accept either.
    expect(["/tmp", "/private/tmp"]).toContain(result.stdoutTail);
  });

  it("builder is called per-iteration (not memoised) so flap between providers works", async () => {
    let calls = 0;
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      invocation: () => {
        calls += 1;
        return {
          command: process.execPath,
          argv: ["-e", "process.exit(0);"],
          stdin: undefined,
        };
      },
    });
    await strat.spawn(emptyInput());
    await strat.spawn(emptyInput());
    await strat.spawn(emptyInput());
    expect(calls).toBe(3);
  });

  it("builder receives the SpawnInput so it can read taskId / extraArgs", async () => {
    /** @type {string[]} */
    let receivedTaskId = "";
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      invocation: (input) => {
        receivedTaskId = input.taskId;
        return {
          command: process.execPath,
          argv: ["-e", "process.exit(0);"],
          stdin: undefined,
        };
      },
    });
    await strat.spawn(emptyInput({ taskId: "expected-task-id" }));
    expect(receivedTaskId).toBe("expected-task-id");
  });

  // Slice 3 of P0 `local-worker-worktree-never-created`: when the
  // builder's `cwd` (the per-worker git worktree) does not exist, fail
  // loud AT the workspace boundary with a one-line operator-actionable
  // message — never spawn the model into a missing cwd.
  it("rejects loud (naming the missing dir) when builder's cwd does not exist — does NOT spawn", async () => {
    let spawnCalls = 0;
    const strat = new ProcessSpawnStrategy({
      command: "aider",
      spawnFn: (() => {
        spawnCalls += 1;
        throw new Error("spawnFn must not be called when cwd is missing");
      }) as unknown as typeof import("node:child_process").spawn,
      existsFn: () => false,
      invocation: () => ({
        command: "aider",
        argv: ["--message", "x"],
        stdin: undefined,
        cwd: "/Users/u/apps/minsky/.claude/worktrees/daemon-0-some-task",
      }),
    });
    await expect(strat.spawn(emptyInput())).rejects.toThrow(
      /worktree cwd "\/Users\/u\/apps\/minsky\/\.claude\/worktrees\/daemon-0-some-task" does not exist/,
    );
    await expect(strat.spawn(emptyInput())).rejects.toThrow(/local-worker-worktree-never-created/);
    expect(spawnCalls).toBe(0);
  });

  it("proceeds to spawn when builder's cwd exists (existsFn → true)", async () => {
    let checkedPath = "";
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      existsFn: (p) => {
        checkedPath = p;
        return true;
      },
      invocation: () => ({
        command: process.execPath,
        argv: ["-e", "process.exit(0);"],
        stdin: undefined,
        cwd: "/tmp",
      }),
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(checkedPath).toBe("/tmp");
  });

  it("does not run the cwd guard when the invocation has no cwd (legacy path unaffected)", async () => {
    let existsCalls = 0;
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      existsFn: () => {
        existsCalls += 1;
        return false;
      },
      invocation: () => ({
        command: process.execPath,
        argv: ["-e", "process.exit(0);"],
        stdin: undefined,
      }),
    });
    const result = await strat.spawn(emptyInput());
    expect(result.exitCode).toBe(0);
    expect(existsCalls).toBe(0);
  });

  it("legacy path (no invocation opt) still writes brief to stdin", async () => {
    const script = `
      let s = '';
      process.stdin.on('data', (c) => { s += c.toString(); });
      process.stdin.on('end', () => {
        process.stdout.write(s);
        process.exit(0);
      });
    `;
    const strat = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", script],
    });
    const result = await strat.spawn(emptyInput({ brief: "legacy-brief-on-stdin" }));
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toBe("legacy-brief-on-stdin");
  });
});
