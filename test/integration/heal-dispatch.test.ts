// Integration tests for `scripts/heal-dispatch.mjs` — the M1.13 phase-2
// production binding that fires the automated-heal catalogue
// (novel/observer/heals) at the runtime boundaries and writes the live
// MTTR ledger.
//
// Hypothesis (rule #9): wiring the dispatcher at the pre-walk boundary
//   makes injected catalogued failures heal without human intervention
//   and writes the first production HealEvent rows.
//   Success: every test below passes against the real
//   `node scripts/heal-dispatch.mjs` with a tmp fixture host.
//   Pivot: if a CLI-per-tick binding proves too coarse (heals need live
//   spawn context), move dispatch into the observer process instead.
//   Measurement: this file; production observation via
//   `node scripts/heal-mttr-report.mjs --window=30d --json`.
// Anchor: user-stories/007-agent-self-heals-catalogued-failures.md;
//   Beyer et al., *Site Reliability Engineering*, O'Reilly 2016, Ch. 6.
//
// Scenarios (rule #3, user-stories/007):
//   - "heal-dispatch heals a stale pid file at the pre-walk boundary and writes the ledger row"
//   - "heal-dispatch is a no-op on a healthy host"
//   - "heal-dispatch never propagates a failure to the caller (rule #6)"

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const DISPATCH = join(REPO_ROOT, "scripts", "heal-dispatch.mjs");

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Fixture host: a tmp dir with a `.minsky/` state dir, isolated via MINSKY_STATE_DIR. */
function makeFixtureHost(): { host: string; stateDir: string } {
  const host = mkdtempSync(join(tmpdir(), "heal-dispatch-host-"));
  tmpDirs.push(host);
  const stateDir = join(host, ".minsky");
  mkdirSync(stateDir, { recursive: true });
  return { host, stateDir };
}

function runDispatch(host: string, stateDir: string, boundary: string) {
  return spawnSync(process.execPath, [DISPATCH, "--host", host, "--boundary", boundary], {
    encoding: "utf8",
    env: { ...process.env, MINSKY_STATE_DIR: stateDir },
    timeout: 60_000,
  });
}

describe("heal-dispatch.mjs (M1.13 phase-2 runtime wiring)", () => {
  // scenario: "heal-dispatch heals a stale pid file at the pre-walk boundary and writes the ledger row"
  test("pre-walk heals an injected stale pid file and writes a ledger row", () => {
    const { host, stateDir } = makeFixtureHost();
    const pidFile = join(stateDir, "daemon.pid");
    writeFileSync(pidFile, "99999\n"); // pid 99999 is reliably dead

    const result = runDispatch(host, stateDir, "pre-walk");

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(existsSync(pidFile)).toBe(false);

    const ledgerPath = join(host, ".minsky", "heal-events.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);
    const rows = readFileSync(ledgerPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const stalePidRow = rows.find((r) => r.failure_class === "stale-pid");
    expect(stalePidRow).toBeDefined();
    expect(stalePidRow.outcome).toBe("healed");
    expect(stalePidRow.duration_ms).toBeLessThan(300_000);
  });

  // scenario: "heal-dispatch is a no-op on a healthy host"
  test("pre-walk on a healthy host exits 0 and writes no ledger row", () => {
    const { host, stateDir } = makeFixtureHost();
    writeFileSync(join(stateDir, "config.json"), "{}\n");
    writeFileSync(join(host, ".minsky", "state.json"), "{}\n");

    const result = runDispatch(host, stateDir, "pre-walk");

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(existsSync(join(host, ".minsky", "heal-events.jsonl"))).toBe(false);
  });

  // scenario: "heal-dispatch heals a stale pid file at the pre-walk boundary and writes the ledger row"
  // (corrupt-state-json variant — same boundary, second wired heal)
  test("pre-walk heals an injected corrupt state.json and records it", () => {
    const { host, stateDir } = makeFixtureHost();
    const stateFile = join(host, ".minsky", "state.json");
    writeFileSync(stateFile, '{"last_iter": 42, "incomplete'); // truncated mid-write

    const result = runDispatch(host, stateDir, "pre-walk");

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual({});
    const rows = readFileSync(join(host, ".minsky", "heal-events.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const row = rows.find((r) => r.failure_class === "corrupt-state-json");
    expect(row).toBeDefined();
    expect(row.outcome).toBe("healed");
  });

  // scenario: "heal-dispatch never propagates a failure to the caller (rule #6)"
  test("exits 0 even when the host dir does not exist", () => {
    const result = spawnSync(
      process.execPath,
      [DISPATCH, "--host", "/nonexistent/heal-dispatch-host", "--boundary", "pre-walk"],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
  });

  // scenario: "heal-dispatch never propagates a failure to the caller (rule #6)"
  test("exits 0 on an unknown boundary (logs, never throws)", () => {
    const { host, stateDir } = makeFixtureHost();
    const result = runDispatch(host, stateDir, "mid-flight");
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
  });
});
