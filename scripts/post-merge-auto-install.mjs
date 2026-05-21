#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-20 operator "let's get stuff auto-installed on pull unless you override it" -->
//
// Post-merge / post-rewrite git hook helper. After every `git pull`
// (merge or rebase path), this script decides what — if anything —
// should be auto-installed so the operator picks up changes without a
// manual step.
//
// Default-by-default discipline (rule #16 / vision.md § 11): the
// burden of proof is on the opt-in side. If a pull touches
// `pnpm-lock.yaml`, `package.json`, `bin/minsky`, or
// `distribution/systemd/*.service`, the matching install step runs
// automatically. The operator-visible side effect is a one-line
// summary; failures are advisory (rule #6 — never block a git
// operation).
//
// Override mechanism (per rule #16 — every default ships with an
// opt-out for debugging only):
//   1. `MINSKY_NO_AUTO_INSTALL=1` env var (one-shot session opt-out).
//   2. `~/.minsky/no-auto-install` sentinel file (per-machine
//      persistent opt-out).
//   3. `CI=true` env auto-skip (auto-install is for operator
//      machines; CI runs its own setup).
//
// Pattern: pure decision (`decideActions`) over a snapshot +
// thin I/O wrapper (`runAutoInstall`) — same shape as
// `auto-merge-clean-prs`, `local-gate-merge`, the rule-lint
// substrate (rule #2 + rule #10). The seam is the `actions` array:
// tests inject the snapshot and assert the actions; production
// executes each action via `execFileSync`.
//
// Source: vision.md § 11 (default by default — "auto-installed on
// first run, not a separate install step"); the env-var propagation
// fix shipped in PR #666 made the launchd plist generator non-trivial,
// and without auto-deploy on pull every operator would need to remember
// to re-run `minsky install-daemon` after every pull that touches the
// generator. That's exactly the "remember-to-reinstall" cost rule #16
// forbids.
//
// Pivot (rule #9): if auto-install fires more than 1 false-positive
// regen per week (e.g. `bin/minsky` changed but the install-daemon
// section didn't), tighten the trigger to grep for the
// `install-daemon)` shell case body explicitly. If it surfaces ≥1
// broken install per month (a regen leaves the system worse than
// before), gate the entire mechanism behind a positive opt-in
// (`MINSKY_AUTO_INSTALL=1` instead of opt-out).
//
// Measurement: `git log --since="30 days ago" --grep="auto-install"
// --oneline | wc -l` (the operator-visible commit trail of regens
// caused by this hook); plus a future telemetry counter at
// `~/.minsky/auto-install.jsonl` once the supervisor lands.
//
// Anchor: rule #16 (default by default); rule #6 (let-it-crash AT
// the right boundary — never block a git operation); rule #10
// (deterministic — same input → same output, no LLM in the chain).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";

/**
 * @typedef {Object} DecideInput
 * @property {readonly string[]} changedFiles  POSIX-relative paths of files changed in the pull.
 * @property {Readonly<Record<string, string | undefined>>} env
 * @property {boolean} sentinelExists  `~/.minsky/no-auto-install` file exists.
 * @property {boolean} daemonRunning   `pgrep -f minsky-run` returns non-empty.
 * @property {boolean} plistExists     `~/Library/LaunchAgents/com.minsky.daemon.plist` exists.
 * @property {NodeJS.Platform | string} platform  `os.platform()` output.
 */

/**
 * @typedef {(
 *   | { kind: "pnpm-install" }
 *   | { kind: "regen-plist", warnDaemonRunning: boolean }
 *   | { kind: "systemctl-reload" }
 *   | { kind: "pre-pr-lint-fast" }
 * )} Action
 */

/**
 * @typedef {Object} DecideResult
 * @property {boolean} skip
 * @property {string} [skipReason]
 * @property {Action[]} actions
 */

/**
 * Pure: check the three override gates. Returns the skip result if any
 * gate fires, undefined otherwise. Extracted so `decideActions` keeps
 * cognitive complexity ≤10 (matches the pattern in `applyFlag` etc.).
 * @param {DecideInput} input
 * @returns {DecideResult | undefined}
 */
