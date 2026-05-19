#!/usr/bin/env node
// minsky-benchmark — run the cross-repo runner N times against a host
// and report the verdict distribution + pass rate + mean duration.
//
// Usage:
//   node scripts/minsky-benchmark.mjs [--iterations N] [--host PATH]
//                                      [--no-live] [--json] [--help]
//
// Default iterations: 5. Default host: cwd (or ~/.minsky/config.json
// `default_host` if cwd isn't a git repo). Default mode: --no-live
// (does not actually spawn agents — exercises the runner pipeline
// for shape verification). Pass `--live` to invoke real agents.
//
// Pass-rate definition (M1 §10): a verdict is "pass" if it produced
// useful output without spawn / setup failure:
//   pass:    pr-open | no-change | empty-queue | dry-run-only
//   fail:    spawn-failed | scope-leak | <other-error>
// pass-rate = pass_count / iterations × 100.
//
// Pattern: pure helpers + thin CLI wrapper (matches minsky-report.mjs).
// Source: M1 milestone exit criterion §10 (`minsky benchmark` ships
// the harness; per-machine stability data lives in the experiment
// store independently). Conformance: full — `aggregateBenchmark`,
// `classifyVerdict`, `parseRunnerOutput` are exported and unit-tested.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** Pass-set (rule-of-thumb): verdicts that mean the runner did its
 *  job without an infrastructural failure. Anything else counts as
 *  a "fail" for the M1 pass-rate definition. Documented inline so
 *  the rationale is co-located with the code.
 *
 *  Verdict semantics (from novel/cross-repo-runner/):
 *    pr-open       — agent shipped a PR (live mode happy-path)
 *    no-change     — agent ran but produced no diff
 *    empty-queue   — TASKS.md had nothing to pick (steady state)
 *    validated     — dry-run mode picked a task + wrote experiment yaml
 *                    (proves the pipeline works end-to-end without
 *                    spawning an agent — the canonical CI / fixture verdict)
 *  Fail (anything else):
 *    spawn-failed  — agent process couldn't start / exited without output
 *    scope-leak    — agent touched files outside the declared Files set
 */
export const PASS_VERDICTS = Object.freeze(
  new Set(["pr-open", "no-change", "empty-queue", "validated"]),
);

/** Classify a verdict string. Returns "pass" / "fail" / "unknown". */
export function classifyVerdict(verdict) {
  if (!verdict) return "unknown";
  if (PASS_VERDICTS.has(verdict)) return "pass";
  return "fail";
}

/** Extract the verdict from one runner stdout block. Looks for
 *  `verdict=<x>` (the format emitted by `⏱ iteration #...` lines)
 *  and falls back to `stopReason: <x>`. Returns undefined if
 *  neither is present. */
export function parseRunnerOutput(stdout) {
  const m1 = stdout.match(/verdict=([a-z][\w-]*)/);
  if (m1) return m1[1];
  const m2 = stdout.match(/stopReason:\s*([a-z][\w-]*)/);
  if (m2) return m2[1];
  return undefined;
}

/** Aggregate per-iteration outcomes into the report shape consumed
 *  by `--json` and the human summary. Pure: takes the array, returns
 *  the report. */
export function aggregateBenchmark(outcomes) {
  const verdictCounts = {};
  let totalDurationMs = 0;
  let passCount = 0;
  for (const o of outcomes) {
    const verdict = o.verdict ?? "unknown";
    verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
    totalDurationMs += o.durationMs ?? 0;
    if (classifyVerdict(verdict) === "pass") passCount++;
  }
  const iterations = outcomes.length;
  const passRate = iterations === 0 ? 0 : Math.round((passCount * 100) / iterations);
  const meanDurationMs = iterations === 0 ? 0 : Math.round(totalDurationMs / iterations);
  return {
    iterations,
    verdict_counts: verdictCounts,
    pass_rate: passRate,
    mean_duration_ms: meanDurationMs,
  };
}

/** Format the report as a human-readable summary. */
export function formatBenchmarkSummary(report) {
  let out = "minsky benchmark — summary\n";
  out += `${"─".repeat(50)}\n`;
  out += `  iterations:        ${report.iterations}\n`;
  out += `  pass-rate:         ${report.pass_rate}%\n`;
  out += `  mean duration:     ${report.mean_duration_ms}ms\n`;
  out += "  verdicts:\n";
  for (const [v, c] of Object.entries(report.verdict_counts).sort()) {
    out += `    ${v.padEnd(20)} ${c}\n`;
  }
  return out;
}

