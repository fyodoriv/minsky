#!/usr/bin/env node
// @ts-check
// `scripts/llm-provider-throughput.mjs` — measure per-provider PR
// throughput over a rolling window. Slice 5 substrate of
// `local-llm-fallback-on-budget-pause` per TASKS.md (the
// pre-registered Measurement command for rule #9 verification).
//
// Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
//   - Goal-Question-Metric — Basili-Caldiera-Rombach 1994 (the
//     pre-registered measurement command IS the GQM operationalisation).
//     Conformance: full.
//   - Pure aggregation over an append-only span log — Helland 2007
//     (immutable log, derived data through reissue). Conformance: full.
//
// Usage:
//   node scripts/llm-provider-throughput.mjs [--since=YYYY-MM-DD]
//                                             [--log=<path>]
//                                             [--json]
//
// Defaults:
//   --since= 7 days ago (UTC)
//   --log=   $MINSKY_HOME/.minsky/tick-loop.out.log
//   --json   when set, output is one JSON line; without it, plain text
//
// Output (JSON mode):
//   {
//     "since": "2026-04-30T00:00:00.000Z",
//     "until": "2026-05-07T00:00:00.000Z",
//     "claude": {"iterations": M1, "completed": N1},
//     "local":  {"iterations": M2, "completed": N2},
//     "hold":   {"iterations": M3, "completed": N3},
//     "untagged": {"iterations": M4, "completed": N4},
//     "switches": K
//   }
//
// `iterations` is total spawn count for that provider. `completed` is
// the count whose `iteration.status` was `"completed"` (a successful
// iteration — a proxy for "shipped a PR" until the daemon emits an
// explicit PR-merged span). `switches` is the count of provider
// transitions in the time-ordered span sequence.
//
// Acceptance threshold (per task spec): when budget-guard's
// `circuit-break-and-notify` was active for ≥6 cumulative hours in the
// window, `local.completed / (local.iterations / 60min) ≥ 0.05`
// (≥1 PR per 20 iterations on local — half of claude baseline).

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_LOOKBACK_DAYS = 7;
const SPAN_PREFIX = "[span] tick-loop.iteration ";

/**
 * @typedef {{
 *   index: number,
 *   status: string,
 *   provider: string,
 *   timestampMs?: number,
 * }} IterationRecord
 */

/**
 * @typedef {{
 *   iterations: number,
 *   completed: number,
 * }} ProviderCounters
 */

/**
 * @typedef {{
 *   since: string,
 *   until: string,
 *   claude: ProviderCounters,
 *   local: ProviderCounters,
 *   hold: ProviderCounters,
 *   untagged: ProviderCounters,
 *   switches: number,
 * }} ThroughputReport
 */

/**
 * Parse CLI args. Pure, exported for testing.
 *
 * @param {readonly string[]} argv
 * @returns {{ since: Date, logPath: string | undefined, json: boolean }}
 */
export function parseArgs(argv) {
  let since = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  /** @type {string | undefined} */
  let logPath;
  let json = false;
  for (const arg of argv) {
    if (arg.startsWith("--since=")) {
      const parsed = new Date(arg.slice("--since=".length));
      if (!Number.isNaN(parsed.getTime())) since = parsed;
    } else if (arg.startsWith("--log=")) {
      logPath = arg.slice("--log=".length);
    } else if (arg === "--json") {
      json = true;
    }
  }
  return { since, logPath, json };
}

/**
 * Parse one log line into an `IterationRecord`. Returns `null` for
 * non-iteration lines or malformed JSON. Pure, exported for testing.
 *
 * @param {string} line
 * @returns {IterationRecord | null}
 */
export function parseIterationLine(line) {
  if (!line.startsWith(SPAN_PREFIX)) return null;
  const json = line.slice(SPAN_PREFIX.length).trim();
  if (json === "") return null;
  try {
    /** @type {Record<string, unknown>} */
    const obj = JSON.parse(json);
    const indexRaw = obj["iteration.index"];
    const status = obj["iteration.status"];
    const provider = obj["iteration.provider"];
    if (typeof indexRaw !== "number" || typeof status !== "string") return null;
    return {
      index: indexRaw,
      status,
      provider: typeof provider === "string" ? provider : "",
    };
  } catch {
    return null;
  }
}

/**
 * Aggregate iteration records into per-provider counters. Pure,
 * exported for testing.
 *
 * @param {readonly IterationRecord[]} records
 * @returns {{
 *   claude: ProviderCounters,
 *   local: ProviderCounters,
 *   hold: ProviderCounters,
 *   untagged: ProviderCounters,
 *   switches: number,
 * }}
 */
