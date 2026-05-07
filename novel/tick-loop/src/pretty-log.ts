// <!-- scope: human-approved minsky CLI ergonomics (operator 2026-05-06) -->

/**
 * Pretty-format the daemon's structured log lines.
 *
 * The daemon emits a mix of:
 *   - Structured spans:    `[span] tick-loop.iteration {...JSON...}`
 *   - Plain console lines:  `[tick-loop] no notifier wired (set MINSKY_NTFY_TOPIC ...)`
 *   - Other arbitrary lines (warnings, errors, anything claude --print writes).
 *
 * `formatLogLine(raw, opts)` parses the structured spans into a glanceable,
 * one-line render and passes the rest through. Output uses ANSI escape
 * sequences for color so it renders right in a terminal without a deps
 * (rule #1 — don't reinvent, but also don't import chalk for 5 colors).
 *
 * @otel-exempt pure formatter; the I/O wrapper (bin/minsky.mjs) feeds
 * tail-F output through this and writes to process.stdout.
 */
export type FormatOpts = {
  /** Render with ANSI colors. Default true; tests pass false for stable assertions. */
  readonly color?: boolean;
  /** Maximum reason length in the rendered line before ellipsis. Default 80. */
  readonly maxReasonChars?: number;
};

export function formatLogLine(raw: string, opts: FormatOpts = {}): string {
  const trimmed = raw.replace(/\r?\n$/, "");
  const span = parseSpan(trimmed);
  if (span === null) return passthrough(trimmed, opts);
  return renderSpan(span, opts);
}

type IterationSpan = {
  readonly name: string;
  readonly iteration: number | undefined;
  readonly status: string | undefined;
  readonly taskId: string | undefined;
  readonly reason: string | undefined;
};

function parseSpan(line: string): IterationSpan | null {
  const m = line.match(/^\[span\]\s+(\S+)\s+(\{.*\})$/);
  if (m === null || m[1] === undefined || m[2] === undefined) return null;
  try {
    const obj = JSON.parse(m[2]) as Record<string, unknown>;
    return {
      name: m[1],
      iteration: numberOrUndefined(obj["iteration.index"]),
      status: stringOrUndefined(obj["iteration.status"]),
      taskId: stringOrUndefined(obj["task.id"]),
      reason: stringOrUndefined(obj["iteration.reason"]),
    };
    // rule-6: handled-locally — malformed JSON falls through to passthrough; the formatter is best-effort
  } catch {
    return null;
  }
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function renderSpan(span: IterationSpan, opts: FormatOpts): string {
  const color = opts.color ?? true;
  const maxReason = opts.maxReasonChars ?? 80;
  const time = new Date().toISOString().slice(11, 19); // HH:MM:SS UTC
  const badge = statusBadge(span.status, color);
  const iter = span.iteration === undefined ? "" : `#${span.iteration}`;
  const task = collapseWhitespace(span.taskId ?? "(no-task)");
  const reason = truncateOneLine(span.reason ?? "", maxReason);
  const taskPart = color ? `\x1b[36m${task}\x1b[0m` : task;
  const iterPart = color ? `\x1b[2m${iter}\x1b[0m` : iter;
  const timePart = color ? `\x1b[2m${time}\x1b[0m` : time;
  return `${timePart} ${badge} ${taskPart} ${iterPart} · ${reason}`;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const STATUS_BADGES: Record<string, { sym: string; color: string }> = {
  completed: { sym: "✓", color: "\x1b[32m" },
  failed: { sym: "✗", color: "\x1b[31m" },
  "no-task": { sym: "○", color: "\x1b[33m" },
  paused: { sym: "⏸", color: "\x1b[34m" },
  "budget-paused": { sym: "⏳", color: "\x1b[35m" },
  "missing-tasks-md": { sym: "⚠", color: "\x1b[31m" },
};

function statusBadge(status: string | undefined, color: boolean): string {
  if (status === undefined) return "·";
  const entry = STATUS_BADGES[status] ?? { sym: "?", color: "\x1b[2m" };
  if (!color) return entry.sym;
  return `${entry.color}${entry.sym}\x1b[0m`;
}

function truncateOneLine(s: string, max: number): string {
  const oneLine = s
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function passthrough(line: string, opts: FormatOpts): string {
  const color = opts.color ?? true;
  if (line.startsWith("[tick-loop]")) {
    return color ? `\x1b[2m${line}\x1b[0m` : line;
  }
  return line;
}
