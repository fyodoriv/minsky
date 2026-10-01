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
// Source: vision.md §16 + §19: refreshing already-consented machine
// state is default-by-default, while first-time supervisor bootstrap
// remains operator-explicit. The env-var propagation fix shipped in
// PR #666 made the launchd plist generator non-trivial; without
// auto-deploy on pull, operators with an existing plist would need to
// remember `minsky install-daemon` after generator changes.
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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";

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
 *   | { kind: "request-daemon-restart", reason: string, changedFiles: readonly string[] }
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
  //    Triggered by any change to the CLI/plist generator or the bash
  //    runner it points launchd at. We don't try to grep for the specific
  //    case body — over-narrow triggers miss legitimate plist-affecting
  //    refactors. The pivot threshold is 1 false-positive regen / week
  //    (rule #9 above).
  //
  //    `plistExists: false` short-circuits — if the operator hasn't
  //    installed the daemon yet, we don't auto-install it on their
  //    behalf (that's surprising; first-install must be explicit).
  if (
    input.platform === "darwin" &&
    input.plistExists &&
    anyChange((/** @type {string} */ f) => isDaemonInstallRelevantFile(f))
  ) {
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

  // 4. Request daemon restart — when a pull lands code the running
  //    daemon would benefit from, write a sentinel file at
  //    `~/.minsky/restart-requested`. The daemon's tick-loop reads
  //    the sentinel between iterations and exits cleanly; launchd
  //    KeepAlive (or systemd Restart=always) then respawns the
  //    daemon with the new code. This makes `minsky update` redundant
  //    for the common case: an operator who `git pull`s and walks
  //    away returns to a daemon running latest code within one
  //    iteration-cycle. Rule #16 (default by default — the burden
  //    of proof is on the opt-in side; `minsky update` becomes the
  //    rare manual escape hatch, not the daily flow).
  //
  //    Extracted to {@link maybeRequestDaemonRestart} so `decideActions`
  //    stays under the cognitive-complexity cap (biome ≤ 10).
  const restartAction = maybeRequestDaemonRestart(input);
  if (restartAction !== null) actions.push(restartAction);

  // 5. Sanity check — run the fast lint stack ONLY when something
  //    material was already going to install. Doc-only or TASKS.md-only
  //    pulls don't need the lint (fast but still ~10s; rule #6 forbids
  //    busywork). The lint must run AFTER the install steps so it
  //    sees the rebuilt dist/.
  if (actions.length > 0) {
    actions.push({ kind: "pre-pr-lint-fast" });
  }

  return { skip: false, actions };
}

/**
 * Pure: surface a `request-daemon-restart` action when the snapshot
 * justifies one — daemon running AND the pull touched runtime code
 * (`bin/minsky`, `bin/minsky-run.sh`, `pnpm-lock.yaml`, daemon-called
 * scripts, or anything under `novel/**`).
 * Returns `null` otherwise. Extracted from {@link decideActions} so
 * the orchestrator stays under the cognitive-complexity cap.
 *
 * Trigger: daemon must be running (no daemon → no restart needed),
 * AND the pull touched runtime code — daemon entrypoints/scripts, anything
 * under `novel/**` (`.ts`/`.mjs`/`.js`), OR `pnpm-lock.yaml` (lockfile
 * changes almost always mean dependency code shifted under the
 * daemon). `bin/minsky` overlaps with the `regen-plist` trigger
 * above — after the plist is rewritten, the daemon must restart to
 * pick up the new launchd env. Without this restart, regen-plist
 * alone leaves the running daemon with stale env vars.
 *
 * @param {DecideInput} input
 * @returns {(Extract<Action, { kind: "request-daemon-restart" }>) | null}
 */
function maybeRequestDaemonRestart(input) {
  if (!input.daemonRunning) return null;
  const reason = detectRestartReason(input.changedFiles);
  if (reason === null) return null;
  return {
    kind: "request-daemon-restart",
    reason,
    changedFiles: filterRestartRelevantFiles(input.changedFiles),
  };
}

/**
 * Pure: classify whether a changed-file list warrants a daemon restart,
 * and if so, what one-line reason to surface in the sentinel + daemon
 * log. Returns `null` when no restart is needed (doc-only / TASKS.md-
 * only / unrelated changes). The reason string is operator-facing —
 * keep it short and concrete (one line, no period).
 * @param {readonly string[]} changedFiles
 * @returns {string | null}
 */
