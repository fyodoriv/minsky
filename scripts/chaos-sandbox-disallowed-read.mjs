#!/usr/bin/env node
// @ts-check
// `scripts/chaos-sandbox-disallowed-read.mjs` — operator-facing chaos test
// for `supervisor-sandbox-syscall-restriction` (TASKS.md). It is the macOS
// half of the task's `**Measurement**`:
//
//   node scripts/chaos-sandbox-disallowed-read.mjs --json
//     → {disallowed_read_denied:true, allowed_read_permitted:true, toolchain_probe_permitted:true, skipped:false}
//
// Steady-state hypothesis (Basiri et al., "Principles of Chaos Engineering",
// IEEE Software 2016): under the shipped `(deny default)` SBPL profile
// `distribution/launchd/com.minsky.tick-loop.sb`, a child process that tries
// to read a path OUTSIDE the supervisor's allow-list (`~/.ssh/known_hosts`)
// is denied (nonzero exit / EPERM), while a child reading an allow-listed
// repo path (`README.md`) succeeds (exit 0), and an operator-toolchain child
// (`xcrun --find git`) succeeds (exit 0). The fault injected is the disallowed
// read itself; the assertion is that the sandbox holds the trust boundary
// documented in docs/security/supervisor-sandbox.md without breaking git/gh.
//
// Pattern conformance (vision.md § "Pattern conformance index"):
//   - Chaos engineering — steady-state hypothesis + fault injection +
//     assertion against the steady state. The pure decision
//     (`assessSandboxProbes`) is exported so the paired .test.mjs drives
//     every branch deterministically without spawning `sandbox-exec`.
//   - Graceful degradation (vision.md rule #7) — on a non-macOS host, or
//     when `sandbox-exec` / `~/.ssh/known_hosts` is absent, the harness
//     reports `skipped:true` and exits 0 rather than false-failing CI on
//     Linux runners. A skip is loud (it prints WHY) — never silent.
//
// Exit 0 iff the steady state holds OR the probe is legitimately skipped;
// 1 when the sandbox FAILED to deny the disallowed read (the dangerous
// regression this chaos test exists to catch).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PROFILE_PATH = resolve(REPO_ROOT, "distribution", "launchd", "com.minsky.tick-loop.sb");

/**
 * The path a regression would try to exfiltrate — outside the supervisor's
 * stated trust boundary, so the sandbox MUST deny it.
 */
export const DISALLOWED_PATH = "~/.ssh/known_hosts";

/**
 * An allow-listed read used as the positive control: if THIS is denied the
 * profile is too tight (a false-positive EPERM), which is a different bug
 * but still a failure of the steady state.
 */
export const ALLOWED_REL_PATH = "README.md";

/**
 * @typedef {object} ProbeResult
 * @property {number | null} exitCode  null when the binary couldn't spawn
 * @property {string} [reason]         set when the probe was skipped
 */

/**
 * @typedef {object} SandboxAssessment
 * @property {boolean} disallowed_read_denied
 * @property {boolean} allowed_read_permitted
 * @property {boolean} toolchain_probe_permitted
 * @property {boolean} skipped
 * @property {string} [skip_reason]
 * @property {boolean} ok   the overall steady-state verdict
 */

/**
 * Pure decision over the two probe results (Basiri assertion). Separated
 * from the I/O so the paired test pins every branch without spawning.
 *
 * Steady state holds when the disallowed read was DENIED (nonzero exit), the
 * allowed read was PERMITTED (exit 0), and the operator toolchain probe was
 * PERMITTED (exit 0). A `skipped` probe yields `ok:true` (graceful degrade —
 * rule #7) but flags the skip so the operator sees it.
 *
 * @param {{ disallowed: ProbeResult, allowed: ProbeResult, toolchain: ProbeResult, skip?: string }} input
 * @returns {SandboxAssessment}
 */
export function assessSandboxProbes({ disallowed, allowed, toolchain, skip }) {
  if (skip !== undefined) {
    return {
      disallowed_read_denied: false,
      allowed_read_permitted: false,
      toolchain_probe_permitted: false,
      skipped: true,
      skip_reason: skip,
      ok: true,
    };
  }
  // Denied == any nonzero exit (sandbox-exec surfaces EPERM as a nonzero
  // child exit). A null exit (binary failed to spawn) is treated as NOT a
  // valid denial — the probe couldn't establish the steady state.
  const disallowed_read_denied = disallowed.exitCode !== null && disallowed.exitCode !== 0;
  const allowed_read_permitted = allowed.exitCode === 0;
  const toolchain_probe_permitted = toolchain.exitCode === 0;
  return {
    disallowed_read_denied,
    allowed_read_permitted,
    toolchain_probe_permitted,
    skipped: false,
    ok: disallowed_read_denied && allowed_read_permitted && toolchain_probe_permitted,
  };
}

