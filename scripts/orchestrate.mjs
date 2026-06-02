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
//   land-local <branch> [--dry-run] [--no-review]
//                   : take a fully-committed LOCAL branch (e.g. an
//                     Opus-director keystone fix from a non-worktree
//                     checkout) green through the scratch --stage=full
//                     gate, then push + open PR + admin-merge it — the
//                     orchestrator's worker-branch primitive generalised
//                     to a local ref so swarm churn / missing worktree
//                     node_modules can no longer strand a vetted branch
//                     (TASKS.md orchestrator-must-land-local-vetted-branches).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { landLocalBranch, runGateSweep } from "./local-gate-merge.mjs";
import {
  DEFAULT_HEALTHY_RESET_SEC,
  DEFAULT_RUN_TIME_LIMIT_SEC,
  decideStartupThrottle,
  parseDurationSec,
} from "./restart-supervisor.mjs";

// Derive the repo root from this script's own location — the hardcoded
// `/Users/cbrwizard/apps/tooling/minsky` fallback only worked for one
// operator. Same rule-#17 fix as `scripts/local-gate-merge.mjs`
// (PR #651, 2026-05-19). The `MINSKY_HOME` env override remains as the
// operator escape hatch.
const REPO = process.env["MINSKY_HOME"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(REPO, ".minsky", "orchestrate.jsonl");
// Persisted crash history for the startup self-throttle (the production
// wire-in of decideStartupThrottle). One read at boot drives BOTH the
// escalating backoff AND the supervised-run deadline origin — a single
// state surface, no second file (round-trip elimination, rule #1).
const RESTART_STATE = join(REPO, ".minsky", "runany-restart-state.json");
// Hard wall-clock ceiling for this run (rule #6 — stay alive, but
// bounded). After it, the conductor stops cleanly (exit 0) instead of
// scheduling another tick; launchd's KeepAlive/runany supervision owns
// crash-restart backoff (see scripts/restart-supervisor.mjs). Env
// `MINSKY_RUN_TIME_LIMIT` accepts `<n>s|m|h` (default 10h).
// `RUN_START_MS` is this *process* life's start; the deadline is
// measured against the persisted *supervised-run* origin (carried
// across launchd restarts so a crash-loop can't earn a fresh 10h every
// respawn). `runOriginMs` is seeded from RUN_START_MS and overwritten
// by the persisted origin at boot (rule #7 — falls back gracefully when
// the state file is absent/corrupt).
const RUN_START_MS = Date.now();
let runOriginMs = RUN_START_MS;
const RUN_TIME_LIMIT_MS =
  parseDurationSec(process.env["MINSKY_RUN_TIME_LIMIT"], DEFAULT_RUN_TIME_LIMIT_SEC) * 1000;
// Sustained-healthy window that resets the backoff ladder to base.
// Operator-tunable like the deadline (same parseDurationSec contract —
// a typo'd value falls back to the 20m default, rule #7); `<n>s|m|h`.
const HEALTHY_RESET_MS =
  parseDurationSec(process.env["MINSKY_HEALTHY_RESET"], DEFAULT_HEALTHY_RESET_SEC) * 1000;
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
 * Pure: build the conductor's `.minsky/orchestrate.jsonl` ledger line from a
 * sweep result. Extracted so the merge-accounting is unit-testable without
 * filesystem I/O (rule #2 — pure decision over a seam, rule #10 — same input
 * ⇒ same output). The sweep result is whatever `runGateSweep` returns; its
 * `merged[]` already counts a worktree-bound-delete soft-fail as MERGED (the
 * remote squash-merge succeeded even though the post-merge local `git branch
 * -d` failed — `local-gate-merge.mjs`'s `processOnePr` consults the `gh pr
 * view --json state` oracle, never the `gh pr merge` exit code). This helper
 * carries that count straight into the conductor's `merged:[]` so the
 * autonomous path's accounting agrees with the manual path's — closing the
 * TASKS.md `local-gate-merge-false-negative-on-worktree-bound-branch-delete`
 * acceptance for `orchestrate.mjs`.
 * @param {{merged: {number:number}[], skipped: {number:number}[]}} res
 * @param {{ts: string, workerAlive: boolean, healed: boolean, sweepError?: string}} ctx
 * @returns {{ts: string, workerAlive: boolean, healed: boolean, merged: number[], skipped: number, sweepError?: string}}
 */
export function buildTickLedgerLine(res, ctx) {
  return {
    ts: ctx.ts,
    workerAlive: ctx.workerAlive,
    healed: ctx.healed,
    merged: res.merged.map((m) => m.number),
    skipped: res.skipped.length,
    ...(ctx.sweepError ? { sweepError: ctx.sweepError } : {}),
  };
}

/**
 * One conductor tick: heal-if-needed → Opus-review-gated merge sweep →
 * ledger. Never throws (caught internally) so a bad sweep can't kill the
 * loop; the ledger line is the 10h-uptime + self-metric record. The sweep
 * is injected (`sweepFn`, default `runGateSweep`) so the merge-accounting
 * path — including the worktree-bound-delete soft-fail counted as MERGED —
 * is testable without spawning `gh` (rule #2).
 * @param {(s: string) => void} log
 * @param {(opts: {limit: number, log: (s: string) => void}) => {merged: {number:number}[], skipped: {number:number}[]}} [sweepFn]
 */
export function tick(log, sweepFn = runGateSweep) {
  const aliveBefore = workerDaemonAlive();
  if (decideHeal(aliveBefore) === "heal") {
    log("orchestrate: Sonnet worker daemon DOWN — healing\n");
    healWorkerDaemon(log);
  }
  /** @type {{merged: {number:number}[], skipped: {number:number}[]}} */
  let res = { merged: [], skipped: [] };
  let sweepError = "";
  try {
    res = sweepFn({ limit: SWEEP_LIMIT, log });
  } catch (err) {
    sweepError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    log(`orchestrate: sweep error (continuing): ${sweepError}\n`);
  }
  if (existsSync(join(REPO, ".minsky"))) {
    try {
      appendFileSync(
        LEDGER,
        `${JSON.stringify(
          buildTickLedgerLine(res, {
            ts: new Date().toISOString(),
            workerAlive: workerDaemonAlive(),
            healed: aliveBefore === false,
            ...(sweepError ? { sweepError } : {}),
          }),
        )}\n`,
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
  // zombie, no infinite restart past the deadline. Measured against the
  // *supervised-run* origin (persisted across launchd restarts), not
  // this process life — otherwise a crash-loop earns a fresh budget
  // every respawn and the ceiling never bites (Acceptance #3).
  const elapsedMs = Date.now() - runOriginMs;
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

/**
 * Read persisted crash history (rule #7 — absent/corrupt/garbage all
 * degrade to a clean first-run, never a throw that would defeat the
 * supervisor). I/O edge; the decision is the pure decideStartupThrottle.
 * @returns {{ prevStartMs: number | null, prevOriginMs: number | null, prevRestartIndex: number }}
 */
function readRestartState() {
  try {
    const raw = JSON.parse(readFileSync(RESTART_STATE, "utf8"));
    return {
      prevStartMs: Number.isFinite(raw.startMs) ? raw.startMs : null,
      prevOriginMs: Number.isFinite(raw.originMs) ? raw.originMs : null,
      prevRestartIndex: Number.isFinite(raw.restartIndex) ? raw.restartIndex : 0,
    };
  } catch {
    return { prevStartMs: null, prevOriginMs: null, prevRestartIndex: 0 };
  }
}

/**
 * Persist crash history for the next launchd respawn. Best-effort: a
 * failed write just means the next boot starts from base backoff and a
 * fresh deadline origin — degraded, not broken (rule #7).
 * @param {{ startMs: number, originMs: number, restartIndex: number }} st
 */
function writeRestartState(st) {
  try {
    writeFileSync(RESTART_STATE, `${JSON.stringify(st)}\n`);
  } catch {
    /* rule #7: state is an optimisation of the supervisor, not a gate */
  }
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const log = (/** @type {string} */ s) => process.stdout.write(s);
  if (args[0] === "land-local") {
    const res = landLocalBranch({
      branchName: args[1],
      dryRun: args.includes("--dry-run"),
      noReview: args.includes("--no-review"),
      log,
    });
    log(`orchestrate: land-local ${args[1] ?? "(none)"} — ${res.outcome} (${res.reason})\n`);
    process.exit(res.outcome === "landed" ? 0 : 1);
  }
  const ivArg = args.find((a) => a.startsWith("--interval-ms="));
  const intervalMs = ivArg
    ? Number(ivArg.split("=")[1])
    : Number(process.env["MINSKY_ORCH_INTERVAL_MS"] ?? 1200000);
  if (args.includes("--once")) {
    log(`orchestrate: --once tick ${new Date().toISOString()}\n`);
    tick(log);
    log("orchestrate: --once done\n");
  } else {
    // Startup self-throttle: the production wire-in of the escalating,
    // capped, reset-on-health backoff (decideStartupThrottle → the same
    // pure decideRestart the chaos sim measures — rule #1, one core).
    // launchd KeepAlive respawns us with a *flat* ThrottleInterval; the
    // escalation lives here, off persisted crash history. The same read
    // also pins the supervised-run deadline origin so the ceiling is
    // bounded across restarts. State tracking always runs; only the
    // sleep itself is skipped by MINSKY_NO_STARTUP_BACKOFF=1 (tests/CI
    // and fast operator runs must not block on a 300s backoff).
    const prev = readRestartState();
    const t = decideStartupThrottle({
      prevStartMs: prev.prevStartMs,
      prevOriginMs: prev.prevOriginMs,
      prevRestartIndex: prev.prevRestartIndex,
      nowMs: Date.now(),
      healthyResetMs: HEALTHY_RESET_MS,
    });
    writeRestartState({
      startMs: t.startMs,
      originMs: t.originMs,
      restartIndex: t.nextRestartIndex,
    });
    runOriginMs = t.originMs;
    if (t.sleepMs > 0 && process.env["MINSKY_NO_STARTUP_BACKOFF"] !== "1") {
      log(
        `orchestrate: startup self-throttle ${Math.round(
          t.sleepMs / 1000,
        )}s (${t.reason}, prior restart #${prev.prevRestartIndex})\n`,
      );
      await new Promise((r) => setTimeout(r, t.sleepMs));
    }
    log(`orchestrate: start ${new Date().toISOString()} interval=${intervalMs}ms\n`);
    schedule(intervalMs, log);
  }
}
