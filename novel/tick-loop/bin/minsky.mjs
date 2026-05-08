#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved minsky CLI ergonomics (operator 2026-05-06) -->
// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 3 (operator 2026-05-08) -->
// <!-- scope: human-approved minsky-cli-arch-detection slice 6 (operator 2026-05-08 — "rosetta/intel must be resolved as well") -->

/**
 * `minsky` CLI — operator-facing wrapper around `bin/tick-loop.mjs`.
 *
 * Sane defaults + attach detection + local-LLM auto-bootstrap (P0 from
 * operator 2026-05-08, "git pull && minsky" UX):
 *
 *   minsky                    start-or-attach worker 0; auto-bootstrap if Claude is exhausted
 *   minsky 1                  start-or-attach worker 1
 *   minsky logs               tail worker 0's log (never spawns)
 *   minsky logs 1             tail worker 1's log
 *   minsky stop               stop worker 0 (SIGTERM the daemon, leave the log)
 *   minsky stop 1             stop worker 1
 *   minsky doctor             read-only state check (claude / local-LLM stack); prints + exits
 *   minsky bootstrap-local-llm  explicitly run the local-LLM install plan (force the prompt)
 *
 * Behaviour of `minsky [<id>]` (no subcommand or just an ID):
 *   1. If `.minsky/workers/<id>.pid` exists AND the PID is live → ATTACH:
 *      open the log file with `tail -F` (pretty output), don't spawn anything.
 *   2. Otherwise (cold start) → run the local-LLM auto-bootstrap pre-flight:
 *      - probe `mlx_lm.server` reachability (~2s)
 *      - if reachable → set `MINSKY_LOCAL_LLM=1` for the spawn and skip
 *      - if unreachable AND Claude is also unhealthy → run
 *        `detectLocalLlmStack` + `planLocalLlmBootstrap`; if the plan
 *        is non-empty, prompt the operator with one `[Y/n]` confirm,
 *        then install + start the local server
 *      - then SPAWN: fork bin/tick-loop.mjs with sane defaults
 *
 * Operator escape hatches:
 *   - `MINSKY_NO_AUTO_BOOTSTRAP=1` skips the pre-flight entirely
 *   - `MINSKY_NON_INTERACTIVE=1` (or non-TTY stdin/stdout) auto-confirms
 *
 * Detach: Ctrl+C exits the tail only; the daemon keeps running.
 * Reattach: re-run `minsky` (or `minsky logs`) — it sees the live PID
 * and attaches without respawning.
 */

import { exec, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildProductionProbes,
  classifyClaudeProbeOutput,
  confirmAlwaysYes,
  describeArchState,
  detectArchState,
  detectLocalLlmStack,
  executeBootstrapPlan,
  needsLocalLlmBootstrap,
  planLocalLlmBootstrap,
  probePythonWithDefaults,
  renderConfirmSummary,
} from "../dist/index.js";
import { formatLogLine } from "../dist/pretty-log.js";

const execAsync = promisify(exec);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const TICK_LOOP_BIN = resolve(PKG_ROOT, "bin", "tick-loop.mjs");

const MINSKY_HOME = process.env["MINSKY_HOME"] ?? resolve(PKG_ROOT, "..", "..");
const WORKERS_DIR = resolve(MINSKY_HOME, ".minsky", "workers");

const argv = process.argv.slice(2);
const first = argv[0];

if (first === "--help" || first === "-h" || first === "help") {
  printHelp();
  process.exit(0);
} else if (first === "logs") {
  await runLogs(argv.slice(1));
} else if (first === "stop") {
  runStop(argv.slice(1));
} else if (first === "doctor") {
  await runDoctor();
} else if (first === "bootstrap-local-llm") {
  await runBootstrapLocalLlm({ force: true });
} else if (first === "start") {
  // Back-compat: keep `start` as an alias of the no-subcommand form. Any
  // further args are forwarded to bin/tick-loop.mjs at spawn time.
  await runStartOrAttach(argv.slice(1));
} else {
  await runStartOrAttach(argv);
}