/** Run one iteration of the runner and return `{ verdict, durationMs, exitCode }`.
 *  Side-effects: spawns `node novel/cross-repo-runner/bin/minsky-run.mjs`.
 *  Pure helpers above don't depend on this — they take outcomes as input. */
function runOneIteration({ host, live }) {
  const runnerBin = join(REPO_ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs");
  const args = ["--host", host, "--once"];
  if (!live) args.push("--no-live");
  const t0 = Date.now();
  const result = spawnSync("node", [runnerBin, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, MINSKY_NON_INTERACTIVE: "1" },
  });
  const durationMs = Date.now() - t0;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const verdict = parseRunnerOutput(`${stdout}\n${stderr}`);
  return {
    verdict,
    durationMs,
    exitCode: result.status,
  };
}

/** Resolve the host repo: explicit --host wins, then ~/.minsky/config.json,
 *  then cwd. Returns undefined if none is a git repo. */
function resolveHost({ explicitHost }) {
  if (explicitHost) return explicitHost;
  // Read default_host from ~/.minsky/config.json without parsing JSON
  // formally — we use a regex for robustness.
  const cfgPath = join(process.env.HOME ?? "", ".minsky", "config.json");
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      if (cfg.default_host) return cfg.default_host;
    } catch {
      // fallthrough — corrupt config shouldn't block the benchmark
    }
  }
  return process.cwd();
}

/** Apply one CLI flag at index `i` of `args` to the accumulator `acc`.
 *  Returns the new index (advanced past any value the flag consumes).
 *  Extracted from `parseArgs` to keep cognitive complexity ≤10. */
function applyFlag(args, i, acc) {
  switch (args[i]) {
    case "--iterations":
      acc.iterations = Number.parseInt(args[i + 1], 10);
      return i + 1;
    case "--host":
      acc.host = args[i + 1];
      return i + 1;
    case "--live":
      acc.live = true;
      return i;
    case "--no-live":
      acc.live = false;
      return i;
    case "--json":
      acc.json = true;
      return i;
    case "--help":
    case "-h":
      acc.help = true;
      return i;
    default:
      return i;
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const acc = { iterations: 5, host: undefined, live: false, json: false, help: false };
  let i = 0;
  while (i < args.length) {
    i = applyFlag(args, i, acc) + 1;
  }
  return acc;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: minsky benchmark [options]",
      "",
      "Run the cross-repo runner N times against a host and report",
      "verdict distribution + pass rate + mean iteration duration.",
      "",
      "Options:",
      "  --iterations N    Number of iterations to run (default: 5)",
      "  --host PATH       Host repo (default: ~/.minsky/config.json default_host or cwd)",
      "  --live            Spawn real agents (default: --no-live, dry-run pipeline)",
      "  --no-live         Dry-run (default; for CI / fixture tests)",
      "  --json            Emit machine-readable JSON instead of human summary",
      "  --agent NAME      (Reserved — currently uses default agent from config)",
      "  --help, -h        Print this message",
      "",
      "Pass-rate definition: pass_count / iterations × 100.",
      "  pass:  pr-open | no-change | empty-queue | dry-run-only",
      "  fail:  spawn-failed | scope-leak | <other>",
      "",
    ].join("\n"),
  );
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  if (!Number.isFinite(opts.iterations) || opts.iterations < 1) {
    process.stderr.write(
      `minsky benchmark: --iterations must be a positive integer (got ${opts.iterations})\n`,
    );
    return 2;
  }
  const host = resolveHost({ explicitHost: opts.host });
  if (!host || !existsSync(join(host, ".git"))) {
    process.stderr.write(
      `minsky benchmark: host '${host}' is not a git repo (set --host or run 'minsky init')\n`,
    );
    return 2;
  }
  const outcomes = [];
  for (let i = 0; i < opts.iterations; i++) {
    outcomes.push(runOneIteration({ host, live: opts.live }));
  }
  const report = aggregateBenchmark(outcomes);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatBenchmarkSummary(report));
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
