// <!-- scope: human-approved minsky-cli-context-aware-ux (operator 2026-05-08) -->
/**
 * `@minsky/tick-loop/minsky-action-plan` — pure decision function that maps
 * a `MinskyContext` snapshot to an action plan. Slice 2 of P0 task
 * `minsky-cli-context-aware-ux`.
 *
 * `planMinskyAction` is a pure function (no I/O): same context → same plan.
 * This is intentional — the operator-facing prompt is the I/O boundary
 * (`minsky-prompt.ts`); the planner stays testable.
 *
 * ## Scenarios (decision order)
 *
 * | Priority | Scenario | Condition |
 * |---|---|---|
 * | 1 | worker-already-running | worker 0 PID is alive |
 * | 2 | claude-exhausted-with-local-stack | exhausted/binary-missing + local-LLM running |
 * | 3 | claude-exhausted-no-stack | exhausted/binary-missing + local-LLM not running |
 * | 4 | git-dirty-cant-iterate | git state is dirty |
 * | 5 | wip-needs-cleanup | conflicting PRs > 0 |
 * | 6 | queue-empty | queue state is empty |
 * | 7 | daemon-mid-iteration | last iteration < 2 h ago |
 * | 8 | clean-fresh-checkout | fallthrough |
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision function** — Hughes, "Why Functional Programming
 *     Matters", 1989. Conformance: full (no I/O, referentially transparent).
 *   - **Strategy pattern** — Gamma et al. 1994 — `planMinskyAction` IS the
 *     strategy; the prompt runner dispatches on it. Conformance: full.
 *
 * @module tick-loop/minsky-action-plan
 */

import type { ClaudeContextState, LocalLlmContextState, MinskyContext } from "./minsky-context.js";

// ---- Types ------------------------------------------------------------------

/**
 * Closed scenario set. Adding a new scenario is a rule-#9 pivot record.
 * The prompt renderer in `minsky-prompt.ts` maps each scenario to a
 * display description.
 */
export type Scenario =
  | "worker-already-running"
  | "claude-exhausted-with-local-stack"
  | "claude-exhausted-no-stack"
  | "git-dirty-cant-iterate"
  | "wip-needs-cleanup"
  | "queue-empty"
  | "daemon-mid-iteration"
  | "clean-fresh-checkout";

/**
 * Closed action identifier set. Each action maps to a concrete function in
 * `bin/minsky.mjs` (the executor). Adding a new action that requires new
 * minsky.mjs wiring is a two-file change.
 */
export type ActionId =
  | "start-worker"
  | "start-worker-local-llm"
  | "attach-worker"
  | "bootstrap-local-llm"
  | "run-doctor"
  | "run-logs"
  | "stop-worker";

/** A single action option shown to the operator. */
export interface MinskyAction {
  readonly id: ActionId;
  readonly label: string;
}

/**
 * The full action plan returned by `planMinskyAction`. The prompt renderer
 * uses `scenario` for the heading, `contextSummary` for the one-line state
 * description, `recommendedAction` for the `[Enter]` default, and
 * `alternatives` for the numbered list.
 */
export interface MinskyActionPlan {
  readonly scenario: Scenario;
  /** One-line human-readable description of the detected state. */
  readonly contextSummary: string;
  /** The default action (executed on `[Enter]` or in non-interactive mode). */
  readonly recommendedAction: MinskyAction;
  /** Numbered alternatives (1-based in the prompt). */
  readonly alternatives: readonly MinskyAction[];
}

// ---- Constants --------------------------------------------------------------

/** Worker runs within the last 2 h are "mid-iteration" (not stale). */
const RECENT_ITERATION_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// ---- planMinskyAction -------------------------------------------------------

/**
 * Map a context snapshot to an action plan. Pure: no I/O.
 *
 * @otel-exempt pure decision function — caller carries the span.
 */
export function planMinskyAction(context: MinskyContext): MinskyActionPlan {
  if (context.workerState.alive) {
    return planWorkerAlreadyRunning(context.workerState.pid);
  }
  if (isClaudeUnavailable(context.claudeState)) {
    return planClaudeExhausted(context.localLlmState, context.claudeState);
  }
  if (context.gitState === "dirty") {
    return planGitDirty(context);
  }
  if (context.prStats.conflicting > 0) {
    return planWipNeedsCleanup(context.prStats.open, context.prStats.conflicting);
  }
  if (context.queueState === "empty") {
    return planQueueEmpty();
  }
  const recentMs = recentIterationMs(context.lastIterationAgeMs);
  if (recentMs !== undefined) {
    return planDaemonMidIteration(recentMs, context.prStats.open);
  }
  return planCleanFreshCheckout();
}

// ---- Scenario builders (extracted to stay under biome complexity cap) -------

