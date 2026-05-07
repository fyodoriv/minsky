#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved minsky CLI ergonomics (operator 2026-05-06) -->

/**
 * `minsky` CLI — operator-facing wrapper around `bin/tick-loop.mjs`.
 *
 * Sane defaults + attach detection:
 *
 *   minsky                    start-or-attach worker 0 (default)
 *   minsky 1                  start-or-attach worker 1
 *   minsky logs               tail worker 0's log (never spawns)
 *   minsky logs 1             tail worker 1's log
 *   minsky stop               stop worker 0 (SIGTERM the daemon, leave the log)
 *   minsky stop 1             stop worker 1
 *
 * Behaviour of `minsky [<id>]` (no subcommand or just an ID):
 *   1. If `.minsky/workers/<id>.pid` exists AND the PID is live → ATTACH:
 *      open the log file with `tail -F` (pretty output), don't spawn anything.
 *   2. Otherwise → SPAWN: fork bin/tick-loop.mjs with sane defaults
 *      (--worker-id=<id>, --workers-total=max(id+1, 1), tick interval 5min,
 *      private paused-sentinel so the legacy launchd PAUSED doesn't pause us),
 *      write the PID to `.minsky/workers/<id>.pid`, then attach.
 *
 * Detach: Ctrl+C exits the tail only; the daemon keeps running.
 * Reattach: re-run `minsky` (or `minsky logs`) — it sees the live PID
 * and attaches without respawning.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { formatLogLine } from "../dist/pretty-log.js";

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
  const tickLoopArgs = withSaneDefaults(workerId, extraArgs);
  const fd = openSync(logPath, "a");
  const child = spawn(process.execPath, [TICK_LOOP_BIN, ...tickLoopArgs], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.unref();
  writeFileSync(pidPath, String(child.pid ?? ""), "utf8");
  process.stderr.write(`minsky: started worker ${workerId} (PID ${child.pid}, log: ${logPath})\n`);
  process.stderr.write("minsky: Ctrl+C detaches (daemon keeps running)\n\n");
  await tailWithPretty(logPath, true);
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