function detectRestartReason(changedFiles) {
  const changed = new Set(changedFiles);
  if (changed.has("bin/minsky")) return "bin/minsky changed";
  if (changed.has("bin/minsky-run.sh")) return "bin/minsky-run.sh changed";
  if (changed.has("pnpm-lock.yaml")) return "pnpm-lock.yaml changed";
  const scriptChange = changedFiles.find((/** @type {string} */ f) => isDaemonRuntimeScript(f));
  if (scriptChange !== undefined) return `daemon script changed (e.g. ${scriptChange})`;
  const novelChange = changedFiles.find((/** @type {string} */ f) =>
    /^novel\/.+\.(ts|mjs|js)$/.test(f),
  );
  if (novelChange !== undefined) return `novel/* changed (e.g. ${novelChange})`;
  return null;
}

/**
 * Pure: filter the changed-file list down to the subset that's actually
 * relevant to the restart reason. Used as the `changedFiles` payload in
 * the sentinel JSON so the daemon log can surface the operator-facing
 * "why" without printing 40 doc-only paths.
 * @param {readonly string[]} changedFiles
 * @returns {string[]}
 */
function filterRestartRelevantFiles(changedFiles) {
  return changedFiles.filter(
    (f) =>
      f === "bin/minsky" ||
      f === "bin/minsky-run.sh" ||
      f === "pnpm-lock.yaml" ||
      isDaemonRuntimeScript(f) ||
      /^novel\/.+\.(ts|mjs|js)$/.test(f),
  );
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isDaemonInstallRelevantFile(file) {
  return file === "bin/minsky" || file === "bin/minsky-run.sh";
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isDaemonRuntimeScript(file) {
  return (
    DAEMON_RUNTIME_SCRIPTS.has(file) ||
    /^scripts\/lib\/.+\.(mjs|js)$/.test(file) ||
    /^distribution\/systemd\/run-.+\.sh$/.test(file)
  );
}

const DAEMON_RUNTIME_SCRIPTS = new Set([
  "scripts/build_brief.py",
  "scripts/build_cto_brief.py",
  "scripts/dynamic_timeout.py",
  "scripts/extract_pr_url.py",
  "scripts/gh_issue_task_source.py",
  "scripts/heal-dispatch.mjs",
  "scripts/orchestrate.mjs",
  "scripts/pick_task.py",
  "scripts/resolve_gh_host.py",
  "scripts/runany-resolve-model.mjs",
  "scripts/spawn_agent.py",
  "scripts/spawn_with_watchdog.py",
  "scripts/synth_experiment_yaml.py",
]);

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
  const daemonPattern = [
    "cross-repo-runner/bin/minsky-run",
    "bin/minsky-run\\.sh",
    "distribution/systemd/run-tick-loop\\.sh",
  ].join("|");
  try {
    execFileSync("pgrep", ["-f", daemonPattern], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Path to the restart-requested sentinel the daemon's tick-loop polls
 * between iterations. Lives under `~/.minsky/` (the same dir as
 * `config.json`, `daemon.pid`, `daemon.log`) so the lifecycle is one
 * directory: stop the daemon → remove `~/.minsky/` → restart fresh.
 *
 * Exported as a constant so the host-loop sentinel reader uses the
 * exact same path (single source of truth — rule #1 / rule #10).
 */
export const RESTART_SENTINEL_PATH = join(homedir(), ".minsky", "restart-requested");

/**
 * Write the restart-requested sentinel file. Best-effort per rule #6 —
 * if `~/.minsky/` is unwritable for any reason (sandbox, full disk,
 * read-only FS), we WARN but never block the git operation. The
 * sentinel's contents are operator-facing JSON: `ts` lets the daemon
 * log show how long ago the request was filed, `reason` is the
 * one-line "why", `changedFiles` is the relevant subset (filtered by
 * `filterRestartRelevantFiles` — not the full git diff, which can be
 * 40+ paths on a routine pull).
 *
 * @param {string} reason
 * @param {readonly string[]} changedFiles
 */
function writeRestartSentinel(reason, changedFiles) {
  try {
    mkdirSync(dirname(RESTART_SENTINEL_PATH), { recursive: true });
    const payload = JSON.stringify(
      { ts: new Date().toISOString(), reason, changedFiles: [...changedFiles] },
      null,
      2,
    );
    writeFileSync(RESTART_SENTINEL_PATH, `${payload}\n`, "utf8");
  } catch (err) {
    // Best-effort: surface but never throw. The operator can still
    // recover with `minsky update` (the manual escape hatch — rule #16
    // documents that auto-restart's failure mode is "no worse than
    // pre-fix behaviour").
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ failed to write restart sentinel at ${RESTART_SENTINEL_PATH}: ${message}`);
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
  "request-daemon-restart": (action) => {
    console.info(`  → request daemon restart (${action.reason})…`);
    writeRestartSentinel(action.reason, action.changedFiles);
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
