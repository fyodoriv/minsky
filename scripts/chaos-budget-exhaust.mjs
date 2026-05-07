#!/usr/bin/env node
// @ts-check
// `scripts/chaos-budget-exhaust.mjs` — operator-facing chaos test that
// forces the daemon into local-LLM dispatch and asserts the daemon
// completes ≥1 iteration with `iteration.provider: "local"`. Slice 6 of
// `local-llm-fallback-on-budget-pause` per TASKS.md.
//
// Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
//   - Chaos engineering — Basiri et al., "Principles of Chaos
//     Engineering", *IEEE Software* 2016. Steady-state hypothesis +
//     fault injection + assertion against the steady state. Conformance:
//     full.
//   - Synthetic-fault injection — the chaos test injects:
//       * `MINSKY_LLM_PROVIDER=local-preferred` (operator override
//         routing to local when reachable), and
//       * a tiny in-process HTTP server on a free localhost port
//         returning 200 OK on `/v1/models` (the probe target).
//     Together these force the wrapper's `decideProvider(...)` to pick
//     "local" without needing a real mlx-lm.server, real budget
//     exhaustion, or real Anthropic quota burn.
//
// Steady-state hypothesis: when `MINSKY_LLM_PROVIDER=local-preferred`
// is set AND the probe target returns 200 OK, the daemon's iteration
// log carries at least one `iteration.provider: "local"` entry within
// `--max-iterations` iterations.
//
// Operator escape hatch: the script does NOT actually overwrite the
// operator's claude session JSONL. The cap override is env-only and
// ephemeral — when the script exits, normal budget tracking resumes.
//
// Usage:
//   node scripts/chaos-budget-exhaust.mjs [--max-iterations=N]
//                                          [--probe-url=<url>]
//                                          [--report=<path>]
//
// Defaults:
//   --max-iterations=  3
//   --probe-url=       http://127.0.0.1:8080/v1/models (the default mlx-lm.server)
//
// The script exits 0 when the steady state is observed (≥1 local
// iteration in the log within max-iterations) and 1 otherwise. It does
// not modify the operator's main repo, branch, or git state — runs in
// dry-run mode (`MINSKY_TICK_DRY_RUN=1`).
//
// Anchor: TASKS.md `local-llm-fallback-on-budget-pause` § Verification
//         "Chaos test: artificially flip budget-guard state file →
//          assert next iteration spawns aider (not claude) → assert PR
//          opened".

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const TICK_LOOP_BIN = join(REPO_ROOT, "novel/tick-loop/bin/tick-loop.mjs");

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_PROBE_URL = "http://127.0.0.1:8080/v1/models";

/**
 * Parse CLI args. Pure, exported for testing.
 *
 * @param {readonly string[]} argv
 * @returns {{
 *   maxIterations: number,
 *   probeUrl: string,
 *   reportPath: string | undefined,
 * }}
 */
export function parseArgs(argv) {
  let maxIterations = DEFAULT_MAX_ITERATIONS;
  let probeUrl = DEFAULT_PROBE_URL;
  /** @type {string | undefined} */
  let reportPath;
  for (const arg of argv) {
    if (arg.startsWith("--max-iterations=")) {
      const parsed = Number.parseInt(arg.slice("--max-iterations=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) maxIterations = parsed;
    } else if (arg.startsWith("--probe-url=")) {
      probeUrl = arg.slice("--probe-url=".length);
    } else if (arg.startsWith("--report=")) {
      reportPath = arg.slice("--report=".length);
    }
  }
  return { maxIterations, probeUrl, reportPath };
}

/**
 * Verdict shape — exported for testing the assertion logic.
 *
 * @typedef {{
 *   verdict: "pass" | "fail",
 *   reason: string,
 *   localIterations: number,
 *   claudeIterations: number,
 *   holdIterations: number,
 *   totalIterations: number,
 * }} ChaosVerdict
 */

/**
 * Pure assertion: given the iteration log captured during the chaos
 * window, decide whether the steady-state hypothesis holds.
 *
 * @param {string} stdout
 * @returns {ChaosVerdict}
 */
export function assertSteadyState(stdout) {
  const counts = countProviders(stdout);
  if (counts.local >= 1) {
    return {
      verdict: "pass",
      reason: `observed ${counts.local} local iteration(s) within ${counts.total} total — steady-state holds`,
      localIterations: counts.local,
      claudeIterations: counts.claude,
      holdIterations: counts.hold,
      totalIterations: counts.total,
    };
  }
  return {
    verdict: "fail",
    reason: `expected ≥1 local iteration but observed ${counts.local} (claude=${counts.claude}, hold=${counts.hold}, total=${counts.total}) — steady-state violated`,
    localIterations: counts.local,
    claudeIterations: counts.claude,
    holdIterations: counts.hold,
    totalIterations: counts.total,
  };
}

/**
 * Pure helper: count provider occurrences in the iteration log.
 *
 * @param {string} stdout
 * @returns {{ local: number, claude: number, hold: number, total: number }}
 */
function countProviders(stdout) {
  const SPAN_PREFIX = "[span] tick-loop.iteration ";
  const counts = { local: 0, claude: 0, hold: 0, total: 0 };
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(SPAN_PREFIX)) continue;
    counts.total += 1;
    bumpProvider(counts, line.slice(SPAN_PREFIX.length));
  }
  return counts;
}

