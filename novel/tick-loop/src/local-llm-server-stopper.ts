// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 11 (operator 2026-05-08 — slice 10 wrote `.minsky/local-llm.pid`; the operator needs a one-command graceful stop instead of `kill $(cat .minsky/local-llm.pid) && rm …`) -->
/**
 * `@minsky/tick-loop/local-llm-server-stopper` — pure
 * `stopLocalLlmServer` decision + I/O helper for slice 11 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Slice 10 wrote `.minsky/local-llm.pid` whenever the bootstrap
 * pipeline daemonized `mlx_lm.server`. Slice 11 closes the lifecycle:
 * `minsky stop-mlx-server` reads the PID, sends SIGTERM, and unlinks
 * the file. If the PID is already dead (server crashed / was killed
 * out-of-band), the stale PID file is unlinked so the next bootstrap
 * doesn't think a server is still running.
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision over injection** — Hughes 1989 — every I/O
 *     primitive (read PID file, exists check, kill syscall, unlink)
 *     is injected as `StopServerIo`. The function itself is one
 *     dispatch sequence with no globals.
 *   - **Adapter** — Wirfs-Brock & McKean 2003 — production wires
 *     `readFileSync` / `existsSync` / `process.kill` / `unlinkSync`;
 *     tests inject in-memory fakes.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: `stopLocalLlmServer` returns a discriminated
 * outcome record for every input shape — never throws. Every outcome
 * leaves the filesystem in a consistent state (PID file present iff
 * `kind === "kill-failed"`).
 *
 * | # | Failure mode | Trigger / fault axis | Expected outcome | Chaos test |
 * |---|---|---|---|---|
 * | 1 | No PID file | `pidExistsFn` returns `false` | `{ kind: "no-pid-file" }`; no kill / no unlink | "absent pid file" test |
 * | 2 | PID file unparseable | `readPidFn` returns non-numeric | unlink the file; `{ kind: "invalid-pid-file" }` | "invalid pid file" test |
 * | 3 | PID dead (ESRCH) | `killFn(pid, 0)` throws ESRCH | unlink the file; `{ kind: "stale-cleaned", pid }` | "stale pid" test |
 * | 4 | PID alive | `killFn(pid, 0)` returns; `killFn(pid, SIGTERM)` returns | unlink the file; `{ kind: "stopped", pid }` | "happy stop" test |
 * | 5 | Kill permission denied (EPERM) | `killFn(pid, 0)` returns; `killFn(pid, SIGTERM)` throws EPERM | leave PID file; `{ kind: "kill-failed", pid, reason }` | "kill rejects" test |
 *
 * @module tick-loop/local-llm-server-stopper
 */

// ---- Types ----------------------------------------------------------------

/**
 * Injected I/O seam — production wires the four `node:fs` / `node:process`
 * functions; tests inject in-memory fakes that touch nothing on disk.
 */
export interface StopServerIo {
  /** `existsSync` — returns `true` iff the PID file exists. */
  readonly pidExistsFn: (path: string) => boolean;
  /** `readFileSync(path, "utf8")` — returns the raw PID file contents. */
  readonly readPidFn: (path: string) => string;
  /**
   * `process.kill(pid, signal)`. Caller passes `0` to test liveness
   * (kill(2) returns 0 if the PID exists, throws ESRCH otherwise) and
   * `"SIGTERM"` to actually terminate.
   *
   * Production binding throws `Error` whose `code` field is the errno
   * (`"ESRCH"` / `"EPERM"`); the helper inspects the thrown Error's
   * `code` to dispatch.
   */
  readonly killFn: (pid: number, signal: 0 | NodeJS.Signals) => void;
  /** `unlinkSync` — removes the PID file. Throws on missing file or EACCES. */
  readonly unlinkFn: (path: string) => void;
}

/** Discriminator for {@link StopOutcome} — closed set, no `default` branches. */
export type StopOutcomeKind =
  | "no-pid-file"
  | "invalid-pid-file"
  | "stale-cleaned"
  | "stopped"
  | "kill-failed";

/** Result record returned by {@link stopLocalLlmServer}. */
export interface StopOutcome {
  readonly kind: StopOutcomeKind;
  /** PID parsed from the file, when `kind !== "no-pid-file" | "invalid-pid-file"`. */
  readonly pid?: number;
  /** Short reason string when `kind === "kill-failed"` ("EPERM", "EACCES", etc.). */
  readonly reason?: string;
}

