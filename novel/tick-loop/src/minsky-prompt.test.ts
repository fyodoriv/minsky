/**
 * Paired tests for `minsky-prompt.ts` — slice 3 of
 * `minsky-cli-context-aware-ux`.
 *
 * Tests cover:
 *   - `renderPlan` snapshot for all 8 scenario fixtures (golden output).
 *   - `runInteractive` in non-interactive mode (auto-confirm).
 *   - `runInteractive` in TTY mode: [Enter], digit, invalid input fallback.
 */

import { PassThrough, type Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { MinskyActionPlan, Scenario } from "./minsky-action-plan.js";
import { renderPlan, runInteractive } from "./minsky-prompt.js";

// ---- Fixtures ---------------------------------------------------------------

function makePlan(scenario: Scenario, overrides: Partial<MinskyActionPlan> = {}): MinskyActionPlan {
  const defaults: Record<Scenario, MinskyActionPlan> = {
    "worker-already-running": {
      scenario: "worker-already-running",
      contextSummary: "Worker 0 is running (PID 12345)",
      recommendedAction: { id: "attach-worker", label: "Attach to worker 0 log" },
      alternatives: [
        { id: "stop-worker", label: "Stop worker 0" },
        { id: "run-doctor", label: "Run health check" },
      ],
    },
    "claude-exhausted-with-local-stack": {
      scenario: "claude-exhausted-with-local-stack",
      contextSummary: "Claude quota exhausted; local-LLM server is running",
      recommendedAction: {
        id: "start-worker-local-llm",
        label: "Start worker with local-LLM (MINSKY_LLM_PROVIDER=local-preferred)",
      },
      alternatives: [{ id: "run-doctor", label: "Run health check (minsky doctor)" }],
    },
    "claude-exhausted-no-stack": {
      scenario: "claude-exhausted-no-stack",
      contextSummary: "Claude quota exhausted; local-LLM server not running",
      recommendedAction: {
        id: "bootstrap-local-llm",
        label: "Bootstrap local-LLM stack (minsky bootstrap-local-llm)",
      },
      alternatives: [{ id: "run-doctor", label: "Run health check (minsky doctor)" }],
    },
    "git-dirty-cant-iterate": {
      scenario: "git-dirty-cant-iterate",
      contextSummary: "Git working tree has uncommitted changes",
      recommendedAction: {
        id: "start-worker",
        label: "Start worker anyway (daemon uses worktrees)",
      },
      alternatives: [{ id: "run-doctor", label: "Run health check" }],
    },
    "wip-needs-cleanup": {
      scenario: "wip-needs-cleanup",
      contextSummary: "2 conflicting PR(s) need attention; 5 open PR(s) total",
      recommendedAction: { id: "start-worker", label: "Start worker (will resolve conflicts)" },
      alternatives: [{ id: "run-doctor", label: "Run health check" }],
    },
    "queue-empty": {
      scenario: "queue-empty",
      contextSummary: "Task queue is empty — no unclaimed tasks in TASKS.md",
      recommendedAction: { id: "run-doctor", label: "Run health check (minsky doctor)" },
      alternatives: [{ id: "start-worker", label: "Start worker anyway" }],
    },
    "daemon-mid-iteration": {
      scenario: "daemon-mid-iteration",
      contextSummary: "Worker last ran 42m ago; 3 open PR(s)",
      recommendedAction: { id: "start-worker", label: "Resume worker 0" },
      alternatives: [
        { id: "run-logs", label: "View last log (minsky logs)" },
        { id: "run-doctor", label: "Run health check (minsky doctor)" },
      ],
    },
    "clean-fresh-checkout": {
      scenario: "clean-fresh-checkout",
      contextSummary: "Clean state — ready to start",
      recommendedAction: { id: "start-worker", label: "Start worker 0" },
      alternatives: [
        { id: "run-doctor", label: "Run health check first (minsky doctor)" },
        { id: "bootstrap-local-llm", label: "Bootstrap local-LLM first" },
      ],
    },
  };
  return { ...defaults[scenario], ...overrides };
}

// ---- renderPlan snapshot tests ----------------------------------------------

describe("renderPlan — worker-already-running", () => {
  it("renders the plan for worker-already-running scenario", () => {
    expect(renderPlan(makePlan("worker-already-running"))).toMatchInlineSnapshot(`
      "minsky: Worker 0 is running (PID 12345)

        → Attach to worker 0 log  [Enter to confirm]
        1. Stop worker 0
        2. Run health check
      "
    `);
  });
});

describe("renderPlan — claude-exhausted-with-local-stack", () => {
  it("renders the plan for claude-exhausted-with-local-stack scenario", () => {
    expect(renderPlan(makePlan("claude-exhausted-with-local-stack"))).toMatchInlineSnapshot(`
      "minsky: Claude quota exhausted; local-LLM server is running

        → Start worker with local-LLM (MINSKY_LLM_PROVIDER=local-preferred)  [Enter to confirm]
        1. Run health check (minsky doctor)
      "
    `);
  });
});

describe("renderPlan — claude-exhausted-no-stack", () => {
  it("renders the plan for claude-exhausted-no-stack scenario", () => {
    expect(renderPlan(makePlan("claude-exhausted-no-stack"))).toMatchInlineSnapshot(`
      "minsky: Claude quota exhausted; local-LLM server not running

        → Bootstrap local-LLM stack (minsky bootstrap-local-llm)  [Enter to confirm]
        1. Run health check (minsky doctor)
      "
    `);
  });
});

describe("renderPlan — git-dirty-cant-iterate", () => {
  it("renders the plan for git-dirty-cant-iterate scenario", () => {
    expect(renderPlan(makePlan("git-dirty-cant-iterate"))).toMatchInlineSnapshot(`
      "minsky: Git working tree has uncommitted changes

        → Start worker anyway (daemon uses worktrees)  [Enter to confirm]
        1. Run health check
      "
    `);
  });
});

describe("renderPlan — wip-needs-cleanup", () => {
  it("renders the plan for wip-needs-cleanup scenario", () => {
    expect(renderPlan(makePlan("wip-needs-cleanup"))).toMatchInlineSnapshot(`
      "minsky: 2 conflicting PR(s) need attention; 5 open PR(s) total

        → Start worker (will resolve conflicts)  [Enter to confirm]
        1. Run health check
      "
    `);
  });
});

describe("renderPlan — queue-empty", () => {
  it("renders the plan for queue-empty scenario", () => {
    expect(renderPlan(makePlan("queue-empty"))).toMatchInlineSnapshot(`
      "minsky: Task queue is empty — no unclaimed tasks in TASKS.md

        → Run health check (minsky doctor)  [Enter to confirm]
        1. Start worker anyway
      "
    `);
  });
});

describe("renderPlan — daemon-mid-iteration", () => {
  it("renders the plan for daemon-mid-iteration scenario", () => {
    expect(renderPlan(makePlan("daemon-mid-iteration"))).toMatchInlineSnapshot(`
      "minsky: Worker last ran 42m ago; 3 open PR(s)

        → Resume worker 0  [Enter to confirm]
        1. View last log (minsky logs)
        2. Run health check (minsky doctor)
      "
    `);
  });
});

describe("renderPlan — clean-fresh-checkout", () => {
  it("renders the plan for clean-fresh-checkout scenario", () => {
    expect(renderPlan(makePlan("clean-fresh-checkout"))).toMatchInlineSnapshot(`
      "minsky: Clean state — ready to start

        → Start worker 0  [Enter to confirm]
        1. Run health check first (minsky doctor)
        2. Bootstrap local-LLM first
      "
    `);
  });
});

// ---- runInteractive — non-interactive mode ----------------------------------

describe("runInteractive — non-interactive mode", () => {
  function makeOpts(output: string[]) {
    const stdout = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    return {
      stdin: new PassThrough(),
      stdout,
      isTty: false,
    };
  }

  it("returns recommended action immediately in non-TTY mode", async () => {
    const output: string[] = [];
    const plan = makePlan("clean-fresh-checkout");
    const action = await runInteractive(plan, makeOpts(output));
    expect(action).toBe("start-worker");
  });

  it("writes a one-line non-interactive summary", async () => {
    const output: string[] = [];
    const plan = makePlan("clean-fresh-checkout");
    await runInteractive(plan, makeOpts(output));
    const combined = output.join("");
    expect(combined).toContain("non-interactive");
    expect(combined).toContain("Start worker 0");
  });
});

// ---- runInteractive — TTY mode ----------------------------------------------

function makeStdinFromString(input: string): Readable {
  const pt = new PassThrough();
  pt.end(`${input}\n`);
  return pt;
}

function makeTtyOpts(input: string, output: string[]) {
  const stdout = new Writable({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      output.push(chunk.toString());
      cb();
    },
  });
  return {
    stdin: makeStdinFromString(input),
    stdout,
    isTty: true,
  };
}