function planWorkerAlreadyRunning(pid: number): MinskyActionPlan {
  return {
    scenario: "worker-already-running",
    contextSummary: `Worker 0 is running (PID ${pid})`,
    recommendedAction: { id: "attach-worker", label: "Attach to worker 0 log" },
    alternatives: [
      { id: "stop-worker", label: "Stop worker 0" },
      { id: "run-doctor", label: "Run health check" },
    ],
  };
}

function planClaudeExhausted(
  localLlmState: LocalLlmContextState,
  claudeState: ClaudeContextState,
): MinskyActionPlan {
  // Same action either way (claude can't run); only the *reason* differs so
  // the operator knows whether to install claude or wait for quota reset.
  const reason =
    claudeState === "binary-missing" ? "Claude binary not installed" : "Claude quota exhausted";
  if (localLlmState === "running") {
    return {
      scenario: "claude-exhausted-with-local-stack",
      contextSummary: `${reason}; local-LLM server is running`,
      recommendedAction: {
        id: "start-worker-local-llm",
        label: "Start worker with local-LLM (MINSKY_LLM_PROVIDER=local-preferred)",
      },
      alternatives: [{ id: "run-doctor", label: "Run health check (minsky doctor)" }],
    };
  }
  return {
    scenario: "claude-exhausted-no-stack",
    contextSummary: `${reason}; local-LLM server not running`,
    recommendedAction: {
      id: "bootstrap-local-llm",
      label: "Bootstrap local-LLM stack (minsky bootstrap-local-llm)",
    },
    alternatives: [{ id: "run-doctor", label: "Run health check (minsky doctor)" }],
  };
}

function planGitDirty(context: MinskyContext): MinskyActionPlan {
  const prInfo = context.prStats.open > 0 ? `; ${context.prStats.open} open PR(s)` : "";
  return {
    scenario: "git-dirty-cant-iterate",
    contextSummary: `Git working tree has uncommitted changes${prInfo}`,
    recommendedAction: { id: "start-worker", label: "Start worker anyway (daemon uses worktrees)" },
    alternatives: [{ id: "run-doctor", label: "Run health check" }],
  };
}

function planWipNeedsCleanup(open: number, conflicting: number): MinskyActionPlan {
  return {
    scenario: "wip-needs-cleanup",
    contextSummary: `${conflicting} conflicting PR(s) need attention; ${open} open PR(s) total`,
    recommendedAction: {
      id: "start-worker",
      label: "Start worker (will resolve conflicts)",
    },
    alternatives: [{ id: "run-doctor", label: "Run health check" }],
  };
}

function planQueueEmpty(): MinskyActionPlan {
  return {
    scenario: "queue-empty",
    contextSummary: "Task queue is empty — no unclaimed tasks in TASKS.md",
    recommendedAction: { id: "run-doctor", label: "Run health check (minsky doctor)" },
    alternatives: [{ id: "start-worker", label: "Start worker anyway" }],
  };
}

function planDaemonMidIteration(lastIterationAgeMs: number, openPrs: number): MinskyActionPlan {
  const ageMin = Math.round(lastIterationAgeMs / 60_000);
  const prInfo = openPrs > 0 ? `; ${openPrs} open PR(s)` : "";
  return {
    scenario: "daemon-mid-iteration",
    contextSummary: `Worker last ran ${ageMin}m ago${prInfo}`,
    recommendedAction: { id: "start-worker", label: "Resume worker 0" },
    alternatives: [
      { id: "run-logs", label: "View last log (minsky logs)" },
      { id: "run-doctor", label: "Run health check (minsky doctor)" },
    ],
  };
}

function planCleanFreshCheckout(): MinskyActionPlan {
  return {
    scenario: "clean-fresh-checkout",
    contextSummary: "Clean state — ready to start",
    recommendedAction: { id: "start-worker", label: "Start worker 0" },
    alternatives: [
      { id: "run-doctor", label: "Run health check first (minsky doctor)" },
      { id: "bootstrap-local-llm", label: "Bootstrap local-LLM first" },
    ],
  };
}

// ---- Internal helpers -------------------------------------------------------

/**
 * Claude cannot run iterations. Mirrors the canonical contract in
 * `claude-health-probe.ts` (`needsLocalLlmBootstrap`: `verdict === "exhausted"
 * || verdict === "binary-missing"`) — a fresh checkout with no `claude` on
 * PATH must route to the bootstrap-local-LLM scenario, NOT fall through to
 * `clean-fresh-checkout` and recommend a worker that crashes on spawn.
 */
function isClaudeUnavailable(state: ClaudeContextState): boolean {
  return state === "exhausted" || state === "binary-missing";
}

/**
 * Return `lastIterationAgeMs` if it's within `RECENT_ITERATION_THRESHOLD_MS`,
 * else undefined. Extracted to keep `planMinskyAction` under complexity cap.
 */
function recentIterationMs(lastIterationAgeMs: number | undefined): number | undefined {
  if (lastIterationAgeMs === undefined) return undefined;
  if (lastIterationAgeMs >= RECENT_ITERATION_THRESHOLD_MS) return undefined;
  return lastIterationAgeMs;
}
