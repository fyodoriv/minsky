// <!-- scope: human-approved 2026-05-16 operator "single-command run-anywhere multi-tenant minsky + retro TUI" -->
//
// Machine-wide running-minsky enumerator. Foundational shared substrate
// for the runany P0 cluster:
//   - runany-retro-tui-dashboard : the dashboard lists every running run
//   - runany-multitenant-no-conflict : detect concurrent runs on a repo
//   - runany-zero-arg-entrypoint : know what's already running before launch
//
// Pattern: a PURE parser (`parseMinskyProcs`) over `ps` text — no I/O in
// the decision (rule #10) — plus a thin injected exec seam
// (`scanMinskyProcesses`) for production (rule #2). Composes the OS `ps`
// rather than a bespoke registry (rule #1). Read-only; never spawns a
// model; $0.

import { execFileSync } from "node:child_process";

/** A top-level minsky process discovered on the host. */
export interface MinskyProc {
  readonly pid: number;
  /** orchestrator = conductor; worker = tick-loop; gate = local-gate-merge. */
  readonly kind: "orchestrator" | "worker" | "gate";
  /** Absolute repo root the run operates on (derived from the script path). */
  readonly repo: string;
  /** Per-run id: `w<N>` for a worker (`--worker-id=N`), else `main`. */
  readonly runId: string;
  /** The raw argv tail (for the TUI detail page). */
  readonly argv: string;
}

/** Injected exec seam — production runs `ps`; tests pass a fixture. */
export interface ProcScanProbe {
  /** Returns `ps`-style `\n`-separated `<pid> <command…>` lines. */
  readonly ps: () => string;
}

const ENTRYPOINTS: ReadonlyArray<{
  readonly re: RegExp;
  readonly kind: MinskyProc["kind"];
  readonly anchor: string;
}> = [
  {
    re: /\/scripts\/orchestrate\.mjs(\s|$)/,
    kind: "orchestrator",
    anchor: "/scripts/orchestrate.mjs",
  },
  {
    re: /\/novel\/tick-loop\/bin\/tick-loop\.mjs(\s|$)/,
    kind: "worker",
    anchor: "/novel/tick-loop/bin/tick-loop.mjs",
  },
  {
    re: /\/scripts\/local-gate-merge\.mjs(\s|$)/,
    kind: "gate",
    anchor: "/scripts/local-gate-merge.mjs",
  },
];

/**
 * Pure: parse one `ps` line into a `MinskyProc`, or `null` if it is not a
 * top-level minsky run (non-minsky noise, or a `run-pre-pr-lint-stack` vet
 * child). Extracted so `parseMinskyProcs` stays a trivial map/filter and
 * each branch is independently reasoned (rule #10).
 */
function parseProcLine(raw: string): MinskyProc | null {
  const m = raw.trim().match(/^(\d+)\s+(.*)$/);
  if (!m) return null;
  const cmd = m[2] ?? "";
  // A `run-pre-pr-lint-stack` is a gate vet child, not a top-level run.
  if (/\/run-pre-pr-lint-stack\.mjs(\s|$)/.test(cmd)) return null;
  const hit = ENTRYPOINTS.find((e) => e.re.test(cmd));
  if (!hit) return null;
  const idx = cmd.indexOf(hit.anchor);
  if (idx < 0) return null;
  // repo root = the absolute path up to (not including) the anchor: the
  // last whitespace-delimited token that contains the anchor.
  const token =
    cmd
      .slice(0, idx + hit.anchor.length)
      .split(/\s+/)
      .pop() ?? "";
  const repo = token.slice(0, token.length - hit.anchor.length);
  if (!repo.startsWith("/")) return null;
  const workerMatch = cmd.match(/--worker-id=(\d+)/);
  const runId = workerMatch ? `w${workerMatch[1]}` : "main";
  return { pid: Number(m[1]), kind: hit.kind, repo, runId, argv: cmd };
}

/**
 * Pure: parse `ps` text into the top-level minsky runs. Excludes vet
 * children and all non-minsky noise. Any unparsable line is skipped
 * (fail-safe).
 * @param psText `\n`-separated `<pid> <command…>` lines
 */
export function parseMinskyProcs(psText: string): readonly MinskyProc[] {
  const out: MinskyProc[] = [];
  for (const raw of psText.split("\n")) {
    const proc = parseProcLine(raw);
    if (proc) out.push(proc);
  }
  return out;
}

/**
 * Production scan: `ps -axww -o pid=,command=` → `parseMinskyProcs`.
 * Any failure (ps missing, permission) degrades to an empty list and
 * never throws (rule #6 — a broken scan must not crash the TUI / the
 * caller's launch path).
 */
export function scanMinskyProcesses(
  probe: ProcScanProbe = { ps: defaultPs },
): readonly MinskyProc[] {
  try {
    return parseMinskyProcs(probe.ps());
  } catch {
    return [];
  }
}

function defaultPs(): string {
  return execFileSync("ps", ["-axww", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}
