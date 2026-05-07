#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved minsky CLI ergonomics (operator 2026-05-06) -->

/**
 * `minsky` CLI — operator-facing wrapper around `bin/tick-loop.mjs`.
 *
 * Subcommands:
 *   minsky start [tick-loop-args…]   spawn the daemon detached + tail the log with pretty output
 *   minsky logs  [--worker=<id>] [--follow]  tail an existing worker log with pretty output
 *
 * Default behaviour of `start`: forks the daemon with `detached: true` so it
 * survives shell exit, redirects its stdout/stderr to
 * `.minsky/workers/<worker-id>.log`, then opens that file with `tail -F` and
 * pipes each line through `formatLogLine` (pretty output).
 *
 * Detach: Ctrl+C (SIGINT) on the foreground `start` exits the tail only;
 * the daemon child keeps running because `detached: true` + `child.unref()`
 * decouples its lifetime from this process.
 *
 * Reattach: `minsky logs` opens the same file with `tail -F` and pretty-prints.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { formatLogLine } from "../dist/pretty-log.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const TICK_LOOP_BIN = resolve(PKG_ROOT, "bin", "tick-loop.mjs");

const MINSKY_HOME = process.env["MINSKY_HOME"] ?? resolve(PKG_ROOT, "..", "..");
const WORKERS_LOG_DIR = resolve(MINSKY_HOME, ".minsky", "workers");

const subcommand = process.argv[2];
const subargs = process.argv.slice(3);

if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
  printHelp();
  process.exit(0);
} else if (subcommand === "start") {
  await runStart(subargs);
} else if (subcommand === "logs") {
  await runLogs(subargs);
} else {
  console.error(`minsky: unknown subcommand: ${subcommand}\n`);
  printHelp();
  process.exit(2);
}

function printHelp() {
  process.stdout.write("minsky — operator CLI for the tick-loop daemon\n");
  process.stdout.write(helpBody());
}

function helpBody() {
  return `

Usage:
  minsky start [tick-loop-args…]   start the daemon detached + tail the log (Ctrl+C detaches)
  minsky logs  [--worker=<id>] [--follow]   reattach to a running worker's log

Examples:
  minsky start                                        # default: claim-aware worker 0/1
  minsky start --workers-total=3                      # I'm worker 0 of 3, siblings join later
  minsky start --spawn-additional-workers=2           # fork 2 children, become 0 of 3
  minsky logs                                         # tail worker 0's log
  minsky logs --worker=1 --follow                     # tail worker 1's log forever

Logs land in: ${WORKERS_LOG_DIR}/<worker-id>.log
Detach: Ctrl+C on \`start\` exits the tail; the daemon keeps running.
Reattach: \`minsky logs\` opens the same file.
`;
}

/**
 * @param {readonly string[]} args
 */
async function runStart(args) {
  // Determine which worker-id this start would launch — needed for the log
  // file path. Defaults to 0 (matches parseWorkerArgs's new default).
  const workerId = workerIdFromArgs(args) ?? 0;
  mkdirSync(WORKERS_LOG_DIR, { recursive: true });
  const logPath = resolve(WORKERS_LOG_DIR, `${workerId}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn(process.execPath, [TICK_LOOP_BIN, ...args], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.unref();
  console.error(`minsky: started worker ${workerId} as PID ${child.pid} (log: ${logPath})`);
  console.error("minsky: tailing log — Ctrl+C detaches (daemon keeps running)\n");
  await tailWithPretty(logPath, true);
}

/**
 * @param {readonly string[]} args
 */
async function runLogs(args) {
  const workerId = workerIdFromArgs(args) ?? 0;
  const follow = args.includes("--follow") || args.includes("-f") || true;
  // Default to follow mode (the operator wants to see live output);
  // explicit --no-follow shorts to a one-shot read.
  const logPath = resolve(WORKERS_LOG_DIR, `${workerId}.log`);
  if (!existsSync(logPath)) {
    console.error(`minsky: no log at ${logPath} — start the worker first with \`minsky start\``);
    process.exit(1);
  }
  console.error(`minsky: tailing ${logPath}\n`);
  await tailWithPretty(logPath, follow);
}

/**
 * @param {readonly string[]} args
 * @returns {number | undefined}
 */
function workerIdFromArgs(args) {
  for (const a of args) {
    const m = a.match(/^--worker(?:-id)?=(\d+)$/);
    if (m && m[1] !== undefined) return Number(m[1]);
  }
  return undefined;
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
