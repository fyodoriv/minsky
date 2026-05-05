// <!-- scope: human-approved 2026-05-05 user request "implement a meaningful changelog for humans … as a part of the minsky loop." — task `daily-changelog-for-humans` Details (e) "Snapshots persisted at .minsky/metric-snapshots/<date>.json"; this module is the CLI-side production binding for the `SnapshotSeam` that PR #190 wired into `RunDaemonOpts` (substrate from PR #189). -->
/**
 * `@minsky/tick-loop/snapshot-cli-wiring` — CLI-side construction of the
 * `SnapshotSeam` `runDaemon` dispatches into. Twin of `changelog-cli-wiring`:
 * the bin script (`bin/tick-loop.mjs`) is the I/O boundary; this module is
 * the smallest unit-testable surface above it.
 *
 * Two primitives:
 *   - `createFileBackedSnapshotExists(rootDir)` — `(date) => existsSync(<rootDir>/.minsky/metric-snapshots/<date>.json)`.
 *     Idempotency for snapshot capture lives in the file itself (rule #2,
 *     data-not-code: one source of truth, the JSON file IS the per-day
 *     "this happened" record), so the existence probe IS the gate.
 *   - `createPnpmSnapshotCapture(opts?)` — returns a `SnapshotCapture` that
 *     spawns `pnpm changelog:snapshot --date <date>` (the producer CLI
 *     shipped #188), captures bounded stdout/stderr tails (4 KB each per
 *     rule #7), and resolves with the spawn-result shape `runSnapshot`
 *     hands back as `outcome: "ran"`. NOT a re-use of `SpawnStrategy` —
 *     the daemon's existing strategy targets `claude --print` with the
 *     brief on stdin, while the snapshot capture targets `pnpm` with
 *     `--date <date>` on argv and no stdin write. Different command,
 *     different invocation shape — a separate factory keeps the shape
 *     contract uniform and the failure modes separable.
 *
 * Pattern (rule #2): pure factories above the file-system + subprocess
 * primitives. The `SnapshotExists` and `SnapshotCapture` types live in
 * `snapshot-runner.ts` so this module only supplies the I/O implementation;
 * tests drive a temp-dir + injected `spawnFn` without touching the OS
 * subprocess machinery.
 *
 * Pivot (rule #9): if `existsSync` proves insufficient (race against a
 * partially-written file mid-fire — the writer atomically renames in
 * production, but a stale `existsSync=true` against a 0-byte truncation
 * would still skip), tighten to a content-shape probe (parse the JSON,
 * assert the `metrics` field is non-empty). Don't retire the factory —
 * the file-as-record contract is the data-not-code substrate.
 *
 * @module tick-loop/snapshot-cli-wiring
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { SnapshotCapture, SnapshotExists } from "./snapshot-runner.js";

// ---- Constants ------------------------------------------------------------

const SNAPSHOTS_SUBDIR = ".minsky/metric-snapshots";
const TAIL_CAP_BYTES = 4096;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- File-backed existence probe -----------------------------------------

/**
 * Build a `SnapshotExists` rooted at `rootDir`. Returns `true` when
 * `<rootDir>/.minsky/metric-snapshots/<date>.json` is present, `false`
 * otherwise. Defense-in-depth: rejects malformed `date` strings (anything
 * not matching `YYYY-MM-DD`) by treating them as non-existent so a buggy
 * caller can't probe arbitrary paths via traversal — the fire happens
 * downstream and the spawn step would also reject the malformed `--date`.
 *
 * The directory does not need to exist; `existsSync` on a missing parent
 * is `false`. Production callers (`bin/tick-loop.mjs`) pass `MINSKY_HOME`
 * as `rootDir` so the snapshot store lives next to TASKS.md / state /
 * cto-audit-lock.
 *
 * @otel-exempt pure factory; the probe itself is one-shot file I/O whose
 *   call site (`runSnapshot` → `tick-loop.snapshot` span) carries the
 *   observability surface.
 */
export function createFileBackedSnapshotExists(rootDir: string): SnapshotExists {
  return async (date: string): Promise<boolean> => {
    if (!DATE_RE.test(date)) return false;
    return existsSync(resolve(rootDir, SNAPSHOTS_SUBDIR, `${date}.json`));
  };
}

// ---- pnpm-backed capture --------------------------------------------------

/**
 * Configuration for `createPnpmSnapshotCapture`. Defaults pick `pnpm` +
 * `["changelog:snapshot"]` so the producer CLI is the canonical pipeline
 * (rule #2 — one source of truth; the operator-facing `pnpm changelog:snapshot`
 * IS the command). Tests inject `spawnFn` to drive the wrapper without
 * forking a real subprocess.
 */
export interface PnpmSnapshotCaptureOptions {
  /** Command to spawn. Default `pnpm`. */
  readonly command?: string;
  /**
   * Base args before `--date <date>`. Default `["changelog:snapshot"]`.
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
 * Build a `SnapshotCapture` that spawns `pnpm changelog:snapshot --date <date>`
 * and resolves with the spawn-result shape (`exitCode`, `durationMs`,
 * bounded `stdoutTail` / `stderrTail`). Mirrors `ProcessSpawnStrategy.spawn`
 * with two intentional differences:
 *   - no stdin write — the snapshot CLI reads `--date` from argv
 *   - per-call args composition — `--date <date>` is appended each call
 *     (the date is determined by the daemon, not constructor-fixed)
 *
 * Let-it-crash boundary (rule #6, Armstrong 2007): a non-zero exit from the
 * subprocess surfaces as `exitCode !== 0` in the result, NOT a thrown
 * exception. `runSnapshot` returns it as `outcome: "ran"`; the `tick-loop.snapshot`
 * span carries `snapshot.exit_code` so the dashboard sees rate-limit /
 * `gh: not authenticated` failures without taking the daemon down.
 *
 * `child.on("error")` (the "spawn failed" case — `pnpm` not on PATH, EACCES,
 * …) DOES propagate via the promise rejection so the supervisor sees a
 * misconfigured environment as a real crash rather than a silent
 * `exitCode = -1` that masks the root cause.
 *
 * @otel-exempt pure factory; the spawn itself is captured by `runSnapshot`'s
 *   `tick-loop.snapshot` span emitted in `daemon.ts` `emitSnapshotSpan`.
 */
export function createPnpmSnapshotCapture(opts: PnpmSnapshotCaptureOptions = {}): SnapshotCapture {
  const command = opts.command ?? "pnpm";
  const baseArgs = opts.baseArgs ?? ["changelog:snapshot"];
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const cwd = opts.cwd;

  return {
    capture(input) {
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
