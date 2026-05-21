// <!-- scope: human-approved slice 3/3 of `runany-retro-tui-dashboard` — the injected I/O shim feeding the screen-1/2 pure renderers; the task block in TASKS.md and pattern conformance row 92 in vision.md anchor this. -->
/**
 * `@minsky/tui` — the I/O shim that feeds the pure screen renderers
 * (TASKS.md `runany-retro-tui-dashboard` slices 1–2) their real data.
 *
 * Slices 1–2 are pure `model → string[]` cores; this slice is the
 * narrow injected edge that gathers the model:
 *
 * - `gatherMachineRaw` — `node:os` + `fs.statfsSync` → the
 *   {@link MachineRaw} the machine-info panel formats. No `df`
 *   subprocess (Node ≥18.15 `statfsSync` is zero-dep and faster than
 *   parsing `df` text — rule #1, the $10-mo cap).
 * - `listLogFiles` — a run's `.minsky/` dir → the {@link LogFile}
 *   list screen 2 drills into.
 *
 * Every gatherer is pure relative to an injected probe (rule #2 — thin
 * injected exec/fs seam; production passes the real `node:` default,
 * tests pass a frozen fixture, so the logic is unit-tested with no
 * touching of the host fs / clock — rule #10). Each default probe is
 * wrapped so a missing/again-permission-denied syscall degrades to a
 * safe empty/zero value and never throws (rule #6/#7 — a broken probe
 * must not crash the read-only TUI). Read-only; never spawns a model;
 * $0.
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 89.
 *
 * @module tui/gather
 */

import { readdirSync, statSync, statfsSync } from "node:fs";
import { cpus, freemem, hostname, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import type { LogFile } from "./detail.js";
import type { MachineRaw } from "./machine.js";

/**
 * Injected machine-telemetry seam. Production binds `node:os` /
 * `fs.statfsSync`; tests pass a frozen fixture so {@link gatherMachineRaw}
 * is asserted deterministically (rule #2 / rule #10).
 */
export interface MachineProbe {
  /** `os.hostname()`. */
  readonly hostname: () => string;
  /** `os.loadavg()` → [1m, 5m, 15m]. */
  readonly loadavg: () => readonly [number, number, number];
  /** `os.cpus().length`. */
  readonly cpuCount: () => number;
  /** `os.totalmem()` bytes. */
  readonly totalmem: () => number;
  /** `os.freemem()` bytes. */
  readonly freemem: () => number;
  /** Filesystem of `path` → total / free bytes (`fs.statfsSync`). */
  readonly disk: (path: string) => { readonly totalBytes: number; readonly freeBytes: number };
  /** Wall-clock epoch ms (a seam so the gather stays test-frozen). */
  readonly nowMs: () => number;
}

/**
 * Injected log-dir seam. Production binds `node:fs`; tests pass a
 * frozen directory listing so {@link listLogFiles} is asserted with no
 * real fs (rule #2 / rule #10).
 */
export interface LogDirProbe {
  /** Entry names in `dir`; `[]` on any error (rule #6 — never throws). */
  readonly readdir: (dir: string) => readonly string[];
  /** Size of `path` in bytes; `-1` when stat fails (rule #7 — explicit). */
  readonly size: (path: string) => number;
}

/** Production machine probe — real `node:os` / `fs.statfsSync`. */
export const defaultMachineProbe: MachineProbe = {
  hostname: () => safe(() => hostname(), "unknown"),
  loadavg: () => safe(() => loadavg() as [number, number, number], [0, 0, 0]),
  cpuCount: () => safe(() => cpus().length, 0),
  totalmem: () => safe(() => totalmem(), 0),
  freemem: () => safe(() => freemem(), 0),
  disk: (path) =>
    safe(
      () => {
        const s = statfsSync(path);
        return { totalBytes: s.bsize * s.blocks, freeBytes: s.bsize * s.bavail };
      },
      { totalBytes: 0, freeBytes: 0 },
    ),
  nowMs: () => Date.now(),
};

/** Production log-dir probe — real `node:fs`. */
export const defaultLogDirProbe: LogDirProbe = {
  readdir: (dir) => safe(() => readdirSync(dir), [] as string[]),
  size: (path) => safe(() => statSync(path).size, -1),
};

/**
 * @otel-exempt thin injected gatherer — the only work is reading the
 *   probe; instrumenting it measures `node:os`, not minsky logic. The
 *   span belongs to the future TUI shim's render/refresh tick.
 *
 * Gather raw machine telemetry for the dashboard's machine-info panel.
 *
 * `minskyProcCount` comes from the caller's `scanMinskyProcesses`
 * result (composed, not re-scanned — rule #1: one machine-wide
 * enumerator). `diskPath` defaults to `process.cwd()` so the panel
 * reports the volume the operator's runs actually live on. Any probe
 * failure has already degraded to a safe zero inside the default probe,
 * so this never throws (rule #6/#7).
 */
export function gatherMachineRaw(
  minskyProcCount: number,
  probe: MachineProbe = defaultMachineProbe,
  diskPath: string = process.cwd(),
): MachineRaw {
  const disk = probe.disk(diskPath);
  const load = probe.loadavg();
  return {
    host: probe.hostname(),
    loadAvg: [load[0], load[1], load[2]] as const,
    cpuCount: probe.cpuCount(),
    totalMemBytes: probe.totalmem(),
    freeMemBytes: probe.freemem(),
    diskTotalBytes: disk.totalBytes,
    diskFreeBytes: disk.freeBytes,
    nowMs: probe.nowMs(),
    procCount: minskyProcCount,
  };
}

/**
 * @otel-exempt thin injected gatherer — see gatherMachineRaw.
 *
 * List a run's `.minsky/*.log` files for screen 2's log list.
 *
 * `dir` is the run's `.minsky` directory (the caller joins
 * `<repo>/.minsky`). Only `*.log` entries are kept; results are sorted
 * by name so the list is stable across refresh ticks (rule #7 — the
 * operator's selection doesn't jump under them). A missing/unreadable
 * dir degrades to `[]` (the renderer then shows its "(no .minsky/*.log
 * files)" notice — rule #6/#7), and an un-stat-able file keeps its
 * `sizeBytes: -1` so the row renders `?` rather than vanishing.
 */
export function listLogFiles(dir: string, probe: LogDirProbe = defaultLogDirProbe): LogFile[] {
  return probe
    .readdir(dir)
    .filter((name) => name.endsWith(".log"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, sizeBytes: probe.size(join(dir, name)) }));
}

/**
 * Run `fn`, returning `fallback` on any throw. The single rule #6
 * let-it-degrade boundary for the default probes: the read-only TUI
 * must render a coherent screen even when a syscall is denied — a
 * blank/zero cell is correct here, a crash is not.
 */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
    // rule-6: handled-locally — a denied/missing telemetry syscall degrades to a safe zero/empty; this read-only panel must never crash the operator's TUI (this IS the let-it-crash boundary).
  } catch {
    return fallback;
  }
}