function checkOverrides(input) {
  if (input.env["MINSKY_NO_AUTO_INSTALL"] === "1") {
    return { skip: true, skipReason: "MINSKY_NO_AUTO_INSTALL=1", actions: [] };
  }
  // Note: don't conflate "0" with "1"; only `=1` opts out (the operator's
  // intent must be explicit — silent default-on otherwise per rule #16).
  if (input.env["CI"] === "true" || input.env["CI"] === "1") {
    return { skip: true, skipReason: "CI environment", actions: [] };
  }
  if (input.sentinelExists) {
    return {
      skip: true,
      skipReason: "~/.minsky/no-auto-install sentinel file present",
      actions: [],
    };
  }
  return undefined;
}

/**
 * Pure: turn the env+filesystem snapshot into the action list.
 * @param {DecideInput} input
 * @returns {DecideResult}
 */
export function decideActions(input) {
  const override = checkOverrides(input);
  if (override) return override;

  /** @type {Action[]} */
  const actions = [];

  const changed = new Set(input.changedFiles);
  /** @param {(f: string) => boolean} predicate */
  const anyChange = (predicate) => input.changedFiles.some(predicate);

  // 1. pnpm install — only when the lockfile or any package.json changed.
  //    Fires across platforms (darwin / linux / win32) — pnpm is portable.
  if (
    changed.has("pnpm-lock.yaml") ||
    anyChange((/** @type {string} */ f) => f === "package.json" || f.endsWith("/package.json"))
  ) {
    actions.push({ kind: "pnpm-install" });
  }

  // 2. Regenerate the launchd plist (macOS only; Linux uses systemd).
  //    Triggered by any change to `bin/minsky` (the plist generator
  //    lives in the `install-daemon)` shell case there). We don't try
  //    to grep for the specific case body — over-narrow triggers miss
  //    legitimate plist-affecting refactors. The pivot threshold is
  //    1 false-positive regen / week (rule #9 above).
  //
  //    `plistExists: false` short-circuits — if the operator hasn't
  //    installed the daemon yet, we don't auto-install it on their
  //    behalf (that's surprising; first-install must be explicit).
  if (input.platform === "darwin" && input.plistExists && changed.has("bin/minsky")) {
    actions.push({ kind: "regen-plist", warnDaemonRunning: input.daemonRunning });
  }

  // 3. systemctl --user daemon-reload (Linux only).
  //    Triggered by changes to the unit / target files. Run scripts
  //    (`run-*.sh`) don't need a reload — systemd re-reads them on
  //    each unit start.
  if (
    input.platform === "linux" &&
    anyChange((/** @type {string} */ f) =>
      /^distribution\/systemd\/.+\.(service|target|socket|timer)$/.test(f),
    )
  ) {
    actions.push({ kind: "systemctl-reload" });
  }

  // 4. Sanity check — run the fast lint stack ONLY when something
  //    material was already going to install. Doc-only or TASKS.md-only
  //    pulls don't need the lint (fast but still ~10s; rule #6 forbids
  //    busywork). The lint must run AFTER the install steps so it
  //    sees the rebuilt dist/.
  if (actions.length > 0) {
    actions.push({ kind: "pre-pr-lint-fast" });
  }

  return { skip: false, actions };
}

// ---- I/O wrapper ------------------------------------------------------

const REPO_ROOT = (() => {
  // The script lives at `<repo>/scripts/post-merge-auto-install.mjs`.
  // Resolve the repo root via the script's own URL so this works on
  // every operator's machine (no hardcoded paths — rule #1 fallout
  // of the `local-gate-merge-minsky-home-hardcoded-path` heal).
  const here = new URL(".", import.meta.url).pathname;
  return join(here, "..");
})();

/**
 * Resolve the changed-file list from git. Lefthook passes prev/new
 * SHAs as `$1` / `$2` for post-merge / post-rewrite, but the SHAs
 * differ in shape between hooks; the safest cross-hook strategy is
 * to diff against the previous HEAD via the reflog notation
 * (`HEAD\u0040{1}` — the previous HEAD position), which works for
 * both merge and rebase paths.
 * @returns {string[]}
 */
function resolveChangedFiles() {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "@{1}", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    // First-clone or detached state — nothing to diff against.
    return [];
  }
}

/**
 * @returns {boolean}
 */