export function aggregate(records) {
  const buckets = {
    claude: { iterations: 0, completed: 0 },
    local: { iterations: 0, completed: 0 },
    hold: { iterations: 0, completed: 0 },
    untagged: { iterations: 0, completed: 0 },
  };
  let lastProvider = "";
  let switches = 0;
  for (const r of records) {
    const key = bucketFor(r.provider);
    buckets[key].iterations += 1;
    if (r.status === "completed") buckets[key].completed += 1;
    if (r.provider !== "" && lastProvider !== "" && r.provider !== lastProvider) {
      switches += 1;
    }
    if (r.provider !== "") lastProvider = r.provider;
  }
  return { ...buckets, switches };
}

/**
 * @param {string} provider
 * @returns {"claude" | "local" | "hold" | "untagged"}
 */
function bucketFor(provider) {
  if (provider === "claude" || provider === "local" || provider === "hold") return provider;
  return "untagged";
}

/**
 * Render a human-readable summary. Pure.
 *
 * @param {ThroughputReport} report
 * @returns {string}
 */
export function renderText(report) {
  const lines = [];
  lines.push(`Window: ${report.since} → ${report.until}`);
  lines.push("");
  lines.push("Provider     iterations  completed");
  /** @type {Array<["claude"|"local"|"hold"|"untagged", string]>} */
  const rows = [
    ["claude", "claude"],
    ["local", "local"],
    ["hold", "hold"],
    ["untagged", "untagged"],
  ];
  for (const [key, label] of rows) {
    const c = report[key];
    lines.push(
      `  ${label.padEnd(10)} ${String(c.iterations).padStart(10)}  ${String(c.completed).padStart(9)}`,
    );
  }
  lines.push("");
  lines.push(`Switches:    ${report.switches}`);
  return lines.join("\n");
}

/**
 * CLI main. I/O boundary; reads the log file, parses + aggregates, prints.
 *
 * @param {{
 *   argv: readonly string[],
 *   stdout: { write: (s: string) => void },
 *   stderr: { write: (s: string) => void },
 *   readFile?: (p: string) => string,
 *   exists?: (p: string) => boolean,
 * }} opts
 * @returns {Promise<number>} exit code
 */
export async function main(opts) {
  const { since, logPath, json } = parseArgs(opts.argv);
  const path = resolveLogPath(logPath);
  const content = readLogContent(path, opts);
  const records = parseAllRecords(content);
  const aggregated = aggregate(records);
  /** @type {ThroughputReport} */
  const report = {
    since: since.toISOString(),
    until: new Date().toISOString(),
    claude: aggregated.claude,
    local: aggregated.local,
    hold: aggregated.hold,
    untagged: aggregated.untagged,
    switches: aggregated.switches,
  };
  opts.stdout.write(`${json ? JSON.stringify(report) : renderText(report)}\n`);
  return 0;
}

/**
 * Resolve the log path: explicit `--log=` wins, else default to
 * `$MINSKY_HOME/.minsky/tick-loop.out.log`. Pure (modulo env read).
 *
 * @param {string | undefined} logPath
 * @returns {string}
 */
function resolveLogPath(logPath) {
  if (logPath !== undefined) return logPath;
  const minskyHome = process.env["MINSKY_HOME"] ?? homedir();
  return join(minskyHome, ".minsky", "tick-loop.out.log");
}

/**
 * Read the log content, or empty string + stderr advisory when missing.
 * The I/O boundary; tests inject `exists` + `readFile`.
 *
 * @param {string} path
 * @param {{
 *   stderr: { write: (s: string) => void },
 *   readFile?: (p: string) => string,
 *   exists?: (p: string) => boolean,
 * }} opts
 * @returns {string}
 */
function readLogContent(path, opts) {
  const exists = opts.exists ?? defaultExists;
  const readFile = opts.readFile ?? defaultReadFile;
  if (!exists(path)) {
    opts.stderr.write(`llm-provider-throughput: log not found at ${path}\n`);
    return "";
  }
  return readFile(path);
}

/**
 * Parse all iteration spans from the log content. Pure.
 *
 * @param {string} content
 * @returns {IterationRecord[]}
 */
function parseAllRecords(content) {
  /** @type {IterationRecord[]} */
  const records = [];
  for (const line of content.split("\n")) {
    const r = parseIterationLine(line);
    if (r !== null) records.push(r);
  }
  return records;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function defaultExists(path) {
  try {
    statSync(path);
    return true;
    // rule-6: handled-locally — missing log file is the documented
    // graceful path (the daemon may not have started yet).
  } catch {
    return false;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
function defaultReadFile(path) {
  return readFileSync(path, "utf-8");
}

// I/O boundary — only runs when this is the entry script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main({
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  })
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      // rule #6 / Armstrong 2007: let it crash. Supervisor sees exit code 2.
      process.stderr.write(`llm-provider-throughput: ${err}\n`);
      process.exit(2);
    });
}
