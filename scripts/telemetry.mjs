#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved owner decision 2026-10-26: opt-in field telemetry to PostHog EU for the README Proof section (replaces TASKS.md field-telemetry-posthog) -->
// telemetry — the one adapter that sends field usage counts to PostHog EU.
//
// Opt-in only: it sends nothing unless the owner stored a project key
// (env MINSKY_POSTHOG_KEY, or the macOS Keychain item service "minsky",
// account "posthog_key"), telemetry is on, and DO_NOT_TRACK is unset. Only
// the allowlisted fields of `usage-events.mjs` leave the machine, under a
// random install id, with person profiles and GeoIP off. It sends at most
// once a day, in one batch. A move to self-hosting changes only this file.
//
// Lifecycle: the install id, the cursor (lines already sent), and the on/off
// flag live in `<state dir>/telemetry.json`; delete it to reset.
//
// Usage: node scripts/telemetry.mjs status|on|off|send [--dry-run] [--daily]
//
// Same contract as careerbrew `src/careerbrew/telemetry.py` and agentbrew
// `src/core/telemetry.ts`. Pattern: adapter (Gamma et al., *Design
// Patterns*, 1994); Homebrew analytics (docs.brew.sh/Analytics).

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvents, stateDir } from "./usage-events.mjs";

export const DEFAULT_URL = "https://eu.i.posthog.com/batch/";
const DAY_MS = 24 * 60 * 60 * 1000;
export const NOTICE =
  "minsky: anonymous usage counts (command, ok/error, duration) go to PostHog EU only after you store a key. Turn off: `minsky telemetry off` or DO_NOT_TRACK=1.";

/**
 * @typedef {{ installId: string, sent: number, enabled: boolean, lastSend?: string, noticeShown?: boolean }} State
 */

/** @param {NodeJS.ProcessEnv} [env] */
export function statePath(env = process.env) {
  return join(stateDir(env), "telemetry.json");
}

/** @param {NodeJS.ProcessEnv} [env] @returns {State} */
export function loadState(env = process.env) {
  try {
    return { enabled: true, sent: 0, ...JSON.parse(readFileSync(statePath(env), "utf8")) };
  } catch {
    return { installId: randomUUID().replace(/-/g, ""), sent: 0, enabled: true };
  }
}

/** @param {State} state @param {NodeJS.ProcessEnv} [env] */
function saveState(state, env = process.env) {
  mkdirSync(stateDir(env), { recursive: true });
  writeFileSync(statePath(env), `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

/**
 * The project key; "" when none is set. Tests set MINSKY_POSTHOG_KEY="" to
 * skip the Keychain. The value is never printed or logged.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function projectKey(env = process.env) {
  if (env["MINSKY_POSTHOG_KEY"] !== undefined) return env["MINSKY_POSTHOG_KEY"];
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", "minsky", "-a", "posthog_key", "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "";
  }
}

/** @param {NodeJS.ProcessEnv} [env] */
export function status(env = process.env) {
  const state = loadState(env);
  const pending = Math.max(0, readEvents(env).length - state.sent);
  if (env["DO_NOT_TRACK"] && env["DO_NOT_TRACK"] !== "0")
    return { on: false, reason: "DO_NOT_TRACK", pending };
  if (!state.enabled) return { on: false, reason: "turned off", pending };
  if (!projectKey(env)) return { on: false, reason: "no key", pending };
  return { on: true, reason: "on", pending };
}

/** @param {boolean} enabled @param {NodeJS.ProcessEnv} [env] */
export function setEnabled(enabled, env = process.env) {
  saveState({ ...loadState(env), enabled }, env);
}

/**
 * Show the one-line notice once per machine. Returns the line, or "".
 * @param {NodeJS.ProcessEnv} [env]
 */
export function noticeOnce(env = process.env) {
  const state = loadState(env);
  if (state.noticeShown) return "";
  saveState({ ...state, noticeShown: true }, env);
  return NOTICE;
}

/**
 * A PostHog batch body from allowlisted usage events.
 * @param {Record<string, unknown>[]} events @param {string} key @param {string} installId
 */
export function buildBatch(events, key, installId) {
  const batch = events.map(({ ts, event, ...rest }) => ({
    event: `minsky.${String(event)}`,
    distinct_id: installId,
    timestamp: ts,
    properties: { ...rest, $geoip_disable: true, $process_person_profile: false },
  }));
  return { api_key: key, batch };
}

/**
 * POST one batch; returns a skip reason, or "" on success. Never throws.
 * @param {Record<string, unknown>[]} events @param {State} state
 * @param {NodeJS.ProcessEnv} env @param {typeof fetch} fetchImpl
 */
async function post(events, state, env, fetchImpl) {
  try {
    const res = await fetchImpl(env["MINSKY_TELEMETRY_URL"] || DEFAULT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBatch(events, projectKey(env), state.installId)),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "" : `http ${res.status}`;
  } catch {
    return "network";
  }
}

/** @param {State} state @param {number} now */
function sentToday(state, now) {
  const last = Date.parse(state.lastSend ?? "");
  return Number.isFinite(last) && now - last < DAY_MS;
}

/**
 * Send what is pending. With dryRun, return the body (key hidden) and send
 * nothing. With daily, skip when the last send was under a day ago. Never throws.
 * @param {{ dryRun?: boolean, daily?: boolean, fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv, now?: number }} [opts]
 * @returns {Promise<{ sent: number, skipped?: string, body?: object }>}
 */
export async function send(opts = {}) {
  const env = opts.env ?? process.env;
  const state = loadState(env);
  const events = readEvents(env).slice(state.sent);
  if (opts.dryRun) return { sent: 0, body: buildBatch(events, "<posthog_key>", state.installId) };
  const st = status(env);
  if (!st.on) return { sent: 0, skipped: st.reason };
  if (opts.daily && sentToday(state, opts.now ?? Date.now()))
    return { sent: 0, skipped: "sent today" };
  if (events.length === 0) return { sent: 0, skipped: "nothing new" };
  const failure = await post(events, state, env, opts.fetchImpl ?? fetch);
  if (failure) return { sent: 0, skipped: failure };
  saveState(
    { ...state, sent: state.sent + events.length, lastSend: new Date().toISOString() },
    env,
  );
  return { sent: events.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [verb, ...rest] = process.argv.slice(2);
  if (verb === "status" || !verb) {
    const st = status();
    console.log(
      `telemetry: ${st.on ? "on" : "off"} (${st.reason}); ${st.pending} event(s) pending`,
    );
  } else if (verb === "on" || verb === "off") {
    setEnabled(verb === "on");
    console.log(`telemetry: turned ${verb}`);
  } else if (verb === "notice") {
    const line = noticeOnce();
    if (line) console.error(line);
  } else if (verb === "send") {
    const result = await send({
      dryRun: rest.includes("--dry-run"),
      daily: rest.includes("--daily"),
    });
    if (result.body) console.log(JSON.stringify(result.body, null, 2));
    else if (!rest.includes("--daily"))
      console.log(`telemetry: sent ${result.sent}${result.skipped ? ` (${result.skipped})` : ""}`);
  } else {
    console.error("usage: minsky telemetry status|on|off|send [--dry-run]");
    process.exit(2);
  }
}