function printHelp() {
  process.stdout.write("minsky — operator CLI for the tick-loop daemon\n");
  process.stdout.write(`
Usage:
  minsky [<worker-id>]      start-or-attach worker <id> (default 0); Ctrl+C detaches
  minsky logs [<worker-id>] reattach to worker <id>'s log (never spawns)
  minsky stop [<worker-id>] stop worker <id> (SIGTERM the daemon)

Examples:
  minsky                      # start-or-attach worker 0
  minsky 1                    # start-or-attach worker 1 (in another terminal)
  minsky logs                 # follow worker 0's log live
  minsky stop 1               # stop worker 1

Sane defaults (override by passing the corresponding tick-loop flag):
  --worker-id        <positional, default 0>
  --workers-total    max(workerId+1, 1)
  --tick-interval-ms 300000 (5 min)
  --paused-sentinel  /tmp/minsky-worker-<id>-never-paused (never pauses)

Logs:    ${WORKERS_DIR}/<worker-id>.log
PID:     ${WORKERS_DIR}/<worker-id>.pid
Detach:  Ctrl+C on \`minsky\` exits the tail; the daemon keeps running.
Reattach: re-run \`minsky\` (or \`minsky logs\`) — it sees the live PID and attaches.
`);
}

/**
 * @param {readonly string[]} args
 */
async function runStartOrAttach(args) {
  const { workerId, extraArgs } = parsePositionalAndForward(args);
  mkdirSync(WORKERS_DIR, { recursive: true });
  const logPath = resolve(WORKERS_DIR, `${workerId}.log`);
  const pidPath = resolve(WORKERS_DIR, `${workerId}.pid`);
  const livePid = readLivePid(pidPath);
  if (livePid !== undefined) {
    process.stderr.write(
      `minsky: worker ${workerId} already running (PID ${livePid}) — attaching to ${logPath}\n`,
    );
    process.stderr.write("minsky: Ctrl+C detaches (daemon keeps running)\n\n");
    await tailWithPretty(logPath, true);
    return;
  }
  // Cold start — run the local-LLM auto-bootstrap pre-flight. Idempotent:
  // a fully-set-up machine adds <500ms and sets MINSKY_LOCAL_LLM=1 if the
  // server is reachable; an unset machine prompts the operator with one
  // confirm and runs the install plan.
  const bootstrapEnv = await maybeBootstrapLocalLlm();
  const tickLoopArgs = withSaneDefaults(workerId, extraArgs);
  const fd = openSync(logPath, "a");
  const child = spawn(process.execPath, [TICK_LOOP_BIN, ...tickLoopArgs], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, ...bootstrapEnv },
  });
  child.unref();
  writeFileSync(pidPath, String(child.pid ?? ""), "utf8");
  process.stderr.write(`minsky: started worker ${workerId} (PID ${child.pid}, log: ${logPath})\n`);
  process.stderr.write("minsky: Ctrl+C detaches (daemon keeps running)\n\n");
  await tailWithPretty(logPath, true);
}

// ---- Local-LLM auto-bootstrap pre-flight ---------------------------------

/**
 * Probe the local-LLM stack and run the install plan if needed. Idempotent
 * fast path: an already-running mlx-lm.server is detected with one fetch
 * call and we just return `MINSKY_LOCAL_LLM=1` so the spawned daemon picks
 * up the local fallback path.
 *
 * Operator escape hatches: `MINSKY_NO_AUTO_BOOTSTRAP=1` skips the pre-flight
 * entirely; `MINSKY_NON_INTERACTIVE=1` (or non-TTY stdin) auto-confirms.
 *
 * Returns an env-overlay object the spawn merges with `process.env`. Empty
 * object means "no overlay needed" (caller passes the daemon's existing env).
 *
 * @returns {Promise<Record<string, string>>}
 */
async function maybeBootstrapLocalLlm() {
  if (process.env["MINSKY_NO_AUTO_BOOTSTRAP"] === "1") {
    return {};
  }
  // Already opted in via env? Don't re-run the bootstrap.
  if (process.env["MINSKY_LOCAL_LLM"] === "1") {
    return {};
  }
  const probes = buildProductionProbes({ whichFn });
  const state = await detectLocalLlmStack(probes);
  // Fast path: server is reachable → set MINSKY_LOCAL_LLM=1 for the spawn,
  // skip the install pipeline entirely.
  if (state.server.reachable) {
    process.stderr.write(
      `minsky: local-LLM server reachable at ${state.server.url} — wiring fallback\n`,
    );
    return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
  }
  // Server unreachable. Run a REAL synthetic claude probe (slice 4 —
  // operator pushback 2026-05-08: "So that all will work even if no
  // message can be sent to claude right?"). The previous slice's
  // `which claude` check returned `true` whenever the binary existed,
  // falsely deferring to claude when credits were exhausted. This probe
  // spawns `claude --print "ping"` with a 10 s timeout and classifies
  // the stderr against `HARD_LIMIT_PATTERNS` (shared contract with
  // `llm-provider-selector`).
  const decision = await probeClaude();
  process.stderr.write(`minsky: claude probe → ${decision.verdict} (${decision.reason})\n`);
  if (!needsLocalLlmBootstrap(decision)) {
    // Claude is healthy OR transient error. Don't trigger a 17 GB
    // download on a network blip — the daemon's per-iteration
    // `decideProvider` will catch any hard-limit signal on the next
    // claude spawn and switch to local then (graceful-degrade).
    return {};
  }
  process.stderr.write(
    `minsky: claude unavailable (${decision.verdict}) AND local-LLM server not reachable\n`,
  );
  return await runBootstrapLocalLlm({ force: false });
}

