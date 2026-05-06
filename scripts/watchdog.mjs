#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-05 — operator directive: detect stuck iterations and resolve them off-tick (continuous loop; companion to scripts/kill-stuck-iterations.mjs). -->
// Pattern: continuous-watchdog (Beyer SRE 2016 Ch. 6 — every state operator
// cares about must surface; Kephart & Chess 2003 — MAPE-K's M+A+P+E pipeline
// runs continuously, not on tick boundaries). Polls the self-diagnose
// invariants every `WATCHDOG_INTERVAL_SECONDS` and acts on findings whose
// resolution is local + reversible-via-respawn (currently:
// `daemon-iteration-runtime-exceeded`).
//
// Source: 2026-05-05 operator directive: "Adjust minsky so that it
// automatically detects situations like this and resolves this specific
// one too" + "Then make changes so that minsky is able to detect similar
// issues too and focus on immediately resolving them outside of time
// boundaries". The supervisor's self-diagnose runs at boot only; this
// watchdog runs continuously so resolution happens at watchdog-cadence,
// not supervisor-tick-cadence.
//
// Conformance: full — pure runner over `defaultInvariants()` from
// self-diagnose.mjs (rule #2 Strategy seam); destructive actions (kill)
// are bounded to local processes the supervisor can respawn; every
// resolution emits a span-shaped log line for audit (rule #4).
//
// Pivot (rule #9): if the watchdog issues ≥1 false-positive kill per week
// (kill of a process that would have completed within the threshold +
// 10%), raise `WATCHDOG_STUCK_THRESHOLD_SECONDS` to 60min before
// retiring. If the watchdog itself crashes ≥3 times/week, switch to
// supervisor-internal periodic timer (in-process, no separate
// scheduler needed).

import { setTimeout as sleep } from "node:timers/promises";

import { extractPidsFromEvidence, killPidProcess } from "./kill-stuck-iterations.mjs";
import {
  daemonIterationRuntimeInvariant,
  defaultInvariants,
  runInvariants,
} from "./self-diagnose.mjs";

const INTERVAL_SECONDS = Number(process.env["WATCHDOG_INTERVAL_SECONDS"] ?? 60);
const STUCK_THRESHOLD_SECONDS = Number(process.env["WATCHDOG_STUCK_THRESHOLD_SECONDS"] ?? 1800);

/**
 * One pass: run the auto-resolvable invariant, kill any detected pids,
 * return the count of resolutions. Pure side-effect over an injected
 * spawn lister — unit-testable.
 *
 * @param {object} opts
 * @param {() => Promise<readonly { pid: number, etimeSeconds: number, ppid: number | null }[]>} opts.listClaudePrintSpawns
 * @param {(pid: number) => Promise<{ ok: boolean, reason?: string }>} opts.killPid
 * @param {(line: string) => void} [opts.log]
 * @param {number} [opts.thresholdSeconds]
 * @returns {Promise<{ checked: number, killed: number, failed: number }>}
 */
export async function watchdogTick(opts) {
  const { listClaudePrintSpawns, killPid, log = () => {}, thresholdSeconds = 1800 } = opts;
  const findings = await runInvariants([
    daemonIterationRuntimeInvariant({ listClaudePrintSpawns, thresholdSeconds }),
  ]);
  const stuck = findings.filter((f) => f.id === "daemon-iteration-runtime-exceeded");
  let killed = 0;
  let failed = 0;
  let checked = 0;
  for (const finding of stuck) {
    const pids = extractPidsFromEvidence(finding.evidence);
    checked += pids.length;
    for (const pid of pids) {
      const result = await killPid(pid);
      if (result.ok) {
        killed++;
        log(
          `[span] watchdog.kill {"pid":${pid},"reason":"daemon-iteration-runtime-exceeded","ts":"${new Date().toISOString()}"}`,
        );
      } else {
        failed++;
        log(
          `[span] watchdog.kill-failed {"pid":${pid},"reason":${JSON.stringify(result.reason ?? "unknown")},"ts":"${new Date().toISOString()}"}`,
        );
      }
    }
  }
  return { checked, killed, failed };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.stdout.write(
    `[span] watchdog.start {"interval_seconds":${INTERVAL_SECONDS},"threshold_seconds":${STUCK_THRESHOLD_SECONDS}}\n`,
  );
  // Production loop: run forever, sleeping between ticks. Crash semantics
  // delegated to launchd / systemd via Restart=on-failure.
  while (true) {
    try {
      const findings = await runInvariants(defaultInvariants());
      const stuck = findings.filter((f) => f.id === "daemon-iteration-runtime-exceeded");
      for (const finding of stuck) {
        const pids = extractPidsFromEvidence(finding.evidence);
        for (const pid of pids) {
          const result = await killPidProcess(pid);
          if (result.ok) {
            process.stdout.write(
              `[span] watchdog.kill {"pid":${pid},"reason":"daemon-iteration-runtime-exceeded","ts":"${new Date().toISOString()}"}\n`,
            );
          } else {
            process.stdout.write(
              `[span] watchdog.kill-failed {"pid":${pid},"reason":${JSON.stringify(result.reason ?? "unknown")},"ts":"${new Date().toISOString()}"}\n`,
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `[span] watchdog.tick-error {"reason":${JSON.stringify(message)},"ts":"${new Date().toISOString()}"}\n`,
      );
    }
    await sleep(INTERVAL_SECONDS * 1_000);
  }
}
