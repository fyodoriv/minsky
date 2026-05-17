/**
 * `@minsky/tui` — pure renderer for the retro-1995 process-detail
 * screen (TASKS.md `runany-retro-tui-dashboard` screen 2: "selected
 * run's repo, env (model/provider), launchd label, ledger summary,
 * recent merges, AND a log list of its `.minsky/*.log` files").
 *
 * Screen 1 (`render.ts`) is the machine board; pressing ENTER on a row
 * drills into this screen. Same zero-dependency contract as screen 1:
 * raw ANSI + Unicode box-drawing, amber/green-on-black, fixed 80x24
 * 1995 aesthetic, no TUI library (rule #1 / the $10-mo cap). The
 * function is pure (`model → string[]`); colour is opt-in so tests
 * assert the plain layout deterministically and the future TTY shim
 * flips `color: true` at the I/O edge (Martin 2017). The {@link
 * DetailModel} is all pre-gathered data — the I/O shim that reads
 * `.minsky/*.log` / ledger / launchd at the edge lands in a later
 * slice, exactly as `machine.ts`'s `MachineRaw` is filled by a shim.
 *
 * The box primitives below are intentionally a small private copy of
 * `render.ts`'s helpers: keeping this slice's diff additive (no edit to
 * the in-flight slice-1 `render.ts`) avoids a merge conflict with the
 * open slice-1 PR. The deferred-DRY consolidation into a shared
 * `box.ts` is filed as a P3 scout task and lands once slice 1 merges.
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 89.
 *
 * @module tui/detail
 */

import type { MinskyProc } from "@minsky/cross-repo-runner";
import { repoBasename } from "./render.js";

/** One `.minsky/*.log` file the operator can drill into / tail. */
export interface LogFile {
  /** Basename, e.g. `tick-loop.log`. */
  readonly name: string;
  /** Size in bytes; `-1` when not yet stat-ed (rule #7 — explicit). */
  readonly sizeBytes: number;
}

/** Pure render inputs for screen 2. All pre-gathered; no I/O handles. */
export interface DetailModel {
  /** The drilled-into process, from the screen-1 scan substrate. */
  readonly proc: MinskyProc;
  /** Effective model, e.g. `claude-opus-4-7` or `local:qwen3-14b`. */
  readonly model: string;
  /** Effective provider, e.g. `anthropic` / `local-preferred`. */
  readonly provider: string;
  /** launchd label, e.g. `com.minsky.daemon-10`; `—` when none. */
  readonly launchdLabel: string;
  /** Pre-formatted ledger summary lines (e.g. last tick, iters). */
  readonly ledger: readonly string[];
  /** Pre-formatted recent-merge lines (most recent first). */
  readonly merges: readonly string[];
  /** The run's `.minsky/*.log` files. */
  readonly logs: readonly LogFile[];
  /** Highlighted log index, clamped; -1 / out-of-range → none. */
  readonly selectedLogIndex: number;
}

/** Render options. `color` defaults off (testability); `width` to 80. */
export interface DetailRenderOpts {
  readonly color?: boolean;
  readonly width?: number;
}

const DEFAULT_WIDTH = 80;

// Same canonical phosphor-terminal palette as screen 1.
const ANSI = {
  reset: "\x1b[0m",
  amber: "\x1b[38;5;214m",
  green: "\x1b[38;5;46m",
  dim: "\x1b[2m",
  invert: "\x1b[7m",
} as const;

/**
 * @otel-exempt pure data→lines transform; no I/O, no clock, no state.
 *   Referentially transparent (rule #4 carve-out); the span belongs to
 *   the future TUI shim that writes these lines and reads keystrokes.
 *
 * Render the process-detail screen to an array of display lines.
 *
 * Every returned line is exactly `width` visible columns (ANSI escapes,
 * when `color` is on, are zero-width to the terminal). An empty log
 * list degrades to a centered "(no .minsky/*.log files)" notice rather
 * than an empty box, and empty ledger/merge sections show an explicit
 * "—" placeholder row (rule #7 — the operator always sees a coherent
 * screen, never a broken or blank panel).
 */