/**
 * Idempotent bootstrap entry point. Runs detect + plan + execute. When
 * `force === true` (operator ran `minsky bootstrap-local-llm` explicitly),
 * the prompt always shows even if the plan is empty; otherwise we skip the
 * prompt for empty plans.
 *
 * @param {{ force: boolean }} opts
 * @returns {Promise<Record<string, string>>}
 */
async function runBootstrapLocalLlm({ force }) {
  const probes = buildProductionProbes({ whichFn });
  const state = await detectLocalLlmStack(probes);
  // slice 5: pick a python interpreter that actually exists on this host
  // (replaces the hardcoded `/opt/homebrew/bin/python3.12` that worked
  // only on the operator's Apple-Silicon-brew laptop).
  const pythonPath = probePythonWithDefaults();
  // slice 6: detect x86_64-on-Apple-Silicon + missing /opt/homebrew/
  // so the planner can prepend install-arm-homebrew and use absolute
  // /opt/homebrew/bin/* paths for subsequent steps.
  const archState = await detectArchState(buildArchProbes());
  /** @type {import("../dist/local-llm-bootstrap.js").BootstrapPlanOptions} */
  const planOpts = {};
  if (pythonPath !== undefined) planOpts.pythonPath = pythonPath;
  planOpts.archState = archState;
  const plan = planLocalLlmBootstrap(state, planOpts);
  if (plan.ready && !force) {
    process.stderr.write("minsky: local-LLM stack already ready — skipping bootstrap\n");
    return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
  }
  const isInteractive =
    process.stdin.isTTY === true && process.env["MINSKY_NON_INTERACTIVE"] !== "1";
  const confirmFn = isInteractive ? confirmInteractive : confirmAlwaysYes;
  const result = await executeBootstrapPlan(plan, {
    confirm: confirmFn,
    spawnFn: spawnAdapter,
    log: (s) => process.stderr.write(s),
  });
  if (!result.success) {
    process.stderr.write(
      `minsky: local-LLM bootstrap failed (${result.failedStep ?? "unknown"}: ${result.reason ?? "no reason"})\n`,
    );
    process.stderr.write(
      "minsky: continuing without local-LLM fallback; daemon will use claude only\n",
    );
    return {};
  }
  return { MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" };
}

/**
 * Read-only doctor — prints the current state of the local-LLM stack +
 * Claude health and exits.
 */
async function runDoctor() {
  process.stdout.write("minsky doctor — local-LLM stack health probe\n\n");
  const probes = buildProductionProbes({ whichFn });
  const state = await detectLocalLlmStack(probes);
  const claudeDecision = await probeClaude();
  /** @param {string} label @param {boolean} ok @param {string} [detail] */
  const line = (label, ok, detail) => {
    const mark = ok ? "✓" : "✗";
    const detailStr = detail !== undefined && detail.length > 0 ? `  ${detail}` : "";
    process.stdout.write(`  ${mark} ${label}${detailStr}\n`);
  };
  line("claude CLI", claudeDecision.verdict === "healthy", claudeDecision.reason);
  line("pipx", state.pipx.present, state.pipx.path ?? state.pipx.reason ?? "");
  line("mlx_lm.server", state.mlxLm.present, state.mlxLm.path ?? state.mlxLm.reason ?? "");
  line("aider", state.aider.present, state.aider.path ?? state.aider.reason ?? "");
  line("model weights", state.model.present, state.model.detail ?? state.model.reason ?? "");
  line(
    "mlx-lm.server reachable",
    state.server.reachable,
    state.server.reachable ? state.server.url : (state.server.reason ?? ""),
  );
  // slice 5: probe python too, so the operator can see what interpreter
  // the aider install step is going to pin to.
  const pythonPath = probePythonWithDefaults();
  line(
    "python 3.12/3.13 for aider",
    pythonPath !== undefined,
    pythonPath ?? "no 3.12/3.13 found — will use pipx default (may fail on 3.14+)",
  );
  // slice 6: show the arch row so Rosetta-on-Apple-Silicon and missing
  // /opt/homebrew/ are visible before the operator runs bootstrap.
  const archState = await detectArchState(buildArchProbes());
  // The row is GREEN when the planner won't need to install arm-homebrew
  // AND the shell isn't mismatched. Rosetta-with-brew is mismatched but
  // still GREEN because absolute paths sidestep the mismatch.
  line("arch", !archState.needsNativeBrew, describeArchState(archState));
  process.stdout.write("\n");
  /** @type {import("../dist/local-llm-bootstrap.js").BootstrapPlanOptions} */
  const planOpts = {};
  if (pythonPath !== undefined) planOpts.pythonPath = pythonPath;
  planOpts.archState = archState;
  const plan = planLocalLlmBootstrap(state, planOpts);
  if (plan.ready) {
    process.stdout.write("Local-LLM stack: GREEN — ready\n");
  } else {
    process.stdout.write("Local-LLM stack: YELLOW — install plan available\n");
    process.stdout.write(`${renderConfirmSummary(plan)}\n`);
    process.stdout.write("\nRun `minsky bootstrap-local-llm` to install.\n");
  }
}

/**
 * Build the production {@link import("../dist/arch-probe.js").ArchProbes}
 * seam. Slice 6 of `minsky-cli-arch-detection`. Wraps:
 *   - `probeShellArch`: maps Node's `process.arch` to the closed set.
 *   - `probeHardwareArch`: shells out to `sysctl -n hw.optional.arm64`.
 *   - `probeNativeBrewPath` / `probeIntelBrewPath`: `existsSync`.
 */
function buildArchProbes() {
  return {
    probeShellArch: () => {
      // Node's `process.arch` is "arm64" on native Apple Silicon, "x64"
      // on both Intel and Rosetta-emulated (x86_64). Map to our closed
      // three-way set.
      switch (process.arch) {
        case "arm64":
          return "arm64";
        case "x64":
        case "ia32":
          return "x86_64";
        default:
          return "other";
      }
    },
    probeHardwareArch: async () => {
      // `sysctl -n hw.optional.arm64` returns "1" on Apple Silicon
      // (even under Rosetta — the hardware is reported truthfully),
      // "0" on Intel Macs, and the command itself is absent on non-
      // Darwin hosts (Linux / Windows). A probe failure due to
      // "sysctl: command not found" falls through to "other".
      try {
        const { stdout } = await execAsync("sysctl -n hw.optional.arm64 2>/dev/null", {
          timeout: 500,
        });
        const trimmed = stdout.trim();
        if (trimmed === "1") return "arm64";
        if (trimmed === "0") return "x86_64";
        return "other";
        // rule-6: handled-locally — sysctl absent is a Linux signal,
        // not a bug; typing as "other" is the planner's signal to skip
        // arm-homebrew injection.
      } catch {
        return "other";
      }
    },
    probeNativeBrewPath: () =>
      existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : undefined,
    probeIntelBrewPath: () =>
      existsSync("/usr/local/bin/brew") ? "/usr/local/bin/brew" : undefined,
  };
}

/** `which <bin>` adapter — uses `command -v` (POSIX) for portability. */
async function whichFn(bin) {
  try {
    const { stdout } = await execAsync(`command -v ${shellQuote(bin)}`, {
      timeout: 1000,
    });
    const path = stdout.trim();
    return path.length > 0 ? path : undefined;
    // rule-6: handled-locally — `command -v` exits 1 when the binary is
    // missing; promisify treats that as a thrown Error. We type that as
    // "not on PATH" rather than crash the whole CLI.
  } catch {
    return undefined;
  }
}

/** Quote a shell argument minimally (no globbing in our usage). */
function shellQuote(s) {
  return /^[\w.\/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn adapter for the bootstrap executor — wraps `child_process.spawn`
 * to return a `{ exitCode, stderrTail }` Promise. Streams stdout/stderr
 * through to the operator's terminal so long installs (model download)
 * show progress live.
 *
 * Slice 6: honors `opts.stdinMode` so the install-arm-homebrew step
 * inherits the parent's stdin (lets sudo prompt for a password on the
 * operator's terminal). Default "ignore" matches slice-1 behavior.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; stdinMode?: "ignore" | "inherit" }} [opts]
 * @returns {Promise<import("../dist/local-llm-bootstrap-executor.js").ExecuteSpawnResult>}
 */
function spawnAdapter(command, args, opts = {}) {
  const stdinMode = opts.stdinMode ?? "ignore";
  return new Promise((resolveDone, rejectFail) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: [stdinMode, "inherit", "pipe"],
    });
    let stderrTail = "";
    child.stderr?.on("data", (chunk) => {
      const s = chunk.toString("utf8");
      process.stderr.write(s);
      stderrTail = (stderrTail + s).slice(-2048);
    });
    child.on("error", rejectFail);
    child.on("close", (code) => {
      resolveDone({ exitCode: code ?? -1, stderrTail });
    });
  });
}

