#!/usr/bin/env node
// @ts-check
// Pattern: deterministic CI gate over the systemd unit-file hardening
// directives that ship with the Minsky supervisor.
//
// Source: rule #10 (vision.md § 10 — deterministic enforcement; every
//   prose-only invariant gets a deterministic linter); rule #13 item 3 (the
//   security-privacy minimum bar — sandboxing applied per
//   `supervisor-sandbox-syscall-restriction`); systemd.exec(5) man page
//   "Sandboxing" + "System Call Filtering" sections; Saltzer & Schroeder,
//   "The Protection of Information in Computer Systems", *Proc. IEEE*
//   63(9), 1975 (principle of least privilege).
//
// Why this gate exists: `supervisor-sandbox-syscall-restriction` is a
// staged task. The first stage (this PR) ships the *safe* set of
// hardening directives — those that improve `systemd-analyze security`'s
// exposure score without restricting filesystem/network access (which
// requires the dry-run + warn-only ramp described in the task's Pivot).
// Once the directives are present, a future PR or revert could silently
// remove them and lose the hardening with no signal. This linter pins
// the minimum set on every PR so the regression is loud, not silent.
//
// Pivot (rule #9, this gate): once the *extended* hardening stage lands
// (ProtectSystem=strict + RestrictAddressFamilies + SystemCallFilter),
// this script's `REQUIRED_DIRECTIVES` constant is extended in the same
// PR that ships the directives — never one without the other. If the
// staged ramp is abandoned (e.g., upstream removes a directive), this
// lint is retired in the same PR that removes the directive.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SYSTEMD_DIR = resolve(REPO_ROOT, "distribution", "systemd");

/**
 * Unit files that must carry the safe hardening directive set. Every
 * Minsky supervisor unit runs the same Node.js process model (long-lived,
 * spawns `claude --print` children, network-bound, writes to
 * `${MINSKY_HOME}` only); the directive set is therefore identical
 * across them.
 */
export const REQUIRED_UNIT_FILES = Object.freeze([
  "minsky-tick-loop.service",
  "minsky-budget-guard.service",
  "minsky-watchdog.service",
]);

/**
 * The safe hardening directive set. Each is a `Key=Value` line that must
 * appear verbatim in the unit's `[Service]` section. Drawn from
 * systemd.exec(5)'s "Sandboxing" stanza; every directive in this set is
 * documented as having no effect on a normal long-lived Node.js process
 * that reads/writes its working directory and spawns child processes.
 *
 * Directives that DO restrict filesystem/network access
 * (`ProtectSystem=`, `ProtectHome=`, `RestrictAddressFamilies=`,
 * `SystemCallFilter=`) are deliberately NOT in this set — they are
 * gated behind the dry-run + warn-only ramp described in the task block
 * for `supervisor-sandbox-syscall-restriction`.
 */
export const REQUIRED_DIRECTIVES = Object.freeze([
  "NoNewPrivileges=yes",
  "PrivateTmp=yes",
  "ProtectKernelTunables=yes",
  "ProtectKernelModules=yes",
  "ProtectKernelLogs=yes",
  "ProtectControlGroups=yes",
  "RestrictSUIDSGID=yes",
  "LockPersonality=yes",
  "RestrictRealtime=yes",
]);

/**
 * @typedef {{ ok: true } | { ok: false, missing: ReadonlyArray<{ unit: string, directive: string }> }} CheckResult
 */

/**
 * Per-unit check: which directives are missing from this unit's body.
 * Returns the empty array if the unit's contents include every
 * required directive, ignoring leading/trailing whitespace per line.
 *
 * @param {string | undefined} body
 * @param {ReadonlyArray<string>} directives
 * @returns {string[]}
 */
function missingDirectivesIn(body, directives) {
  if (typeof body !== "string") return [...directives];
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  return directives.filter((d) => !lines.includes(d));
}

/**
 * Pure function. Asserts that every `(unit, directive)` pair is present
 * in the unit-file contents map.
 *
 * @param {{
 *   unitContents: Record<string, string>,
 *   requiredUnits?: ReadonlyArray<string>,
 *   requiredDirectives?: ReadonlyArray<string>,
 * }} args
 * @returns {CheckResult}
 */
export function checkSupervisorSandboxHardening({
  unitContents,
  requiredUnits,
  requiredDirectives,
}) {
  const units = requiredUnits ?? REQUIRED_UNIT_FILES;
  const directives = requiredDirectives ?? REQUIRED_DIRECTIVES;
  const missing = units.flatMap((unit) =>
    missingDirectivesIn(unitContents[unit], directives).map((directive) => ({ unit, directive })),
  );
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

/**
 * @param {string} dir
 * @param {ReadonlyArray<string>} units
 * @returns {Record<string, string>}
 */
export function readUnitContents(dir, units) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const unit of units) {
    out[unit] = readFileSync(resolve(dir, unit), "utf8");
  }
  return out;
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  /** @type {Record<string, string>} */
  let unitContents;
  try {
    unitContents = readUnitContents(SYSTEMD_DIR, REQUIRED_UNIT_FILES);
  } catch (err) {
    process.stderr.write(
      `supervisor-sandbox-hardening: cannot read unit files under ${SYSTEMD_DIR}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  const result = checkSupervisorSandboxHardening({ unitContents });
  if (!result.ok) {
    process.stderr.write("supervisor-sandbox-hardening violation(s):\n");
    for (const { unit, directive } of result.missing) {
      process.stderr.write(`  - ${unit}: missing \`${directive}\`\n`);
    }
    process.stderr.write(
      "\nFix: add the missing directive(s) to the unit file's [Service] section. The full required set lives in scripts/check-supervisor-sandbox-hardening.mjs (REQUIRED_DIRECTIVES). Anchor: systemd.exec(5) sandboxing stanza; security-privacy task `supervisor-sandbox-syscall-restriction` stage 0.\n",
    );
    return 1;
  }
  process.stdout.write(
    `supervisor-sandbox-hardening ok: all ${REQUIRED_DIRECTIVES.length} safe directives present in all ${REQUIRED_UNIT_FILES.length} systemd units.\n`,
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-supervisor-sandbox-hardening.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
