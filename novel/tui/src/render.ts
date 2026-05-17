/**
 * `@minsky/tui` — pure renderer for the retro-1995 machine dashboard
 * (TASKS.md `runany-retro-tui-dashboard` screen 1).
 *
 * Zero dependency: raw ANSI + Unicode box-drawing, amber/green-on-black,
 * a fixed 80x24 1995 aesthetic. No heavy TUI library — rule #1 / the
 * $10-mo cap forbid a runtime UI service or a fat dep, and a glanceable
 * read-only board needs none (Card & Mackinlay 1999). The process list
 * is **not** re-derived here: it composes the blessed `MinskyProc`
 * substrate from `@minsky/cross-repo-runner` (rule #1 — one
 * machine-wide enumerator for the whole runany cluster). The function
 * is pure (`model → string[]`); colour is opt-in so tests assert the
 * plain layout deterministically and the future TTY shim flips
 * `color: true` at the I/O edge (Martin 2017).
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 89.
 *
 * @module tui/render
 */

import type { MinskyProc } from "@minsky/cross-repo-runner";
import type { MachineInfo } from "./machine.js";

/** The dashboard's render inputs. All pure data; no I/O handles. */
export interface DashboardModel {
  readonly machine: MachineInfo;
  readonly procs: readonly MinskyProc[];
  /** Highlighted row index, clamped into range; -1 / out-of-range → none. */
  readonly selectedIndex: number;
}

/** Render options. `color` defaults off (testability); `width` to 80. */
export interface RenderOpts {
  readonly color?: boolean;
  readonly width?: number;
}

const DEFAULT_WIDTH = 80;

// SGR sequences. Amber chrome, green data, reverse-video selection —
// the canonical phosphor-terminal palette the task calls for.
const ANSI = {
  reset: "\x1b[0m",
  amber: "\x1b[38;5;214m",
  green: "\x1b[38;5;46m",
  dim: "\x1b[2m",
  invert: "\x1b[7m",
} as const;

/**
 * @otel-exempt pure data→lines transform; no I/O, no clock, no state.
 *   The render is referentially transparent (rule #4 carve-out); the
 *   span belongs to the future TUI shim that writes these lines to the
 *   tty and reads keystrokes.
 *
 * Render the machine dashboard to an array of display lines.
 *
 * Every returned line is exactly `width` visible columns (ANSI escapes,
 * when `color` is on, do not count toward width — they are zero-width
 * to the terminal). An empty process list degrades to a centered
 * "(no running minsky processes)" notice rather than an empty box
 * (rule #7 — the operator always sees a coherent screen).
 */
export function renderDashboard(model: DashboardModel, opts: RenderOpts = {}): string[] {
  const width = opts.width ?? DEFAULT_WIDTH;
  const color = opts.color ?? false;
  const inner = width - 2;
  const rule = (s: string): string => (color ? `${ANSI.amber}${s}${ANSI.reset}` : s);

  return [
    rule(`┌${"─".repeat(inner)}┐`),
    boxed(center("MINSKY // MACHINE DASHBOARD", inner), color, ANSI.amber),
    rule(`├${"─".repeat(inner)}┤`),
    ...machineRows(model.machine).map((r) => boxed(padEnd(` ${r}`, inner), color, ANSI.green)),
    rule(`├${"─".repeat(inner)}┤`),
    boxed(padEnd(` ${PROC_HEADER}`, inner), color, ANSI.amber),
    ...procLines(model, color, inner),
    rule(`├${"─".repeat(inner)}┤`),
    boxed(center("↑/↓ select · ENTER detail · q quit", inner), color, ANSI.dim),
    rule(`└${"─".repeat(inner)}┘`),
  ];
}

/** The six machine-info panel rows, in glance-priority order. */
function machineRows(m: DashboardModel["machine"]): string[] {
  return [
    `HOST  ${m.host}`,
    `TIME  ${m.time}`,
    `LOAD  ${m.load}    CPU  ${m.cpu}`,
    `MEM   ${m.mem}`,
    `DISK  ${m.disk}`,
    `PROCS ${m.procs}`,
  ];
}

/**
 * The process-table body: one boxed row per process (selected row in
 * reverse video), or a single centered notice when none are running
 * (rule #7 — never an empty box).
 */
function procLines(model: DashboardModel, color: boolean, inner: number): string[] {
  if (model.procs.length === 0) {
    return [boxed(center("(no running minsky processes)", inner), color, ANSI.dim)];
  }
  const out: string[] = [];
  for (let i = 0; i < model.procs.length; i += 1) {
    const p = model.procs[i];
    if (p === undefined) continue;
    const cell = padEnd(` ${formatProcRow(p, i)}`, inner);
    out.push(boxed(cell, color, i === model.selectedIndex ? ANSI.invert : ANSI.green));
  }
  return out;
}

/** Column header for the process table; kept in sync with formatProcRow. */
const PROC_HEADER = "#  PID     KIND          REPO                        RUN";

/**
 * @otel-exempt pure formatter for one table row; see renderDashboard.
 *
 * Format a single `@minsky/cross-repo-runner` {@link MinskyProc} into
 * the dashboard's fixed-column row. Exported for the per-row unit tests
 * (rule #10) and for the future detail screen to reuse the columns.
 */
export function formatProcRow(p: MinskyProc, index: number): string {
  return [
    String(index + 1).padEnd(2),
    String(p.pid).padEnd(7),
    p.kind.padEnd(13),
    fit(repoBasename(p.repo), 27),
    p.runId,
  ].join(" ");
}

/**
 * @otel-exempt pure path→segment helper; see renderDashboard.
 *
 * Trailing path segment of an absolute repo path (the narrow REPO
 * column shows the repo folder name, not the full path). A path with
 * no `/` or an empty string renders `—` (rule #7 — explicit, never a
 * blank cell).
 */
export function repoBasename(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  if (trimmed.length === 0) return "—";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
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