/**
 * Read one [Y/n] answer from stdin. Used by the confirm prompt.
 *
 * @param {string} summary
 * @returns {Promise<boolean>}
 */
async function confirmInteractive(summary) {
  process.stderr.write(summary);
  process.stderr.write(" [Y/n] ");
  return new Promise((resolveAns) => {
    let buf = "";
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        const ans = buf.trim().toLowerCase();
        // Default Y on empty input (operator hit Enter).
        resolveAns(ans === "" || ans === "y" || ans === "yes");
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/**
 * Real Claude health probe — slice 4 of `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Spawns `claude --print "ping"` with a 10 s timeout, captures the
 * exit code + stderr, and classifies via {@link classifyClaudeProbeOutput}.
 * The classifier returns one of four verdicts: `healthy` / `exhausted`
 * / `binary-missing` / `error` (transient).
 *
 * Cost: ≤2 input + ≤1 output tokens of Claude budget on the healthy
 * path; zero on the exhausted path (Anthropic rejects before billing).
 *
 * @returns {Promise<import("../dist/claude-health-probe.js").ClaudeHealthDecision>}
 */
async function probeClaude() {
  // Short-circuit: binary missing → no point spawning.
  const path = await whichFn("claude");
  if (path === undefined) {
    return classifyClaudeProbeOutput({
      exitCode: -1,
      stderrTail: "",
      binaryAbsent: true,
    });
  }
  // Synthetic 1-token probe. `claude --print "ping"` returns "pong" or
  // similar in <5s on the healthy path; on exhausted, exits non-zero
  // with a hard-limit message in stderr within ~1s.
  return new Promise((resolveDone) => {
    let stderrBuf = "";
    let stdoutBuf = "";
    let resolved = false;
    const child = spawn("claude", ["--print", "ping"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    // 20s timeout — exhausted claude returns sub-second (429); healthy
    // claude --print can take 5-15s for first-token latency on a cold
    // session. Above 20s we classify as `error` (transient) and defer
    // to claude — don't trigger 17 GB download on a slow network.
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGKILL");
        resolveDone(
          classifyClaudeProbeOutput({
            exitCode: -1,
            stderrTail: `<probe timed out after 20000ms>${stderrBuf.slice(-3000)}`,
          }),
        );
      }
    }, 20_000);
    child.stdout?.on("data", (chunk) => {
      stdoutBuf = (stdoutBuf + chunk.toString("utf8")).slice(-2048);
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-4096);
    });
    // rule-6: handled-locally — child.on("error") fires for ENOENT/EACCES; classifier turns it into a verdict.
    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveDone(
        classifyClaudeProbeOutput({
          exitCode: -1,
          stderrTail: err instanceof Error ? err.message : String(err),
        }),
      );
    });
    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveDone(
        classifyClaudeProbeOutput({
          exitCode: code ?? -1,
          stderrTail: stderrBuf,
          stdoutTail: stdoutBuf,
        }),
      );
    });
  });
}

