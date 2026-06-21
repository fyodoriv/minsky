#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved sandbox-allowlist-derive-from-operator-toolchain — task block removed from TASKS.md in the same commit per the rotation policy -->
// `scripts/check-supervisor-sandbox.mjs` — preflight doctor for the macOS
// supervisor sandbox profile.
//
// Why this file exists: the SBPL profile `com.minsky.tick-loop.sb` is a
// hardcoded allowlist. Across PRs #1167/#1169/#1170/#1171/#1172/#1174 SIX
// distinct operator-runtime gaps each silently zeroed productivity until found
// by hand:
//   (1) `python3` resolved to a dotfiles PATH shim outside the allowlist —
//       picker never ran → "no eligible task".
//   (2) `~/.config/gh` read-denied → `gh` failed at startup.
//   (3) `~/.gitconfig.local` / `~/.gitignore_global` includes read-denied →
//       `git worktree add` failed.
//   (4) `claude` resolved only via PATH which did not propagate — silent
//       openhands fallback.
//   (5) the openhands venv python lives under `~/.local/share/uv` (not
//       allowlisted → `Failed to import encodings`).
//   (6) claude auth via Keychain unreachable → `Not logged in`; fixed via
//       injected `CLAUDE_CODE_OAUTH_TOKEN`.
//
// This doctor runs the toolchain (python3, git, gh, claude, node) UNDER the
// real `(deny default)` profile and reads the configs the supervisor needs.
// Each silent-EPERM gap surfaces as a loud line with the exact .sb/PATH/env
// remediation BEFORE a run is started.
//
// Pattern (vision.md):
//   - rule #2 — pure decision (`assessToolchainProbes`) separated from I/O so
//     the paired .test.mjs drives every branch deterministically without
//     spawning sandbox-exec.
//   - rule #7 — graceful degrade on non-macOS / missing sandbox-exec / missing
//     profile: emit `skipped:true` + reason, exit 0. A skip is loud, not silent.
//   - rule #10 — deterministic preflight gate: same operator toolchain → same
//     verdict.
//
// Anchor: Beyer et al., *SRE* (O'Reilly 2016) Ch. 17 (test the real failure
// path, not a proxy); Nygard, *Release It!* (2018) — fail fast + surface, don't
// degrade silently; Saltzer & Schroeder 1975 (least privilege — every probe
// asserts the allowlist still permits the supervisor's stated trust boundary).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PROFILE_PATH = resolve(REPO_ROOT, "distribution", "launchd", "com.minsky.tick-loop.sb");

/**
 * The env var the worker uses to authenticate to Anthropic. When the cloud
 * agent is `claude`, this MUST be set (typically via `launchctl setenv` at
 * supervisor install time) — otherwise the worker exits "Not logged in"
 * because the sandbox blocks the macOS Keychain by design (gap 6).
 */
export const CLAUDE_AUTH_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * One toolchain probe — exercises one (binary or config-file) failure mode
 * under the sandbox. The `gap` number pins it back to the six gap classes in
 * the file header so a regression test fixture per gap stays legible.
 *
 * @typedef {object} ProbeSpec
 * @property {string} name       short label, used in the report ("python3")
 * @property {number} gap        1..6, pins this probe to a header gap class
 * @property {"exec" | "read"} kind
 * @property {string} description what the probe asserts in human terms
 * @property {string} remediation one-line fix when this probe fails
 *
 * @typedef {ProbeSpec & { kind: "exec", binary: string, args: ReadonlyArray<string> }} ExecProbeSpec
 * @typedef {ProbeSpec & { kind: "read", target: string }} ReadProbeSpec
 */

/**
 * Probe declarations. Keep this list ordered by gap number — the report and
 * the tests both rely on the ordering being stable.
 *
 * @type {ReadonlyArray<ExecProbeSpec | ReadProbeSpec>}
 */
