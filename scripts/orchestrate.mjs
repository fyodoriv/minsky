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
import { deriveRunId } from "@minsky/tick-loop";
import { assertWriteAllowed, buildWriteVerdictRecord } from "./lib/repo-policy.mjs";
import { landLocalBranch, runGateSweep, setWorkerPauseSeam } from "./local-gate-merge.mjs";
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
// Least-authority policy ledger (TASKS.md `runany-permission-scoped-writes`).
// The conductor emits a `run-start` marker at boot (bounds the audit's
// `--window=run` slice), one home `write-verdict` per merged home PR, and a
// `minsky-self-task-filed` record whenever a tick observes minsky-on-itself
// friction (scout-and-record). `scripts/runany-policy-audit.mjs` is the only
// reader — its schema + thresholds are the single source of truth (rule #2).
const POLICY_LEDGER = join(REPO, ".minsky", "runany-policy.jsonl");
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
// Per-process run-id so dozens of concurrent conductors on the SAME repo
// (multi-tenant — TASKS.md `runany-multitenant-no-conflict`) are
// distinguishable in the shared `orchestrate.jsonl` ledger and so any per-run
// mutable namespace (worktree, branch, lock) the conductor or its children
// derive is keyed `<repo-hash>-<pid>-<rand>` and never collides. `MINSKY_RUN_ID`
// is the operator/escape-hatch override; otherwise it's derived from
// (repo, pid, crypto-rand). The derivation core lives in
// `novel/tick-loop/src/worker-config.ts` (pure, unit-tested + chaos-tested).
const RUN_ID =
  process.env["MINSKY_RUN_ID"] ??
  deriveRunId({ repoPath: REPO, pid: process.pid, rand: randomRunToken() });

/**
 * A short random hex token for the run-id's tiebreaker. `Math.random` is
 * sufficient here — the token only needs to disambiguate two same-pid runs on
 * one machine, not resist an adversary (rule #1 — no crypto dep for a
 * non-crypto need; the repo-hash + pid already carry most of the entropy).
 * @returns {string}
 */
function randomRunToken() {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
}

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

/**
 * Pure: given the stdout of `launchctl print gui/<uid>/<label>`, decide
 * whether the launchd-supervised worker daemon is running. Detect liveness
 * by the supervisor's own truth — the top-level `state = running` line —
 * NOT by an argv-substring grep (`pgrep -f 'tick-loop.mjs --worker-id=0'`)
 * which silently breaks the moment the arg-shape changes. Concretely:
 * scaling to N workers via `--spawn-additional-workers=3` rewrites the root
 * proc's argv (no `--worker-id=0` substring) and spawns children labelled
 * `--worker-id=1/2/3`, so the old grep only matched a STRAY pre-reload proc
 * by coincidence; when that stray exits the grep flips false and the
 * conductor kickstarts the healthy 4-worker daemon every tick, SIGKILLing
 * in-flight Opus iterations. `launchctl print` reports the supervisor's
 * actual job state independent of how the worker fans out its argv (rule #6
 * — the supervisor owns restart; detect via the supervisor, not a brittle
 * process heuristic — and rule #10 — same input ⇒ same output, no I/O here).
 *
 * `launchctl print` nests sub-job `state = active` lines under the service;
 * the daemon's own liveness is the FIRST top-level (single-tab-indented)
 * `state = running`. We anchor on that to avoid a nested `state = active`
 * sub-job spuriously reading as alive when the top-level job is stopped.
 * @param {string} printOut stdout from `launchctl print`
 * @returns {boolean} true iff the top-level job `state = running`
 */
export function parseLaunchctlRunning(printOut) {
  if (typeof printOut !== "string" || printOut.length === 0) return false;
  for (const line of printOut.split("\n")) {
    // Top-level fields are single-tab-indented; sub-jobs are deeper. Match
    // exactly `\tstate = running` so a nested `\t\tstate = active` can't pass.
    if (/^\tstate\s*=\s*running\b/.test(line)) return true;
  }
  return false;
}

