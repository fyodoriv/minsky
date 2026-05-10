// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 12 (operator 2026-05-08 — slice 11 closed the lifecycle with `stop-mlx-server`; the symmetric `start-mlx-server` post-restart entry point skips the planner+confirm pipeline when only the server is stopped) -->
/**
 * `@minsky/tick-loop/local-llm-server-start-decision` — pure
 * `decideStartAction` helper for slice 12 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Slice 11 added `minsky stop-mlx-server`; the symmetric counterpart is
 * `minsky start-mlx-server` for the operator who already has the local-LLM
 * stack installed and wants to start the detached server again (post
 * `stop-mlx-server`, post-reboot, after a server crash, …) without going
 * through the full detect → plan → confirm → execute pipeline that
 * `bootstrap-local-llm` runs.
 *
 * `decideStartAction` is the pure decision the wiring layer consults to
 * pick exactly one of four mutually-exclusive paths:
 *
 *   - `already-running`     — PID file points at a live PID AND the
 *                             server answers `GET /v1/models`. No spawn,
 *                             exit 0 with an idempotent message.
 *   - `pid-conflict`        — PID file points at a live PID but the
 *                             server is NOT reachable. Either the server
 *                             is mid-load (operator should wait) or the
 *                             PID is owned by an unrelated process. Refuse
 *                             with a "run stop-mlx-server first" recovery
 *                             hint instead of double-spawning.
 *   - `stale-pid-then-start`— PID file exists but the PID is dead (server
 *                             crashed out-of-band). Unlink the stale file,
 *                             then spawn fresh.
 *   - `fresh-start`         — No PID file (or unparseable). Spawn fresh.
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision over injection** — Hughes 1989 — no I/O; takes a
 *     plain record, returns a discriminated union. The wiring layer
 *     (`bin/minsky.mjs`) gathers the four input fields via `existsSync`
 *     / `readFileSync` / `process.kill(pid, 0)` / `buildServerProbe()`.
 *   - **Strategy / Selector** — Gamma 1994 — the function returns "which
 *     branch to take" rather than itself doing the work. Dispatch lives
 *     entirely in the caller.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: `decideStartAction` returns one of the four
 * variants for every legitimate input, never throws, never reads I/O.
 *
 * | # | Failure mode | Trigger / fault axis | Expected outcome | Chaos test |
 * |---|---|---|---|---|
 * | 1 | No PID file | `pidPresent: false` | `{ kind: "fresh-start" }` | "no pid file" test |
 * | 2 | PID file unparseable | `pidPresent: true`, `parsedPid: undefined` | `{ kind: "fresh-start" }` (caller unlinks during dispatch) | "unparseable pid file" test |
 * | 3 | PID dead | `pidAlive: false` | `{ kind: "stale-pid-then-start", stalePid }` | "stale pid" test |
 * | 4 | PID alive + server reachable | `pidAlive: true`, `serverReachable: true` | `{ kind: "already-running", pid, url }` | "happy idempotent" test |
 * | 5 | PID alive but server unreachable | `pidAlive: true`, `serverReachable: false` | `{ kind: "pid-conflict", pid, url }` | "pid alive but unreachable" test |
 *
 * @module tick-loop/local-llm-server-start-decision
 */

// ---- Types ----------------------------------------------------------------

/**
 * Discriminator for {@link StartAction} — closed set, no `default` branches.
 */
export type StartActionKind =
  | "already-running"
  | "pid-conflict"
  | "stale-pid-then-start"
  | "fresh-start";

/**
 * Decision returned by {@link decideStartAction}. `pid` / `stalePid` /
 * `url` are populated only on the variants where they apply; the
 * caller's switch is exhaustive over `kind`.
 */
export type StartAction =
  | { readonly kind: "already-running"; readonly pid: number; readonly url: string }
  | { readonly kind: "pid-conflict"; readonly pid: number; readonly url: string }
  | { readonly kind: "stale-pid-then-start"; readonly stalePid: number }
  | { readonly kind: "fresh-start" };

/**
 * Input to {@link decideStartAction}. The wiring layer populates each
 * field via the production I/O seams — see the JSDoc on each field for
 * the canonical adapter.
 */
export interface StartDecisionInput {
  /** `existsSync(pidPath)` — `true` iff `.minsky/local-llm.pid` exists. */
  readonly pidPresent: boolean;
  /**
   * Parsed PID from the file. `undefined` when the file is absent OR
   * the contents fail `parseInt` (blank, non-numeric, zero, negative).
   * The caller treats `pidPresent: true, parsedPid: undefined` as
   * "stale + unparseable" — same downstream behaviour as a missing
   * file (fresh-start), but the caller may unlink the bogus file as
   * a tidiness gesture before the spawn.
   */
  readonly parsedPid: number | undefined;
  /**
   * `process.kill(parsedPid, 0)` succeeded (no ESRCH). When `parsedPid`
   * is `undefined`, this field is ignored — set to `false` for clarity.
   */
  readonly pidAlive: boolean;
  /**
   * `GET <serverUrl>/v1/models` returned 200 within the probe's TTL.
   * Caller wires `buildServerProbe()` from `local-llm-probes.ts`.
   */
  readonly serverReachable: boolean;
  /**
   * Probe URL the caller used. Threaded through into the
   * `already-running` / `pid-conflict` outcomes for the operator log.
   */
  readonly serverUrl: string;
}

// ---- decideStartAction ----------------------------------------------------

/**
 * Pure decision: which start path to take given the PID-file state and
 * the server reachability. Same input → same output. No I/O. Never throws.
 *
 * See the failure-mode chaos table at the top of this file for the five
 * input shapes this dispatches.
 *
 * @otel-exempt pure decision; the caller's I/O dispatch carries the span.
 */
export function decideStartAction(input: StartDecisionInput): StartAction {
  if (!input.pidPresent || input.parsedPid === undefined) {
    return { kind: "fresh-start" };
  }
  const pid = input.parsedPid;
  if (!input.pidAlive) {
    return { kind: "stale-pid-then-start", stalePid: pid };
  }
  if (input.serverReachable) {
    return { kind: "already-running", pid, url: input.serverUrl };
  }
  return { kind: "pid-conflict", pid, url: input.serverUrl };
}
