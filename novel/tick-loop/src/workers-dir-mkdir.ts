// <!-- scope: human-approved minsky-runtime-resilience slice 2 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
/**
 * `@minsky/tick-loop/workers-dir-mkdir` — pure wrapper around
 * `mkdirSync({ recursive: true })` that classifies common errnos
 * into operator-actionable recovery hints. Slice 2 of P0 task
 * `minsky-runtime-resilience` per `TASKS.md`.
 *
 * Why: when MINSKY_HOME itself is unwritable (typical in the multi-
 * machine pattern — dotfiles' hardcoded path is wrong on this
 * machine), `mkdirSync(WORKERS_DIR, { recursive: true })` in
 * `bin/minsky.mjs` throws EACCES and crashes with a node stack
 * trace pointing at the I/O call, not at the substrate misconfig.
 * The right boundary (rule #6) is loud-crash with a one-line
 * operator-actionable message naming the path + the recovery
 * command (`chmod u+w <path>` or `MINSKY_HOME=<writable-path>`).
 *
 * The helper itself is pure-over-injection so the test layer can
 * simulate each errno; the wiring in `bin/minsky.mjs` calls it,
 * inspects the outcome, and decides whether to continue or exit 1.
 *
 * Pattern conformance (rule #8): Pure decision function (Hughes
 * 1989); Loud-crash boundary (Armstrong 2007 — replaces node's stack
 * trace with a structured operator-facing line). Sources: Beyer et
 * al. (SRE) Ch. 6.
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | mkdir succeeds | Normal operation | `{ ok: true }` | "happy path" |
 * | 2 | EACCES | Wrong owner / wrong permissions | `{ ok: false, errCode: "EACCES", recoveryHint }` | "EACCES" |
 * | 3 | EROFS | Read-only mount | `{ ok: false, errCode: "EROFS", recoveryHint }` | "EROFS" |
 * | 4 | unknown errno | Exotic FS, container quirks | `{ ok: false, errCode, recoveryHint=generic }` | "chaos: unknown errno" |
 *
 * @module tick-loop/workers-dir-mkdir
 */

/** Outcome returned by {@link ensureWorkersDir}. */
export type WorkersDirMkdirOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errCode: string;
      readonly recoveryHint: string;
    };

/**
 * Wrap `mkdirSync({ recursive: true })` and classify common errnos.
 *
 * @otel-exempt pure wrapper — single I/O call, no spans of its own;
 *   the caller carries the span when invoking from the bin script.
 */
export function ensureWorkersDir(opts: {
  readonly dir: string;
  readonly mkdirSyncFn: (dir: string, options: { recursive: true }) => void;
}): WorkersDirMkdirOutcome {
  try {
    opts.mkdirSyncFn(opts.dir, { recursive: true });
    return { ok: true };
    // rule-6: handled-locally — mkdir errno is the operator-actionable boundary; classifying it into a recovery hint IS the loud-fail (caller exits 1 with the path-aware message), per Armstrong 2007 ("let it crash AT the right boundary"). Re-throwing here would leak a node stack trace at the operator, which is exactly the failure mode this slice eliminates.
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return {
      ok: false,
      errCode: code,
      recoveryHint: recoveryHintFor(code, opts.dir),
    };
  }
}

function recoveryHintFor(errCode: string, dir: string): string {
  if (errCode === "EACCES") {
    return `the path is not writable by the current user. Try \`chmod u+w ${dir}\` (if owned by current user) OR set MINSKY_HOME to a writable path (e.g., MINSKY_HOME=$HOME/minsky)`;
  }
  if (errCode === "EROFS") {
    return "the parent filesystem is read-only. Set MINSKY_HOME to a writable path (e.g., MINSKY_HOME=/tmp/minsky-state)";
  }
  return `mkdir failed at ${dir} with errno ${errCode}. Verify the path is writable, or set MINSKY_HOME to a writable path (e.g., MINSKY_HOME=$HOME/minsky)`;
}

/**
 * Render the operator-facing error message. Single line, prefixed
 * `minsky:`. Pinned by paired tests so wording stays compact.
 *
 * @otel-exempt pure formatter.
 */
export function formatWorkersDirRecoveryMessage(args: {
  readonly dir: string;
  readonly errCode: string;
  readonly recoveryHint: string;
}): string {
  return `minsky: cannot create workers dir at ${args.dir} (${args.errCode}) — ${args.recoveryHint}`;
}
