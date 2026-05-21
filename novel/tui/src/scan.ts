/**
 * `@minsky/tui` — pure parser for the machine-wide process scan.
 *
 * The TUI screen (1) lists every running minsky process on the host. The
 * I/O (`pgrep -fal 'scripts/orchestrate.mjs|tick-loop.mjs|local-gate-merge'`)
 * stays at the edge in a later slice; THIS module is the pure seam that
 * turns the raw `pgrep -fal` text into typed rows so the scan logic is
 * unit-testable without spawning processes (rule #10 — pure scan logic).
 *
 * `pgrep -fal` emits one line per match: `<pid> <full command line>`.
 *
 * Anchor: rule #2 (the raw text is the adapter seam, the `pgrep` exec is
 *   the boundary); rule #7 (a noise line — e.g. the scanning grep itself —
 *   degrades to "skipped", never a crash).
 */

/** A worker tick-loop, an orchestrator, or the local merge-gate. */
export type MinskyRole = "worker" | "orchestrator" | "merge-gate";

/** One running minsky process as the dashboard wants to display it. */
export interface MinskyProc {
  readonly pid: number;
  /** `--run-id` value when present, else `pid:<pid>` (always non-empty). */
  readonly runId: string;
  /** basename of `--repo` / `--host` / `--hosts-dir`, else `"unknown"`. */
  readonly repo: string;
  readonly role: MinskyRole;
  /** `--model` value, else `"—"` (provider/model unknown from cmdline). */
  readonly model: string;
  /** the raw command line, kept for the detail screen. */
  readonly command: string;
}

/** First whitespace-delimited flag value after `name`, or undefined. */
function flagValue(tokens: readonly string[], name: string): string | undefined {
  const i = tokens.indexOf(name);
  if (i < 0) return undefined;
  const v = tokens[i + 1];
  return v && !v.startsWith("-") ? v : undefined;
}

/**
 * The scan itself (`pgrep`/`grep`/`rg`/`ps` carrying the pattern string)
 * shows up in `pgrep -fal` output and would otherwise be misclassified
 * because its cmdline literally contains `tick-loop.mjs`. Drop any line
 * whose executable basename is a scan tool (rule #7 — noise degrades to
 * "skipped", it never becomes a phantom worker row).
 */
function isScanNoise(tokens: readonly string[]): boolean {
  const argv0 = tokens[0] ?? "";
  const exe = argv0.slice(argv0.lastIndexOf("/") + 1);
  return exe === "grep" || exe === "pgrep" || exe === "rg" || exe === "ps";
}

/** Map a command line to a role, or undefined when it is not a minsky proc. */
function classifyRole(tokens: readonly string[], command: string): MinskyRole | undefined {
  if (isScanNoise(tokens)) return undefined;
  if (command.includes("tick-loop.mjs")) return "worker";
  if (command.includes("orchestrate.mjs")) return "orchestrator";
  if (command.includes("local-gate-merge")) return "merge-gate";
  return undefined;
}

/** basename of a path, with any trailing slash stripped. `""` → `""`. */
function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Parse one `pgrep -fal` line, or undefined if it is not a minsky proc. */
function parseLine(line: string): MinskyProc | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  const space = trimmed.indexOf(" ");
  if (space < 0) return undefined;
  const pid = Number.parseInt(trimmed.slice(0, space), 10);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const command = trimmed.slice(space + 1).trim();
  const tokens = command.split(/\s+/);
  const role = classifyRole(tokens, command);
  if (role === undefined) return undefined;
  const runIdFlag = flagValue(tokens, "--run-id") ?? flagValue(tokens, "--run");
  const repoFlag =
    flagValue(tokens, "--repo") ?? flagValue(tokens, "--host") ?? flagValue(tokens, "--hosts-dir");
  return {
    pid,
    runId: runIdFlag ?? `pid:${pid}`,
    repo: repoFlag ? basename(repoFlag) : "unknown",
    role,
    model: flagValue(tokens, "--model") ?? "—",
    command,
  };
}

/**
 * Parse raw `pgrep -fal` output into the running-minsky-process list,
 * sorted by pid ascending so the dashboard ordering is stable across
 * scans (a flapping row order would defeat arrow/number selection).
 * Non-minsky / malformed lines are silently skipped (rule #7 — the
 * scanning grep matching itself must not corrupt the list).
 *
 * @otel-exempt pure data transformation; no I/O, no state.
 */
export function parseMinskyProcs(raw: string): MinskyProc[] {
  const out: MinskyProc[] = [];
  for (const line of raw.split("\n")) {
    const proc = parseLine(line);
    if (proc !== undefined) out.push(proc);
  }
  return out.sort((a, b) => a.pid - b.pid);
}