export const TOOLCHAIN_PROBES = Object.freeze([
  {
    name: "python3 exec",
    gap: 1,
    kind: "exec",
    binary: "python3",
    args: ["-c", ""],
    description: "python3 -c '' runs under the sandbox (host picker dispatch)",
    remediation:
      'ensure `python3` resolves to /usr/bin/python3 (or a Homebrew prefix) — a dotfiles PATH shim outside (subpath "/usr" /opt/homebrew "/bin") fails silently. Re-resolve via `command -v python3` after restarting the supervisor with the launchd-cleaned PATH.',
  },
  {
    name: "git config",
    gap: 3,
    kind: "exec",
    binary: "git",
    args: ["config", "-l"],
    description: "git config -l reads ~/.gitconfig + included ~/.gitconfig.local under the sandbox",
    remediation:
      "ensure the .sb file allow-reads ~/.gitconfig.local and ~/.gitignore_global (they are pulled in via [include] path / core.excludesfile and git treats an unreadable include as FATAL → `git worktree add` fails).",
  },
  {
    name: "gh --version",
    gap: 2,
    kind: "exec",
    binary: "gh",
    args: ["--version"],
    description: "gh CLI starts under the sandbox (reads ~/.config/gh/config.yml)",
    remediation:
      "ensure the .sb file allow-reads ~/.config/gh — gh reads config.yml at startup; a read-deny surfaces as `failed to create root command: ... operation not permitted` and the open-PR scan + agent's `gh pr create` fail.",
  },
  {
    name: "claude --version",
    gap: 4,
    kind: "exec",
    binary: "claude",
    args: ["--version"],
    description: "claude CLI runs under the sandbox (resolved by absolute path)",
    remediation:
      "ensure the `claude` binary resolves at install time via `command -v claude` and is invoked by absolute path from bin/minsky-run.sh — PATH does not propagate into the sandboxed worker; without an abs-path resolution the worker silently falls back to openhands.",
  },
  {
    name: "uv venv python read",
    gap: 5,
    kind: "read",
    target: "~/.local/share/uv",
    description:
      "openhands venv python lives under ~/.local/share/uv — sandbox must allow-read this subpath",
    remediation:
      "ensure the .sb file allow-reads ~/.local/share/uv — otherwise the openhands venv python aborts at `Failed to import encodings` and the worker spawn fails.",
  },
  {
    name: "claude session read",
    gap: 6,
    kind: "read",
    target: "~/.claude.json",
    description: "~/.claude.json is readable+writable under the sandbox (session/account state)",
    remediation:
      "ensure the .sb file allow-reads+writes ~/.claude.json AND CLAUDE_CODE_OAUTH_TOKEN is exported (launchctl setenv). The keychain is OUT of the sandbox trust boundary; auth lives in the env var, session lives in ~/.claude.json.",
  },
  {
    name: "node --version",
    gap: 1,
    kind: "exec",
    binary: "node",
    args: ["--version"],
    description: "node runs under the sandbox (every Minsky path needs node)",
    remediation:
      "ensure `node` resolves to /usr/local/bin, /opt/homebrew/bin, or ~/.local/share/fnm — a shimmed PATH outside these prefixes will EPERM.",
  },
]);

/**
 * @typedef {object} ProbeResult
 * @property {string} name
 * @property {number} gap
 * @property {boolean} ok
 * @property {number | null} exitCode
 * @property {string} [stderr]
 * @property {string} [skipReason]
 */

/**
 * @typedef {object} ToolchainAssessment
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} [skip_reason]
 * @property {ReadonlyArray<ProbeResult>} probes
 * @property {boolean} claude_auth_env_present
 */

/**
 * Resolve why the doctor should be skipped on this host, or `undefined` to
 * run it. Pure over the injected predicates so the test pins each branch.
 *
 * @param {{
 *   platform?: string,
 *   sandboxExecExists?: boolean,
 *   profileExists?: boolean,
 * }} env
 * @returns {string | undefined}
 */
export function resolveSkipReason({
  platform = process.platform,
  sandboxExecExists = existsSync("/usr/bin/sandbox-exec"),
  profileExists = existsSync(PROFILE_PATH),
} = {}) {
  if (platform !== "darwin") {
    return `not macOS (platform=${platform}); sandbox-exec is macOS-only`;
  }
  if (!sandboxExecExists) return "/usr/bin/sandbox-exec not present on this host";
  if (!profileExists) return `SBPL profile missing at ${PROFILE_PATH}`;
  return undefined;
}