/**
 * @param {readonly string[]} args
 */
async function runLogs(args) {
  const { workerId } = parsePositionalAndForward(args);
  const logPath = resolve(WORKERS_DIR, `${workerId}.log`);
  if (!existsSync(logPath)) {
    process.stderr.write(
      `minsky: no log at ${logPath} — start the worker first with \`minsky ${workerId}\`\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`minsky: tailing ${logPath} (Ctrl+C exits)\n\n`);
  await tailWithPretty(logPath, true);
}

/**
 * @param {readonly string[]} args
 */
function runStop(args) {
  const { workerId } = parsePositionalAndForward(args);
  const pidPath = resolve(WORKERS_DIR, `${workerId}.pid`);
  const livePid = readLivePid(pidPath);
  if (livePid === undefined) {
    process.stderr.write(`minsky: worker ${workerId} is not running (no live PID at ${pidPath})\n`);
    process.exit(1);
  }
  try {
    process.kill(livePid, "SIGTERM");
    process.stderr.write(`minsky: sent SIGTERM to worker ${workerId} (PID ${livePid})\n`);
    rmSync(pidPath, { force: true });
    // rule-6: handled-locally — process.kill ESRCH is benign (already dead); we still clear the PID file
  } catch (err) {
    if (isErrno(err, "ESRCH")) {
      rmSync(pidPath, { force: true });
      process.stderr.write(
        `minsky: worker ${workerId} was already dead — cleared stale PID file\n`,
      );
      return;
    }
    throw err;
  }
}

/**
 * @param {readonly string[]} args
 * @returns {{ workerId: number, extraArgs: readonly string[] }}
 */
function parsePositionalAndForward(args) {
  // If the first arg parses as a non-negative integer, it's the worker-id;
  // everything else passes through to bin/tick-loop.mjs.
  if (args.length > 0 && /^\d+$/.test(args[0] ?? "")) {
    return { workerId: Number(args[0]), extraArgs: args.slice(1) };
  }
  // Operator may have passed `--worker-id=<N>` instead of positional;
  // honor it but still forward.
  for (const a of args) {
    const m = a.match(/^--worker(?:-id)?=(\d+)$/);
    if (m && m[1] !== undefined) return { workerId: Number(m[1]), extraArgs: args };
  }
  return { workerId: 0, extraArgs: args };
}

/**
 * Build the tick-loop args with sane defaults filled in only when the
 * operator hasn't passed them.
 * @param {number} workerId
 * @param {readonly string[]} extraArgs
 * @returns {readonly string[]}
 */
function withSaneDefaults(workerId, extraArgs) {
  const seen = new Set(extraArgs.map((a) => a.split("=", 1)[0]));
  /** @type {string[]} */
  const out = [];
  // Filter out positional digits (they were the workerId) and any
  // existing --worker-id=… so we set our own.
  for (const a of extraArgs) {
    if (/^\d+$/.test(a)) continue;
    if (a.startsWith("--worker-id=")) continue;
    out.push(a);
  }
  out.push(`--worker-id=${workerId}`);
  if (!seen.has("--workers-total")) {
    out.push(`--workers-total=${Math.max(workerId + 1, 1)}`);
  }
  if (!seen.has("--tick-interval-ms")) {
    out.push("--tick-interval-ms=300000");
  }
  if (!seen.has("--paused-sentinel")) {
    out.push(`--paused-sentinel=/tmp/minsky-worker-${workerId}-never-paused`);
  }
  return out;
}

/**
 * Read the PID file and return the PID iff that process is alive.
 * Returns undefined when the file is missing OR the recorded PID is dead.
 * @param {string} pidPath
 * @returns {number | undefined}
 */
function readLivePid(pidPath) {
  if (!existsSync(pidPath)) return undefined;
  try {
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    // `process.kill(pid, 0)` checks existence without signaling.
    process.kill(pid, 0);
    return pid;
    // rule-6: handled-locally — ESRCH = stale PID, ENOENT = race; both treated as "dead"
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} err
 * @param {string} code
 * @returns {boolean}
 */
function isErrno(err, code) {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    /** @type {{ code: unknown }} */ (err).code === code
  );
}

/**
 * Spawn `tail -F <path>` (or `tail -n+1` for non-follow) and pipe each
 * stdout line through `formatLogLine` to process.stdout.
 *
 * @param {string} path
 * @param {boolean} follow
 */
async function tailWithPretty(path, follow) {
  const tailArgs = follow ? ["-n", "100", "-F", path] : ["-n", "+1", path];
  const tail = spawn("tail", tailArgs, { stdio: ["ignore", "pipe", "inherit"] });
  let buffer = "";
  const colorTty = process.stdout.isTTY === true;
  tail.stdout?.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`${formatLogLine(line, { color: colorTty })}\n`);
    }
  });
  process.on("SIGINT", () => {
    if (buffer.length > 0) process.stdout.write(`${formatLogLine(buffer, { color: colorTty })}\n`);
    tail.kill();
    process.exit(0);
  });
  await new Promise((resolveDone) => {
    tail.on("close", () => resolveDone(undefined));
  });
}