/**
 * Probe launchd for the worker daemon's job state. The `launchctl print`
 * invocation is injected (`probe`) so the liveness decision is unit-testable
 * without a loaded launchd service (rule #2 — pure decision over a seam).
 * Default probe shells out to read-only `launchctl print gui/<uid>/<label>`.
 * On any failure (service not loaded ⇒ non-zero exit, no uid, parse miss)
 * the daemon is treated as DOWN — the conservative heal-eligible state.
 * @param {() => string} [probe] returns `launchctl print` stdout
 * @returns {boolean}
 */
function workerDaemonAlive(probe = defaultLaunchctlProbe) {
  try {
    return parseLaunchctlRunning(probe());
  } catch {
    return false;
  }
}

/**
 * Default liveness probe: read-only `launchctl print gui/<uid>/<label>`.
 * Read-only launchctl is always allowed (see check-supervisor-explicit-start).
 * @returns {string}
 */
function defaultLaunchctlProbe() {
  const uid = typeof process.getuid === "function" ? process.getuid() : "";
  return execFileSync("launchctl", ["print", `gui/${uid}/${WORKER_LABEL}`], {
    encoding: "utf8",
  });
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
 * Pure: parse `pgrep -f tick-loop.mjs` stdout into the worker-daemon pids the
 * conductor should SIGSTOP for the duration of a gate vet (load-shed lever #2,
 * `gate-host-load-shed`). The conductor's OWN pid is excluded so a load-shed
 * pause can never freeze the conductor itself. Same input ⇒ same output (rule
 * #10); no I/O here — the caller supplies the raw `pgrep` text + self pid.
 * @param {string} pgrepOut  newline-separated pids from `pgrep -f tick-loop.mjs`
 * @param {number} selfPid   the conductor's own pid (never paused)
 * @returns {number[]}
 */
export function decideWorkerPausePids(pgrepOut, selfPid) {
  return pgrepOut
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== selfPid);
}

/**
 * Production worker-pause/resume seam (load-shed lever #2). SIGSTOP every live
 * worker-daemon iteration process for the duration of a gate vet so the
 * conductor's scratch `vitest` never competes with a worker-tick `vitest`
 * under host oversubscription (the 2026-05-17 spurious `gate red: vitest`
 * cause). Resume is guaranteed by `local-gate-merge.mjs`'s `withWorkerPaused`
 * `finally` — but a missed SIGCONT would freeze a worker, so resume swallows
 * nothing silently here: it logs. Best-effort throughout (rule #6): a failed
 * signal degrades to an unshed vet, never an aborted sweep.
 * @param {(s: string) => void} log
 * @returns {{ pause: () => void, resume: () => void }}
 */
function workerPauseSeam(log) {
  let pausedPids = /** @type {number[]} */ ([]);
  const pgrep = () => {
    try {
      return execFileSync("pgrep", ["-f", "tick-loop.mjs"], { encoding: "utf8" });
      // rule-6: handled-locally — no worker procs (or pgrep absent) ⇒ nothing to pause; the vet runs unshed.
    } catch {
      return "";
    }
  };
  const signal = (/** @type {number[]} */ pids, /** @type {"-STOP" | "-CONT"} */ sig) => {
    for (const pid of pids) {
      try {
        execFileSync("kill", [sig, String(pid)], { encoding: "utf8" });
        // rule-6: handled-locally — a worker that exited between pgrep and kill is a no-op, not a failure; the per-pid catch keeps one dead pid from blocking the rest.
      } catch {
        /* pid already gone or not ours — skip it */
      }
    }
  };
  return {
    pause: () => {
      pausedPids = decideWorkerPausePids(pgrep(), process.pid);
      if (pausedPids.length === 0) return;
      signal(pausedPids, "-STOP");
      log(`orchestrate: load-shed — SIGSTOP worker pids [${pausedPids.join(",")}] for gate vet\n`);
    },
    resume: () => {
      if (pausedPids.length === 0) return;
      signal(pausedPids, "-CONT");
      log(`orchestrate: load-shed — SIGCONT worker pids [${pausedPids.join(",")}]\n`);
      pausedPids = [];
    },
  };
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
 * @param {{ts: string, workerAlive: boolean, healed: boolean, sweepError?: string, runId?: string}} ctx
 * @returns {{ts: string, workerAlive: boolean, healed: boolean, merged: number[], skipped: number, sweepError?: string, runId?: string}}
 */
export function buildTickLedgerLine(res, ctx) {
  return {
    ts: ctx.ts,
    workerAlive: ctx.workerAlive,
    healed: ctx.healed,
    merged: res.merged.map((m) => m.number),
    skipped: res.skipped.length,
    // Per-run id so concurrent conductors on the same repo (multi-tenant) are
    // distinguishable in the shared ledger — `runany-multitenant-no-conflict`.
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    ...(ctx.sweepError ? { sweepError: ctx.sweepError } : {}),
  };
}

/**
 * Pure: the least-authority policy records a single tick emits, given its
 * sweep result and whether minsky-on-itself friction was observed. The
 * conductor only ever writes to its OWN (home) repo — every merged PR is a
 * home `open-pr`, so each gets a home `write-verdict` (`assertWriteAllowed`
 * always allows home, but recording it makes the audit's `foreign_*`
 * escape-counters provably 0 over a real run, not merely absent). When a
 * tick sees friction — worker daemon DOWN (healed) OR a sweep error — it
 * also files a minsky-self improvement task (scout-and-record across the
 * fleet, Acceptance (3)); `taskId` is a stable per-tick id the runtime uses
 * when appending the TASKS.md block. No I/O — the caller appends (rule #10).
 *
 * @param {{merged: {number:number}[]}} res   the sweep result.
 * @param {{healed: boolean, sweepError?: string, ts: string}} ctx
 * @returns {Array<Record<string, unknown>>}  ledger records, in emit order.
 */
export function buildRunanyPolicyRecords(res, ctx) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const m of res.merged) {
    const req = /** @type {const} */ ({
      repoClass: "home",
      action: "open-pr",
      changedPaths: [`pr-${m.number}`],
    });
    out.push(buildWriteVerdictRecord(req, assertWriteAllowed(req), ctx.ts));
  }
  const friction = ctx.healed || (ctx.sweepError !== undefined && ctx.sweepError.length > 0);
  if (friction) {
    const reason = ctx.healed ? "worker-daemon-down-healed" : "sweep-error";
    out.push({
      ts: ctx.ts,
      event: "minsky-self-task-filed",
      taskId: `minsky-self-${reason}-${ctx.ts}`,
    });
  }
  return out;
}

