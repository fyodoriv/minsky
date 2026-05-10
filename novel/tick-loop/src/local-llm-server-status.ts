// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 14 (operator 2026-05-08 — slice 11 added stop-mlx-server, slice 12 added start-mlx-server, slice 13 added logs mlx-server; the symmetric read-only `minsky status mlx-server` closes the lifecycle quartet so operators can scriptably ask "is the server running?" without the heavyweight `minsky doctor` probe matrix) -->
/**
 * `@minsky/tick-loop/local-llm-server-status` — pure
 * `summarizeMlxServerStatus` decision for slice 14 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Slices 11–13 added stop / start / logs subcommands for the detached
 * `mlx_lm.server`. Slice 14 closes the lifecycle quartet with a read-only
 * `minsky status mlx-server` that prints one line summarising "is the
 * server running?" and exits 0/1 so scripts can chain
 * `minsky status mlx-server && next-cmd` without parsing prose.
 *
 * `summarizeMlxServerStatus` is the pure decision the wiring layer
 * consults to pick exactly one of five mutually-exclusive states:
 *
 *   - `running`           — PID file points at a live PID AND the
 *                           server answers `GET /v1/models`.
 *   - `unhealthy`         — PID file points at a live PID but the
 *                           server is NOT reachable. Either mid-load
 *                           or the PID is owned by an unrelated
 *                           process. Signals "needs intervention".
 *   - `stale`             — PID file exists but the PID is dead.
 *                           Operator should `start-mlx-server` (or
 *                           `stop-mlx-server` first to clean the file).
 *   - `not-running`       — No PID file. Server has never been started
 *                           on this machine, or `stop-mlx-server`
 *                           cleaned up after a graceful shutdown.
 *   - `invalid-pid-file`  — PID file exists but the contents are
 *                           unparseable (blank, non-numeric, …).
 *                           Same recovery as `stale`.
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision over injection** — Hughes 1989 — no I/O; takes a
 *     plain record, returns a discriminated union. The wiring layer
 *     (`bin/minsky.mjs`) gathers the four input fields via `existsSync`
 *     / `readFileSync` / `process.kill(pid, 0)` / `buildServerProbe()`.
 *   - **Strategy / Selector** — Gamma 1994 — the function returns
 *     "which state to report" rather than itself doing the I/O.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: `summarizeMlxServerStatus` returns one of the
 * five variants for every legitimate input, never throws, never reads I/O.
 *
 * | # | Failure mode | Trigger / fault axis | Expected outcome | Chaos test |
 * |---|---|---|---|---|
 * | 1 | No PID file | `pidPresent: false` | `{ kind: "not-running" }` | "no pid file" test |
 * | 2 | PID file unparseable | `pidPresent: true`, `parsedPid: undefined` | `{ kind: "invalid-pid-file" }` | "unparseable pid file" test |
 * | 3 | PID dead | `pidAlive: false` | `{ kind: "stale", stalePid }` | "stale pid" test |
 * | 4 | PID alive + server reachable | `pidAlive: true`, `serverReachable: true` | `{ kind: "running", pid, url }` | "happy running" test |
 * | 5 | PID alive but server unreachable | `pidAlive: true`, `serverReachable: false` | `{ kind: "unhealthy", pid, url }` | "alive but unreachable" test |
 *
 * @module tick-loop/local-llm-server-status
 */

// ---- Types ----------------------------------------------------------------

/**
 * Discriminator for {@link MlxServerStatus} — closed set, no `default` branches.
 */
export type MlxServerStatusKind =
  | "running"
  | "unhealthy"
  | "stale"
  | "not-running"
  | "invalid-pid-file";

/**
 * Status returned by {@link summarizeMlxServerStatus}. `pid` / `stalePid` /
 * `url` are populated only on the variants where they apply; the
 * caller's switch is exhaustive over `kind`.
 */
export type MlxServerStatus =
  | { readonly kind: "running"; readonly pid: number; readonly url: string }
  | { readonly kind: "unhealthy"; readonly pid: number; readonly url: string }
  | { readonly kind: "stale"; readonly stalePid: number }
  | { readonly kind: "not-running" }
  | { readonly kind: "invalid-pid-file" };

/**
 * Input to {@link summarizeMlxServerStatus}. Same shape as the slice-12
 * `StartDecisionInput` — the wiring layer can reuse the same probe
 * sequence and just dispatch on a different decision function.
 */
export interface StatusInput {
  /** `existsSync(pidPath)` — `true` iff `.minsky/local-llm.pid` exists. */
  readonly pidPresent: boolean;
  /**
   * Parsed PID from the file. `undefined` when the file is absent OR
   * the contents fail `parseInt`. The caller treats
   * `pidPresent: true, parsedPid: undefined` as `invalid-pid-file`
   * (distinct from `not-running`) so the operator knows there's a
   * stray file to clean up.
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
   * `running` / `unhealthy` outcomes for the operator's terminal log.
   */
  readonly serverUrl: string;
}

// ---- summarizeMlxServerStatus ---------------------------------------------

/**
 * Pure decision: which status to report given the PID-file state and
 * the server reachability. Same input → same output. No I/O. Never throws.
 *
 * See the failure-mode chaos table at the top of this file for the five
 * input shapes this dispatches.
 *
 * @otel-exempt pure decision; the caller's I/O dispatch carries the span.
 */
export function summarizeMlxServerStatus(input: StatusInput): MlxServerStatus {
  if (!input.pidPresent) {
    return { kind: "not-running" };
  }
  if (input.parsedPid === undefined) {
    return { kind: "invalid-pid-file" };
  }
  const pid = input.parsedPid;
  if (!input.pidAlive) {
    return { kind: "stale", stalePid: pid };
  }
  if (input.serverReachable) {
    return { kind: "running", pid, url: input.serverUrl };
  }
  return { kind: "unhealthy", pid, url: input.serverUrl };
}
