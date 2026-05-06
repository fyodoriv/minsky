#!/usr/bin/env node
// <!-- scope: human-approved slice 5 of daemon-parallel-worktree-launch (operator 2026-05-06: ensure conflict resolution) -->
// Idempotent activation of the Mergiraf semantic merge driver registered in
// `.gitattributes`. Run on daemon startup (and ad-hoc by the operator) so
// auto-resolution is wired before the next conflict.
//
// Three-state exit: 0 = configured (driver installed AND git config set), 1 =
// binary missing (operator must install — prints command), 2 = git config set
// failed (probe returned non-zero — surfaces as visible-not-silent per Beyer
// SRE 2016 Ch. 6 silence-is-failure). Intended to be re-runnable: when run
// twice in a row with the binary present, second run is a no-op.
//
// Substrate slice 5 of `daemon-parallel-worktree-launch`; addresses operator
// directive 2026-05-06 — "ensure that minsky itself will be able to resolve
// git conflicts when it merges its work."

import { spawnSync } from "node:child_process";

/**
 * Pure decision: given a binary-presence probe + a git-config snapshot,
 * return the action plan (commands to run) and verdict.
 *
 * @param {{ binaryPresent: boolean, configuredDriver: string | undefined }} probe
 * @returns {{ verdict: "configured" | "binary-missing" | "needs-config", commands: readonly string[], installHint: string | null }}
 */
export function planMergirafSetup(probe) {
  if (!probe.binaryPresent) {
    return {
      verdict: "binary-missing",
      commands: [],
      installHint:
        "Install Mergiraf:\n  Homebrew:    brew install mergiraf\n  Cargo:       cargo install mergiraf\n  See https://mergiraf.org/installation.html for other platforms.",
    };
  }
  const driverCmd = "mergiraf merge --git %O %A %B -p %P -s %S -x %X -y %Y";
  if (probe.configuredDriver === driverCmd) {
    return { verdict: "configured", commands: [], installHint: null };
  }
  return {
    verdict: "needs-config",
    commands: [
      `git config merge.mergiraf.name "Mergiraf"`,
      `git config merge.mergiraf.driver "${driverCmd}"`,
      `git config merge.mergiraf.recursive "binary"`,
    ],
    installHint: null,
  };
}

function probeMergirafBinary() {
  const { status } = spawnSync("which", ["mergiraf"], { stdio: "ignore" });
  return status === 0;
}

function probeConfiguredDriver() {
  const result = spawnSync("git", ["config", "--get", "merge.mergiraf.driver"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function runCommand(cmd) {
  const result = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8", stdio: "inherit" });
  return result.status === 0;
}

function main() {
  const plan = planMergirafSetup({
    binaryPresent: probeMergirafBinary(),
    configuredDriver: probeConfiguredDriver(),
  });
  if (plan.verdict === "binary-missing") {
    console.error("setup-mergiraf: mergiraf binary not found on PATH.");
    if (plan.installHint) console.error(plan.installHint);
    console.error(
      "Once installed, re-run `node scripts/setup-mergiraf.mjs` to wire the merge driver.",
    );
    process.exit(1);
  }
  if (plan.verdict === "configured") {
    console.log("setup-mergiraf: already configured (no-op).");
    process.exit(0);
  }
  for (const cmd of plan.commands) {
    if (!runCommand(cmd)) {
      console.error(`setup-mergiraf: command failed: ${cmd}`);
      process.exit(2);
    }
  }
  console.log(
    "setup-mergiraf: configured. Mergiraf will auto-resolve conflicts on supported files.",
  );
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
