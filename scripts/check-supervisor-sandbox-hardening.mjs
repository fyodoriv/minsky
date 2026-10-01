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

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SYSTEMD_DIR = resolve(REPO_ROOT, "distribution", "systemd");
const LAUNCHD_DIR = resolve(REPO_ROOT, "distribution", "launchd");

/**
 * The macOS sandbox-exec (SBPL) profile that slices the tick-loop
 * supervisor's filesystem + network reach (`supervisor-sandbox-syscall-
 * restriction`). Filename is load-bearing: the plist's ProgramArguments
 * references it by name and this lint pins the cohesion.
 */
export const MACOS_SANDBOX_PROFILE = "com.minsky.tick-loop.sb";

/**
 * The launchd LaunchAgent whose ProgramArguments must wrap the supervisor
 * in `sandbox-exec -f <profile>`.
 */
export const MACOS_TICK_LOOP_PLIST = "com.minsky.tick-loop.plist";

/**
 * SBPL fail-safe-defaults header (Saltzer & Schroeder 1975). The profile
 * MUST open with `(deny default)` — an allow-default profile would silently
 * widen the supervisor's reach back to the operator's full UID, which is
 * exactly the regression this gate exists to catch.
 */
export const SBPL_DENY_DEFAULT = "(deny default)";

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
 * that reads/writes its working directory and spawns child processes
 * AND works under `systemctl --user` (which is how every Minsky
 * supervisor unit ships).
 *
 * Directives explicitly deferred:
 *   - `ProtectKernel{Tunables,Modules,Logs}=` — each implies a
 *     `CapabilityBoundingSet=~CAP_*` drop, which requires CAP_SETPCAP
 *     on the systemd manager. A user-mode session lacks CAP_SETPCAP, so
 *     the unit fails with `status=218/CAPABILITIES` at start
 *     (observed in linux-supervisor-integration CI 2026-05-07). They
 *     return when (and if) Minsky ever adds system-mode units.
 *   - `ProtectSystem=`, `ProtectHome=`, `RestrictAddressFamilies=`,
 *     `SystemCallFilter=` — these restrict filesystem/network access
 *     and are gated behind the dry-run + warn-only ramp described in
 *     the task block for `supervisor-sandbox-syscall-restriction`.
 */
export const REQUIRED_DIRECTIVES = Object.freeze([
  "NoNewPrivileges=yes",
  "PrivateTmp=yes",
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
 * @typedef {{ ok: true } | { ok: false, problems: string[] }} MacosCheckResult
 */

/**
 * Pure function. Asserts the macOS supervisor-sandbox slice is wired:
 *   1. the SBPL profile body exists and opens with `(deny default)`
 *      (fail-safe defaults — an allow-default profile is a silent
 *      reach-widening regression);
 *   2. the tick-loop launchd plist references the profile via a
 *      `sandbox-exec -f <...>/com.minsky.tick-loop.sb` ProgramArguments
 *      entry (so a future PR can't drop the wrap and lose the sandbox).
 *
 * Both inputs are injected so the test drives every branch without touching
 * the filesystem (rule #2 — I/O at the boundary).
 *
 * @param {{
 *   profileBody: string | undefined,
 *   plistBody: string | undefined,
 *   profileName?: string,
 * }} args
 * @returns {MacosCheckResult}
 */
export function checkMacosSandboxProfile({ profileBody, plistBody, profileName }) {
  const name = profileName ?? MACOS_SANDBOX_PROFILE;
  const problems = [...profileProblems(profileBody, name), ...plistProblems(plistBody, name)];
  if (problems.length === 0) return { ok: true };
  return { ok: false, problems };
}

/**
 * @param {string | undefined} profileBody
 * @param {string} name
 * @returns {string[]}
 */
function profileProblems(profileBody, name) {
  if (typeof profileBody !== "string" || profileBody.length === 0) {
    return [`SBPL profile ${name} is missing or empty`];
  }
  if (!profileBody.includes(SBPL_DENY_DEFAULT)) {
    return [
      `SBPL profile ${name} does not open with \`${SBPL_DENY_DEFAULT}\` — an allow-default profile silently widens the supervisor's reach (Saltzer & Schroeder 1975, fail-safe defaults)`,
    ];
  }
  return [];
}

/**
 * @param {string | undefined} plistBody
 * @param {string} name
 * @returns {string[]}
 */
function plistProblems(plistBody, name) {
  if (typeof plistBody !== "string" || plistBody.length === 0) {
    return [`plist ${MACOS_TICK_LOOP_PLIST} is missing or empty`];
  }
  /** @type {string[]} */
  const problems = [];
  if (!/\/usr\/bin\/sandbox-exec/.test(plistBody)) {
    problems.push(
      `plist ${MACOS_TICK_LOOP_PLIST} ProgramArguments does not invoke /usr/bin/sandbox-exec`,
    );
  }
  // The `-f <profile>` reference must name THIS profile so renaming the .sb
  // file without updating the plist (or vice versa) trips the gate.
  const refRe = new RegExp(`-f[\\s\\S]*?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (!refRe.test(plistBody)) {
    problems.push(`plist ${MACOS_TICK_LOOP_PLIST} does not reference the SBPL profile ${name}`);
  }
  return problems;
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

  if (!reportMacosSlice()) return 1;

  process.stdout.write(
    `supervisor-sandbox-hardening ok: all ${REQUIRED_DIRECTIVES.length} safe directives present in all ${REQUIRED_UNIT_FILES.length} systemd units; macOS ${MACOS_SANDBOX_PROFILE} (deny default) profile wired into ${MACOS_TICK_LOOP_PLIST}.\n`,
  );
  return 0;
}

/**
 * macOS slice: the launchd plist must wrap the supervisor in the
 * `(deny default)` sandbox-exec profile (`supervisor-sandbox-syscall-
 * restriction`). Reading the profile + plist is the I/O boundary; the pure
 * `checkMacosSandboxProfile` does the asserting. Returns true on pass,
 * false (after writing the diagnostics) on violation.
 *
 * @returns {boolean}
 */
function reportMacosSlice() {
  const profilePath = resolve(LAUNCHD_DIR, MACOS_SANDBOX_PROFILE);
  const plistPath = resolve(LAUNCHD_DIR, MACOS_TICK_LOOP_PLIST);
  const macos = checkMacosSandboxProfile({
    profileBody: existsSync(profilePath) ? readFileSync(profilePath, "utf8") : undefined,
    plistBody: existsSync(plistPath) ? readFileSync(plistPath, "utf8") : undefined,
  });
  if (macos.ok) return true;
  process.stderr.write("supervisor-sandbox-hardening (macOS) violation(s):\n");
  for (const problem of macos.problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  process.stderr.write(
    "\nFix: ship distribution/launchd/com.minsky.tick-loop.sb opening with `(deny default)` and wrap the plist's ProgramArguments with `/usr/bin/sandbox-exec -f <profile>`. Anchor: sandbox-exec(1) SBPL; Saltzer & Schroeder 1975 (least privilege); security-privacy task `supervisor-sandbox-syscall-restriction`.\n",
  );
  return false;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-supervisor-sandbox-hardening.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