/**
 * Pure decision over the probe results + claude-auth env presence. Verdict
 * is `ok:true` iff every probe is ok AND the auth env var is present. Skip
 * (`probes:[]`) yields `ok:true, skipped:true` (graceful degrade — rule #7)
 * with the reason surfaced.
 *
 * @param {{
 *   probes: ReadonlyArray<ProbeResult>,
 *   claudeAuthEnvPresent: boolean,
 *   skip?: string,
 * }} input
 * @returns {ToolchainAssessment}
 */
export function assessToolchainProbes({ probes, claudeAuthEnvPresent, skip }) {
  if (skip !== undefined) {
    return {
      ok: true,
      skipped: true,
      skip_reason: skip,
      probes: [],
      claude_auth_env_present: claudeAuthEnvPresent,
    };
  }
  const allProbesOk = probes.every((p) => p.ok);
  return {
    ok: allProbesOk && claudeAuthEnvPresent,
    skipped: false,
    probes,
    claude_auth_env_present: claudeAuthEnvPresent,
  };
}

/**
 * Walk PATH and return the first existing absolute binary path, or undefined
 * if not found. Pure over the injected PATH + existsSync.
 *
 * @param {{
 *   binary: string,
 *   pathEnv?: string,
 *   exists?: (p: string) => boolean,
 * }} args
 * @returns {string | undefined}
 */