describe("runInteractive — TTY: Enter confirms recommended action", () => {
  it("returns recommended action on empty input", async () => {
    const plan = makePlan("daemon-mid-iteration");
    const action = await runInteractive(plan, makeTtyOpts("", []));
    expect(action).toBe("start-worker");
  });

  it("returns recommended action on 'y' input", async () => {
    const plan = makePlan("daemon-mid-iteration");
    const action = await runInteractive(plan, makeTtyOpts("y", []));
    expect(action).toBe("start-worker");
  });
});

describe("runInteractive — TTY: digit selects alternative", () => {
  it("returns first alternative on input '1'", async () => {
    const plan = makePlan("daemon-mid-iteration");
    const action = await runInteractive(plan, makeTtyOpts("1", []));
    expect(action).toBe("run-logs");
  });

  it("returns second alternative on input '2'", async () => {
    const plan = makePlan("daemon-mid-iteration");
    const action = await runInteractive(plan, makeTtyOpts("2", []));
    expect(action).toBe("run-doctor");
  });
});

describe("runInteractive — TTY: invalid input falls back to recommended", () => {
  it("returns recommended action on out-of-range digit", async () => {
    const plan = makePlan("daemon-mid-iteration");
    const action = await runInteractive(plan, makeTtyOpts("9", []));
    expect(action).toBe("start-worker");
  });

  it("returns recommended action on non-numeric input", async () => {
    const plan = makePlan("daemon-mid-iteration");
    const action = await runInteractive(plan, makeTtyOpts("garbage", []));
    expect(action).toBe("start-worker");
  });
});
