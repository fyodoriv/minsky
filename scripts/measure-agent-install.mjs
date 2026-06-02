#!/usr/bin/env node
// Measurement harness for the parent P0 `agent-mediated-install` task's
// 9-run cross-provider success criterion:
//
//   `node scripts/measure-agent-install.mjs --providers=claude-code,devin,cursor \
//     --runs-per-provider=3 --threshold-seconds=90 --threshold-prompts=1`
//
// Exit 0 iff every run passes both thresholds (duration ≤ N seconds AND
// prompt count ≤ N). The exit code is the aggregate verdict.
//
// Mock mode (`--providers=mock`) emits deterministic readings so CI has
// a regression gate on the harness machinery (arg parsing, JSON shape,
// aggregate logic, threshold semantics) without spending API budget on
// real agent invocations.
//
// Live mode (`--live` flag) spawns the named real agent against a fresh
// tmp git repo seeded with INSTALL.md, captures its stdout transcript,
// and parses the operator-prompt count via a per-provider parser module
// (`scripts/measure-agent-install/parsers/<provider>.mjs`). When the
// provider's CLI is not on PATH, the run skips gracefully (so `--live`
// is safe to invoke without every agent installed). Live mode is NOT
// wired into CI — the parent task's Pivot keeps it operator-side.
//
// Source: P1 `measure-agent-install-harness`; parent P0 `agent-mediated-install` slice (3);
// live-mode follow-up `measure-agent-install-live-mode`.
// Rule #9: this script IS the Measurement field of the parent task.
// Rule #1: emits the same JSON shape that parent task acceptance #1 asserts.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as claudeCodeParser from "./measure-agent-install/parsers/claude-code.mjs";
import * as cursorParser from "./measure-agent-install/parsers/cursor.mjs";
import * as devinParser from "./measure-agent-install/parsers/devin.mjs";

// Per-provider parser registry. Adding a 4th provider is a one-file
// addition (parent task Acceptance #6): write the parser module, add one
// row here. The harness logic stays untouched.
/** @type {Record<string, { PROVIDER: string, BINARY: string, parsePromptCount: (t: string) => number }>} */
export const PROVIDER_PARSERS = {
  "claude-code": claudeCodeParser,
  devin: devinParser,
  cursor: cursorParser,
};

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const KNOWN_PROVIDERS = new Set(["mock", "claude-code", "devin", "cursor"]);
const DEFAULT_THRESHOLD_SECONDS = 90;
const DEFAULT_THRESHOLD_PROMPTS = 1;
const DEFAULT_RUNS_PER_PROVIDER = 3;

/**
 * @typedef {Object} RunReading
 * @property {string} provider
 * @property {number} run_index
 * @property {number} duration_seconds
 * @property {number} prompt_count
 * @property {"pass" | "fail" | "skipped"} verdict
 * @property {string} [reason]
 */

/**
 * @typedef {Object} HarnessReport
 * @property {string} timestamp
 * @property {{
 *   providers: string[],
 *   runs_per_provider: number,
 *   threshold_seconds: number,
 *   threshold_prompts: number,
 *   live: boolean,
 * }} config
 * @property {RunReading[]} runs
 * @property {{
 *   total: number,
 *   passed: number,
 *   failed: number,
 *   skipped: number,
 * }} totals
 * @property {"pass" | "fail"} aggregate_verdict
 * @property {number} runs_passed
 */

/**
 * @typedef {Object} CliArgs
 * @property {string[]} providers
 * @property {number} runsPerProvider
 * @property {number} thresholdSeconds
 * @property {number} thresholdPrompts
 * @property {boolean} live
 * @property {string | null} outFile
 * @property {boolean} json
 * @property {boolean} quiet
 */

/**
 * @typedef {Object} ArgHandler
 * @property {(a: string) => boolean} test
 * @property {(args: CliArgs, a: string) => void} apply
 */

