#!/usr/bin/env node
// Pattern: reactive-resolution (Beyer SRE 2016 Ch. 6 — silence is failure;
// Kephart & Chess 2003 — MAPE-K's E phase). Runs the self-diagnose
// invariants once, finds any `daemon-iteration-runtime-exceeded`
// findings, kills the named pids, and exits. Composes with the
// `watchdog.mjs` continuous loop AND with the supervisor's
// self-diagnose-on-boot path for defense in depth.
//
// Source: 2026-05-05 dogfood — a daemon iteration ran for 2h+ at ~1% CPU
// before the operator killed it manually. Operator directive: "Adjust
// minsky so that it automatically detects situations like this and
// resolves this specific one too" + "make changes so that minsky is
// able to detect similar issues too and focus on immediately resolving
// them outside of time boundaries".
//
// Conformance: full — pure runner over the existing self-diagnose
// substrate (rule #2 Strategy seam); destructive action (kill) is
// explicit and operator-readable; rule #9 — every kill emits a span-
// shaped log line so the resolution is auditable.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { defaultInvariants, runInvariants } from "./self-diagnose.mjs";

const execFileAsync = promisify(execFile);

/**
 * Extract pids from a stuck-iteration finding's evidence string. Format:
 * `pid=<n> etime=<...> (>...); pid=<n> ...`. Pure parser.
 *
 * @param {string} evidence
 * @returns {readonly number[]}
 */
export function extractPidsFromEvidence(evidence) {
  /** @type {number[]} */
  const pids = [];
  for (const match of evidence.matchAll(/pid=(\d+)/g)) {
    const pid = Number(match[1]);
    if (Number.isFinite(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/**
 * Kill the given pid via `kill <pid>` (SIGTERM by default; the supervisor's
 * launchd respawn handles the gap). Returns `{ ok: true }` on success or
 * `{ ok: false, reason }` if the pid is no longer alive (race) or the
 * kill itself fails.
 *
 * @param {number} pid
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function killPidProcess(pid) {
  try {
    await execFileAsync("kill", [String(pid)], { timeout: 5_000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const findings = await runInvariants(defaultInvariants());
  const stuck = findings.filter((f) => f.id === "daemon-iteration-runtime-exceeded");
  if (stuck.length === 0) {
    process.stdout.write("kill-stuck-iterations: no stuck iterations detected\n");
    process.exit(0);
  }
  /** @type {{ pid: number, ok: boolean, reason?: string }[]} */
  const results = [];
  for (const finding of stuck) {
    const pids = extractPidsFromEvidence(finding.evidence);
    for (const pid of pids) {
      const result = await killPidProcess(pid);
      results.push({ pid, ...result });
      const verdict = result.ok ? "killed" : `kill-failed (${result.reason})`;
      process.stdout.write(`kill-stuck-iterations: pid=${pid} ${verdict}\n`);
    }
  }
  const failures = results.filter((r) => !r.ok).length;
  process.exit(failures === 0 ? 0 : 1);
}
