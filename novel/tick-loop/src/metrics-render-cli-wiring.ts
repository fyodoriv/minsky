// <!-- scope: human-approved 2026-05-05 user request "every minsky repo must have a list of important metrics … always be visible and updated" — task `canonical-metric-list-per-repo` Acceptance (3) "daemon refreshes daily"; this module is the CLI-side production binding for the `MetricsRenderSeam` that PR #197 wired into `RunDaemonOpts` (substrate from slices 1+2+3 in PR #196). -->
/**
 * `@minsky/tick-loop/metrics-render-cli-wiring` — CLI-side construction of
 * the `MetricsRenderSeam` `runDaemon` dispatches into. Twin of
 * `snapshot-cli-wiring`: the bin script (`bin/tick-loop.mjs`) is the I/O
 * boundary; this module is the smallest unit-testable surface above it.
 *
 * Two primitives:
 *   - `createFileBackedLastRenderedDate(rootDir)` — `() => stat(<rootDir>/METRICS.md).mtime`
 *     formatted as `YYYY-MM-DD` UTC, or `null` on ENOENT (genesis case —
 *     METRICS.md not yet authored). Other errors (EACCES, EISDIR, …)
 *     propagate so the supervisor sees them — rule #6 let-it-crash at the
 *     right boundary. Idempotency for the daily render lives in the file
 *     mtime itself (rule #2 — the file IS the per-day "this happened"
 *     record), so the mtime probe IS the gate.
 *   - `createPnpmMetricsRender(opts?)` — returns a `MetricsRender` that
 *     spawns `pnpm metrics:render --date <date>` (the operator CLI shipped
 *     #196), captures bounded 4 KB stdout/stderr tails (rule #7), and
 *     resolves with the spawn-result shape `runMetricsRender` hands back
 *     as `outcome: "ran"`. Mirrors `createPnpmSnapshotCapture` with one
 *     intentional difference: the base script is `metrics:render`, not
 *     `changelog:snapshot`. Same shape, different command — separate
 *     factory keeps failure modes separable.
 *
 * Pattern (rule #2): pure factories above the file-system + subprocess
 * primitives. The `GetLastRenderedDate` and `MetricsRender` types live in
 * `metrics-render-runner.ts` so this module only supplies the I/O
 * implementation; tests drive a temp-dir + injected `spawnFn` without
 * touching the OS subprocess machinery.
 *
 * Pivot (rule #9): if `stat`-mtime proves insufficient (METRICS.md mtime
 * drifts backwards mid-fire so the same day's render reruns; or a
 * filesystem with non-monotonic mtimes — some tmpfs configurations),
 * tighten `getLastRenderedDate` to read an explicit `_Updated:` marker
 * from the file content rather than mtime. Don't retire the per-day
 * cadence — that IS the contract the freshness lint depends on.
 *
 * @module tick-loop/metrics-render-cli-wiring
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { GetLastRenderedDate, MetricsRender } from "./metrics-render-runner.js";

// ---- Constants ------------------------------------------------------------

const METRICS_FILENAME = "METRICS.md";
const TAIL_CAP_BYTES = 4096;

// ---- File-backed last-rendered-date probe --------------------------------

/**
 * Build a `GetLastRenderedDate` rooted at `rootDir`. Returns the UTC date
 * string (`YYYY-MM-DD`) of `<rootDir>/METRICS.md`'s mtime on success,
 * `null` when the file does not exist (ENOENT — genesis case; the gate
 * flows through to render so the file is authored on the first daemon
 * iteration of a fresh checkout). All other errors (EACCES, EISDIR, …)
 * propagate so the supervisor sees them — rule #6 let-it-crash at the
 * right boundary.
 *
 * The mtime is formatted via `toISOString().slice(0, 10)` so the boundary
 * matches the daemon's `today` derivation (`new Date(now()).toISOString().slice(0, 10)`)
 * exactly — same UTC midnight rollover, same string equality test.
 *
 * Production callers (`bin/tick-loop.mjs`) pass `MINSKY_HOME` as `rootDir`
 * so the probe lands on the same `METRICS.md` `pnpm metrics:render` writes
 * (the script defaults `outputPath` to `<cwd>/METRICS.md`, and the
 * supervisor sets `WorkingDirectory=$MINSKY_HOME` so cwd === rootDir in
 * production).
 *
 * @otel-exempt pure factory; the probe itself is one-shot file I/O whose
 *   call site (`runMetricsRender` → `tick-loop.metrics-render` span)
 *   carries the observability surface.
 */
