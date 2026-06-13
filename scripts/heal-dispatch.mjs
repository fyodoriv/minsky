#!/usr/bin/env node
// heal-dispatch: production binding for the M1.13 automated-heal
// catalogue (`novel/observer/heals`). Builds REAL seams (node:fs,
// process.kill, pnpm) for the subset of heals whose production seam is
// unambiguous at a CLI boundary, runs detect → apply → verify per heal,
// and appends a HealEvent row to `<host>/.minsky/heal-events.jsonl`
// (read by scripts/heal-mttr-report.mjs → the `mttr-self-heal` metric).
//
// Boundaries (callers):
//   pre-walk  — bin/minsky-run.sh --loop, before each walk_hosts.
//               Heals: stale-pid, corrupt-state-json, partial-config-write.
//   pre-spawn — per-iteration, after the worktree exists (follow-up wire-in).
//               Heals: missing-node-modules, stale-tsbuildinfo.
//
// Deliberately NOT wired here (their seams need live runtime context the
// CLI doesn't have — a spawn's stderr buffer, shell poll counts, retry
// state): stuck-command, agent-rate-limited, claude-account-rate-limit,
// ollama-down, network-partition-mid-spawn,
// brief-too-long-for-context-window. They wire in at the spawn-failure
// boundary in a follow-up.
//
// Contract (rule #6): the dispatcher must never make the loop worse —
// exit 0 ALWAYS, one stderr line per fired heal / per-heal error.
// Shape mirrors scripts/metrics-render.mjs: pure orchestrator above
// injected seams + a thin CLI binding at the bottom.
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-dispatch heals a stale pid file at the pre-walk boundary and writes the ledger row"
//   - "heal-dispatch is a no-op on a healthy host"
//   - "heal-dispatch never propagates a failure to the caller (rule #6)"

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

import * as healCorruptStateJson from "../novel/observer/heals/dist/heal-corrupt-state-json.js";
import * as healPartialConfigWrite from "../novel/observer/heals/dist/heal-partial-config-write.js";
import * as healStalePid from "../novel/observer/heals/dist/heal-stale-pid.js";
import * as healStaleTsbuildinfo from "../novel/observer/heals/dist/heal-stale-tsbuildinfo.js";
import * as healWorktreeMissingNodeModules from "../novel/observer/heals/dist/heal-worktree-missing-node-modules.js";
import { buildHealEvent, recordHealEvent } from "../novel/observer/heals/dist/ledger.js";

/**
 * @typedef {import("../novel/observer/heals/dist/types.js").DetectResult} DetectResult
 * @typedef {import("../novel/observer/heals/dist/types.js").ApplyResult} ApplyResult
 * @typedef {import("../novel/observer/heals/dist/types.js").VerifyResult} VerifyResult
 */

/**
 * One dispatchable heal: catalogue id + a detect/apply/verify trio
 * already bound to its production seams.
 * @typedef {object} DispatchableHeal
 * @property {string} id failure_class written to the ledger (matches `automatedHealCatalogue`)
 * @property {string} fixApplied helper module name written to the ledger's fix_applied
 * @property {() => DetectResult} detect
 * @property {() => ApplyResult} apply
 * @property {() => VerifyResult} verify
 */

/**
 * Scan one directory level: subdirs to descend into + `.tsbuildinfo` hits.
 * @param {string} dir
 * @param {Set<string>} skip
 * @returns {{ dirs: string[]; hits: string[] }}
 */
function scanDirOnce(dir, skip) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
    // rule-6: handled-locally — an unreadable subdir (perms, raced
    // deletion) must not abort the scan of its siblings.
  } catch {
    return { dirs: [], hits: [] };
  }
  /** @type {string[]} */
  const dirs = [];
  /** @type {string[]} */
  const hits = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) dirs.push(full);
    } else if (entry.name.endsWith(".tsbuildinfo")) {
      hits.push(full);
    }
  }
  return { dirs, hits };
}

/**
 * Recursively list `.tsbuildinfo` files under `rootDir`, skipping
 * dependency/VCS dirs. Production stand-in for the chaos test's
 * injected `listTsbuildinfoFn`.
 * @param {string} rootDir
 * @returns {string[]}
 */
export function listTsbuildinfoFiles(rootDir) {
  /** @type {string[]} */
  const found = [];
  const skip = new Set(["node_modules", ".git", ".worktrees", ".pnpm-store"]);
  const stack = [rootDir];
  for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
    const { dirs, hits } = scanDirOnce(dir, skip);
    stack.push(...dirs);
    found.push(...hits);
  }
  return found;
}