/**
 * Best-effort append of the tick's policy records to
 * `.minsky/runany-policy.jsonl`. Same fail-soft contract as the
 * orchestrate ledger: a failed write (no `.minsky/`, EACCES) degrades to a
 * blind metric for that tick, never an aborted loop (rule #6).
 * @param {Array<Record<string, unknown>>} records
 */
function appendPolicyLedger(records) {
  if (records.length === 0) return;
  if (!existsSync(join(REPO, ".minsky"))) return;
  try {
    appendFileSync(POLICY_LEDGER, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  } catch {
    /* rule #6: policy ledger is best-effort, never gates the loop */
  }
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
            runId: RUN_ID,
            ...(sweepError ? { sweepError } : {}),
          }),
        )}\n`,
      );
    } catch {
      /* rule #6: ledger best-effort, never gates the loop */
    }
  }
  // Least-authority policy ledger (runany-permission-scoped-writes): one
  // home write-verdict per merged PR + a minsky-self task on observed
  // friction. Best-effort, after the orchestrate ledger so a policy-ledger
  // failure can never lose the throughput record.
  appendPolicyLedger(
    buildRunanyPolicyRecords(res, {
      healed: aliveBefore === false,
      ...(sweepError ? { sweepError } : {}),
      ts: new Date().toISOString(),
    }),
  );
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
  // Wire the load-shed worker-pause seam into the gate (gate-host-load-shed):
  // every sweep vet launched from a conductor tick SIGSTOPs the worker daemon
  // for the vet's duration so gate-vet and worker-tick never run vitest
  // simultaneously. Standalone `node scripts/local-gate-merge.mjs` runs leave
  // the seam at its no-op default.
  setWorkerPauseSeam(workerPauseSeam(log));
  // Emit the policy-ledger `run-start` marker so the audit's `--window=run`
  // slice is bounded to THIS conductor run (runany-permission-scoped-writes).
  // A unique runId keys the slice; best-effort like every other ledger write.
  appendPolicyLedger([
    {
      ts: new Date().toISOString(),
      event: "run-start",
      runId: `${process.pid}-${RUN_START_MS}`,
    },
  ]);
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
