// Integration test for `spawn-failed-exit-minus-one-silent-empty-stderr` (P0).
//
// Verifies that when the spawned child is killed by a POSIX signal
// (`SIGKILL` / `SIGTERM` / `SIGHUP`) — the exact failure shape that
// devin exhibited on launchd-managed daemons before PR #666 — the
// `signal` field is captured by `ProcessSpawnStrategy` AND threaded
// all the way through `runLive` into the `LiveSpawnOutcome` the
// host-loop records.
//
// The unit-level tests cover each seam in isolation:
//   - `novel/tick-loop/src/spawn-strategy.test.ts:spawn-failed-signal-capture`
//     (signal is set on the SpawnResult returned by ProcessSpawnStrategy)
//   - `novel/cross-repo-runner/src/runner.test.ts:spawn-failed-exit-minus-one-…`
//     (signal threads from a FAKE SpawnLike into LiveSpawnOutcome)
//   - `novel/cross-repo-runner/src/host-loop.test.ts:spawn-failed-exit-minus-one-…`
//     (signal threads from outcome into LoopIterationResult)
//
// This file is the SEAM TEST: a REAL `ProcessSpawnStrategy` (not a fake)
// drives `runLive` against a REAL subprocess that SIGKILLs itself, so
// that any future refactor of `ProcessSpawnStrategy` which silently
// drops the signal field is caught even when the unit tests still pass
// against their hand-written fakes. The diagnostic gap this guards
// against is the entire reason the P0 task exists: a daemon iteration
// that surfaces as `exit=-1 stderr=(empty)` with no signal collapses
// "child exited with no code" and "child killed by signal" into one
// indistinguishable bucket, blocking debugging.
//
// Pattern: integration / seam test (Wirfs-Brock & McKean 2003 — verify
//   the contract at the seam, not in the leaf module); chaos row 7
//   (failure mode: cloud agent dies from a signal; expected behavior:
//   `signal: SIGKILL` field present in the iteration record).
// Source: TASKS.md `spawn-failed-exit-minus-one-silent-empty-stderr`
//   § "Files" — the task block explicitly lists this file as the new
//   regression-test deliverable; vision.md § Glossary "spawn-failed-
//   exit-minus-one-silent-empty-stderr".
// Conformance: full — drives the production `ProcessSpawnStrategy` +
//   production `runLive`; no in-memory mocks of either; only `GitLike`
//   is faked because spinning up a real git repo would add minutes
//   to the test without exercising any signal-capture path.

import { ProcessSpawnStrategy } from "@minsky/tick-loop";
import { describe, expect, test } from "vitest";

import type { GitLike } from "../src/runner.js";
import type { RunnerPlan } from "../src/spawn-plan.js";

import { runLive } from "../src/runner.js";

/**
 * In-memory `GitLike` fake. Baseline + diff are NOT what we're testing
 * here — the spawn-failed branch in `runLive` short-circuits BEFORE
 * `git.changedFiles` is called, so the diff fake is never reached.
 * `captureBaseline` still runs (it's the first thing `runLive` does)
 * and must return a non-empty string the outcome can echo back.
 */
function fakeGit(): GitLike {
  return {
    captureBaseline(): Promise<string> {
      return Promise.resolve("abc1234");
    },
    changedFiles(): Promise<readonly string[]> {
      return Promise.resolve([]);
    },
  };
}

/**
 * Trivial glob matcher. Never reached on the spawn-failed branch but
 * required by `runLive`'s seam contract.
 */
function neverGlobMatch(): boolean {
  return false;
}

/**
 * Build a `RunnerPlan` pointing at a tmpdir-less synthetic host. The
 * spawn-failed branch never touches the working directory (the child
 * dies before any filesystem write), so we can use any path here.
 */
function makePlan(): RunnerPlan {
  return {
    workingDirectory: "/tmp",
    taskId: "spawn-error-capture-test",
    branchName: "feat/spawn-error-capture-test",
    experimentYamlPath: "/tmp/spawn-error-capture-test.yaml",
    env: { MINSKY_HOST_ROOT: "/tmp/.minsky" },
    systemPromptOverlay: "system prompt",
    brief: "task brief",
    preCommitCommand: "true",
  };
}

describe("spawn-error-capture — real ProcessSpawnStrategy + real runLive", () => {
  test("SIGKILL self-kill: signal=SIGKILL, exitCode=-1, verdict=spawn-failed", async () => {
    // Child sends SIGKILL to itself after 100ms. Mirrors the production
    // failure mode: launchd / EPM / OOM-killer / parent process signal-
    // kills devin before it produces stderr.
    const script =
      "setTimeout(() => process.kill(process.pid, 'SIGKILL'), 100); setInterval(() => {}, 1000);";
    const strategy = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", script],
    });
    const outcome = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: strategy,
      git: fakeGit(),
      globMatchesPath: neverGlobMatch,
    });
    expect(outcome.verdict).toBe("spawn-failed");
    expect(outcome.exitCode).toBe(-1);
    expect(outcome.signal).toBe("SIGKILL");
    // PR URL is null because the spawn-failed branch never reaches the
    // extract-PR-url cascade. `baselineRef` is captured before the
    // spawn so it's the value our fake returned.
    expect(outcome.prUrl).toBeNull();
    expect(outcome.baselineRef).toBe("abc1234");
  });

  test("SIGTERM self-kill: signal=SIGTERM (distinct from SIGKILL bucket)", async () => {
    // SIGTERM is the "parent process asked us to stop" signal — distinct
    // from SIGKILL ("OS killed us"). Both surface as `exit=-1` in the
    // close event, but the signal field is the operator's lifeline for
    // distinguishing them. Without this distinction, the daemon log
    // can't tell SIGTERM-from-supervisor from SIGKILL-from-watchdog,
    // and the wrong remediation gets applied.
    const script =
      "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100); setInterval(() => {}, 1000);";
    const strategy = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", script],
    });
    const outcome = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: strategy,
      git: fakeGit(),
      globMatchesPath: neverGlobMatch,
    });
    expect(outcome.verdict).toBe("spawn-failed");
    expect(outcome.exitCode).toBe(-1);
    expect(outcome.signal).toBe("SIGTERM");
  });

  test("clean non-zero exit: signal is absent (not synthesised as undefined)", async () => {
    // The opposite axis: child exited with a non-zero CODE (no signal).
    // The outcome must NOT carry a `signal` key at all — downstream
    // JSON.stringify must not emit `"signal":null` for the common
    // exit-with-code path. This is enforced by the
    // `exactOptionalPropertyTypes` compiler option, and verified here
    // at runtime against the real strategy.
    const strategy = new ProcessSpawnStrategy({
      command: process.execPath,
      args: ["-e", "process.exit(7);"],
    });
    const outcome = await runLive({
      plan: makePlan(),
      allowedPaths: [],
      spawn: strategy,
      git: fakeGit(),
      globMatchesPath: neverGlobMatch,
    });
    expect(outcome.verdict).toBe("spawn-failed");
    expect(outcome.exitCode).toBe(7);
    expect(outcome).not.toHaveProperty("signal");
  });
});
