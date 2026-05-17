#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-16 operator "build the best solution for autonomous opus, we're here for the long game" -->
//
// `minsky orchestrate` — the Opus orchestrator conductor (autonomous-opus
// Phase 1.2). One self-scheduling supervised loop, NOT a while(true):
//   (1) self-heal: if the Sonnet worker daemon (com.minsky.opus-sonnet-run)
//       is down, kickstart its launchd agent;
//   (2) Opus-review-gated merge sweep — `runGateSweep` from
//       local-gate-merge.mjs (deterministic --stage=full gate + Opus brain
//       review; only gate-green AND Opus-approved PRs merge);
//   (3) append a heartbeat to `.minsky/orchestrate.jsonl` (the 10h-uptime
//       + self-metric ledger).
// Per-tick errors are caught and logged (one bad sweep must not kill the
// conductor); a fatal throw exits and launchd KeepAlive restarts it
// (Armstrong let-it-crash). Composes existing pieces (rule #1); $0 infra
// (Opus on the Claude subscription; fits $10/mo). Roles: Opus = brain
// (merge review), Sonnet = workers + routine. The conductor itself does
// no model calls — it delegates judgement to runGateSweep's reviewFn.
//
// Usage: node scripts/orchestrate.mjs [--once] [--interval-ms=N]
//   --once          : one tick then exit (for validation / dry checks)
//   --interval-ms=N : loop period (default 1200000 = 20 min;
//                      env MINSKY_ORCH_INTERVAL_MS also honored)

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runGateSweep } from "./local-gate-merge.mjs";
import { DEFAULT_RUN_TIME_LIMIT_SEC, parseDurationSec } from "./restart-supervisor.mjs";

const REPO = process.env["MINSKY_HOME"] ?? "/Users/cbrwizard/apps/tooling/minsky";
const LEDGER = join(REPO, ".minsky", "orchestrate.jsonl");
// Hard wall-clock ceiling for this run (rule #6 — stay alive, but
// bounded). After it, the conductor stops cleanly (exit 0) instead of
// scheduling another tick; launchd's KeepAlive/runany supervision owns
// crash-restart backoff (see scripts/restart-supervisor.mjs). Env
// `MINSKY_RUN_TIME_LIMIT` accepts `<n>s|m|h` (default 10h).
const RUN_START_MS = Date.now();
const RUN_TIME_LIMIT_MS =
  parseDurationSec(process.env["MINSKY_RUN_TIME_LIMIT"], DEFAULT_RUN_TIME_LIMIT_SEC) * 1000;
// PRs vetted per tick. Bounded (default 2) so a tick is at most
// LIMIT × per-vet-timeout — the conductor cannot back up behind a long
// sweep (keystone "run reliably for 10h"). Env-tunable.
const SWEEP_LIMIT = Number(process.env["MINSKY_ORCH_LIMIT"] ?? 2);
const WORKER_LABEL = "com.minsky.opus-sonnet-run";

/**
 * Pure: given whether the Sonnet worker daemon process is alive, decide
 * the conductor action. Extracted so the loop body stays trivial and the
 * decision is unit-testable (rule #10 — no I/O in the decision).
 * @param {boolean} workerAlive
 * @returns {"heal" | "ok"}
 */
export function decideHeal(workerAlive) {
  return workerAlive ? "ok" : "heal";
}

/** @returns {boolean} */
function workerDaemonAlive() {
  try {
    const out = execFileSync("pgrep", ["-f", "tick-loop.mjs --worker-id=0"], {
      encoding: "utf8",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** @param {(s: string) => void} log */
function healWorkerDaemon(log) {
  try {
    const uid = typeof process.getuid === "function" ? process.getuid() : "";
    execFileSync("launchctl", ["kickstart", "-k", `gui/${uid}/${WORKER_LABEL}`], {
      encoding: "utf8",
    });
    log(`orchestrate: healed — kickstarted ${WORKER_LABEL}\n`);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    log(`orchestrate: heal failed (continuing): ${m.slice(0, 140)}\n`);
  }
}

/**
 * One conductor tick: heal-if-needed → Opus-review-gated merge sweep →
 * ledger. Never throws (caught internally) so a bad sweep can't kill the
 * loop; the ledger line is the 10h-uptime + self-metric record.
 * @param {(s: string) => void} log
 */
export function tick(log) {
  const aliveBefore = workerDaemonAlive();
  if (decideHeal(aliveBefore) === "heal") {
    log("orchestrate: Sonnet worker daemon DOWN — healing\n");
    healWorkerDaemon(log);
  }
  /** @type {{merged: {number:number}[], skipped: {number:number}[]}} */
  let res = { merged: [], skipped: [] };
  let sweepError = "";
  try {
    res = runGateSweep({ limit: SWEEP_LIMIT, log });
  } catch (err) {
    sweepError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    log(`orchestrate: sweep error (continuing): ${sweepError}\n`);
  }
  if (existsSync(join(REPO, ".minsky"))) {
    try {
      appendFileSync(
        LEDGER,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          workerAlive: workerDaemonAlive(),
          healed: aliveBefore === false,
          merged: res.merged.map((m) => m.number),
          skipped: res.skipped.length,
          ...(sweepError ? { sweepError } : {}),
        })}\n`,
      );
    } catch {
      /* rule #6: ledger best-effort, never gates the loop */
    }
  }
}

/**
 * Self-scheduling loop (no while(true) → no biome noConstantCondition;
 * setTimeout chain so a slow tick never overlaps the next).
 * @param {number} intervalMs
 * @param {(s: string) => void} log
 */
function schedule(intervalMs, log) {
  try {
    tick(log);
  } catch (err) {
    // tick() catches its own sweep/heal errors; this guards the unexpected.
    const m = err instanceof Error ? err.message : String(err);
    log(`orchestrate: tick threw (continuing): ${m.slice(0, 200)}\n`);
  }
  // Bounded stay-alive (rule #6): once the hard wall-clock ceiling is
  // reached, do NOT reschedule — returning drains the setTimeout chain
  // (the only thing keeping the loop alive) so Node exits 0 cleanly. No
  // zombie, no infinite restart past the deadline.
  const elapsedMs = Date.now() - RUN_START_MS;
  if (elapsedMs >= RUN_TIME_LIMIT_MS) {
    log(
      `orchestrate: MINSKY_RUN_TIME_LIMIT reached (${Math.round(
        elapsedMs / 1000,
      )}s ≥ ${RUN_TIME_LIMIT_MS / 1000}s) — clean stop, exit 0\n`,
    );
    process.exitCode = 0;
    return;
  }
  setTimeout(() => schedule(intervalMs, log), intervalMs);
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const log = (/** @type {string} */ s) => process.stdout.write(s);
  const ivArg = args.find((a) => a.startsWith("--interval-ms="));
  const intervalMs = ivArg
    ? Number(ivArg.split("=")[1])
    : Number(process.env["MINSKY_ORCH_INTERVAL_MS"] ?? 1200000);
  if (args.includes("--once")) {
    log(`orchestrate: --once tick ${new Date().toISOString()}\n`);
    tick(log);
    log("orchestrate: --once done\n");
  } else {
    log(`orchestrate: start ${new Date().toISOString()} interval=${intervalMs}ms\n`);
    schedule(intervalMs, log);
  }
}