export function renderDetail(model: DetailModel, opts: DetailRenderOpts = {}): string[] {
  const width = opts.width ?? DEFAULT_WIDTH;
  const color = opts.color ?? false;
  const inner = width - 2;
  const rule = (s: string): string => (color ? `${ANSI.amber}${s}${ANSI.reset}` : s);
  const data = (s: string): string => boxed(padEnd(` ${s}`, inner), color, ANSI.green);
  const head = (s: string): string => boxed(padEnd(` ${s}`, inner), color, ANSI.amber);

  return [
    rule(`┌${"─".repeat(inner)}┐`),
    boxed(center("MINSKY // PROCESS DETAIL", inner), color, ANSI.amber),
    rule(`├${"─".repeat(inner)}┤`),
    ...identityRows(model).map(data),
    rule(`├${"─".repeat(inner)}┤`),
    head("LEDGER"),
    ...section(model.ledger).map(data),
    rule(`├${"─".repeat(inner)}┤`),
    head("RECENT MERGES"),
    ...section(model.merges).map(data),
    rule(`├${"─".repeat(inner)}┤`),
    head(`LOGS (${model.logs.length})`),
    ...logLines(model, color, inner),
    rule(`├${"─".repeat(inner)}┤`),
    boxed(center("↑/↓ select log · ENTER tail · b back · q quit", inner), color, ANSI.dim),
    rule(`└${"─".repeat(inner)}┘`),
  ];
}

/** The process-identity panel rows, in glance-priority order. */
function identityRows(m: DetailModel): string[] {
  return [
    `RUN      ${m.proc.runId}`,
    `KIND     ${m.proc.kind}`,
    `PID      ${m.proc.pid}`,
    `REPO     ${repoBasename(m.proc.repo)}`,
    `MODEL    ${m.model}`,
    `PROVIDER ${m.provider}`,
    `LAUNCHD  ${m.launchdLabel}`,
  ];
}

/** A list section, degraded to a single "—" row when empty (rule #7). */
function section(lines: readonly string[]): string[] {
  return lines.length === 0 ? ["—"] : [...lines];
}

/**
 * The log-list body: one boxed row per `.minsky/*.log` file (selected
 * row in reverse video, size right-aligned), or a single centered
 * notice when none exist (rule #7 — never an empty box).
 */
function logLines(model: DetailModel, color: boolean, inner: number): string[] {
  if (model.logs.length === 0) {
    return [boxed(center("(no .minsky/*.log files)", inner), color, ANSI.dim)];
  }
  const out: string[] = [];
  for (let i = 0; i < model.logs.length; i += 1) {
    const log = model.logs[i];
    if (log === undefined) continue;
    const cell = padEnd(` ${formatLogRow(log, i)}`, inner);
    out.push(boxed(cell, color, i === model.selectedLogIndex ? ANSI.invert : ANSI.green));
  }
  return out;
}

/**
 * @otel-exempt pure formatter for one log row; see renderDetail.
 *
 * Format one {@link LogFile} into the fixed-column log row. Exported
 * for the per-row unit tests (rule #10) and reuse by the future tail
 * view. An un-stat-ed size (`-1`) renders `?` rather than a negative
 * number (rule #7 — explicit, never a misleading cell).
 */
export function formatLogRow(log: LogFile, index: number): string {
  const size = log.sizeBytes < 0 ? "?" : humanSize(log.sizeBytes);
  return `${String(index + 1).padEnd(2)} ${fit(log.name, 40)} ${size.padStart(8)}`;
}

/** Bytes → glanceable `B`/`K`/`M`/`G`/`T` (1024-based, one decimal). */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["K", "M", "G", "T"] as const;
  let n = bytes / 1024;
  let unit: (typeof units)[number] = units[0];
  for (let i = 1; i < units.length && n >= 1024; i += 1) {
    n /= 1024;
    unit = units[i] ?? unit;
  }
  return `${n.toFixed(1)}${unit}`;
}

/** Wrap content in the box's vertical rules, painting the content cell. */
function boxed(content: string, color: boolean, code: string): string {
  const bar = color ? `${ANSI.amber}│${ANSI.reset}` : "│";
  const body = color ? `${code}${content}${ANSI.reset}` : content;
  return `${bar}${body}${bar}`;
}

/** Pad to exactly `n` columns, truncating overflow. */
function padEnd(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

/** Truncate to `n` columns with an ellipsis when it would overflow. */
function fit(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  return n <= 1 ? s.slice(0, n) : `${s.slice(0, n - 1)}…`;
}

/** Centre `s` within `n` columns (extra space biased to the right). */
function center(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  const left = Math.floor((n - s.length) / 2);
  return " ".repeat(left) + s + " ".repeat(n - s.length - left);
}