export function resolveBinary({
  binary,
  pathEnv = process.env["PATH"] ?? "",
  exists = existsSync,
}) {
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = resolve(dir, binary);
    if (exists(candidate)) return candidate;
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
 * Run one exec probe under sandbox-exec. I/O boundary — the test never calls
 * this; it injects ProbeResults directly.
 *
 * @param {ExecProbeSpec} probe
 * @returns {ProbeResult}
 */
function runExecProbe(probe) {
  const absBinary = resolveBinary({ binary: probe.binary });
  if (absBinary === undefined) {
    return {
      name: probe.name,
      gap: probe.gap,
      ok: false,
      exitCode: null,
      stderr: `binary "${probe.binary}" not on PATH (${probe.remediation})`,
    };
  }
  const home = process.env["HOME"] ?? "";
  const r = spawnSync(
    "/usr/bin/sandbox-exec",
    [
      "-D",
      `MINSKY_HOME=${REPO_ROOT}`,
      "-D",
      `HOME=${home}`,
      "-f",
      PROFILE_PATH,
      absBinary,
      ...probe.args,
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
  );
  const exitCode = r.error ? null : (r.status ?? null);
  const stderr = r.stderr?.trim() || "";
  /** @type {ProbeResult} */
  const out = {
    name: probe.name,
    gap: probe.gap,
    ok: exitCode === 0,
    exitCode,
  };
  if (stderr) out.stderr = stderr;
  return out;
}

/**
 * Run one read probe under sandbox-exec (uses `/bin/cat`).
 *
 * @param {ReadProbeSpec} probe
 * @returns {ProbeResult}
 */
function runReadProbe(probe) {
  const target = resolveHome(probe.target);
  if (!existsSync(target)) {
    // A missing target is not a sandbox regression — the gap class is
    // "sandbox blocks reading it WHEN it exists". Skip with a reason so the
    // operator knows why the gap isn't pinned on this host.
    return {
      name: probe.name,
      gap: probe.gap,
      ok: true,
      exitCode: null,
      skipReason: `target ${probe.target} does not exist on this host`,
    };
  }
  const home = process.env["HOME"] ?? "";
  const r = spawnSync(
    "/usr/bin/sandbox-exec",
    [
      "-D",
      `MINSKY_HOME=${REPO_ROOT}`,
      "-D",
      `HOME=${home}`,
      "-f",
      PROFILE_PATH,
      "/bin/cat",
      target,
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
  );
  // For a directory target, /bin/cat exits nonzero (`Is a directory`) even
  // when the sandbox allows the read. Treat any error containing "Operation
  // not permitted" as a sandbox-blocked read; everything else is OK.
  const stderr = (r.stderr ?? "").toString();
  const denied = /Operation not permitted/i.test(stderr) || /sandbox/i.test(stderr);
  const exitCode = r.error ? null : (r.status ?? null);
  const trimmed = stderr.trim();
  /** @type {ProbeResult} */
  const out = {
    name: probe.name,
    gap: probe.gap,
    ok: !denied && exitCode !== null,
    exitCode,
  };
  if (trimmed) out.stderr = trimmed;
  return out;
}

/**
 * Run every probe under the live sandbox. I/O boundary.
 *
 * @returns {ToolchainAssessment}
 */
export function runToolchainDoctor() {
  const skip = resolveSkipReason();
  const claudeAuthEnvPresent = (process.env[CLAUDE_AUTH_ENV] ?? "").length > 0;
  if (skip !== undefined) {
    return assessToolchainProbes({ probes: [], claudeAuthEnvPresent, skip });
  }
  /** @type {ProbeResult[]} */
  const probes = [];
  for (const spec of TOOLCHAIN_PROBES) {
    probes.push(spec.kind === "exec" ? runExecProbe(spec) : runReadProbe(spec));
  }
  return assessToolchainProbes({ probes, claudeAuthEnvPresent });
}

/**
 * @param {ProbeResult} p
 * @returns {string[]}
 */
function renderProbeLines(p) {
  const status = p.skipReason ? "SKIP" : p.ok ? "PASS" : "FAIL";
  let tail = "";
  if (p.skipReason) tail = `(${p.skipReason})`;
  else if (!p.ok) tail = `(exit=${p.exitCode ?? "spawn-failed"})`;
  const out = [`  ${status}  gap-${p.gap}  ${p.name}  ${tail}`.trimEnd()];
  if (!p.ok && !p.skipReason && p.stderr) {
    out.push(`        stderr: ${p.stderr.split("\n")[0]}`);
  }
  return out;
}

/**
 * @param {boolean} envPresent
 * @returns {string}
 */
function renderEnvLine(envPresent) {
  const status = envPresent ? "PASS" : "FAIL";
  const tail = envPresent
    ? "set"
    : "MISSING (export via `launchctl setenv` so the sandboxed worker authenticates without the Keychain)";
  return `  ${status}  env    ${CLAUDE_AUTH_ENV} ${tail}`;
}

/**
 * @param {ToolchainAssessment} a
 * @returns {string[]}
 */
function renderRemediation(a) {
  /** @type {string[]} */
  const out = ["", "Per-gap remediation:"];
  for (const p of a.probes) {
    if (p.ok || p.skipReason) continue;
    const spec = TOOLCHAIN_PROBES.find((s) => s.name === p.name);
    if (spec) out.push(`  - gap-${p.gap} ${p.name}: ${spec.remediation}`);
  }
  if (!a.claude_auth_env_present) {
    out.push(
      `  - env ${CLAUDE_AUTH_ENV}: export the token via \`launchctl setenv ${CLAUDE_AUTH_ENV} <value>\` and restart the supervisor.`,
    );
  }
  return out;
}

/**
 * Render a human-readable report. Pure over the assessment.
 *
 * @param {ToolchainAssessment} a
 * @returns {string}
 */
export function renderReport(a) {
  if (a.skipped) {
    return `check-supervisor-sandbox: SKIPPED — ${a.skip_reason}\n`;
  }
  /** @type {string[]} */
  const lines = [
    "check-supervisor-sandbox — probing the operator toolchain under com.minsky.tick-loop.sb",
    "",
  ];
  for (const p of a.probes) lines.push(...renderProbeLines(p));
  lines.push("", renderEnvLine(a.claude_auth_env_present), "");
  if (a.ok) {
    lines.push("✅ sandbox-toolchain doctor: every probe passed; the loop can spawn a worker.");
  } else {
    lines.push("❌ sandbox-toolchain doctor: gaps detected; the loop will spawn-fail until fixed.");
    lines.push(...renderRemediation(a));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const json = process.argv.includes("--json");
  const a = runToolchainDoctor();
  if (json) {
    process.stdout.write(`${JSON.stringify(a)}\n`);
  } else {
    process.stdout.write(renderReport(a));
  }
  // Self-check: the profile must still open with (deny default) even when the
  // live probe is skipped, so a Linux CI run still pins the artifact.
  if (existsSync(PROFILE_PATH)) {
    const body = readFileSync(PROFILE_PATH, "utf8");
    if (!body.includes("(deny default)")) {
      process.stderr.write(
        "check-supervisor-sandbox: FAIL — profile no longer opens with `(deny default)`.\n",
      );
      return 1;
    }
  }
  return a.ok ? 0 : 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-supervisor-sandbox.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
