/**
 * `@minsky/tui` — pure machine-info formatter for the dashboard header.
 *
 * Screen (1) shows host vitals next to the process list. The raw OS
 * readings (`os.loadavg()`, `os.totalmem()`, a `df` shell-out, …) are
 * collected at the I/O edge in a later slice; THIS module is the pure
 * seam that turns the numeric readings into the fixed-width display
 * strings the renderer prints, so the formatting is unit-testable
 * without touching the host (rule #10 — pure scan/format logic).
 *
 * Time is formatted in UTC on purpose: a deterministic, timezone-free
 * string keeps the unit tests stable on any CI host (rule #7 — explicit
 * over implicit).
 *
 * Anchor: rule #2 (readings are the adapter seam); Card & Mackinlay 1999
 *   (glanceable fixed-width vitals).
 */

import { humanBytes } from "./format.js";

/** Raw host readings, exactly as the I/O edge will hand them over. */
export interface RawMachineReadings {
  readonly host: string;
  readonly loadAvg: readonly [number, number, number];
  readonly cpuCount: number;
  readonly totalMemBytes: number;
  readonly freeMemBytes: number;
  readonly diskTotalBytes: number;
  readonly diskFreeBytes: number;
  readonly nowMs: number;
  /** total running minsky procs (== `parseMinskyProcs(...).length`). */
  readonly procCount: number;
}

/** Formatted, fixed-width host vitals for the dashboard header. */
export interface MachineInfo {
  readonly host: string;
  readonly load: string;
  readonly cpu: string;
  readonly mem: string;
  readonly disk: string;
  /** `"YYYY-MM-DD HH:MM:SS UTC"`. */
  readonly time: string;
  readonly procs: string;
}

/** `used / total (NN%)` where used = total − free; clamps to [0,100]. */
function usage(totalBytes: number, freeBytes: number): string {
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  const free = Number.isFinite(freeBytes) && freeBytes >= 0 ? Math.min(freeBytes, total) : 0;
  const used = total - free;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return `${humanBytes(used)} / ${humanBytes(total)} (${pct}%)`;
}

/** Two-digit zero-padded segment of a UTC timestamp. */
function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `nowMs` → `"YYYY-MM-DD HH:MM:SS UTC"`. Invalid → epoch string. */
function utcStamp(nowMs: number): string {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : 0);
  const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  const clock = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return `${date} ${clock} UTC`;
}

/** A finite, non-negative load number to 2dp, else `"?"`. */
function load1(n: number): string {
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : "?";
}

/**
 * Format raw host readings into the dashboard's fixed-width vitals.
 *
 * @otel-exempt pure data transformation; no I/O, no state.
 */
export function formatMachineInfo(raw: RawMachineReadings): MachineInfo {
  const [l1, l5, l15] = raw.loadAvg;
  const cores = Number.isFinite(raw.cpuCount) && raw.cpuCount > 0 ? raw.cpuCount : 0;
  const procs = Number.isFinite(raw.procCount) && raw.procCount >= 0 ? raw.procCount : 0;
  return {
    host: raw.host.length > 0 ? raw.host : "unknown",
    load: `${load1(l1)} ${load1(l5)} ${load1(l15)}`,
    cpu: `${cores} core${cores === 1 ? "" : "s"}`,
    mem: usage(raw.totalMemBytes, raw.freeMemBytes),
    disk: usage(raw.diskTotalBytes, raw.diskFreeBytes),
    time: utcStamp(raw.nowMs),
    procs: `${procs} minsky proc${procs === 1 ? "" : "s"}`,
  };
}
