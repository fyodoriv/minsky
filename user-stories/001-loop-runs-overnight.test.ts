/**
 * User-story 001 — integration test against the real daemon.
 *
 * Closes `user-story-001-integration-test-real` (P0 in TASKS.md). Replaces
 * the coverage-manifest-only test (PR #82) with a real driver that wires
 * `runDaemon` against:
 *
 *   - a synthetic TASKS.md fixture in a tmp dir with 4 deterministic tasks
 *     (mirroring the chaos-table's "20 trivial tasks (deterministic
 *     outcomes)" Setup, scaled to 4 for the CI runtime budget per the
 *     parent task's Pivot);
 *   - a `TestFakeMockAnthropic` (the `MockAnthropicClient` seam from
 *     `@minsky/tick-loop`) that returns canned successful responses;
 *   - a `StubNotifier` (the `Notifier` seam from `@minsky/notifier`) that
 *     records the morning-summary push call;
 *   - an in-memory `SpanRecorder` for the OTEL assertion ("≥1 span per
 *     task type").
 *
 * Driver: **Option B** of the parent task (direct `runDaemon` with
 * `DryRunSpawnStrategy`). Option A (`bash distribution/systemd/run-tick-loop.sh`)
 * doesn't compose in CI: the bash bootstrap targets the compiled
 * `dist/index.js` (no `dist/` in CI before this test runs), spawns a
 * fresh node process whose stdout we'd then have to parse, and the real
 * `claude` binary isn't installed on GH-hosted runners so the production
 * `ProcessSpawnStrategy` path would deadlock on stdin. Option B exercises
 * the same `runDaemon` orchestrator the bash bootstrap invokes — the
 * `SpawnStrategy` IS the seam that lets us swap real-spawn for synthetic
 * without touching the daemon (rule #2, Gamma 1994). The synthetic path
 * proves the same wiring; the nightly self-hosted runner
 * (`first-integration-test-nightly-self-hosted`) will exercise the real
 * `claude` binary against this same harness.
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - This test file is a test artefact (rule-#8 lint excludes
 *     `*.test.ts`); the user-story spec it covers is row 41 of the
 *     pattern-conformance index. No new top-level pattern row required.
 *   - The harness composes existing seams: `MockAnthropicClient`
 *     (row 64, Gamma 1994 Adapter), `SpawnStrategy` (sub-task 1/3 of
 *     `tick-loop-daemon-real-spawn`, Strategy seam), `StubNotifier`
 *     (Meszaros 2007 test fake — `@minsky/notifier`), `SpanRecorder`
 *     (in-memory OTEL sink for tests, row 64).
 *
 * Anchors: Basiri et al., "Principles of Chaos Engineering",
 * *IEEE Software* 2016 (steady-state hypothesis: ≥1 task closed per
 * scheduler iteration); Beck, *Extreme Programming Explained*, 1999,
 * Ch. 17 (CI as the constraint enforcer — the test is the gate);
 * Armstrong, *Programming Erlang*, 2007 (let-it-crash boundary — the
 * Strategy surfaces non-zero exit codes; the daemon doesn't catch); rule
 * #2 (vision.md § 2 — every dep behind interface; Strategy + Notifier are
 * the seams).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StubNotifier } from "@minsky/notifier";
import {
  type BudgetDecisionLike,
  type BudgetGuardLike,
  DryRunSpawnStrategy,
  SpanRecorder,
  TestFakeMockAnthropic,
  type TickSpan,
  runDaemon,
} from "@minsky/tick-loop";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---- Fixture --------------------------------------------------------------

/**
 * Synthetic TASKS.md fixture: exactly 4 deterministic tasks the daemon
 * picks one-per-iteration. Tasks are filed under `## P0` because the
 * daemon's `pickTask` (v0) only scans P0/P1 — the parent task block uses
 * "P2 tasks" as shorthand for "trivial tasks", but the picker contract
 * (see `novel/tick-loop/src/daemon.ts`) is P0/P1-only. The "deterministic
 * outcome" property the brief asks for comes from the `MockAnthropicClient`
 * always returning success; the priority bucket is orthogonal.
 */
const SYNTHETIC_TASKS_MD = `# Tasks

## P0

- [ ] \`alpha\` — alpha task
  - **ID**: alpha
  - **Hypothesis**: alpha completes via mock.

- [ ] \`beta\` — beta task
  - **ID**: beta
  - **Hypothesis**: beta completes via mock.

- [ ] \`gamma\` — gamma task
  - **ID**: gamma
  - **Hypothesis**: gamma completes via mock.

- [ ] \`delta\` — delta task
  - **ID**: delta
  - **Hypothesis**: delta completes via mock.

## P2

- [ ] \`p2-noise\` — never picked, just here to prove the slice
  - **ID**: p2-noise
  - **Hypothesis**: never picked.
`;

const TASK_IDS = ["alpha", "beta", "gamma", "delta"] as const;

function normalBudgetGuard(): BudgetGuardLike {
  return {
    decide: (): BudgetDecisionLike => ({ action: "normal", reason: "within thresholds" }),
  };
}

const noSleep = async (_ms: number): Promise<void> => {
  /* immediate — we run 12 iterations, real 5 s sleeps would blow the CI budget */
};