export interface StopLocalLlmServerOpts {
  readonly pidPath: string;
  readonly io: StopServerIo;
}

// ---- stopLocalLlmServer ---------------------------------------------------

/**
 * Read the PID file, send SIGTERM, unlink. Returns a structured outcome;
 * never throws. See the failure-mode chaos table at the top of this file.
 *
 * @otel tick-loop.local-llm-server-stopper.stop
 */
export function stopLocalLlmServer(opts: StopLocalLlmServerOpts): StopOutcome {
  const { pidPath, io } = opts;
  if (!io.pidExistsFn(pidPath)) {
    return { kind: "no-pid-file" };
  }
  const pid = parsePidFile(io.readPidFn(pidPath));
  if (pid === undefined) {
    safeUnlink(io, pidPath);
    return { kind: "invalid-pid-file" };
  }
  if (!isPidAlive(io, pid)) {
    safeUnlink(io, pidPath);
    return { kind: "stale-cleaned", pid };
  }
  const termOutcome = sendSigterm(io, pid);
  if (termOutcome.kind === "kill-failed") {
    return termOutcome;
  }
  safeUnlink(io, pidPath);
  return { kind: "stopped", pid };
}

// ---- Internal helpers (pure, not exported) --------------------------------

/**
 * Parse the PID file's raw text into a positive finite integer. Returns
 * `undefined` for blanks, non-numeric, zero, negative, or non-integer
 * values — the caller treats those as "invalid pid file" and unlinks.
 *
 * (Internal — not exported.)
 */
function parsePidFile(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * Test PID liveness via `kill(pid, 0)`. Returns `true` if the syscall
 * succeeds; `false` on ESRCH (no such process) — the standard POSIX
 * idiom. Other errno values (EPERM — process owned by another UID
 * but exists) are conservatively treated as alive: refusing to clean
 * up another user's PID file is the safer default.
 *
 * (Internal — not exported.)
 */
function isPidAlive(io: StopServerIo, pid: number): boolean {
  try {
    io.killFn(pid, 0);
    return true;
    // rule-6: handled-locally — the kill(2) classification IS the function's purpose; ESRCH is the documented signal for "no such process" and the caller's only path to "stale-cleaned".
  } catch (err) {
    const code = errCode(err);
    if (code === "ESRCH") return false;
    return true;
  }
}

/**
 * Send SIGTERM, classify the result. Returns either `{ kind: "stopped" }`
 * (caller unlinks afterward) or `{ kind: "kill-failed", reason }` with
 * the errno code embedded for the operator's terminal log.
 *
 * (Internal — not exported.)
 */
function sendSigterm(io: StopServerIo, pid: number): StopOutcome {
  try {
    io.killFn(pid, "SIGTERM");
    return { kind: "stopped", pid };
    // rule-6: handled-locally — kill(2) error classification IS the function's purpose; mapping EPERM/ESRCH/EACCES to a structured outcome is the caller's contract.
  } catch (err) {
    const code = errCode(err);
    return { kind: "kill-failed", pid, reason: code ?? "unknown" };
  }
}

/**
 * Best-effort unlink — swallow ENOENT (race: PID file vanished between
 * the existsSync probe and the unlink) and any other I/O error. The
 * caller already determined the kill / cleanup verdict; an unlink
 * failure here would just mask that with a misleading "kill-failed".
 *
 * (Internal — not exported.)
 */
function safeUnlink(io: StopServerIo, pidPath: string): void {
  try {
    io.unlinkFn(pidPath);
    // rule-6: handled-locally — unlink is the cleanup tail; failure here doesn't change the kill verdict, so it's swallowed deliberately.
  } catch {
    // intentional swallow — see JSDoc.
  }
}

/**
 * Extract the errno-style `code` field from a thrown error, falling back
 * to `undefined` if absent. Node's `process.kill` rejections set `.code`
 * to "ESRCH" / "EPERM" / "EINVAL" — the helper threads that to the
 * caller without a class import.
 *
 * (Internal — not exported.)
 */
function errCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err) {
    const c = (err as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}