// Dispatch table — keeps parseArgs flat enough for biome's cognitive
// complexity threshold. Each entry's `apply` mutates `args` in-place.
/** @type {ArgHandler[]} */
const ARG_HANDLERS = [
  {
    test: (a) => a.startsWith("--providers="),
    apply: (args, a) => {
      args.providers = a
        .slice("--providers=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },
  },
  {
    test: (a) => a.startsWith("--runs-per-provider="),
    apply: (args, a) => {
      args.runsPerProvider = Number.parseInt(a.slice("--runs-per-provider=".length), 10);
    },
  },
  {
    test: (a) => a.startsWith("--threshold-seconds="),
    apply: (args, a) => {
      args.thresholdSeconds = Number.parseInt(a.slice("--threshold-seconds=".length), 10);
    },
  },
  {
    test: (a) => a.startsWith("--threshold-prompts="),
    apply: (args, a) => {
      args.thresholdPrompts = Number.parseInt(a.slice("--threshold-prompts=".length), 10);
    },
  },
  {
    test: (a) => a === "--live",
    apply: (args) => {
      args.live = true;
    },
  },
  {
    test: (a) => a.startsWith("--out="),
    apply: (args, a) => {
      args.outFile = a.slice("--out=".length);
    },
  },
  {
    test: (a) => a === "--quiet",
    apply: (args) => {
      args.quiet = true;
    },
  },
  {
    test: (a) => a === "--no-json",
    apply: (args) => {
      args.json = false;
    },
  },
];

/**
 * @param {string[]} argv
 * @returns {CliArgs}
 */
function parseArgs(argv) {
  /** @type {CliArgs} */
  const args = {
    providers: ["mock"],
    runsPerProvider: DEFAULT_RUNS_PER_PROVIDER,
    thresholdSeconds: DEFAULT_THRESHOLD_SECONDS,
    thresholdPrompts: DEFAULT_THRESHOLD_PROMPTS,
    live: false,
    outFile: null,
    json: true,
    quiet: false,
  };
  for (const a of argv) {
    const h = ARG_HANDLERS.find((x) => x.test(a));
    if (h) h.apply(args, a);
  }
  return args;
}

/**
 * @param {CliArgs} args
 * @returns {string[]}
 */
function validateArgs(args) {
  const errs = [];
  if (!Number.isFinite(args.runsPerProvider) || args.runsPerProvider < 1) {
    errs.push(`--runs-per-provider must be a positive integer (got ${args.runsPerProvider})`);
  }
  if (!Number.isFinite(args.thresholdSeconds) || args.thresholdSeconds < 1) {
    errs.push(`--threshold-seconds must be a positive integer (got ${args.thresholdSeconds})`);
  }
  if (!Number.isFinite(args.thresholdPrompts) || args.thresholdPrompts < 0) {
    errs.push(`--threshold-prompts must be a non-negative integer (got ${args.thresholdPrompts})`);
  }
  if (args.providers.length === 0) {
    errs.push("--providers list is empty (pass at least one provider name)");
  }
  for (const p of args.providers) {
    if (!KNOWN_PROVIDERS.has(p)) {
      errs.push(`unknown provider "${p}" (known: ${[...KNOWN_PROVIDERS].join(", ")})`);
    }
  }
  return errs;
}

/**
 * Deterministic mock reading — exists so CI has a regression gate on
 * the harness machinery without spending API budget. Returns a reading
 * that satisfies the default thresholds (≤90s, ≤1 prompt).
 *
 * Determinism via the (provider, runIndex) pair: seed-stable, no
 * randomness, no clock dependency.
 *
 * @param {{ provider: string, runIndex: number, thresholdSeconds: number, thresholdPrompts: number }} input
 * @returns {RunReading}
 */
export function mockReading({ provider, runIndex, thresholdSeconds, thresholdPrompts }) {
  // Deterministic duration: 30-60s window, varying by runIndex so the
  // test can detect run-to-run differences but always under threshold.
  const duration = 30 + runIndex * 10;
  // The mock agent asks exactly 1 prompt (the verbatim consent) per
  // the INSTALL.md contract.
  const promptCount = 1;
  const durationOk = duration <= thresholdSeconds;
  const promptsOk = promptCount <= thresholdPrompts;
  return {
    provider,
    run_index: runIndex,
    duration_seconds: duration,
    prompt_count: promptCount,
    verdict: durationOk && promptsOk ? "pass" : "fail",
  };
}

/**
 * Resolve a CLI binary on PATH. Returns true iff the binary is invokable.
 * Used so live mode skips gracefully when an agent isn't installed
 * (parent task Risk (c)).
 *
 * @param {string} binary
 * @returns {boolean}
 */
function binaryOnPath(binary) {
  const which = spawnSync(process.platform === "win32" ? "where" : "command", ["-v", binary], {
    encoding: "utf8",
    shell: true,
  });
  return which.status === 0 && typeof which.stdout === "string" && which.stdout.trim().length > 0;
}

/**
 * Spawn a real agent against a fresh tmp git repo seeded with INSTALL.md,
 * returning the captured stdout transcript. The agent is fed the install
 * brief via stdin. Side-effecting (spawn + tmp dir); kept separate from
 * the pure verdict logic (`liveVerdict`) so the latter is fixture-testable
 * without an agent on PATH.
 *
 * @param {{ binary: string, installMdPath: string }} input
 * @returns {{ transcript: string, durationSeconds: number }}
 */
function captureTranscript({ binary, installMdPath }) {
  const workdir = mkdtempSync(join(tmpdir(), "measure-agent-live-"));
  try {
    // Fresh git repo + a copy of the runbook so the agent has a realistic
    // target to install into.
    spawnSync("git", ["init", "-q"], { cwd: workdir });
    const installMd = spawnSync("cat", [installMdPath], { encoding: "utf8" });
    writeFileSync(join(workdir, "INSTALL.md"), installMd.stdout ?? "");
    const brief = `Read INSTALL.md in this directory and install minsky for this folder. Ask me a question ONLY at the explicit Step-5 consent prompt; every other step is yours to execute autonomously. When you reach the consent prompt, ask it verbatim, then assume the answer is "no".`;
    const start = process.hrtime.bigint();
    const proc = spawnSync(binary, [], {
      cwd: workdir,
      input: brief,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
    });
    const end = process.hrtime.bigint();
    const transcript = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
    return { transcript, durationSeconds: Number(end - start) / 1e9 };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/**
 * Pure: turn a captured (durationSeconds, transcript) pair into a
 * RunReading by parsing the prompt count with the provider's parser and
 * applying the thresholds. No I/O — fixture-testable against committed
 * transcripts (parent task Acceptance: each parser fixture-tested).
 *
 * @param {{
 *   provider: string,
 *   runIndex: number,
 *   durationSeconds: number,
 *   transcript: string,
 *   thresholdSeconds: number,
 *   thresholdPrompts: number,
 * }} input
 * @returns {RunReading}
 */
export function liveVerdict({
  provider,
  runIndex,
  durationSeconds,
  transcript,
  thresholdSeconds,
  thresholdPrompts,
}) {
  const parser = PROVIDER_PARSERS[provider];
  if (!parser) {
    return {
      provider,
      run_index: runIndex,
      duration_seconds: -1,
      prompt_count: -1,
      verdict: "skipped",
      reason: `no parser registered for provider "${provider}"`,
    };
  }
  const promptCount = parser.parsePromptCount(transcript);
  const duration = Math.round(durationSeconds * 100) / 100;
  const durationOk = duration <= thresholdSeconds;
  const promptsOk = promptCount <= thresholdPrompts;
  return {
    provider,
    run_index: runIndex,
    duration_seconds: duration,
    prompt_count: promptCount,
    verdict: durationOk && promptsOk ? "pass" : "fail",
  };
}

/**
 * Live reading: spawn the real agent, capture its transcript, score it.
 * Skips gracefully (with a reason) when the provider has no parser or the
 * CLI is not on PATH — so `--live` is safe to run without every agent
 * installed (parent task Risk (c)).
 *
 * @param {{
 *   provider: string,
 *   runIndex: number,
 *   thresholdSeconds: number,
 *   thresholdPrompts: number,
 *   installMdPath?: string,
 * }} input
 * @returns {RunReading}
 */
function liveReading({ provider, runIndex, thresholdSeconds, thresholdPrompts, installMdPath }) {
  const parser = PROVIDER_PARSERS[provider];
  if (!parser) {
    return {
      provider,
      run_index: runIndex,
      duration_seconds: -1,
      prompt_count: -1,
      verdict: "skipped",
      reason: `no parser registered for provider "${provider}"`,
    };
  }
  if (!binaryOnPath(parser.BINARY)) {
    return {
      provider,
      run_index: runIndex,
      duration_seconds: -1,
      prompt_count: -1,
      verdict: "skipped",
      reason: `agent CLI "${parser.BINARY}" not on PATH — install it to run --live for ${provider}`,
    };
  }
  const { transcript, durationSeconds } = captureTranscript({
    binary: parser.BINARY,
    installMdPath: installMdPath ?? resolve(REPO_ROOT, "INSTALL.md"),
  });
  return liveVerdict({
    provider,
    runIndex,
    durationSeconds,
    transcript,
    thresholdSeconds,
    thresholdPrompts,
  });
}

/**
 * Pure: given args + a reading function, produce a HarnessReport.
 *
 * @param {{
 *   providers: string[],
 *   runsPerProvider: number,
 *   thresholdSeconds: number,
 *   thresholdPrompts: number,
 *   live: boolean,
 *   readingFn?: (input: { provider: string, runIndex: number, thresholdSeconds: number, thresholdPrompts: number, live: boolean }) => RunReading,
 * }} input
 * @returns {HarnessReport}
 */
export function buildReport({
  providers,
  runsPerProvider,
  thresholdSeconds,
  thresholdPrompts,
  live,
  readingFn,
}) {
  const fn = readingFn ?? defaultReadingFn;
  /** @type {RunReading[]} */
  const runs = [];
  for (const provider of providers) {
    for (let i = 1; i <= runsPerProvider; i++) {
      runs.push(fn({ provider, runIndex: i, thresholdSeconds, thresholdPrompts, live }));
    }
  }
  const passed = runs.filter((r) => r.verdict === "pass").length;
  const failed = runs.filter((r) => r.verdict === "fail").length;
  const skipped = runs.filter((r) => r.verdict === "skipped").length;
  return {
    timestamp: new Date().toISOString(),
    config: {
      providers,
      runs_per_provider: runsPerProvider,
      threshold_seconds: thresholdSeconds,
      threshold_prompts: thresholdPrompts,
      live,
    },
    runs,
    totals: { total: runs.length, passed, failed, skipped },
    // `aggregate_verdict == "pass"` requires ALL runs to be "pass".
    // A single "skipped" or "fail" → aggregate "fail" so the operator
    // never reads `aggregate_verdict == "pass"` from a partial run.
    aggregate_verdict: passed === runs.length && runs.length > 0 ? "pass" : "fail",
    runs_passed: passed,
  };
}

/**
 * Default reading dispatcher: routes to mock for `mock` provider, to
 * live invocation otherwise. Live mode itself is gated behind --live;
 * without it, real-provider names are reported as skipped (so a stray
 * `--providers=claude-code` in CI without `--live` doesn't fail the
 * harness — it produces a clean skipped reading).
 *
 * @param {{ provider: string, runIndex: number, thresholdSeconds: number, thresholdPrompts: number, live: boolean }} input
 * @returns {RunReading}
 */
function defaultReadingFn({ provider, runIndex, thresholdSeconds, thresholdPrompts, live }) {
  if (provider === "mock") {
    return mockReading({ provider, runIndex, thresholdSeconds, thresholdPrompts });
  }
  if (live) {
    return liveReading({ provider, runIndex, thresholdSeconds, thresholdPrompts });
  }
  return {
    provider,
    run_index: runIndex,
    duration_seconds: -1,
    prompt_count: -1,
    verdict: "skipped",
    reason: `real-agent provider "${provider}" requires --live (omitted)`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const errs = validateArgs(args);
  if (errs.length > 0) {
    for (const e of errs) console.error(`measure-agent-install: ${e}`);
    console.error(
      "Usage: node scripts/measure-agent-install.mjs --providers=mock --runs-per-provider=3 --threshold-seconds=90 --threshold-prompts=1",
    );
    process.exit(2);
  }
  const report = buildReport({
    providers: args.providers,
    runsPerProvider: args.runsPerProvider,
    thresholdSeconds: args.thresholdSeconds,
    thresholdPrompts: args.thresholdPrompts,
    live: args.live,
  });
  if (args.outFile) {
    const target = resolve(REPO_ROOT, args.outFile);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json && !args.quiet) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    process.stdout.write(
      `measure-agent-install: ${report.aggregate_verdict} (${report.runs_passed}/${report.totals.total} runs passed)\n`,
    );
  }
  // Exit 0 only when every run passed (parent task contract).
  process.exit(report.aggregate_verdict === "pass" ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
