// <!-- scope: human-approved 2026-05-04 user request "stream of latest messages from inside" -->
/**
 * Activity feed — read recent tick-loop iteration spans from the
 * supervisor's stdout log (`.minsky/tick-loop.out.log`) and surface
 * them as a typed list for the dashboard's "Recent activity" section.
 *
 * Each line of the log carries one span:
 *
 *   [span] tick-loop.iteration {"iteration.index":7,"iteration.status":"completed","task.id":"foo","iteration.reason":"…"}
 *
 * `parseSpan(line)` is pure (regex + JSON.parse over a single string);
 * `loadRecentSpans(path, n)` is the I/O boundary that reads the last N
 * matching spans from a file and returns them youngest-first.
 */

import { readFileSync, statSync } from "node:fs";

/**
 * One iteration span as the dashboard wants to display it.
 *
 * `index` is the tick-loop daemon's iteration counter. `status` is the
 * resolved branch of the iteration (`completed` / `budget-paused` /
 * `paused` / `no-task` / `failed` / etc. — whatever the daemon emits).
 * `taskId` is empty for budget-paused / no-task iterations because no
 * task was claimed. `reason` is the human-readable explainer the
 * daemon emits — usually the same string that goes into the OTEL span.
 */
export interface ActivityEntry {
  readonly index: number;
  readonly status: string;
  readonly taskId: string;
  readonly reason: string;
  /**
   * Optional LLM provider tag — surfaced when the supervisor's
   * `LlmProviderSpawnStrategy` (slice 3 of
   * `local-llm-fallback-on-budget-pause`) recorded which provider
   * served this iteration. Empty string when the supervisor used the
   * legacy single-strategy claude path (no wrapper). One of:
   * `"claude"` / `"local"` / `"hold"` / `""`.
   */
  readonly provider: string;
}

const SPAN_PREFIX = "[span] tick-loop.iteration ";

/**
 * Parse one log line into an `ActivityEntry`, or return `null` when
 * the line isn't a `tick-loop.iteration` span. Tolerates malformed
 * JSON / missing fields — corrupt lines yield `null` rather than
 * throwing (rule #7 graceful-degrade for upstream-malformed input).
 *
 * @otel-exempt pure parser — called per-line by `takeRecentSpans`,
 *   which itself is the @otel-exempt sibling of `loadRecentSpans` (the
 *   I/O boundary that carries the `dashboard-web.activity.load` span).
 *   A per-line span on parsing would explode cardinality without
 *   adding signal.
 */
export function parseSpan(line: string): ActivityEntry | null {
  if (!line.startsWith(SPAN_PREFIX)) return null;
  const json = line.slice(SPAN_PREFIX.length).trim();
  if (json === "") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
    // rule-6: handled-locally — malformed JSON in a single span line is the rule #7 graceful-degrade path; one bad line must not abort the activity feed render.
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const indexRaw = o["iteration.index"];
  const status = o["iteration.status"];
  const taskId = o["task.id"];
  const reason = o["iteration.reason"];
  const provider = o["iteration.provider"];
  if (typeof indexRaw !== "number" || typeof status !== "string") return null;
  return {
    index: indexRaw,
    status,
    taskId: typeof taskId === "string" ? taskId : "",
    reason: typeof reason === "string" ? reason : "",
    provider: typeof provider === "string" ? provider : "",
  };
}

/**
 * Pure: take a flat array of log lines, parse each, return the
 * **last `n`** entries that parsed successfully, **youngest-first**
 * (most recent at index 0). Caller does the I/O.
 *
 * @otel-exempt pure helper — `loadRecentSpans` is the I/O boundary
 *   and carries the `dashboard-web.activity.load` span; instrumenting
 *   the pure tail-walker here is double-counting.
 */
export function takeRecentSpans(lines: readonly string[], n: number): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i -= 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const entry = parseSpan(line);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/**
 * Read the supervisor log at `logPath`, return the most recent `n`
 * iteration spans (youngest first). Missing file → `[]` (rule #7
 * graceful-degrade — the daemon may not have started yet, or the log
 * may have been rotated; the dashboard renders an empty section
 * rather than throwing).
 *
 * The whole file is read in one pass — `.minsky/tick-loop.out.log`
 * is operator-side and bounded (a few hundred KB at most before
 * the supervisor rotates / the operator runs `pnpm dogfood:stop`),
 * so the simpler shape beats a streaming reverse-tail. If the log
 * grows past a few MB, swap this for a streaming reader.
 *
 * @otel dashboard-web.activity.load-recent
 */
export function loadRecentSpans(logPath: string, n: number): ActivityEntry[] {
  let content: string;
  try {
    statSync(logPath);
    content = readFileSync(logPath, "utf-8");
    // rule-6: handled-locally — missing log file (daemon hasn't started yet) is the rule #7 graceful-degrade path; an empty activity section is the right cold-start UX.
  } catch {
    return [];
  }
  const lines = content.split("\n");
  return takeRecentSpans(lines, n);
}
