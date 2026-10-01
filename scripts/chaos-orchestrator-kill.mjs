#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-06-02 TASKS.md claude-orchestrator-local-worker-fanout — chaos test (c): orchestrator-kill fault injection paired with chaos-multitenant.mjs -->
//
// `scripts/chaos-orchestrator-kill.mjs` — operator-facing chaos test for the
// brain-vs-hands fan-out (TASKS.md `claude-orchestrator-local-worker-fanout`).
// It is the task's chaos artefact (c), paired with the sibling
// `scripts/chaos-multitenant.mjs`. The injected fault is: KILL the orchestrator
// (the brain) while N workers (the hands) are mid-flight. The steady state is:
//   1. every BUSY worker FINISHES its in-flight iteration then self-terminates,
//   2. every IDLE worker self-terminates immediately,
//   3. ZERO workers survive as zombies past the grace window.
//
// Pattern conformance (vision.md § "Pattern conformance index"):
//   - Chaos engineering — Basiri et al., "Principles of Chaos Engineering",
//     IEEE Software 2016: steady-state hypothesis + fault injection + assertion
//     against the steady state. The injected fault is the orchestrator-kill;
//     the steady state is "0 zombie workers". Like the sibling chaos harnesses,
//     this is a deterministic discrete-event simulation over the PURE decision
//     under test (`decideDetachedWorkerAction` from scripts/orchestrate.mjs) —
//     a real SIGKILL race would be flaky and machine-dependent, while the
//     detach decision is pure, so the sim is the faithful deterministic harness.
//   - Actor model — Hewitt, "A Universal Modular Actor Formalism for Artificial
//     Intelligence", IJCAI 1973: the orchestrator + workers are message-passing
//     actors; a detached hand must not become a zombie.
//
// Exit 0 iff the steady state holds (0 zombies AND every worker reached a
// terminal action); 1 otherwise (Basiri assertion). The sim is pure and
// exported so the paired .test.mjs drives it deterministically.

import { decideDetachedWorkerAction } from "./orchestrate.mjs";

const DEFAULT_WORKERS = 3; // the task's N=3 fan-out
const DEFAULT_GRACE_SEC = 1800; // 30-min finish window (spawn-watchdog ceiling)

/**
 * Build a deterministic worker fleet for the sim: a mix of busy + idle workers,
 * each with a finish-duration. Deterministic from the worker index so the
 * result is reproducible while still exercising both detach branches.
 *
 * @param {number} workers
 * @returns {{ pid: number, busy: boolean, finishSec: number }[]}
 */
function buildFleet(workers) {
  /** @type {{ pid: number, busy: boolean, finishSec: number }[]} */
  const out = [];
  for (let i = 0; i < workers; i++) {
    const busy = i % 2 === 0; // alternate busy/idle so both branches run
    // A busy worker's in-flight iteration finishes well within the grace window.
    out.push({ pid: 20_000 + i, busy, finishSec: busy ? 300 + i * 60 : 0 });
  }
  return out;
}

/**
 * Simulate the orchestrator-kill fault over the fleet. For each worker, ask the
 * PURE `decideDetachedWorkerAction` (orchestrator dead) what it does, then model
 * the outcome: `exit-now` and `finish-then-exit` (within grace) both reach a
 * terminal state with 0 survival; only a worker whose modelled action is
 * `continue` (the forbidden zombie path) — or whose finish overruns the grace
 * window — counts as a zombie.
 *
 * @param {{ workers?: number, graceSec?: number }} [opts]
 * @returns {{ zombies: number, terminated: number, nonTerminal: number, total: number }}
 */
export function simulateOrchestratorKill(opts = {}) {
  const workers = opts.workers ?? DEFAULT_WORKERS;
  const graceSec = opts.graceSec ?? DEFAULT_GRACE_SEC;
  const fleet = buildFleet(workers);
  let zombies = 0;
  let terminated = 0;
  let nonTerminal = 0;
  for (const w of fleet) {
    // The fault: the orchestrator (brain) has exited.
    const action = decideDetachedWorkerAction({
      orchestratorAlive: false,
      workerBusy: w.busy,
    });
    if (action === "continue") {
      // The forbidden zombie path: a detached worker that keeps running.
      zombies += 1;
      nonTerminal += 1;
      continue;
    }
    if (action === "exit-now") {
      terminated += 1;
      continue;
    }
    // action === "finish-then-exit": a busy worker finishes then exits. It is a
    // zombie only if its finish overruns the grace window.
    if (w.finishSec > graceSec) {
      zombies += 1;
    } else {
      terminated += 1;
    }
  }
  return { zombies, terminated, nonTerminal, total: fleet.length };
}

/**
 * Steady state: 0 zombies AND every worker reached a terminal action (none
 * stuck in the forbidden `continue` path).
 *
 * @param {{ zombies: number, nonTerminal: number }} r
 * @returns {boolean}
 */
export function allClear(r) {
  return r.zombies === 0 && r.nonTerminal === 0;
}

/**
 * Parse `--workers=N` / `--grace-sec=N` / `--json` from argv. A bad value falls
 * back to the default (rule #7 — a typo'd knob never crashes the harness).
 *
 * @param {readonly string[]} argv
 * @returns {{ workers: number, graceSec: number, jsonOnly: boolean }}
 */
export function parseArgs(argv) {
  let workers = DEFAULT_WORKERS;
  let graceSec = DEFAULT_GRACE_SEC;
  let jsonOnly = false;
  for (const a of argv) {
    if (a === "--json") jsonOnly = true;
    const wMatch = a.match(/^--workers=(\d+)$/);
    if (wMatch?.[1] !== undefined) workers = Number(wMatch[1]) || DEFAULT_WORKERS;
    const gMatch = a.match(/^--grace-sec=(\d+)$/);
    if (gMatch?.[1] !== undefined) graceSec = Number(gMatch[1]) || DEFAULT_GRACE_SEC;
  }
  return { workers, graceSec, jsonOnly };
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { workers, graceSec, jsonOnly } = parseArgs(process.argv.slice(2));
  const result = simulateOrchestratorKill({ workers, graceSec });
  const ok = allClear(result);
  if (!jsonOnly) {
    process.stdout.write(
      `chaos-orchestrator-kill: KILL orchestrator with N=${workers} workers alive (grace=${graceSec}s)\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!jsonOnly) {
    process.stdout.write(
      ok
        ? "chaos-orchestrator-kill: STEADY STATE HELD — 0 zombie workers; every worker finished or self-terminated\n"
        : "chaos-orchestrator-kill: STEADY STATE VIOLATED — a worker survived the orchestrator's exit\n",
    );
  }
  process.exit(ok ? 0 : 1);
}