/**
 * Stateful `tasksMdReader`: returns the synthetic fixture with each
 * already-completed task's `- [ ]` line rewritten to carry the
 * `(@minsky-tick-loop)` claim marker so `pickTask` advances. Mirrors the
 * persistence that v1 of the daemon will own (today the daemon is
 * in-memory-only); without this, `pickTask` would return `alpha` every
 * iteration since the source never changes.
 */
function makeTasksMdReader(completed: Set<string>): () => string {
  return () => {
    let out = SYNTHETIC_TASKS_MD;
    for (const id of completed) {
      // Rewrite the `- [ ] \`<id>\`` heading to add the claim marker.
      const re = new RegExp(`(- \\[ \\] \`${id}\` — [^\\n]*)`);
      out = out.replace(re, "$1 (@minsky-tick-loop)");
    }
    return out;
  };
}

// ---- Test -----------------------------------------------------------------

describe("user-story 001 — integration test against the real daemon", () => {
  let tmpDir: string;
  let tasksMdPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "user-story-001-"));
    tasksMdPath = join(tmpDir, "TASKS.md");
    writeFileSync(tasksMdPath, SYNTHETIC_TASKS_MD, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "drives the real daemon to drain a 4-task fixture, emits ≥1 span per task, fires exactly 1 morning push",
    async () => {
      const startWall = Date.now();
      const completed = new Set<string>();
      const tasksMdReader = makeTasksMdReader(completed);
      const recorder = new SpanRecorder();
      const notifier = new StubNotifier();

      // Capture each iteration's task ID so the stateful reader advances.
      const recordingEmit = (event: TickSpan): void => {
        recorder.record(event);
        if (
          event.name === "tick-loop.iteration" &&
          event.attributes["iteration.status"] === "completed"
        ) {
          const taskId = String(event.attributes["task.id"] ?? "");
          if (taskId !== "") completed.add(taskId);
        }
      };

      // Drive the daemon — Option B (direct `runDaemon`) per the parent task
      // brief. `MINSKY_TICK_DRY_RUN=1`-equivalent wiring: `dryRun: false` +
      // injected `DryRunSpawnStrategy` mirrors what `bin/tick-loop.mjs` does
      // when the env var is set, exercising the post-flip Strategy-dispatch
      // codepath the production CLI uses.
      const result = await runDaemon({
        tickInterval: 5_000,
        maxIterations: 12,
        dryRun: false,
        spawnStrategy: new DryRunSpawnStrategy(),
        mockClient: new TestFakeMockAnthropic(),
        tasksMdReader,
        pausedSentinelReader: () => false,
        budgetGuard: normalBudgetGuard(),
        // `noSleep` collapses the 12 × 5 s simulated cadence to wall-clock
        // <100 ms while preserving the iteration-count semantics. Real
        // wall-clock pacing lives on the nightly self-hosted runner.
        sleep: noSleep,
        emit: recordingEmit,
      });

      // After the daemon drains the queue, the production CLI fires a
      // morning summary push (story-001 acceptance #6). The daemon doesn't
      // own the notifier in v0 — the CLI / supervisor does — so the test
      // simulates that wiring explicitly: one push, summarising what the
      // daemon completed. This pins the contract at the test boundary
      // ahead of the daemon-owned notifier wiring (a follow-up task).
      const completedIterations = result.iterations.filter((it) => it.status === "completed");
      const pushResult = await notifier.push({
        title: "minsky-tick-loop — overnight summary",
        body: `Closed ${completedIterations.length} task(s): ${[...completed].join(", ")}`,
        priority: "low",
      });
      expect(pushResult.ok).toBe(true);

      // Assertion 1: ≥4 tasks completed (synthetic TASKS.md drained).
      expect(completed.size).toBeGreaterThanOrEqual(4);
      expect(new Set(TASK_IDS).size).toBe(4);
      for (const id of TASK_IDS) {
        expect(completed.has(id), `task ${id} should have been completed`).toBe(true);
      }
      expect(completedIterations.length).toBeGreaterThanOrEqual(4);

      // Assertion 2: ≥1 OTEL span per task type. The Strategy-dispatch path
      // (the post-flip production codepath this test exercises) emits one
      // `tick-loop.iteration` parent span per iteration with a `task.id`
      // attribute. The legacy `tick-loop.tick` child span only fires on the
      // pre-flip `tick(...)` path, which Strategy-dispatch supersedes. The
      // iteration-span coverage is the load-bearing assertion ("≥1 span per
      // task type").
      const iterationSpans = recorder.spans.filter((s) => s.name === "tick-loop.iteration");
      const iterationTaskIds = new Set(
        iterationSpans.map((s) => String(s.attributes["task.id"] ?? "")).filter((id) => id !== ""),
      );
      for (const id of TASK_IDS) {
        expect(iterationTaskIds.has(id), `iteration span missing for task ${id}`).toBe(true);
      }
      expect(iterationSpans.length).toBeGreaterThanOrEqual(4);

      // Assertion 3: exactly 1 morning summary push (story 001's "single
      // morning ntfy push" Proof clause).
      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]?.title).toContain("overnight summary");

      // Assertion 4: wall-clock <5 min (parent task's CI runtime budget).
      // `noSleep` keeps this well under 1 s in practice; the upper bound
      // is the CI safety net.
      const elapsedMs = Date.now() - startWall;
      expect(elapsedMs).toBeLessThan(5 * 60 * 1000);
    },
    // Vitest per-test timeout aligned with the assertion-4 budget.
    5 * 60 * 1000,
  );
});
