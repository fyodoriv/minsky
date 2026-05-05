// <!-- scope: human-approved 2026-05-05 user request "every minsky repo must have a list of important metrics … always be visible and updated" — task `canonical-metric-list-per-repo` Acceptance (3) "daemon refreshes daily". This is the CLI-side production binding for the `MetricsRenderSeam` that the daemon wired in via `RunDaemonOpts` (#197 / slice 4/N). -->
/**
 * `@minsky/tick-loop/metrics-render-cli-wiring` — CLI-side construction of
 * the `MetricsRenderSeam` `runDaemon` dispatches into. Twin of
 * `snapshot-cli-wiring`: the bin script (`bin/tick-loop.mjs`) is the I/O
 * boundary; this module is the smallest unit-testable surface above it.
 *
 * Two primitives:
 *   - `createFileBackedLastRenderedDate(metricsMdPath)` — a
 *     `GetLastRenderedDate` that wraps `fs.stat` against the file. Returns
 *     the mtime UTC date as `YYYY-MM-DD` when the file exists, `null` on
 *     ENOENT (genesis case — `METRICS.md` not yet authored; the runner
 *     flows `null` through to render so the file is created on the first
 *     daemon iteration of a fresh checkout). Other errors (EACCES, EISDIR)
 *     propagate so the supervisor sees them — rule #6 let-it-crash at the
 *     right boundary (Armstrong 2007).
 *   - `createPnpmMetricsRender(opts?)` — a `MetricsRender` that spawns
 *     `pnpm metrics:render --date <date>` (the operator CLI shipped in
 *     slice 3/N, #196), captures bounded stdout/stderr tails (4 KB each
 *     per rule #7), and resolves with the spawn-result shape `runMetricsRender`
 *     hands back as `outcome: "ran"`. NOT a re-use of `SpawnStrategy` —
 *     the daemon's existing strategy targets `claude --print` with the
 *     brief on stdin, while the render targets `pnpm` with `--date <date>`
 *     on argv and no stdin write. Same rationale as `createPnpmSnapshotCapture`.
 *
 * Pattern (rule #2): pure factories above the file-system + subprocess
 * primitives. The `GetLastRenderedDate` and `MetricsRender` types live in
 * `metrics-render-runner.ts` so this module only supplies the I/O
 * implementation; tests drive a temp-dir + injected `spawnFn` without
 * touching the OS subprocess machinery.
 *
 * Pivot (rule #9): if mtime proves insufficient (e.g. a `git checkout`
 * resets METRICS.md mtime backwards mid-day so the same UTC date renders
 * twice), tighten `createFileBackedLastRenderedDate` to parse an explicit
 * `_Updated:` marker out of the file content rather than mtime. The runner
 * JSDoc anticipates this pivot — don't retire the per-day cadence.
 *
 * @module tick-loop/metrics-render-cli-wiring
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { stat } from "node:fs/promises";

import type { GetLastRenderedDate, MetricsRender } from "./metrics-render-runner.js";

// ---- Constants ------------------------------------------------------------

const TAIL_CAP_BYTES = 4096;

// ---- File-backed last-rendered-date probe ---------------------------------

/**
 * Build a `GetLastRenderedDate` rooted at `metricsMdPath`. Returns the
 * file's mtime formatted as `YYYY-MM-DD` (UTC) when the file exists,
 * `null` on ENOENT.
 *
 * The genesis path (`METRICS.md` does not yet exist) returns `null` rather
 * than an error so the runner flows through to render and the file is
 * authored on the first daemon iteration of a fresh checkout. Mirrors
 * `createFileBackedChangelogReader`'s ENOENT graceful-degrade.
 *
 * Other stat errors (EACCES, EISDIR, …) propagate so the supervisor sees
 * a misconfigured repo as a real crash rather than a silent "always
 * render" loop that masks the root cause.
 *
 * @otel-exempt pure factory; the probe itself is one-shot file I/O whose
 *   call site (`runMetricsRender` → `tick-loop.metrics-render` span)
 *   carries the observability surface.
 */
export function createFileBackedLastRenderedDate(metricsMdPath: string): GetLastRenderedDate {
  return async (): Promise<string | null> => {
    try {
      const st = await stat(metricsMdPath);
      return st.mtime.toISOString().slice(0, 10);
      // rule-6: handled-locally — ENOENT is the documented genesis case (METRICS.md not yet authored); converting to `null` IS the contract `runMetricsRender` depends on (Armstrong 2007 — let it crash AT the right boundary, which here is "anything that isn't ENOENT")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  };
}

// ---- pnpm-backed render ---------------------------------------------------

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
   * direct `node scripts/metrics-render.mjs` invocation that bypasses
   * pnpm).
   */
  readonly baseArgs?: readonly string[];
  /**
   * Working directory for the spawn. Default `undefined` (inherit from
   * the parent). Production callers pass `MINSKY_HOME` so `pnpm` resolves
   * the workspace root deterministically; the supervisor unit files set
   * `WorkingDirectory=<repo>` so inherit is also correct, but explicit
   * is cheap and survives operators running the bin from elsewhere.
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
 *   - script name (`metrics:render` vs `changelog:snapshot`)
 *   - target file (`METRICS.md` vs `.minsky/metric-snapshots/<date>.json`) —
 *     a difference that the spawn step does not see; the script handles it
 *
 * Let-it-crash boundary (rule #6, Armstrong 2007): a non-zero exit from the
 * subprocess surfaces as `exitCode !== 0` in the result, NOT a thrown
 * exception. `runMetricsRender` returns it as `outcome: "ran"`; the
 * `tick-loop.metrics-render` span carries `metrics-render.exit_code` so
 * the dashboard sees missing-snapshot / TypeError failures without taking
 * the daemon down.
 *
 * `child.on("error")` (the "spawn failed" case — `pnpm` not on PATH, EACCES,
 * …) DOES propagate via the promise rejection so the supervisor sees a
 * misconfigured environment as a real crash rather than a silent
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