/**
 * Resolve why the probe should be skipped on this host, or `undefined` to
 * run it. Pure over the injected predicates so the test drives each branch.
 *
 * @param {{
 *   platform?: string,
 *   sandboxExecExists?: boolean,
 *   profileExists?: boolean,
 *   disallowedTargetExists?: boolean,
 * }} env
 * @returns {string | undefined}
 */
export function resolveSkipReason({
  platform = process.platform,
  sandboxExecExists = existsSync("/usr/bin/sandbox-exec"),
  profileExists = existsSync(PROFILE_PATH),
  disallowedTargetExists = existsSync(resolveHome(DISALLOWED_PATH)),
} = {}) {
  if (platform !== "darwin") return `not macOS (platform=${platform}); sandbox-exec is macOS-only`;
  if (!sandboxExecExists) return "/usr/bin/sandbox-exec not present on this host";
  if (!profileExists) return `SBPL profile missing at ${PROFILE_PATH}`;
  if (!disallowedTargetExists) {
    return `${DISALLOWED_PATH} does not exist — no disallowed target to probe`;
  }
  return undefined;
}

/**
 * Expand a leading `~/` to the operator's HOME.
 * @param {string} p
 * @returns {string}
 */
export function resolveHome(p) {
  const home = process.env["HOME"] ?? "";
  return p.startsWith("~/") ? resolve(home, p.slice(2)) : p;
}

/**
 * Run one `sandbox-exec -f <profile> <argv...>` probe. I/O boundary — never
 * called by the test (which injects ProbeResults directly).
 *
 * @param {string[]} argv
 * @returns {ProbeResult}
 */
function runProbe(argv) {
  const home = process.env["HOME"] ?? "";
  const r = spawnSync(
    "/usr/bin/sandbox-exec",
    ["-D", `MINSKY_HOME=${REPO_ROOT}`, "-D", `HOME=${home}`, "-f", PROFILE_PATH, ...argv],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  // spawnSync sets `.error` (and status null) when the binary itself can't
  // run; otherwise `.status` is the child exit code.
  return { exitCode: r.error ? null : (r.status ?? null) };
}

/**
 * @returns {SandboxAssessment}
 */
export function runChaos() {
  const skip = resolveSkipReason();
  if (skip !== undefined) {
    return assessSandboxProbes({
      disallowed: { exitCode: null },
      allowed: { exitCode: null },
      toolchain: { exitCode: null },
      skip,
    });
  }
  const disallowed = runProbe(["/bin/cat", resolveHome(DISALLOWED_PATH)]);
  const allowed = runProbe(["/bin/cat", resolve(REPO_ROOT, ALLOWED_REL_PATH)]);
  const toolchain = runProbe(["/usr/bin/xcrun", "--find", "git"]);
  return assessSandboxProbes({ disallowed, allowed, toolchain });
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("chaos-sandbox-disallowed-read.mjs");
if (invokedDirectly) {
  const json = process.argv.includes("--json");
  const result = runChaos();
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.skipped) {
    process.stdout.write(`chaos-sandbox-disallowed-read: SKIPPED — ${result.skip_reason}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `chaos-sandbox-disallowed-read: OK — ${DISALLOWED_PATH} denied (EPERM), ${ALLOWED_REL_PATH} permitted, xcrun toolchain probe permitted under (deny default) profile.\n`,
    );
  } else {
    process.stderr.write(
      `chaos-sandbox-disallowed-read: FAIL — disallowed_read_denied=${result.disallowed_read_denied} allowed_read_permitted=${result.allowed_read_permitted} toolchain_probe_permitted=${result.toolchain_probe_permitted}. The sandbox did not hold the supervisor trust boundary without breaking the operator toolchain (docs/security/supervisor-sandbox.md).\n`,
    );
  }
  // Self-check: the profile must exist and open with (deny default) even when
  // the live probe is skipped, so a Linux CI run still pins the artifact.
  if (existsSync(PROFILE_PATH)) {
    const body = readFileSync(PROFILE_PATH, "utf8");
    if (!body.includes("(deny default)")) {
      process.stderr.write(
        "chaos-sandbox-disallowed-read: FAIL — profile no longer opens with `(deny default)`.\n",
      );
      process.exit(1);
    }
  }
  process.exit(result.ok ? 0 : 1);
}
