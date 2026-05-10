// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 13 (operator 2026-05-08 — slice 10 spawns the detached `mlx_lm.server` and writes its log to `.minsky/local-llm.log`; slice 13 exposes that log via `minsky logs mlx-server` so the operator can observe model-load progress / crash diagnostics through the same `minsky logs` UX they use for worker logs) -->
/**
 * `@minsky/tick-loop/logs-target-decision` — pure `decideLogsTarget`
 * helper for slice 13 of P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Slice 10 introduced the detached `mlx_lm.server` whose stdout/stderr
 * is redirected to `.minsky/local-llm.log` (see `LOCAL_LLM_LOG_PATH` in
 * `bin/minsky.mjs`). When the model crashes mid-iteration or hangs on
 * load, the operator currently has to know that path exists and
 * `tail -F` it by hand. Slice 13 routes `minsky logs mlx-server` (or the
 * shorthand `minsky logs mlx`) through the same `tailWithPretty` codepath
 * the worker logs use, so the operator's mental model is "one command
 * tails any minsky-managed log".
 *
 * `decideLogsTarget` is the pure dispatch the wiring layer consults to
 * pick exactly one of two mutually-exclusive paths:
 *
 *   - `mlx-server` — operator passed `mlx-server` or the shorthand `mlx`.
 *                    Wiring tails {@link LOCAL_LLM_LOG_PATH}.
 *   - `worker`     — every other input. The decision parses the
 *                    optional numeric worker-id (default 0) and the
 *                    wiring layer tails `<WORKERS_DIR>/<id>.log`.
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision over injection** — Hughes 1989 — no I/O; takes a
 *     plain `string | undefined` and returns a discriminated union.
 *     Path resolution + `existsSync` lives in the caller.
 *   - **Strategy / Selector** — Gamma 1994 — same shape as
 *     `decideStartAction` (slice 12) and `stopLocalLlmServer` (slice 11):
 *     pure decision returning a closed-set kind, dispatch in `bin/minsky.mjs`.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: for every `string | undefined` input
 * `decideLogsTarget` returns a closed-set variant; never throws, never
 * reads I/O.
 *
 * | # | Failure mode | Trigger / fault axis | Expected outcome | Chaos test |
 * |---|---|---|---|---|
 * | 1 | No arg                  | `arg: undefined`         | `{ kind: "worker", workerId: 0 }`         | "no arg → worker 0" |
 * | 2 | Numeric worker id       | `arg: "1"`               | `{ kind: "worker", workerId: 1 }`         | "numeric arg → that worker" |
 * | 3 | `mlx-server` literal    | `arg: "mlx-server"`      | `{ kind: "mlx-server" }`                  | "mlx-server keyword" |
 * | 4 | `mlx` shorthand         | `arg: "mlx"`             | `{ kind: "mlx-server" }`                  | "mlx shorthand" |
 * | 5 | Unknown non-numeric arg | `arg: "frob"`            | `{ kind: "worker", workerId: 0 }` (default) | "unknown arg falls through" |
 *
 * @module tick-loop/logs-target-decision
 */

// ---- Types ----------------------------------------------------------------

/**
 * Discriminator for {@link LogsTarget} — closed set, no `default` branches.
 */
export type LogsTargetKind = "worker" | "mlx-server";

/**
 * Decision returned by {@link decideLogsTarget}. The `worker` variant
 * carries the parsed numeric id (default 0); `mlx-server` carries no
 * fields — the wiring layer's `LOCAL_LLM_LOG_PATH` is the resolved path.
 */
export type LogsTarget =
  | { readonly kind: "worker"; readonly workerId: number }
  | { readonly kind: "mlx-server" };

// ---- decideLogsTarget -----------------------------------------------------

/**
 * Pure decision: which log target the operator selected. Same input →
 * same output. No I/O. Never throws.
 *
 * Recognised mlx-server keywords: `mlx-server`, `mlx`. Anything else
 * that doesn't parse as a non-negative integer falls through to the
 * default worker (id 0) — same default `runLogs` already uses for
 * unrecognised input.
 *
 * @otel-exempt pure decision; the caller's `tailWithPretty` carries the span.
 */
export function decideLogsTarget(arg: string | undefined): LogsTarget {
  if (arg === "mlx-server" || arg === "mlx") {
    return { kind: "mlx-server" };
  }
  if (arg !== undefined && /^\d+$/.test(arg)) {
    return { kind: "worker", workerId: Number(arg) };
  }
  return { kind: "worker", workerId: 0 };
}
