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
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { detectConductorRoot } from "../novel/cross-repo-runner/dist/index.js";
import { runGateSweep } from "./local-gate-merge.mjs";

/**
 * Pure: resolve the root the conductor scopes to (its `MINSKY_HOME`).
 * `MINSKY_HOME` env wins (set by launchd units / `minsky-bootstrap`);
 * otherwise the conductor self-detects from `cwd` via the SAME pure
 * zero-arg precedence chain `bin/minsky` documents (single source of
 * truth — the shim no longer duplicates git-root detection in bash, so
 * a zero-arg launch forks zero extra detection subprocesses). Extracted
 * + exported so the decision is unit-testable with an injected fs probe
 * (rule #10 — no real I/O in the decision; the default probe is wired
 * only at the call site below).
 * @param {Record<string,string|undefined>} env
 * @param {string} cwd
 * @param {{exists:(p:string)=>boolean,listDir:(p:string)=>readonly string[]}} fsProbe
 * @returns {string}
 */
export function resolveRepoRoot(env, cwd, fsProbe) {
  const home = env["MINSKY_HOME"];
  if (home !== undefined && home.length > 0) return home;
  return detectConductorRoot({ cwd, fs: fsProbe });
}

const REPO = resolveRepoRoot(process.env, process.cwd(), {
  exists: (p) => existsSync(p),
  listDir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
});
const LEDGER = join(REPO, ".minsky", "orchestrate.jsonl");
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