function detectDaemonRunning() {
  try {
    execFileSync("pgrep", ["-f", "cross-repo-runner/bin/minsky-run"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run an external command with inherited stdio. Catches every error
 * (rule #6 — never block git) and prints `warnMsg` if the command
 * failed. The "best-effort" wrapper used by every action handler.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, warnMsg: string }} opts
 * @returns {boolean} true if the command exited 0, false otherwise.
 */
function bestEffortExec(command, args, opts) {
  try {
    execFileSync(command, [...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      ...(opts.env ? { env: opts.env } : {}),
    });
    return true;
  } catch {
    console.warn(opts.warnMsg);
    return false;
  }
}

/** @type {{ [K in Action["kind"]]: (action: Extract<Action, { kind: K }>) => void }} */
const ACTION_HANDLERS = {
  "pnpm-install": () => {
    // `console.info` (not `console.log`): biome's `noConsoleLog` warns
    // that `console.log` reads as debug output; these lines are
    // intentional operator-facing status notifications, so `.info`
    // is the linter-approved channel. Healed 2026-05-20 to unblock
    // pre-pr-lint --stage=fast on main (rule #17 proactive healing).
    console.info("  → pnpm install (lockfile or package.json changed)…");
    bestEffortExec("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
      warnMsg: "  ⚠ pnpm install failed — run `pnpm install` manually to refresh dist/.",
    });
  },
  "regen-plist": (action) => {
    console.info("  → minsky install-daemon (regenerate launchd plist)…");
    const ok = bestEffortExec(join(REPO_ROOT, "bin", "minsky"), ["install-daemon"], {
      env: { ...process.env, MINSKY_INSTALL_DAEMON_QUIET: "1" },
      warnMsg: "  ⚠ install-daemon failed — run `minsky install-daemon` manually if needed.",
    });
    if (ok && action.warnDaemonRunning) {
      console.info(
        "  ⓘ daemon is currently running — restart with `minsky update` to pick up the new plist.",
      );
    }
  },
  "systemctl-reload": () => {
    console.info("  → systemctl --user daemon-reload (systemd unit changed)…");
    bestEffortExec("systemctl", ["--user", "daemon-reload"], {
      warnMsg: "  ⚠ systemctl daemon-reload failed — run it manually if needed.",
    });
  },
  "pre-pr-lint-fast": () => {
    console.info("  → pnpm pre-pr-lint --stage=fast (sanity check)…");
    bestEffortExec("pnpm", ["pre-pr-lint", "--stage=fast"], {
      warnMsg: "  ⚠ pre-pr-lint --stage=fast reported issues — see output above. Not blocking.",
    });
  },
};

/**
 * Dispatch one action via the per-kind handler table. Pure routing —
 * the table itself enforces exhaustiveness via the indexed `Action`
 * union, so adding a new kind without a handler is a TS error.
 * @param {Action} action
 */
function executeAction(action) {
  /** @type {(a: Action) => void} */
  const handler = /** @type {(a: Action) => void} */ (ACTION_HANDLERS[action.kind]);
  handler(action);
}

/**
 * Top-level orchestrator. Reads env + filesystem, calls
 * `decideActions`, executes the result. ALWAYS exits 0 — rule #6,
 * never block a git operation.
 */
export function runAutoInstall() {
  const sentinelPath = join(homedir(), ".minsky", "no-auto-install");
  const plistPath = join(homedir(), "Library", "LaunchAgents", "com.minsky.daemon.plist");
  const result = decideActions({
    changedFiles: resolveChangedFiles(),
    env: process.env,
    sentinelExists: existsSync(sentinelPath),
    daemonRunning: detectDaemonRunning(),
    plistExists: existsSync(plistPath),
    platform: osPlatform(),
  });

  if (result.skip) {
    // Skip silently for the env-var / sentinel paths (the operator
    // explicitly opted out — don't spam them on every pull).
    return 0;
  }

  if (result.actions.length === 0) {
    // Nothing relevant changed — silent no-op.
    return 0;
  }

  console.info("minsky auto-install: applying post-pull updates…");
  for (const action of result.actions) {
    executeAction(action);
  }
  console.info("minsky auto-install: done.");
  return 0;
}

// CLI entry: invoked from lefthook post-merge / post-rewrite.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("post-merge-auto-install.mjs");

if (invokedDirectly) {
  process.exit(runAutoInstall());
}