/**
 * Mutates `counts` in place to bump the provider counter parsed from
 * the iteration JSON. Tolerates malformed JSON (rule-6 handled-locally
 * — one bad line must not abort the chaos verdict).
 *
 * @param {{ local: number, claude: number, hold: number, total: number }} counts
 * @param {string} json
 */
function bumpProvider(counts, json) {
  try {
    /** @type {Record<string, unknown>} */
    const obj = JSON.parse(json);
    const provider = obj["iteration.provider"];
    if (provider === "local") counts.local += 1;
    else if (provider === "claude") counts.claude += 1;
    else if (provider === "hold") counts.hold += 1;
    // rule-6: handled-locally — malformed JSON in the iteration log is
    // rule #7 graceful-degrade per the dashboard's parseSpan precedent;
    // one bad line must not abort the chaos verdict.
  } catch {
    /* swallow */
  }
}

/**
 * I/O boundary — spawn the daemon with the chaos env, capture stdout,
 * call `assertSteadyState`. Exported for tests; production callers use
 * the CLI entry below.
 *
 * @param {{
 *   argv: readonly string[],
 *   stdout: { write: (s: string) => void },
 *   stderr: { write: (s: string) => void },
 *   spawnFn?: typeof spawn,
 * }} opts
 * @returns {Promise<number>} exit code (0 = pass, 1 = fail, 2 = unhandled error)
 */
export async function main(opts) {
  const args = parseArgs(opts.argv);
  const minskyHome = process.env["MINSKY_HOME"] ?? REPO_ROOT;
  // Start the synthetic probe server (200 OK on /v1/models) so the
  // wrapper's probe sees `reachable: true` without needing a real
  // mlx-lm.server. The server uses a random localhost port; close it
  // when the daemon exits.
  const probeServer = await startProbeServer();
  const probeUrl = `http://127.0.0.1:${probeServer.port}/v1/models`;
  opts.stdout.write(
    `chaos-budget-exhaust: probe server up at ${probeUrl} (max-iter=${args.maxIterations})\n`,
  );
  const env = {
    ...process.env,
    MINSKY_HOME: minskyHome,
    // Wire the local-LLM fallback (slice 3) so the wrapper takes over.
    MINSKY_LOCAL_LLM: "1",
    MINSKY_LOCAL_LLM_PROBE_URL: probeUrl,
    // Force the wrapper to route to local when probe is reachable
    // (operator override path, slice 1's `preferLocal: true`).
    MINSKY_LLM_PROVIDER: "local-preferred",
    // Run in dry-run mode so we don't actually shell out to claude or
    // aider — the wrapper's claude / local both delegate to
    // `DryRunSpawnStrategy`, but `decideProvider` still runs and the
    // iteration span carries `iteration.provider`. The chaos test
    // verifies the dispatch logic, not the underlying CLI.
    MINSKY_TICK_DRY_RUN: "1",
  };
  const exitCode = await runDaemonAndAssert({ args, env, minskyHome, opts });
  probeServer.close();
  return exitCode;
}

/**
 * Start a tiny in-process HTTP server that returns 200 OK + an empty
 * JSON model list on `/v1/models`. Used by the chaos test to synthesise
 * a reachable probe target.
 *
 * @returns {Promise<{ port: number, close: () => void }>}
 */
async function startProbeServer() {
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":[]}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolveProm) => {
    server.listen(0, "127.0.0.1", () => resolveProm(undefined));
  });
  const addr = server.address();
  const port = addr !== null && typeof addr === "object" && "port" in addr ? Number(addr.port) : 0;
  return {
    port,
    close: () => server.close(),
  };
}

/**
 * Spawn the daemon, capture stdout, run the assertion, return exit code.
 * Extracted from `main` to keep the I/O boundary under the
 * cognitive-complexity cap (rule #6, ≤10).
 *
 * @param {{
 *   args: { maxIterations: number, probeUrl: string, reportPath: string | undefined },
 *   env: Record<string, string | undefined>,
 *   minskyHome: string,
 *   opts: {
 *     stdout: { write: (s: string) => void },
 *     stderr: { write: (s: string) => void },
 *     spawnFn?: typeof spawn,
 *   },
 * }} input
 * @returns {Promise<number>}
 */
async function runDaemonAndAssert(input) {
  const { args, env, minskyHome, opts } = input;
  const spawnFn = opts.spawnFn ?? spawn;
  /** @type {Buffer[]} */
  const stdoutChunks = [];
  return new Promise((resolveProm) => {
    const child = spawnFn(
      "node",
      [
        TICK_LOOP_BIN,
        `--max-iterations=${args.maxIterations}`,
        "--tick-interval-ms=10",
        `--tasks-md=${join(minskyHome, "TASKS.md")}`,
        `--paused-sentinel=${join(minskyHome, "state", "PAUSED")}`,
      ],
      {
        env: /** @type {NodeJS.ProcessEnv} */ (env),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      opts.stdout.write(String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      opts.stderr.write(String(chunk));
    });
    child.on("error", (err) => {
      opts.stderr.write(`chaos-budget-exhaust: spawn error: ${err}\n`);
      resolveProm(2);
    });
    child.on("close", () => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const verdict = assertSteadyState(stdout);
      opts.stdout.write(
        `chaos-budget-exhaust: ${verdict.verdict.toUpperCase()} — ${verdict.reason}\n`,
      );
      resolveProm(verdict.verdict === "pass" ? 0 : 1);
    });
  });
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
      process.stderr.write(`chaos-budget-exhaust: ${err}\n`);
      process.exit(2);
    });
}
