#!/usr/bin/env node
// @ts-check
// usage-events — content-free field recording for the README Proof section.
//
// Each real `minsky <command>` run appends one JSON line to
// `<state dir>/usage.jsonl` (state dir: $MINSKY_STATE_DIR, default
// ~/.minsky). A line holds only allowlisted fields: the time, the command
// name (from a fixed list; anything else is "other"), ok or error, the exit
// code, and the duration. Never arguments, paths, host names, user names, or
// task text.
//
// Lifecycle: the file belongs to one machine's state dir and grows by one
// line per run; delete it to reset. `MINSKY_USAGE=off` stops recording.
//
// Usage: node scripts/usage-events.mjs record --command <name> --exit <n> --duration-ms <n>
//
// Pattern: append-only event log (Kleppmann, *Designing Data-Intensive
// Applications*, 2017, ch. 11); Homebrew analytics (docs.brew.sh/Analytics)
// for content-free usage counts.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The only command names a usage line may hold. */
export const COMMANDS = new Set(
  "agent audit bash-doctor benchmark changelog config consent daemon disable-autostart disable-tick-loop doctor enable-autostart enable-tick-loop init install-daemon iter-once knowledge list logs m1 metrics milestone qa recommend report reset reset-host-if-crashed run setup show solve status stop submit submit-finding tail-failures telemetry transform trend ui uninstall uninstall-daemon update watch".split(
    " ",
  ),
);

/** The only fields a usage line may hold. */
export const FIELDS = ["ts", "event", "command", "status", "exit_code", "duration_ms"];

/** @param {NodeJS.ProcessEnv} [env] */
export function stateDir(env = process.env) {
  return env["MINSKY_STATE_DIR"] || join(homedir(), ".minsky");
}

/** @param {NodeJS.ProcessEnv} [env] */
export function usageFile(env = process.env) {
  return join(stateDir(env), "usage.jsonl");
}

/**
 * Build one allowlisted usage line. Unknown commands become "other";
 * a bare `minsky` run is "run".
 * @param {{ command?: string | undefined, exitCode: number, durationMs: number, now?: Date }} input
 */
export function buildEvent({ command, exitCode, durationMs, now = new Date() }) {
  const name = !command ? "run" : COMMANDS.has(command) ? command : "other";
  const code = Number.isInteger(exitCode) ? exitCode : 1;
  return {
    ts: now.toISOString(),
    event: "command",
    command: name,
    status: code === 0 ? "ok" : "error",
    exit_code: code,
    duration_ms: Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0)),
  };
}

/**
 * Append one usage line. Returns false when recording is off.
 * @param {ReturnType<typeof buildEvent>} event
 * @param {NodeJS.ProcessEnv} [env]
 */
export function record(event, env = process.env) {
  if (env["MINSKY_USAGE"] === "off") return false;
  mkdirSync(stateDir(env), { recursive: true });
  appendFileSync(usageFile(env), `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return true;
}

/**
 * Read every parseable usage line, keeping allowlisted fields only.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown>[]}
 */
export function readEvents(env = process.env) {
  const file = usageFile(env);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map(parseLine)
    .filter((e) => e !== undefined);
}

/**
 * One line's allowlisted fields, or undefined for an empty or torn line
 * (a killed run can leave a torn last line).
 * @param {string} line
 * @returns {Record<string, unknown> | undefined}
 */
function parseLine(line) {
  if (!line) return undefined;
  try {
    const raw = JSON.parse(line);
    return Object.fromEntries(FIELDS.filter((f) => f in raw).map((f) => [f, raw[f]]));
  } catch {
    return undefined;
  }
}

/** @param {string[]} argv @param {string} flag */
function arg(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "record") {
    console.error("usage: usage-events.mjs record --command <name> --exit <n> --duration-ms <n>");
    process.exit(2);
  }
  try {
    record(
      buildEvent({
        command: arg(argv, "--command"),
        exitCode: Number(arg(argv, "--exit")),
        durationMs: Number(arg(argv, "--duration-ms")),
      }),
    );
  } catch {
    // Recording must never break the command it measures.
  }
}
