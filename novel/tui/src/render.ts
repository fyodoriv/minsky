/**
 * `@minsky/tui` — pure retro-1995 renderer for screen (1), the
 * machine-wide dashboard. ANSI + box-drawing, green-on-black, fixed
 * 80×24 aesthetic. Zero runtime dependency (rule #1 / the $10-mo cap —
 * no heavy TUI lib, no runtime web service): raw escape codes only.
 *
 * The renderer is a total `model -> string` transform with NO I/O and NO
 * model calls, so the layout is unit-testable without a TTY (rule #10 —
 * the pure render logic is the seam; the raw-mode TTY driver and the
 * file/process collectors are the I/O edge, wired in later slices).
 *
 * Width discipline: every width/`cell` calculation runs on PLAIN text;
 * color is applied only by wrapping an already-exact-width segment in a
 * single escape pair, so ANSI codes never inflate the measured columns
 * (the classic TUI alignment bug — Card & Mackinlay 1999, fixed grid).
 */

import { cell } from "./format.js";
import type { MachineInfo } from "./machine.js";
import type { MinskyRole } from "./scan.js";

/** Total terminal columns (the 1995 80×24 frame). */
export const WIDTH = 80;
/** Drawable inner columns: `║␠ … ␠║` → WIDTH − 4. */
const INNER = WIDTH - 4;

/** One process as the dashboard row wants it — all pre-formatted. */
export interface ProcRow {
  readonly runId: string;
  readonly repo: string;
  readonly role: MinskyRole;
  readonly uptime: string;
  readonly model: string;
  /** e.g. `"running"`, `"paused"`, `"stuck"` — free-form, source-derived. */
  readonly state: string;
}

/** Everything screen (1) needs to render, fully resolved upstream. */
export interface DashboardModel {
  readonly machine: MachineInfo;
  readonly procs: readonly ProcRow[];
  /** highlighted row, clamped by the renderer; −1 / out-of-range → none. */
  readonly selectedIndex: number;
}

const RESET = "\u001b[0m";
const GREEN = "\u001b[32m";
const AMBER = "\u001b[33m";
const BOLD_INV = "\u001b[1;7m";

/** Wrap `s` in an escape pair only when color is on; width is unchanged. */
function tint(s: string, code: string, on: boolean): string {
  return on ? `${code}${s}${RESET}` : s;
}

/** A horizontal frame rule: `left` + `═`×(WIDTH−2) + `right`. */
function rule(left: string, right: string, on: boolean): string {
  return tint(left + "═".repeat(WIDTH - 2) + right, GREEN, on);
}

/** One framed content row: `║␠<inner padded to INNER>␠║`. */
function line(inner: string, on: boolean, code: string): string {
  const bar = tint("║", GREEN, on);
  return `${bar} ${tint(cell(inner, INNER), code, on)} ${bar}`;
}

/** `label` left, `value` right-justified, joined to exactly INNER cols. */
function kv(label: string, value: string): string {
  const left = cell(label, INNER - value.length - 1);
  return `${left} ${value}`;
}

/** Title + two vitals rows. */
function header(m: MachineInfo, on: boolean): string[] {
  return [
    line(kv("MINSKY :: MACHINE DASHBOARD", m.time), on, AMBER),
    rule("╠", "╣", on),
    line(`host  ${cell(m.host, 22)} load  ${cell(m.load, 18)} cpu  ${m.cpu}`, on, GREEN),
    line(`mem   ${cell(m.mem, 22)} disk  ${cell(m.disk, 18)} ${m.procs}`, on, GREEN),
    rule("╠", "╣", on),
  ];
}

/** The column header for the process table. */
function tableHead(on: boolean): string {
  const cols = `  ${cell("#", 3)}${cell("RUN-ID", 13)}${cell("REPO", 19)}${cell(
    "ROLE",
    12,
  )}${cell("UPTIME", 9)}MODEL`;
  return line(cols, on, AMBER);
}

/** One process row; the selected row is rendered inverse (retro cursor). */
function procLine(row: ProcRow, num: number, selected: boolean, on: boolean): string {
  const sel = selected ? "> " : "  ";
  const body = `${sel}${cell(String(num), 3)}${cell(row.runId, 13)}${cell(
    row.repo,
    19,
  )}${cell(row.role, 12)}${cell(row.uptime, 9)}${row.model}`;
  return line(body, on, selected ? BOLD_INV : GREEN);
}

/** Footer: key hints left, selected proc's state right. */
function footer(model: DashboardModel, on: boolean): string {
  const sel = model.procs[model.selectedIndex];
  const state = sel ? `state: ${sel.role} ${sel.state}` : "no process selected";
  return line(kv("↑/↓ select   ⏎ open   q quit", state), on, GREEN);
}

/**
 * Render the full machine dashboard to a single string (`\n`-joined
 * lines). `opts.color === false` disables ANSI so snapshot tests assert
 * on stable plain text. An empty process list renders an explicit
 * "(no running minsky processes)" row, never a blank table (rule #7 —
 * the empty state is visible, not silent).
 *
 * @otel-exempt pure data transformation; no I/O, no state.
 */

/**
 * @otel-exempt pure path→segment helper. Trailing path segment of an
 * absolute repo path. Slice-2 `detail.ts` and any other consumer of
 * REPO-name shortening use this single source of truth.
 */
export function repoBasename(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  if (trimmed.length === 0) return "—";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function renderDashboard(
  model: DashboardModel,
  opts: { readonly color?: boolean } = {},
): string {
  const on = opts.color !== false;
  const lines: string[] = [rule("╔", "╗", on), ...header(model.machine, on), tableHead(on)];
  if (model.procs.length === 0) {
    lines.push(line(cell("  (no running minsky processes)", INNER), on, GREEN));
  } else {
    model.procs.forEach((row, i) =>
      lines.push(procLine(row, i + 1, i === model.selectedIndex, on)),
    );
  }
  lines.push(rule("╠", "╣", on), footer(model, on), rule("╚", "╝", on));
  return lines.join("\n");
}
