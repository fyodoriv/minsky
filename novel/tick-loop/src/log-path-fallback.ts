// <!-- scope: human-approved minsky-runtime-resilience slice 2 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
/**
 * `@minsky/tick-loop/log-path-fallback` — pure decision over an
 * injected `openSyncFn` that picks where to write the worker's log:
 * primary path first, then a `/tmp` fallback on EACCES / EROFS /
 * ENOSPC. Slice 2 of P0 task `minsky-runtime-resilience` per
 * `TASKS.md`.
 *
 * Why: when MINSKY_HOME points at a path the current user can't
 * write (the multi-machine pattern from PRs #394/#395 — different
 * username on a different machine, dotfiles' hardcoded path is
 * wrong), `bin/minsky.mjs`'s `openSync(logPath, "a")` call throws
 * EACCES and crashes the CLI with a node stack trace. The right
 * boundary (rule #6, Armstrong 2007) is graceful-degrade: log to
 * `/tmp` and warn, so the daemon still runs and the operator can
 * still see logs while they fix the underlying permission.
 *
 * Pattern conformance (rule #8): Pure decision function (Hughes
 * 1989); Graceful-degrade-AT-the-right-boundary (Armstrong 2007 —
 * `let it crash` doesn't apply here because the I/O failure has a
 * deterministic recovery path: the tmp dir). Sources: Beyer et al.
 * (SRE) Ch. 6 — health/observability surfaces must survive partial
 * failure of their substrate.
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | primary writable | Normal operation | `{ path: primary, fellBack: false, fd }` | "primary writable" |
 * | 2 | primary EACCES | Permission denied | falls back to tmp + reason="EACCES …" | "fallback paths — EACCES" |
 * | 3 | primary EROFS | Read-only mount | falls back to tmp + reason="EROFS …" | "fallback paths — EROFS" |
 * | 4 | primary ENOSPC | Disk full | falls back to tmp + reason="ENOSPC …" | "fallback paths — ENOSPC" |
 * | 5 | both fail | Tmp also unwritable | throws (loud-crash, Armstrong) | "chaos — both paths fail" |
 * | 6 | unknown errno | EBUSY, EROFS variants, etc. | does NOT fall back; bubbles up | "chaos — unknown errno" |
 *
 * @module tick-loop/log-path-fallback
 */

/**
 * Return shape. `fellBack: false` → primary worked; `fellBack: true`
 * → primary failed with a recoverable errno; `reason` carries the
 * errno + message so the caller can log it.
 */
export type LogPathOutcome = {
  readonly path: string;
  readonly fellBack: boolean;
  readonly fd: number;
  readonly reason?: string;
};

/** Errno codes that justify falling back to `/tmp`. */
const FALLBACK_ERRNOS = new Set(["EACCES", "EROFS", "ENOSPC"]);

/**
 * Pick where to open the log file. Pure-over-injection: production
 * wiring in `bin/minsky.mjs` passes `node:fs.openSync`; tests pass
 * a synthetic that simulates each errno.
 *
 * On primary success → return primary's fd. On primary failure with
 * a recoverable errno → try the tmp fallback. On primary success
 * with non-recoverable errno (EBUSY, etc.) → throw (loud-crash).
 * On both-fail → throw (loud-crash — Armstrong 2007: even
 * graceful-degrade has a boundary, and "no log path works at all"
 * means the substrate is broken beyond the helper's recovery).
 *
 * @otel-exempt pure decision function — caller's spawn is what
 *   carries the otel attribute (logPath, fellBack).
 */
export function pickLogPath(opts: {
  readonly primary: string;
  readonly fallbackTmp: string;
  readonly openSyncFn: (path: string, flags: string) => number;
}): LogPathOutcome {
  try {
    const fd = opts.openSyncFn(opts.primary, "a");
    return { path: opts.primary, fellBack: false, fd };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === undefined || !FALLBACK_ERRNOS.has(code)) {
      throw err;
    }
    const reason = `${code}: ${(err as Error).message}`;
    // Primary failed with a recoverable errno. Try the tmp fallback.
    // If THAT also fails, we throw the SECOND error (so the operator
    // sees the actual blocker, not the original).
    const fd = opts.openSyncFn(opts.fallbackTmp, "a");
    return { path: opts.fallbackTmp, fellBack: true, fd, reason };
  }
}
