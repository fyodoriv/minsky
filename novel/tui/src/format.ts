/**
 * `@minsky/tui` — pure display formatters shared by the scan/machine/render
 * layers. No I/O, no state: every function is a total string transform so
 * the retro dashboard renders deterministically and is unit-testable
 * without a terminal (rule #10 — the pure render/scan logic is the seam).
 *
 * Anchor: rule #1 (zero runtime dependency — these replace what a heavy
 *   TUI lib would otherwise pull in); Card & Mackinlay 1999 (glanceable
 *   fixed-width display).
 */

/**
 * Human-readable byte size, 1024-based, one decimal. `0` → `"0B"`.
 * Caps at TiB so a pathological disk reading still renders in a cell.
 *
 * @otel-exempt pure data transformation; no I/O, no state.
 */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  const units = ["B", "K", "M", "G", "T"] as const;
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const unit = units[i] ?? "B";
  return i === 0 ? `${Math.round(value)}${unit}` : `${value.toFixed(1)}${unit}`;
}

/**
 * Compact uptime: `ms` → `"3d04h"`, `"02h15m"`, `"07m42s"`, `"09s"`.
 * Negative / non-finite → `"--"` (clock skew degrades visibly, rule #7).
 *
 * @otel-exempt pure data transformation; no I/O, no state.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${String(m).padStart(2, "0")}m${String(sec).padStart(2, "0")}s`;
  return `${String(sec).padStart(2, "0")}s`;
}

/**
 * Right-pad (or hard-truncate with a trailing `…`) to exactly `width`
 * columns so every box-drawing row lines up regardless of input length.
 *
 * @otel-exempt pure data transformation; no I/O, no state.
 */
export function cell(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length === width) return text;
  if (text.length < width) return text + " ".repeat(width - text.length);
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}