/**
 * Build the pre-walk heal set with production seams.
 * `stateDir` is where the daemon pid + machine config live
 * (`MINSKY_STATE_DIR`, default `~/.minsky` — same resolution as
 * bin/minsky); host-scoped state.json lives under `<host>/.minsky/`.
 * @param {{ hostDir: string; stateDir: string }} args
 * @returns {DispatchableHeal[]}
 */
export function buildPreWalkHeals({ hostDir, stateDir }) {
  /** @type {import("../novel/observer/heals/dist/heal-stale-pid.js").StalePidSeams} */
  const stalePidSeams = {
    pidFilePath: join(stateDir, "daemon.pid"),
    readFileSyncFn: (path, encoding) => readFileSync(path, encoding),
    existsSyncFn: existsSync,
    unlinkSyncFn: unlinkSync,
    killFn: (pid, signal) => {
      process.kill(pid, signal);
    },
  };
  /** @type {import("../novel/observer/heals/dist/heal-corrupt-state-json.js").CorruptStateJsonSeams} */
  const corruptStateSeams = {
    stateFilePath: join(hostDir, ".minsky", "state.json"),
    nowFn: Date.now,
    existsSyncFn: existsSync,
    readFileSyncFn: (path, encoding) => readFileSync(path, encoding),
    writeFileSyncFn: writeFileSync,
    renameSyncFn: renameSync,
  };
  /** @type {import("../novel/observer/heals/dist/heal-partial-config-write.js").PartialConfigWriteSeams} */
  const partialConfigSeams = {
    configFilePath: process.env["MINSKY_CONFIG"] ?? join(stateDir, "config.json"),
    nowFn: Date.now,
    existsSyncFn: existsSync,
    readFileSyncFn: (path, encoding) => readFileSync(path, encoding),
    writeFileSyncFn: writeFileSync,
    renameSyncFn: renameSync,
  };
  return [
    {
      id: "stale-pid",
      fixApplied: "heal-stale-pid",
      detect: () => healStalePid.detect(stalePidSeams),
      apply: () => healStalePid.apply(stalePidSeams),
      verify: () => healStalePid.verify(stalePidSeams),
    },
    {
      id: "corrupt-state-json",
      fixApplied: "heal-corrupt-state-json",
      detect: () => healCorruptStateJson.detect(corruptStateSeams),
      apply: () => healCorruptStateJson.apply(corruptStateSeams),
      verify: () => healCorruptStateJson.verify(corruptStateSeams),
    },
    {
      id: "partial-config-write",
      fixApplied: "heal-partial-config-write",
      detect: () => healPartialConfigWrite.detect(partialConfigSeams),
      apply: () => healPartialConfigWrite.apply(partialConfigSeams),
      verify: () => healPartialConfigWrite.verify(partialConfigSeams),
    },
  ];
}

/**
 * Build the pre-spawn heal set with production seams. `worktreeDir` is
 * the freshly created `.worktrees/<branch>` dir the iteration is about
 * to spawn an agent into.
 * @param {{ worktreeDir: string }} args
 * @returns {DispatchableHeal[]}
 */