export function createFileBackedLastRenderedDate(rootDir: string): GetLastRenderedDate {
  const path = resolve(rootDir, METRICS_FILENAME);
  return async (): Promise<string | null> => {
    try {
      const st = await stat(path);
      return st.mtime.toISOString().slice(0, 10);
      // rule-6: handled-locally — ENOENT on METRICS.md is the documented graceful-degrade contract (genesis case, fresh checkout); any other error propagates to the supervisor (Armstrong 2007 — let it crash AT the right boundary)
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  };
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === "string" &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

// ---- pnpm-backed render --------------------------------------------------

/**
 * Configuration for `createPnpmMetricsRender`. Defaults pick `pnpm` +
 * `["metrics:render"]` so the operator CLI is the canonical pipeline
 * (rule #2 — one source of truth; the operator-facing `pnpm metrics:render`
 * IS the command). Tests inject `spawnFn` to drive the wrapper without
 * forking a real subprocess.
 */
export interface PnpmMetricsRenderOptions {
  /** Command to spawn. Default `pnpm`. */
  readonly command?: string;
  /**
   * Base args before `--date <date>`. Default `["metrics:render"]`.
   * Override only when the operator wants a different script (e.g. a
   * dry-run wrapper that shells through `node` directly).
   */
  readonly baseArgs?: readonly string[];
  /**
   * Working directory for the spawn. Default `undefined` (inherit from the
   * parent), which means `pnpm` resolves the workspace root from CWD. The
   * supervisor unit files set `WorkingDirectory=<repo>` so the inherit
   * default is correct in production; tests pass an explicit path.
   */
  readonly cwd?: string;
  /**
   * Optional spawn override — a seam tests use to inject a fake
   * `child_process.spawn` without touching the OS. Production omits.
   */
  readonly spawnFn?: typeof nodeSpawn;
}

/**
 * Build a `MetricsRender` that spawns `pnpm metrics:render --date <date>`
 * and resolves with the spawn-result shape (`exitCode`, `durationMs`,
 * bounded `stdoutTail` / `stderrTail`). Mirrors `createPnpmSnapshotCapture`
 * with two intentional differences:
 *   - base args target `metrics:render`, not `changelog:snapshot`
 *   - the date is appended as `--date <date>` per call (the daemon decides
 *     today's UTC date; the constructor doesn't fix it)
 *
 * Let-it-crash boundary (rule #6, Armstrong 2007): a non-zero exit from the
 * subprocess surfaces as `exitCode !== 0` in the result, NOT a thrown
 * exception. `runMetricsRender` returns it as `outcome: "ran"`; the
 * `tick-loop.metrics-render` span carries `metrics-render.exit_code` so the
 * dashboard sees malformed-snapshot / write-failure cases without taking
 * the daemon down.
 *
 * `child.on("error")` (the "spawn failed" case — `pnpm` not on PATH,
 * EACCES, …) DOES propagate via the promise rejection so the supervisor
 * sees a misconfigured environment as a real crash rather than a silent
 * `exitCode = -1` that masks the root cause.
 *
 * @otel-exempt pure factory; the spawn itself is captured by
 *   `runMetricsRender`'s `tick-loop.metrics-render` span emitted in
 *   `daemon.ts` `emitMetricsRenderSpan`.
 */
export function createPnpmMetricsRender(opts: PnpmMetricsRenderOptions = {}): MetricsRender {
  const command = opts.command ?? "pnpm";
  const baseArgs = opts.baseArgs ?? ["metrics:render"];
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const cwd = opts.cwd;

  return {
    render(input) {
      const args = [...baseArgs, "--date", input.date];
      const startedAt = Date.now();
      return new Promise((resolveResult, rejectResult) => {
        const child: ChildProcess = spawnFn(command, args, {
          env: input.env as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
          ...(cwd === undefined ? {} : { cwd }),
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout?.on("data", (chunk: Buffer) => {
          stdoutChunks.push(chunk);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on("error", (err) => {
          rejectResult(err);
        });

        child.on("close", (code) => {
          resolveResult({
            exitCode: code ?? -1,
            durationMs: Date.now() - startedAt,
            stdoutTail: tailOf(stdoutChunks, TAIL_CAP_BYTES),
            stderrTail: tailOf(stderrChunks, TAIL_CAP_BYTES),
          });
        });
      });
    },
  };
}

function tailOf(chunks: readonly Buffer[], cap: number): string {
  const full = Buffer.concat(chunks as Buffer[]);
  const sliced = full.length <= cap ? full : full.subarray(full.length - cap);
  return sliced.toString("utf8");
}
