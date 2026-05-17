/**
 * `@minsky/tui` — pure formatter for the machine-info panel of the
 * retro dashboard (TASKS.md `runany-retro-tui-dashboard` screen 1:
 * "host, load, cpu, mem, disk, time, total minsky procs").
 *
 * The raw numbers come from `node:os` / `df` at the I/O edge; this
 * module turns them into the glanceable, fixed-width strings the
 * renderer drops into the box (Card & Mackinlay 1999 — a dashboard is
 * a pre-formatted information display, not a number dump). Pure so the
 * panel layout is unit-testable with a frozen `MachineRaw` (rule #10).
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 89.
 *
 * @module tui/machine
 */

/** Raw machine telemetry, gathered by a future shim at the I/O edge. */
export interface MachineRaw {
  /** `os.hostname()`. */
  readonly host: string;
  /** `os.loadavg()` → [1m, 5m, 15m]. */
  readonly loadavg: readonly [number, number, number];
  /** `os.cpus().length`. */
  readonly cpuCount: number;
  /** `os.totalmem()` in bytes. */
  readonly totalMemBytes: number;
  /** `os.freemem()` in bytes. */
  readonly freeMemBytes: number;
  /** Filesystem size of the minsky volume, bytes. */
  readonly diskTotalBytes: number;
  /** Free space on the minsky volume, bytes. */
  readonly diskFreeBytes: number;
  /** Wall-clock epoch ms (passed in so the formatter stays pure). */
  readonly nowMs: number;
  /** Count of running minsky processes (from the scan). */
  readonly minskyProcCount: number;
}

/** Pre-formatted, fixed-shape strings ready for the dashboard box. */
export interface MachineInfo {
  readonly host: string;
  /** `1m 5m 15m` to 2dp, e.g. `2.10 1.80 1.55`. */
  readonly load: string;
  /** e.g. `8 cores`. */
  readonly cpu: string;
  /** e.g. `9.4/16.0 GiB (59%)`. */
  readonly mem: string;
  /** e.g. `412.0/930.0 GiB (44%)`. */
  readonly disk: string;
  /** ISO-8601 UTC, e.g. `2026-05-17T12:00:00.000Z`. */
  readonly time: string;
  /** e.g. `3 minsky procs`. */
  readonly procs: string;
}

const BYTES_PER_GIB = 1024 ** 3;

/**
 * @otel-exempt pure number→string formatter; no I/O, no clock (the
 *   clock is the injected `nowMs`), no state. Same rule #4 carve-out as
 *   the scan parser — instrumenting a total pure function measures V8.
 *
 * Format raw machine telemetry into the dashboard's machine-info panel.
 *
 * Percentages round to the nearest whole number; sizes show one decimal
 * GiB. A zero total (e.g. `df` not yet read) degrades to `0%` rather
 * than `NaN%` (rule #7 — explicit graceful degrade, never a broken
 * glyph on the operator's screen).
 */
export function formatMachineInfo(raw: MachineRaw): MachineInfo {
  const usedMem = raw.totalMemBytes - raw.freeMemBytes;
  const usedDisk = raw.diskTotalBytes - raw.diskFreeBytes;
  return {
    host: raw.host,
    load: raw.loadavg.map((n) => n.toFixed(2)).join(" "),
    cpu: `${raw.cpuCount} ${raw.cpuCount === 1 ? "core" : "cores"}`,
    mem: ratio(usedMem, raw.totalMemBytes),
    disk: ratio(usedDisk, raw.diskTotalBytes),
    time: new Date(raw.nowMs).toISOString(),
    procs: `${raw.minskyProcCount} minsky ${raw.minskyProcCount === 1 ? "proc" : "procs"}`,
  };
}

/** `used/total GiB (pct%)`; pct is 0 when total is 0 (no divide-by-zero). */
function ratio(usedBytes: number, totalBytes: number): string {
  const used = usedBytes / BYTES_PER_GIB;
  const total = totalBytes / BYTES_PER_GIB;
  const pct = totalBytes <= 0 ? 0 : Math.round((usedBytes / totalBytes) * 100);
  return `${used.toFixed(1)}/${total.toFixed(1)} GiB (${pct}%)`;
}