export function buildPreSpawnHeals({ worktreeDir }) {
  /** @type {import("../novel/observer/heals/dist/heal-worktree-missing-node-modules.js").WorktreeMissingSeams} */
  const missingNodeModulesSeams = {
    cwd: worktreeDir,
    existsSyncFn: existsSync,
    execFn: (command, args, options) => {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
  /** @type {import("../novel/observer/heals/dist/heal-stale-tsbuildinfo.js").StaleTsbuildinfoSeams} */
  const staleTsbuildinfoSeams = {
    hostDir: worktreeDir,
    currentNodeMajor: process.versions.node.split(".")[0] ?? "20",
    listTsbuildinfoFn: listTsbuildinfoFiles,
    readFileSyncFn: (path, encoding) => readFileSync(path, encoding),
    unlinkSyncFn: unlinkSync,
    existsSyncFn: existsSync,
  };
  return [
    {
      id: "missing-node-modules",
      fixApplied: "heal-worktree-missing-node-modules",
      detect: () => healWorktreeMissingNodeModules.detect(missingNodeModulesSeams),
      apply: () => healWorktreeMissingNodeModules.apply(missingNodeModulesSeams),
      verify: () => healWorktreeMissingNodeModules.verify(missingNodeModulesSeams),
    },
    {
      id: "stale-tsbuildinfo",
      fixApplied: "heal-stale-tsbuildinfo",
      detect: () => healStaleTsbuildinfo.detect(staleTsbuildinfoSeams),
      apply: () => healStaleTsbuildinfo.apply(staleTsbuildinfoSeams),
      verify: () => healStaleTsbuildinfo.verify(staleTsbuildinfoSeams),
    },
  ];
}

/**
 * One heal's detect → apply → verify cycle. Returns null when the
 * failure class is not present (no-op — nothing to record).
 * @param {{ heal: DispatchableHeal; host: string; nowFn: () => number }} args
 * @returns {{
 *   event: import("../novel/observer/heals/dist/types.js").HealEvent;
 *   outcome: "healed" | "verified-failed";
 *   durationMs: number;
 * } | null}
 */
function runHealCycle({ heal, host, nowFn }) {
  const tsObservedMs = nowFn();
  const detection = heal.detect();
  if (!detection.present) return null;
  heal.apply();
  const verified = heal.verify();
  const tsFixedMs = nowFn();
  /** @type {"healed" | "verified-failed"} */
  const outcome = verified.healed ? "healed" : "verified-failed";
  const event = buildHealEvent({
    tsObservedMs,
    tsFixedMs,
    failureClass: heal.id,
    fixApplied: heal.fixApplied,
    host,
    outcome,
  });
  return { event, outcome, durationMs: tsFixedMs - tsObservedMs };
}

/**
 * Run every heal in `heals`: detect → apply → verify, record fired
 * heals to the ledger, log one stderr line per fired heal. A throw in
 * any single heal is contained (logged, next heal still runs) — rule #6.
 * @param {{
 *   heals: DispatchableHeal[];
 *   hostDir: string;
 *   host: string;
 *   nowFn?: () => number;
 *   logFn?: (line: string) => void;
 * }} args
 * @returns {{ id: string; outcome: "healed" | "verified-failed" }[]} fired heals
 */
export function dispatchHeals({ heals, hostDir, host, nowFn = Date.now, logFn }) {
  const log = logFn ?? ((/** @type {string} */ line) => console.error(line));
  /** @type {{ id: string; outcome: "healed" | "verified-failed" }[]} */
  const fired = [];
  for (const heal of heals) {
    try {
      const result = runHealCycle({ heal, host, nowFn });
      if (result === null) continue;
      recordHealEvent({
        event: result.event,
        seams: {
          ledgerPath: join(hostDir, ".minsky", "heal-events.jsonl"),
          appendFileSyncFn: appendFileSync,
          mkdirSyncFn: mkdirSync,
          existsSyncFn: existsSync,
          dirnameFn: dirname,
        },
      });
      fired.push({ id: heal.id, outcome: result.outcome });
      log(`heal-dispatch: ${heal.id} ${result.outcome} (${result.durationMs}ms)`);
      // rule-6: handled-locally — one heal's I/O throw must not abort the
      // rest of the sweep nor the caller's walk; the dispatcher's whole
      // contract is exit-0-always.
    } catch (err) {
      log(`heal-dispatch: ${heal.id} errored: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return fired;
}

// CLI entrypoint — only runs when invoked directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = process.argv.slice(2);
    let hostDir = process.cwd();
    let boundary = "pre-walk";
    /** @type {string | null} */
    let worktreeDir = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--host") hostDir = args[++i] ?? hostDir;
      else if (a?.startsWith("--host=")) hostDir = a.slice("--host=".length);
      else if (a === "--boundary") boundary = args[++i] ?? boundary;
      else if (a?.startsWith("--boundary=")) boundary = a.slice("--boundary=".length);
      else if (a === "--worktree") worktreeDir = args[++i] ?? null;
      else if (a?.startsWith("--worktree=")) worktreeDir = a.slice("--worktree=".length);
      else if (a === "--help" || a === "-h") {
        console.info(
          "Usage: heal-dispatch.mjs [--host <dir>] --boundary pre-walk|pre-spawn [--worktree <dir>]",
        );
        process.exit(0);
      }
    }
    hostDir = resolve(hostDir);
    const stateDir = process.env["MINSKY_STATE_DIR"] ?? join(homedir(), ".minsky");

    /** @type {DispatchableHeal[]} */
    let heals = [];
    if (boundary === "pre-walk") {
      heals = buildPreWalkHeals({ hostDir, stateDir });
    } else if (boundary === "pre-spawn") {
      if (worktreeDir) {
        heals = buildPreSpawnHeals({ worktreeDir: resolve(worktreeDir) });
      } else {
        console.error("heal-dispatch: --boundary pre-spawn requires --worktree <dir>; skipping");
      }
    } else {
      console.error(`heal-dispatch: unknown boundary ${boundary}; skipping`);
    }
    dispatchHeals({ heals, hostDir, host: hostname() });
    // rule-6: handled-locally — exit-0-always contract; a dispatcher crash
    // must never take the supervisor loop down with it.
  } catch (err) {
    console.error(
      `heal-dispatch: dispatcher error (ignored): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  process.exit(0);
}
