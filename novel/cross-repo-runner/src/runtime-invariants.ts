// Runtime invariants — checks that run EVERY iteration and catch the class
// of bugs that unit tests systematically miss: integration seam failures,
// configuration drift, stale state, and real-world behavioral divergence.
//
// Pattern: runtime specification monitoring (Havelund & Goldberg 2008).
// These are NOT unit tests (those verify pure functions in isolation).
// These verify that the SYSTEM — config + daemon + agent + git + host —
// is behaving as expected at runtime.
//
// Rule #4: everything measurable, everything visible. Each invariant
// emits a structured result the dashboard/log can consume.

/**
 * Result of a single runtime invariant check.
 */
export interface InvariantResult {
  readonly id: string;
  readonly ok: boolean;
  readonly message: string;
  /** Severity: error = iteration should fail; warn = log + continue. */
  readonly severity: "error" | "warn";
}

/**
 * Context available to invariant checks at runtime.
 */
export interface InvariantContext {
  /** The agent binary resolved by config. */
  readonly agentCommand: string;
  /** The full argv that will be passed to the agent. */
  readonly agentArgv: readonly string[];
  /** The host repo root. */
  readonly hostRoot: string;
  /** Whether git working tree is clean. */
  readonly gitClean: boolean;
  /** The brief content that will be sent to the agent. */
  readonly briefContent: string;
  /** The task ID being worked on. */
  readonly taskId: string;
  /** Duration of last completed iteration in ms (null if first). */
  readonly lastIterationDurationMs: number | null;
  /** Verdict of last completed iteration (null if first). */
  readonly lastIterationVerdict: string | null;
  /** Number of experiment-store records for this task. */
  readonly taskIterationCount: number;
  /** The PID file path and whether the PID is actually alive. */
  readonly daemonPidAlive: boolean;
}

type InvariantCheck = (ctx: InvariantContext) => InvariantResult;

// ── Invariant: agent binary accepts the argv shape we're about to send ──

export const agentArgvSanityCheck: InvariantCheck = (ctx) => {
  const id = "agent-argv-sanity";

  // Devin must have --permission-mode in argv
  if (ctx.agentCommand === "devin" || ctx.agentCommand.includes("devin")) {
    const hasPermMode = ctx.agentArgv.some((a) => a === "--permission-mode");
    if (!hasPermMode) {
      return {
        id,
        ok: false,
        severity: "error",
        message:
          "devin spawn missing --permission-mode — every write tool will be rejected. " +
          "Fix: add --permission-mode dangerous to devin argv in buildAgentConfig.",
      };
    }
  }

  // Devin must have --prompt-file, NOT stdin
  if (ctx.agentCommand === "devin" || ctx.agentCommand.includes("devin")) {
    const hasPromptFile = ctx.agentArgv.some((a) => a === "--prompt-file");
    if (!hasPromptFile) {
      return {
        id,
        ok: false,
        severity: "error",
        message:
          "devin spawn missing --prompt-file — devin panics on stdin pipe. " +
          "Fix: use --prompt-file instead of stdin brief delivery.",
      };
    }
  }

  return { id, ok: true, severity: "warn", message: "agent argv looks sane" };
};

// ── Invariant: brief includes PR creation instructions ──

export const briefIncludesPrInstructions: InvariantCheck = (ctx) => {
  const id = "brief-includes-pr-instructions";
  const hasPrInstruction =
    ctx.briefContent.includes("gh pr create") || ctx.briefContent.includes("git push");

  if (!hasPrInstruction) {
    return {
      id,
      ok: false,
      severity: "warn",
      message:
        "brief does not contain 'gh pr create' or 'git push' — " +
        "the agent may validate work but never open a PR (devin-spawn-no-pr-opened bug class).",
    };
  }
  return { id, ok: true, severity: "warn", message: "brief includes PR instructions" };
};

// ── Invariant: git working tree is clean before spawn ──

export const gitTreeCleanBeforeSpawn: InvariantCheck = (ctx) => {
  const id = "git-tree-clean-before-spawn";
  if (!ctx.gitClean) {
    return {
      id,
      ok: false,
      severity: "warn",
      message:
        "git working tree is dirty — scope-leak detector will attribute " +
        "your uncommitted changes to the agent's diff. Commit first.",
    };
  }
  return { id, ok: true, severity: "warn", message: "git tree clean" };
};

// ── Invariant: task not stuck in a re-pick loop ──

export const taskNotStuckInRepickLoop: InvariantCheck = (ctx) => {
  const id = "task-not-stuck-repick";
  if (ctx.taskIterationCount >= 5 && ctx.lastIterationVerdict !== "validated") {
    return {
      id,
      ok: false,
      severity: "warn",
      message:
        `task ${ctx.taskId} has been picked ${ctx.taskIterationCount} times ` +
        `without a validated outcome — possible re-pick loop. ` +
        `Last verdict: ${ctx.lastIterationVerdict}`,
    };
  }
  return { id, ok: true, severity: "warn", message: "task not stuck" };
};

// ── Invariant: daemon PID file is consistent ──

export const daemonPidConsistent: InvariantCheck = (ctx) => {
  const id = "daemon-pid-consistent";
  // This check is meaningful when we're running in daemon mode
  // A stale PID is the #1 operational failure mode
  if (!ctx.daemonPidAlive) {
    return {
      id,
      ok: false,
      severity: "warn",
      message: "daemon PID file exists but process is not alive — stale PID. " +
        "Fix: rm -f ~/.minsky/daemon.pid",
    };
  }
  return { id, ok: true, severity: "warn", message: "daemon PID consistent" };
};

/**
 * All runtime invariants, in check order.
 */
export const ALL_RUNTIME_INVARIANTS: readonly InvariantCheck[] = [
  agentArgvSanityCheck,
  briefIncludesPrInstructions,
  gitTreeCleanBeforeSpawn,
  taskNotStuckInRepickLoop,
  daemonPidConsistent,
];

/**
 * Run all invariants and return results. Pure — caller builds the context.
 */
export function checkRuntimeInvariants(
  ctx: InvariantContext,
  invariants: readonly InvariantCheck[] = ALL_RUNTIME_INVARIANTS,
): InvariantResult[] {
  return invariants.map((check) => check(ctx));
}

/**
 * Format invariant results as a single log line for daemon.log.
 */
export function formatInvariantSummary(results: InvariantResult[]): string {
  const errors = results.filter((r) => !r.ok && r.severity === "error");
  const warns = results.filter((r) => !r.ok && r.severity === "warn");
  const total = results.length;

  if (errors.length > 0) {
    return `🚨 runtime-invariants: ${errors.length} ERROR(s) — ${errors.map((e) => e.id + ": " + e.message).join("; ")}`;
  }
  if (warns.length > 0) {
    return `⚠️ runtime-invariants: ${warns.length}/${total} warn — ${warns.map((w) => w.id).join(", ")}`;
  }
  return `✅ runtime-invariants: ${total}/${total} ok`;
}
