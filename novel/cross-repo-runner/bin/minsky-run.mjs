#!/usr/bin/env node
// `minsky run <task-id> --host <host-dir>` — cross-repo runner CLI.
//
// Pattern: command-line I/O boundary (Martin 2017). The pure functions live
//   in `src/` (loadRepoConfig, findTask, synthesiseExperimentYaml,
//   buildSpawnPlan, renderIterationRecord); the CLI is the only side-
//   effecting layer. Source: rule #6 (vision.md § 6 — let-it-crash AT the
//   boundary; per-task errors surface with operator-actionable messages,
//   never silently swallowed); user-stories/006-runner-on-any-repo.md.
//
// Modes:
//   minsky-run <task-id> --host <host-dir>            — dry-run (default).
//   minsky-run <task-id> --host <host-dir> --live     — live spawn.
//
// v0 ships dry-run as the safe default. `--live` is the explicit opt-in
// (rule #6 — let dry-run be the safe default; failure surfaces in the
// plan, not the side-effect).

import { execFile as execFileCb, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ProcessSpawnStrategy, globMatchesPath } from "@minsky/tick-loop";

import { computeDynamicSettings, parseTimingsFromJsonl } from "../dist/dynamic-timeouts.js";
import {
  buildSpawnPlan,
  detectCwd,
  extractAllowedPathsFromTaskBlock,
  extractPrUrl,
  findBootstrappedSubdirs,
  findTask,
  loadRepoConfig,
  pickHostTask,
  renderIterationRecord,
  resolveGhHost,
  runHostCtoAudit,
  runHostLoop,
  runLive,
  synthesiseExperimentYaml,
  walkHostsDir,
} from "../dist/index.js";

const execFile = promisify(execFileCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const MINSKY_REPO_ROOT = resolve(HERE, "..", "..", "..");
const VISION_MD_PATH = resolve(MINSKY_REPO_ROOT, "vision.md");

// Cache one gh-env per hostRoot per process — git remote get-url is cheap
// but called multiple times per iteration (open-PR scan, PR backstop,
// task-completion checks). Per rule #17, the resolver IS the proactive
// fix for the github.intuit.com / github.com 401 cascade.
/** @type {Map<string, NodeJS.ProcessEnv>} */
const GH_ENV_CACHE = new Map();

/**
 * Resolve the `GH_HOST` for `hostRoot` and return a cloned `process.env`
 * with it set. Always returns an env — falls back to `process.env` as-is
 * when no host can be resolved (graceful-degrade per rule #7).
 *
 * @param {string} hostRoot  absolute path to the host repo
 * @returns {NodeJS.ProcessEnv}
 */
function ghEnvForHost(hostRoot) {
  const cached = GH_ENV_CACHE.get(hostRoot);
  if (cached !== undefined) return cached;
  let remoteUrl;
  try {
    remoteUrl = execFileSync("git", ["-C", hostRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    remoteUrl = undefined;
  }
  const resolved = resolveGhHost({
    envGhHost: process.env.GH_HOST,
    gitRemoteUrl: remoteUrl,
  });
  const env = { ...process.env };
  if (resolved.host !== null) env.GH_HOST = resolved.host;
  else env.GH_HOST = undefined;
  GH_ENV_CACHE.set(hostRoot, env);
  return env;
}

function usage() {
  process.stderr.write(
    [
      "minsky-run — run a task in a host repo under minsky's full constitution.",
      "",
      "Modes:",
      "  minsky-run                                    Autonomous (auto-detect cwd as host or hosts-dir).",
      "  minsky-run --host <host-dir>                  Autonomous against a single host.",
      "  minsky-run --hosts-dir <parent-dir>           Autonomous, drain-then-advance through bootstrapped subdirs.",
      "  minsky-run <task-id> [--host <host-dir>]      One-shot (legacy explicit-task mode).",
      "  minsky-run --help                             Print this message.",
      "",
      "Defaults (autonomous mode):",
      "  Equivalent to --live --loop --cto-audit --seed-on-empty unless overridden.",
      "  A 3-second countdown banner prints before the first live spawn.",
      "  Set MINSKY_NON_INTERACTIVE=1 to suppress the banner (CI / supervisor use).",
      "",
      "Opt-outs (autonomous mode):",
      "  --no-live    (alias --dry-run)   Disable claude --print spawn; synthetic results only.",
      "  --once                            Disable loop; run one iteration and exit.",
      "  --no-cto-audit                    Skip the post-iteration CTO audit.",
      "  --no-seed-on-empty                Stop on empty-queue instead of seeding via CTO audit.",
      "",
      "Other flags:",
      "  --max-iterations=N             Cap total loop iterations across all hosts. Default Infinity.",
      "  --max-iterations-per-host=N    Cap iterations per host per walk pass (walk mode only). Default 3.",
      "  --tick-interval-ms=M           Sleep between iterations. Default 300000 (5 min).",
      "",
      "The host(s) must have been bootstrapped first via `minsky-bootstrap <host-dir>`.",
      "",
    ].join("\n"),
  );
}

function valueAfter(arg, prefix) {
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined;
}

const BOOL_FLAGS = {
  "--live": (s) => {
    s.live = true;
    s.liveExplicit = true;
  },
  "--no-live": (s) => {
    s.live = false;
    s.liveExplicit = true;
  },
  "--dry-run": (s) => {
    s.live = false;
    s.liveExplicit = true;
  },
  "--loop": (s) => {
    s.loop = true;
    s.loopExplicit = true;
  },
  "--once": (s) => {
    s.loop = false;
    s.loopExplicit = true;
  },
  "--cto-audit": (s) => {
    s.ctoAudit = true;
    s.ctoAuditExplicit = true;
  },
  "--no-cto-audit": (s) => {
    s.ctoAudit = false;
    s.ctoAuditExplicit = true;
  },
  "--seed-on-empty": (s) => {
    s.seedOnEmpty = true;
    s.seedOnEmptyExplicit = true;
  },
  "--no-seed-on-empty": (s) => {
    s.seedOnEmpty = false;
    s.seedOnEmptyExplicit = true;
  },
};

function applyMaxIterations(state, raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    state.error = `--max-iterations must be a positive integer, got: ${raw}`;
    return false;
  }
  state.maxIterations = parsed;
  return true;
}

function applyTickIntervalMs(state, raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    state.error = `--tick-interval-ms must be a non-negative integer, got: ${raw}`;
    return false;
  }
  state.tickIntervalMs = parsed;
  return true;
}

function applyMaxIterationsPerHost(state, raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    state.error = `--max-iterations-per-host must be a positive integer, got: ${raw}`;
    return false;
  }
  state.maxIterationsPerHost = parsed;
  return true;
}

const KEY_VALUE_FLAGS = {
  "--max-iterations=": applyMaxIterations,
  "--tick-interval-ms=": applyTickIntervalMs,
  "--max-iterations-per-host=": applyMaxIterationsPerHost,
};

function tryKeyValueFlag(state, arg) {
  for (const prefix of Object.keys(KEY_VALUE_FLAGS)) {
    const value = valueAfter(arg, prefix);
    if (value !== undefined) {
      return { matched: true, ok: KEY_VALUE_FLAGS[prefix](state, value) };
    }
  }
  return { matched: false, ok: true };
}

function consumeArg(args, i, state) {
  const a = args[i];
  if (a === undefined) return i + 1;
  if (a === "--host") {
    state.host = args[i + 1] ?? null;
    return i + 2;
  }
  if (a === "--hosts-dir") {
    state.hostsDir = args[i + 1] ?? null;
    return i + 2;
  }
  if (BOOL_FLAGS[a] !== undefined) {
    BOOL_FLAGS[a](state);
    return i + 1;
  }
  const kv = tryKeyValueFlag(state, a);
  if (kv.matched) return kv.ok ? i + 1 : args.length;
  if (a.startsWith("--")) {
    state.error = `unknown flag: ${a}`;
    return args.length;
  }
  state.positional.push(a);
  return i + 1;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }
  const state = {
    host: null,
    hostsDir: null,
    live: false,
    loop: false,
    ctoAudit: false,
    seedOnEmpty: false,
    liveExplicit: false,
    loopExplicit: false,
    ctoAuditExplicit: false,
    seedOnEmptyExplicit: false,
    maxIterations: Number.POSITIVE_INFINITY,
    tickIntervalMs: 300_000,
    // Per-host iteration cap for multi-host walk mode. Default 3 — after
    // a host has run N iterations, the walker advances regardless of
    // whether that host's queue is empty. This is the *bounded drain*
    // half of the `walker-drains-one-host-forever` fix (the other half
    // is the validated-task rotation inside `runHostLoop`). Single-host
    // (--host) mode ignores this flag — `--max-iterations` caps it instead.
    maxIterationsPerHost: 3,
    positional: [],
    error: null,
  };
  for (let i = 0; i < args.length; ) {
    i = consumeArg(args, i, state);
  }
  if (state.error !== null) return { kind: "error", message: state.error };
  return dispatchParsed(state);
}

/**
 * Route parser state to one of four modes:
 *   - `help`  — operator asked, OR no args + no auto-detect signal
 *   - `error` — conflicting flags / unbootstrapped host / missing target
 *   - `run`   — one-shot mode (positional task-id supplied)
 *   - `loop`  — single-host autonomous (legacy --loop OR new default when no task-id)
 *   - `walk`  — multi-host autonomous (--hosts-dir OR cwd has bootstrapped subdirs)
 */
function dispatchParsed(state) {
  if (state.host !== null && state.hostsDir !== null) {
    return {
      kind: "error",
      message: "cannot pass both --host and --hosts-dir; choose one",
    };
  }
  const autoTarget =
    state.host === null && state.hostsDir === null ? autoDetectTarget(state) : null;
  if (autoTarget !== null && autoTarget.kind === "error") {
    return { kind: "error", message: autoTarget.message };
  }
  const resolvedHost = state.host ?? autoTarget?.host ?? null;
  const resolvedHostsDir = state.hostsDir ?? autoTarget?.hostsDir ?? null;
  if (resolvedHostsDir !== null) return buildWalkDispatch(state, resolvedHostsDir);
  if (resolvedHost === null) {
    return {
      kind: "error",
      message:
        "must pass --host <host-dir> or --hosts-dir <parent-dir>, OR run from a bootstrapped host / parent directory.\nHint: run `minsky-bootstrap <host-dir>` to bootstrap a repo.",
    };
  }
  return buildHostDispatch(state, resolvedHost);
}

/**
 * Build the dispatch result for `--hosts-dir` / cwd-auto-detect-walk mode.
 * Extracted from {@link dispatchParsed} to keep complexity under biome's 10
 * cap; same Strategy pattern (Gamma 1994) — one branch per kind.
 */
function buildWalkDispatch(state, resolvedHostsDir) {
  if (state.positional.length > 0) {
    return {
      kind: "error",
      message: `--hosts-dir mode picks tasks automatically; remove positional argument(s): ${state.positional.join(", ")}`,
    };
  }
  const defaults = applyAutonomousDefaults(state);
  return {
    kind: "walk",
    hostsDir: resolve(resolvedHostsDir),
    ...defaults,
    maxIterations: state.maxIterations,
    tickIntervalMs: state.tickIntervalMs,
    maxIterationsPerHost: state.maxIterationsPerHost,
  };
}

/**
 * Build the dispatch result for single-host mode (one-shot via positional
 * task-id, OR autonomous single-host loop when no positional). Extracted
 * from {@link dispatchParsed} to keep complexity under biome's 10 cap.
 */
function buildHostDispatch(state, resolvedHost) {
  if (state.positional.length === 1) {
    const autonomousExplicit =
      state.loopExplicit || state.ctoAuditExplicit || state.seedOnEmptyExplicit;
    if (autonomousExplicit) {
      return {
        kind: "error",
        message:
          "positional task-id is incompatible with autonomous-mode flags (--loop / --cto-audit / --seed-on-empty). Either drop the positional to enter autonomous mode, or drop the autonomous flags to run one-shot.",
      };
    }
    return {
      kind: "run",
      taskId: state.positional[0],
      host: resolve(resolvedHost),
      live: state.live,
    };
  }
  if (state.positional.length > 1) {
    return {
      kind: "error",
      message: `expected at most one positional <task-id>, got: ${state.positional.join(", ")}`,
    };
  }
  const defaults = applyAutonomousDefaults(state);
  // `--once` semantically means "run exactly one iteration then exit".
  // Without this bridge, `--once` only flips the `loop` flag (currently
  // unused inside the loop runner) and the dispatch falls into the
  // default `tickIntervalMs` sleep (300_000ms) after iteration #0,
  // making the test see a 60s timeout. Rule #17 fix: an operator-
  // facing flag whose meaning the runner ignores is a class of bug
  // we should never ship again. Force `maxIterations=1` when `--once`
  // is set so the loop exits via `max-iterations` stop reason. The
  // explicit `--max-iterations=N` flag still wins.
  const maxIterations =
    !defaults.loop && state.maxIterations === Number.POSITIVE_INFINITY ? 1 : state.maxIterations;
  return {
    kind: "loop",
    host: resolve(resolvedHost),
    ...defaults,
    maxIterations,
    tickIntervalMs: state.tickIntervalMs,
  };
}

/**
 * Apply autonomous-mode defaults (slice-D flip): when no explicit flag
 * was set, default to live=true, loop=true, ctoAudit=true, seedOnEmpty=true.
 * Explicit flags (via --no-live, --once, --no-cto-audit, --no-seed-on-empty)
 * still win.
 */
function applyAutonomousDefaults(state) {
  return {
    live: state.liveExplicit ? state.live : true,
    loop: state.loopExplicit ? state.loop : true,
    ctoAudit: state.ctoAuditExplicit ? state.ctoAudit : true,
    seedOnEmpty: state.seedOnEmptyExplicit ? state.seedOnEmpty : true,
  };
}

/**
 * Auto-detect target when neither --host nor --hosts-dir is set. Probes
 * cwd via `detectCwd`; returns the chosen target shape OR an error
 * message the dispatcher surfaces.
 */
function autoDetectTarget(state) {
  // If no args at all + no positional, this is the operator running
  // `minsky-run` in their cwd with nothing else — auto-detect.
  if (state.positional.length > 0) {
    // Operator supplied a positional task-id but no --host. We need a host
    // for one-shot mode. Auto-detect cwd as host (same logic).
  }
  const cwd = process.cwd();
  const result = detectCwd({
    cwd,
    fs: {
      exists: (path) => existsSync(path),
      listDir: (path) => {
        try {
          return readdirSync(path);
        } catch {
          return [];
        }
      },
    },
  });
  if (result.kind === "single-host") return { host: result.host };
  if (result.kind === "multi-host") return { hostsDir: result.hostsDir };
  return { kind: "error", message: result.hint };
}

function loadHostConfig(hostRoot) {
  const repoYamlPath = resolve(hostRoot, ".minsky", "repo.yaml");
  if (!existsSync(repoYamlPath)) {
    process.stderr.write(
      `host is not bootstrapped: ${repoYamlPath} not found. Run \`minsky-bootstrap ${hostRoot}\` first.\n`,
    );
    process.exit(1);
  }
  const raw = readFileSync(repoYamlPath, "utf8");
  const result = loadRepoConfig(raw);
  if (!result.ok) {
    process.stderr.write(`failed to parse ${repoYamlPath}:\n`);
    for (const e of result.errors) {
      process.stderr.write(`  - [${e.field}] ${e.message}\n`);
    }
    process.exit(1);
  }
  return result.config;
}

function loadHostTasks(hostRoot, tasksMdPath) {
  const fullPath = resolve(hostRoot, tasksMdPath);
  if (!existsSync(fullPath)) {
    process.stderr.write(`host TASKS.md not found at ${fullPath}\n`);
    process.exit(1);
  }
  return readFileSync(fullPath, "utf8");
}

function writeExperimentYaml(planPath, yaml) {
  mkdirSync(dirname(planPath), { recursive: true });
  writeFileSync(planPath, yaml, "utf8");
  process.stdout.write(`✓ wrote ${planPath}\n`);
}

// Fetch the set of head-ref names with open PRs on a host repo. Used by
// the host-daemon loop to skip tasks whose canonical branch already has
// an open PR — avoids the re-pick loop after a salvage-merge while the
// operator's TASKS.md cleanup is still in flight. Falls back to an empty
// set if `gh` is unavailable or the host_repo is unreachable (graceful-
// degrade per rule #7 — the worst case is the prior behaviour: re-pick
// the same task, not a hard failure).
//
// `hostRoot` is required: it lets `ghEnvForHost` resolve `GH_HOST` from
// the host's `git remote get-url origin` (rule #17 — fixes the
// github.intuit.com / github.com 401 cascade).
function listOpenPrBranches(hostRepo, hostRoot) {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        hostRepo,
        "--state",
        "open",
        "--json",
        "headRefName",
        "--limit",
        "100",
      ],
      { encoding: "utf8", env: ghEnvForHost(hostRoot) },
    );
    const prs = JSON.parse(out);
    return new Set(prs.map((pr) => pr.headRefName).filter((name) => typeof name === "string"));
  } catch {
    // `gh` not on PATH, repo unreachable, malformed JSON — degrade to
    // an empty set so the loop continues with the legacy behaviour.
    return new Set();
  }
}

function writeIterationRecord(hostRoot, record) {
  const storeDir = resolve(hostRoot, ".minsky", "experiment-store", "cross-repo");
  mkdirSync(storeDir, { recursive: true });
  const filePath = resolve(storeDir, `${record.experiment_id}.jsonl`);
  writeFileSync(filePath, renderIterationRecord(record), { flag: "a" });
  process.stdout.write(`✓ appended iteration record to ${filePath}\n`);
}

// ── Restart-sentinel reader (composes with the writer in
//    `scripts/post-merge-auto-install.mjs`). The constant path lives in
//    one place — `~/.minsky/restart-requested` — and BOTH the writer
//    (post-merge hook) and the reader (this daemon) hardcode it
//    identically. We don't import RESTART_SENTINEL_PATH from the
//    writer module because the writer is a .mjs script outside the
//    cross-repo-runner workspace package, and the runner can't depend
//    on it without a circular layering inversion. Keep the two
//    constants in sync; rule #1's "single source of truth" is enforced
//    by the integration test in `test/integration/daemon-restart.test.ts`.
const RESTART_SENTINEL_PATH = join(homedir(), ".minsky", "restart-requested");

/**
 * Read the restart-requested sentinel. Returns the parsed JSON when
 * the sentinel exists AND parses cleanly, otherwise `null`. Best-effort
 * per rule #6 — a malformed sentinel must NOT crash the loop (the
 * worst-case is "we missed one restart cycle"; the operator can still
 * run `minsky update` as the manual escape hatch).
 *
 * @returns {{ ts: string; reason: string; changedFiles: readonly string[] } | null}
 */
function readRestartSentinel() {
  if (!existsSync(RESTART_SENTINEL_PATH)) return null;
  try {
    const raw = readFileSync(RESTART_SENTINEL_PATH, "utf8");
    const parsed = JSON.parse(raw);
    // Defensive: the writer guarantees the shape, but a hand-edited
    // sentinel might be missing fields. Fail-soft into reasonable
    // defaults so the daemon still restarts.
    return {
      ts: typeof parsed.ts === "string" ? parsed.ts : new Date().toISOString(),
      reason: typeof parsed.reason === "string" ? parsed.reason : "unspecified",
      changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles : [],
    };
  } catch (err) {
    // Sentinel exists but is malformed. Treat as "still requested" so
    // the daemon DOES restart (the operator's intent is clear) and the
    // post-restart daemon clears the broken file as a side effect.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `⚠ restart sentinel at ${RESTART_SENTINEL_PATH} is malformed: ${message}\n`,
    );
    return {
      ts: new Date().toISOString(),
      reason: "sentinel-malformed (treating as restart)",
      changedFiles: [],
    };
  }
}

/**
 * Remove the restart-requested sentinel. Best-effort per rule #6 — if
 * the file is already gone, that's fine (idempotent). If removal fails
 * for some reason (locked file, perms), surface a warning but proceed
 * to the exit; the post-restart daemon's `readRestartSentinel` will
 * see the same request and trigger another restart cycle. Worst case
 * is one extra restart — bounded by the pull cadence.
 */
function clearRestartSentinel() {
  try {
    rmSync(RESTART_SENTINEL_PATH, { force: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `⚠ failed to clear restart sentinel at ${RESTART_SENTINEL_PATH}: ${message}\n`,
    );
  }
}

/**
 * Build the `GhLike` probe over `child_process.execFile("gh", …)`. Used by
 * `runLive`'s post-spawn PR-creation backstop (devin-spawn-no-pr-opened
 * pivot, 2026-05-18). Both methods are best-effort: every failure path
 * (gh-not-on-PATH, auth-expired, branch-not-pushed, network, malformed
 * JSON) returns `null` so the runner falls back to the legacy behaviour
 * (`validated` + `pr_url: null`) without crashing the iteration. Per
 * rule #7 graceful-degrade — the backstop is the safety net, not the
 * primary path.
 *
 * @otel-exempt thin gh-CLI wrapper.
 */
function makeGhProbe(hostRoot) {
  // Per rule #17: `ghEnvForHost` reads the hostRoot's `git remote get-url
  // origin` and sets `GH_HOST` to the matching hostname. This is the
  // proactive fix for the github.intuit.com / github.com 401 cascade —
  // never assume one corporate host. Operator-set `GH_HOST` wins.
  const ghEnv = ghEnvForHost(hostRoot);
  return {
    async findOpenPr({ hostRepo, branch }) {
      try {
        const { stdout } = await execFile(
          "gh",
          [
            "pr",
            "list",
            "--repo",
            hostRepo,
            "--head",
            branch,
            "--state",
            "open",
            "--json",
            "url",
            "--limit",
            "1",
          ],
          { env: ghEnv, cwd: hostRoot },
        );
        const prs = JSON.parse(stdout);
        if (!Array.isArray(prs) || prs.length === 0) return null;
        const url = prs[0]?.url;
        return typeof url === "string" && url.length > 0 ? url : null;
      } catch {
        return null;
      }
    },
    async createPr({ hostRepo, branch, base, title, body, workingDir }) {
      try {
        const { stdout } = await execFile(
          "gh",
          [
            "pr",
            "create",
            "--repo",
            hostRepo,
            "--head",
            branch,
            "--base",
            base,
            "--title",
            title,
            "--body",
            body,
          ],
          { env: ghEnv, cwd: workingDir },
        );
        const url = extractPrUrl(stdout);
        return url;
      } catch (err) {
        // gh pr create can fail for many reasons — the most common is
        // "branch not pushed" or "PR already exists for branch". When
        // we see "already exists", parse the URL from stderr; otherwise
        // surface a short diagnostic so the iteration's notes field
        // captures the failure mode (operator-actionable).
        const stderr = err?.stderr ?? "";
        const fallback = extractPrUrl(stderr);
        if (fallback !== null) return fallback;
        process.stdout.write(
          `[pr-backstop] gh pr create failed for ${hostRepo}#${branch}: ${String(stderr).slice(0, 200)}\n`,
        );
        return null;
      }
    },
  };
}

function reportTaskNotFound(taskResult) {
  process.stderr.write(`${taskResult.reason}\n`);
  if (taskResult.availableIds.length === 0) return;
  process.stderr.write("\nAvailable task IDs:\n");
  for (const id of taskResult.availableIds.slice(0, 10)) {
    process.stderr.write(`  - ${id}\n`);
  }
  if (taskResult.availableIds.length > 10) {
    process.stderr.write(`  …and ${taskResult.availableIds.length - 10} more\n`);
  }
}

function reportRule9Violation(taskId, missingFields) {
  process.stderr.write(
    `rule-9 violation: task ${taskId} is missing required field(s): ${missingFields.join(", ")}\n`,
  );
  process.stderr.write(
    "Rule #9 is iron — no exemption. Add the missing fields to the task block in TASKS.md.\n",
  );
}

function emitDryRunReport(plan, hostRoot, hostRepo) {
  process.stdout.write("\n=== runner plan (dry-run) ===\n");
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  writeIterationRecord(hostRoot, {
    ts: new Date().toISOString(),
    experiment_id: plan.taskId,
    host_repo: hostRepo,
    branch: plan.branchName,
    verdict: "planned",
    pr_url: null,
    notes: "dry-run; no spawn",
  });
}

/**
 * v1 live-spawn boundary — wires `runLive` (pure orchestrator) to the real
 * `ProcessSpawnStrategy` from `@minsky/tick-loop` and a `git execFile`
 * probe for baseline capture + post-spawn diff. The `--live` flag is the
 * opt-in (rule #6 — dry-run is the safe default).
 *
 * Scope: caller-supplied via the task block's `**Touches**:` or `**Files**:`
 * field. Empty scope is "no scope declared" — chaos row 7's scope-leak
 * detector short-circuits to `validated` regardless of diff (graceful-
 * degrade per rule #7).
 *
 * Watchdog: 30 min default (raised from 15 min 2026-05-18 — devin iterations with
 * operator-overridable via `MINSKY_LIVE_SPAWN_TIMEOUT_MS`.
 */
async function emitLiveSpawn(plan, hostRoot, hostRepo, rawTaskBlock, defaultBranch) {
  process.stdout.write("\n=== runner plan (live spawn) ===\n");
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`\nSpawning \`${readSpawnCommand()} --print\` in ${hostRoot}...\n`);
  const allowedPaths = extractAllowedPathsFromTaskBlock(rawTaskBlock);
  if (allowedPaths.length === 0) {
    process.stdout.write(
      "ℹ no **Touches** or **Files** declared on the task — scope-leak check disabled.\n",
    );
  } else {
    process.stdout.write(`ℹ scope: ${allowedPaths.join(", ")}\n`);
  }
  const timeoutMs = readLiveSpawnTimeoutMs(hostRoot);
  const agentCfg = buildAgentConfig(hostRoot);
  const strategy = new ProcessSpawnStrategy({
    command: agentCfg.command,
    args: agentCfg.args,
    timeoutMs,
    invocation: agentCfg.invocation,
  });
  const git = makeGitProbe(hostRoot);
  const gh = makeGhProbe(hostRoot);
  const outcome = await runLive({
    plan,
    allowedPaths,
    spawn: strategy,
    git,
    globMatchesPath,
    gh,
    hostRepo,
    defaultBranch,
  });
  emitLiveOutcome(outcome);
  writeIterationRecord(hostRoot, {
    ts: new Date().toISOString(),
    experiment_id: plan.taskId,
    host_repo: hostRepo,
    branch: plan.branchName,
    verdict: outcome.verdict,
    pr_url: outcome.prUrl ?? extractPrUrl(outcome.stdoutTail),
    notes: buildLiveNotes(outcome),
  });
  return outcome.verdict === "validated" ? 0 : outcome.verdict === "scope-leak" ? 2 : 1;
}

function emitLiveOutcome(outcome) {
  const banner =
    outcome.verdict === "validated"
      ? "✓ live spawn validated"
      : outcome.verdict === "scope-leak"
        ? "✗ live spawn scope-leak"
        : "✗ live spawn failed";
  process.stdout.write(`\n${banner} (exit=${outcome.exitCode}, ${outcome.durationMs}ms)\n`);
  if (outcome.verdict === "scope-leak") {
    process.stdout.write("  out-of-scope paths:\n");
    for (const p of outcome.scopeLeakPaths) process.stdout.write(`    - ${p}\n`);
  }
  if (outcome.verdict === "spawn-failed" && outcome.stderrTail.length > 0) {
    process.stdout.write(`  stderr tail:\n${indent(outcome.stderrTail, "    ")}\n`);
  }
  if (outcome.prUrl !== null) {
    process.stdout.write(`  PR: ${outcome.prUrl}\n`);
  }
}

function buildLiveNotes(outcome) {
  const base = `live; exit=${outcome.exitCode}; ${outcome.durationMs}ms; baseline=${outcome.baselineRef}`;
  if (outcome.verdict === "scope-leak") {
    return `${base}; leaked=${outcome.scopeLeakPaths.length}: ${outcome.scopeLeakPaths.join(",")}`;
  }
  if (outcome.verdict === "spawn-failed") {
    return `${base}; stderr-tail=${outcome.stderrTail.slice(-200)}`;
  }
  return base;
}

function indent(text, prefix) {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * Build the GitLike probe over `child_process.execFile("git", …)`. Captures
 * `git rev-parse HEAD` before the spawn; lists `git diff --name-only <baseline>`
 * paths afterwards. Pure I/O wrapper; failures bubble to `runLive` per
 * let-it-crash discipline (Armstrong 2007).
 */
function makeGitProbe(hostRoot) {
  return {
    async captureBaseline() {
      try {
        const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: hostRoot });
        return stdout.trim();
      } catch {
        // No commit yet (fresh `git init` without first commit) — use the
        // empty-tree SHA as the baseline so the diff reports every staged
        // file as "changed" (a conservative scope check for fresh hosts).
        return "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
      }
    },
    async changedFiles({ sinceRef }) {
      try {
        const { stdout } = await execFile("git", ["diff", "--name-only", sinceRef, "--", "."], {
          cwd: hostRoot,
        });
        return stdout
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } catch {
        // `git diff` failing (e.g. detached HEAD vs invalid baseline) is
        // treated as "no changes detected" — operator inspects manually.
        return [];
      }
    },
  };
}

/**
 * Extract the raw task-block text from the host's TASKS.md by **ID** field.
 * The block spans from the nearest `- [ ] ` checkbox above the ID line down
 * to the next checkbox or `## ` heading. Mirrors the daemon's
 * `extractTaskBlock` semantics for cross-repo input where the task ID is
 * not embedded in the heading-backticks.
 */
function extractRawTaskBlock(tasksMd, taskId) {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idRegex = new RegExp(`^\\s*-?\\s*\\*\\*ID\\*\\*:\\s*${escaped}\\s*$`, "m");
  const match = tasksMd.match(idRegex);
  if (match === null || match.index === undefined) return "";
  const before = tasksMd.slice(0, match.index);
  const lastCheckboxIdx = before.lastIndexOf("\n- [");
  const start = lastCheckboxIdx < 0 ? 0 : lastCheckboxIdx + 1;
  const tail = tasksMd.slice(start);
  const next = tail.slice(2).search(/\n(?:- \[[ x]\] |## )/);
  return next < 0 ? tail : tail.slice(0, next + 2);
}

async function runPlanned(taskId, hostRoot, live) {
  const config = loadHostConfig(hostRoot);
  const tasksMd = loadHostTasks(hostRoot, config.tasks_md_path);
  const taskResult = findTask(tasksMd, taskId);
  if (!taskResult.ok) {
    reportTaskNotFound(taskResult);
    process.exit(1);
  }
  const synth = synthesiseExperimentYaml(taskResult.task, { hostRepo: config.host_repo });
  if (!synth.ok) {
    reportRule9Violation(taskResult.task.id, synth.missingFields);
    process.exit(1);
  }
  const plan = buildSpawnPlan({
    hostRoot,
    config,
    task: taskResult.task,
    visionMdPath: VISION_MD_PATH,
  });
  writeExperimentYaml(plan.experimentYamlPath, synth.yaml);
  if (live) {
    const rawBlock = extractRawTaskBlock(tasksMd, taskResult.task.id);
    return await emitLiveSpawn(plan, hostRoot, config.host_repo, rawBlock);
  }
  emitDryRunReport(plan, hostRoot, config.host_repo);
  return 0;
}

/**
 * Continuous-mode driver: walks the host's queue using `pickHostTask`,
 * invokes `runLive` per iteration via `runHostLoop`, sleeps between
 * iterations, exits on empty-queue / SIGTERM / max-iterations / first
 * scope-leak or spawn-failed.
 *
 * The picker re-reads TASKS.md each tick so the host operator can edit
 * the queue mid-loop and the next iteration sees the change (rule #6 —
 * stay-alive across mid-task interruption).
 */
async function runLoop(parsed) {
  // SIGTERM bridge — operator's normal-exit signal. The loop's AbortSignal
  // fires when the supervisor (or `kill <pid>` from the operator) sends
  // SIGTERM; in-flight spawn finishes, then the loop exits with stopReason
  // `aborted`. Per rule #6 let-it-crash AT the iteration boundary, not the
  // loop body — uncaught throws still propagate to the top-level handler.
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  const result = await runLoopAsResult(parsed, controller);
  process.off("SIGTERM", onSignal);
  process.off("SIGINT", onSignal);
  emitLoopSummary(result);
  if (result.stopReason === "scope-leak") return 2;
  if (result.stopReason === "spawn-failed") return 1;
  return 0;
}

/**
 * Single-host loop core. Returns the `LoopResult` so the multi-host
 * walker can compose this per host without re-installing SIGTERM
 * handlers (those live one layer up — `runLoop` for single-host CLI,
 * `runWalk` for multi-host).
 *
 * Extracted from the original `runLoop` body so slice D's multi-host
 * walker can reuse it (rule #1 — single source of single-host logic).
 */
async function runLoopAsResult(parsed, controller) {
  const { host: hostRoot, live, ctoAudit, seedOnEmpty, maxIterations, tickIntervalMs } = parsed;
  const config = loadHostConfig(hostRoot);

  process.stdout.write(
    `\n=== host-daemon loop (host=${config.host_repo}, mode=${live ? "live" : "dry-run"}, ` +
      `max-iter=${maxIterations === Number.POSITIVE_INFINITY ? "∞" : maxIterations}, ` +
      `tick=${tickIntervalMs}ms, cto-audit=${ctoAudit ? "on" : "off"}, ` +
      `seed-on-empty=${seedOnEmpty ? "on" : "off"}) ===\n`,
  );

  // Per rule #4 (everything measurable, visible): always emit the
  // dynamic-timeouts probe when this host has iteration history, even
  // in dry-run mode. Operators (and integration tests) rely on seeing
  // this line to know the timeout values the loop computed. Previously
  // gated by `if (live)`, which made the probe invisible exactly when
  // dry-run operators most needed to verify the computation.
  computeDynamicSettingsForHost(hostRoot);

  let strategy = null;
  if (live) {
    const loopAgentCfg = buildAgentConfig(hostRoot);
    strategy = new ProcessSpawnStrategy({
      command: loopAgentCfg.command,
      args: loopAgentCfg.args,
      timeoutMs: readLiveSpawnTimeoutMs(hostRoot),
      invocation: loopAgentCfg.invocation,
    });
  }
  const dryRunStrategy = {
    spawn(input) {
      return Promise.resolve({
        exitCode: 0,
        durationMs: 0,
        stdoutTail: `loop dry-run for ${input.taskId}`,
        stderrTail: "",
      });
    },
  };
  const git = makeGitProbe(hostRoot);

  let lastTasksMd = "";
  const result = await runHostLoop({
    pickTask: (pickOpts) => {
      lastTasksMd = loadHostTasks(hostRoot, config.tasks_md_path);
      // Self-healing: skip tasks that already have an open PR on the
      // canonical branch (<branch_prefix><task.id>). Without this, after
      // a task's PR lands the loop re-picks the same task on every
      // iteration until the operator deletes it from TASKS.md. Discovered
      // 2026-05-16 on oncall-hub-plugin — bulletproof-ux-dashboard was
      // re-picked 3 times after PR #296 opened, wasting 30+ minutes
      // until manual TASKS.md cleanup in PR #297. Source: plugin task
      // `minsky-claim-by-open-pr`.
      //
      // Dry-run mode skips the gh probe: no live spawn means no new PR
      // to collide with, and the network call adds 10–30s latency + a
      // ~2.5% flake rate per CI run (rule #11 — no flaky load-bearing
      // gates). Rule #17 fix: tests and bootstrap probes that exercise
      // `--no-live` should not hit the GitHub API at all.
      const openPrBranches = live ? listOpenPrBranches(config.host_repo, hostRoot) : new Set();
      // Thread the loop's validated-task set into pickHostTask so a
      // worker that validates but does NOT open a PR (devin pre-fix,
      // a brief that doesn't instruct `gh pr create`, or a CI failure
      // that prevented the PR step) does not get the same task picked
      // again on the next iteration. `walker-drains-one-host-forever`
      // fix (b) — the in-loop counterpart to the per-host iteration
      // cap in `runWalk`.
      const task = pickHostTask(lastTasksMd, {
        openPrBranches,
        branchPrefix: config.branch_prefix,
        skipTaskIds: pickOpts?.skipTaskIds,
      });
      if (task === null) return null;
      const synth = synthesiseExperimentYaml(task, { hostRepo: config.host_repo });
      if (!synth.ok) {
        reportRule9Violation(task.id, synth.missingFields);
        return null;
      }
      return task;
    },
    buildPlan: (task) => {
      const plan = buildSpawnPlan({
        hostRoot,
        config,
        task,
        visionMdPath: VISION_MD_PATH,
      });
      const synth = synthesiseExperimentYaml(task, { hostRepo: config.host_repo });
      if (synth.ok) writeExperimentYaml(plan.experimentYamlPath, synth.yaml);
      return plan;
    },
    resolveAllowedPaths: (task) => {
      const block = extractRawTaskBlock(lastTasksMd, task.id);
      return extractAllowedPathsFromTaskBlock(block);
    },
    runLive: (inputs) => runLive(inputs),
    spawn: strategy ?? dryRunStrategy,
    git,
    globMatchesPath,
    maxIterations,
    tickIntervalMs,
    // Scope-leak soft mode (default): devin naturally touches related
    // files outside **Files**: — warn + continue instead of halting.
    // Override: MINSKY_SCOPE_LEAK_MODE=hard for strict enforcement.
    scopeLeakMode: process.env.MINSKY_SCOPE_LEAK_MODE === "hard" ? "hard" : "warn",
    signal: controller.signal,
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: core iteration recorder; multiple verdict branches + observability emit. Refactor tracked in TASKS.md `minsky-run-record-iteration-extract-verdict-mapper`.
    recordIteration: (record) => {
      const verdict =
        record.verdict === "validated"
          ? "validated"
          : record.verdict === "scope-leak"
            ? "scope-leak"
            : "spawn-failed";
      const durSec = Math.round(record.durationMs / 1000);
      const pr = record.prUrl || "—";
      const agent = readSpawnCommand();
      // Per-iteration summary line for daemon.log glanceability
      // (daemon-log-lacks-iteration-detail P1, 2026-05-18)
      process.stdout.write(
        `⏱ iteration #${record.iteration}: task=${record.taskId} agent=${agent} verdict=${verdict} duration=${durSec}s pr=${pr}\n`,
      );
      // Smart scope-leak: log the out-of-scope files as a follow-up
      // suggestion, not a failure. "Should these be in a separate PR?"
      if (record.scopeLeakPaths && record.scopeLeakPaths.length > 0) {
        process.stdout.write(
          `  📋 out-of-scope files (consider separate PR): ${record.scopeLeakPaths.join(", ")}\n`,
        );
      }
      // Rule #17 (proactive healing) — surface the WHY of a spawn-failed
      // so the operator can act. Previously the runner captured the
      // agent's stderr but the loop threw it away before this log line
      // was written, leaving operators with `verdict=spawn-failed` and
      // zero diagnostic. Now: print exit code + signal + stderr tail
      // (last 1 KB) inline. `signal=` was added 2026-05-19 for the
      // `spawn-failed-exit-minus-one-silent-empty-stderr` P0 — the
      // entire diagnostic class where exit=-1 collapsed "exited with
      // no code" and "killed by signal" into one bucket.
      if (record.verdict === "spawn-failed") {
        const signalSuffix = record.signal ? ` signal=${record.signal}` : "";
        process.stdout.write(`  exit=${record.exitCode}${signalSuffix}\n`);
        if (record.stderrTail.length > 0) {
          const tail = record.stderrTail.slice(-1024);
          process.stdout.write(`  stderr tail (last ${tail.length} bytes):\n`);
          for (const line of tail.split("\n")) {
            process.stdout.write(`    ${line}\n`);
          }
        } else {
          process.stdout.write("  stderr tail: (empty — agent exited silently)\n");
        }
      }
      // Compose the iteration-record `notes` field. For spawn-failed
      // iterations we append `exit=N signal=SIG` so operators reading
      // `experiment-store/cross-repo/<id>.jsonl` later (or aggregating
      // across machines) can see the signal without re-scrolling the
      // daemon log. Validated iterations keep the original minimal
      // shape to avoid breaking downstream JSONL grep patterns.
      const baseNotes = `loop iteration=${record.iteration}; ${record.durationMs}ms; ${live ? "live" : "dry-run"}`;
      const diagSuffix =
        record.verdict === "spawn-failed"
          ? `; exit=${record.exitCode}${record.signal ? ` signal=${record.signal}` : ""}`
          : "";
      writeIterationRecord(hostRoot, {
        ts: new Date().toISOString(),
        experiment_id: record.taskId,
        host_repo: config.host_repo,
        branch: `${config.branch_prefix}${record.taskId}`,
        verdict,
        pr_url: record.prUrl,
        notes: `${baseNotes}${diagSuffix}`,
      });
    },
    seedOnEmpty: ctoAudit && seedOnEmpty,
    // Restart-sentinel seam — composes with the writer in
    // `scripts/post-merge-auto-install.mjs`. The post-merge hook drops
    // a sentinel at `~/.minsky/restart-requested` after a `git pull`
    // lands runtime code; the loop reads it BEFORE the next pickTask
    // and exits cleanly (code 0). launchd's `KeepAlive=true` (or
    // systemd `Restart=always`) respawns the daemon with the new
    // code. Rule #16 (default by default) — `minsky update` becomes
    // the rare escape hatch, not the daily flow. Source: TASKS.md
    // `minsky-auto-restart-daemon-on-pull`.
    checkRestartRequest: readRestartSentinel,
    clearRestartRequest: clearRestartSentinel,
    ...(ctoAudit
      ? {
          ctoAudit: ({ signals, completedVerdict }) =>
            runHostCtoAudit({
              signals,
              spawn: strategy ?? dryRunStrategy,
              env: process.env,
              completedVerdict,
            }),
          buildCtoSignals: (args) => ({
            hostRepo: config.host_repo,
            hostRoot,
            tasksMdPath: config.tasks_md_path,
            reason: args.reason,
            completedTaskId: args.completedTaskId,
            prUrl: args.prUrl,
            filesChanged: args.filesChanged,
            utcDate: new Date().toISOString().slice(0, 10),
          }),
        }
      : {}),
  });

  return result;
}

/**
 * Dynamic timeout: computes from iteration history if available,
 * falls back to conservative default. Env var overrides everything.
 *
 * Principle (2026-05-18 operator directive): all timeouts must be
 * dynamically calculated from actual machine performance, not
 * hardcoded. Different machines + agents have different latencies.
 */
function readLiveSpawnTimeoutMs(hostRoot) {
  // Env override always wins (escape hatch).
  const raw = process.env.MINSKY_LIVE_SPAWN_TIMEOUT_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // Dynamic: compute from this host's iteration history.
  return computeDynamicSettingsForHost(hostRoot).spawnTimeoutMs;
}

/**
 * Load iteration history from all experiment-store jsonl files for a host
 * and compute dynamic settings (watchdog, tick interval).
 */
function computeDynamicSettingsForHost(hostRoot) {
  try {
    const storeDir = join(hostRoot, ".minsky", "experiment-store", "cross-repo");
    if (!existsSync(storeDir)) return computeDynamicSettings([]);
    const files = readdirSync(storeDir).filter((f) => f.endsWith(".jsonl"));
    let allTimings = [];
    for (const f of files) {
      try {
        const content = readFileSync(join(storeDir, f), "utf8");
        allTimings = allTimings.concat(parseTimingsFromJsonl(content));
      } catch {
        /* skip unreadable files */
      }
    }
    const settings = computeDynamicSettings(allTimings);
    if (settings.source === "history") {
      process.stdout.write(
        `[dynamic-timeouts] computed from ${settings.sampleSize} iterations: ` +
          `watchdog=${Math.round(settings.spawnTimeoutMs / 1000)}s, ` +
          `tick=${Math.round(settings.tickIntervalMs / 1000)}s, ` +
          `p95=${settings.p95Ms ? `${Math.round(settings.p95Ms / 1000)}s` : "n/a"}\n`,
      );
    }
    return settings;
  } catch {
    return computeDynamicSettings([]);
  }
}

// Build the argv we pass to `claude` for live spawns. `--print` is the
// non-interactive flag minsky has always used. We additionally pass
// `--setting-sources project,local` so user-level CLAUDE.md (which on
// many operators' machines has grown past the model context — see e.g.
// the 74KB+ ~/.claude/CLAUDE.md that ships "Prompt is too long" before
// the brief is even submitted) does NOT load. Project + local sources
// still load so the host repo's own AGENTS.md/CLAUDE.md remain in
// scope, and OAuth/keychain auth stays intact (which `--bare` would
// have broken). Operators can override:
//   MINSKY_CLAUDE_SETTING_SOURCES=""           → omit the flag entirely
//   MINSKY_CLAUDE_SETTING_SOURCES="user,project,local" → restore user
//
// Source: rule #6 (let-it-crash AT the boundary, not silently — without
// this flag the spawn no-ops on a context-overflow and the loop exits
// `empty-queue iterations:0` with no operator-visible diagnostic).
/**
 * Per-machine minsky config at `~/.minsky/config.json`. Loaded once
 * at startup; env vars override any key for one-session overrides.
 *
 * Keys: cloud_agent, cloud_agent_model, local_agent, local_agent_model.
 * Edit directly or (future) via `minsky config set <key> <value>`.
 */
function loadMinskyConfig() {
  const configPath = resolve(process.env.HOME ?? "/root", ".minsky", "config.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}
const _minskyConfig = loadMinskyConfig();

/**
 * Resolve the CLI command to spawn. Priority:
 *   1. MINSKY_CLOUD_AGENT env var (one-session override)
 *   2. ~/.minsky/config.json `cloud_agent` (persistent per-machine)
 *   3. "claude" (default)
 */
function readSpawnCommand() {
  const agent = process.env.MINSKY_CLOUD_AGENT ?? _minskyConfig.cloud_agent ?? "claude";
  return agent.toLowerCase() === "devin" ? "devin" : "claude";
}

/**
 * Build the argv and invocation factory for the resolved spawn command.
 *
 * Claude Code: feeds the brief via stdin (child.stdin.end(brief)).
 * Devin CLI:   writes the brief to a temp file and passes --prompt-file
 *              (devin panics on stdin pipe as of 2026.5.6-8).
 *
 * Returns { args, buildInvocation(hostRoot) } so both the one-shot and
 * loop paths can use the same factory.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: agent-factory branching across local/devin/claude/aider — refactor tracked in TASKS.md `minsky-run-record-iteration-extract-verdict-mapper`.
function buildAgentConfig(hostRoot) {
  // When MINSKY_LLM_PROVIDER=local-only (set by `minsky --local`),
  // use the local agent (aider + ollama) instead of the cloud agent.
  const isLocal = process.env.MINSKY_LLM_PROVIDER === "local-only";
  if (isLocal) return buildLocalAgentConfig(hostRoot);

  const cmd = readSpawnCommand();
  // Model resolution priority:
  //   1. MINSKY_CLOUD_AGENT_MODEL env (one-session override)
  //   2. MINSKY_CLAUDE_MODEL env (legacy)
  //   3. ~/.minsky/config.json cloud_agent_model (persistent)
  //   4. "" (use CLI default)
  const model =
    process.env.MINSKY_CLOUD_AGENT_MODEL ??
    process.env.MINSKY_CLAUDE_MODEL ??
    _minskyConfig.cloud_agent_model ??
    "";

  if (cmd === "devin") {
    // --permission-mode dangerous: auto-approve edit/write/exec tools.
    // Without this, devin in --print mode rejects ALL write operations
    // ("Running in non-interactive mode. Use --permission-mode dangerous").
    // Fixed 2026-05-18 (devin-spawn-missing-permission-mode-bypass P0).
    const permMode = process.env.MINSKY_DEVIN_PERMISSION_MODE ?? "dangerous";
    const base = ["--print", "--permission-mode", permMode];
    if (model !== "") base.push("--model", model);
    // Devin: brief → temp file → --prompt-file. No stdin.
    const promptDir = mkdtempSync(join(tmpdir(), "minsky-devin-"));
    return {
      command: cmd,
      args: base,
      invocation: (input) => {
        const promptPath = join(promptDir, `${input.taskId}.md`);
        writeFileSync(promptPath, input.brief, "utf8");
        return {
          command: cmd,
          argv: [...base, "--prompt-file", promptPath],
          stdin: undefined, // do NOT pipe stdin — devin panics
          cwd: hostRoot,
        };
      },
    };
  }

  // Claude Code: brief via stdin (the original path)
  const raw = process.env.MINSKY_CLAUDE_SETTING_SOURCES;
  const sources = raw === undefined ? "project,local" : raw;
  const permMode = process.env.MINSKY_CLAUDE_PERMISSION_MODE ?? "bypassPermissions";
  const base = ["--print"];
  if (sources !== "") base.push("--setting-sources", sources);
  if (permMode !== "") base.push("--permission-mode", permMode);
  if (model !== "") base.push("--model", model);
  return {
    command: cmd,
    args: base,
    invocation: (input) => ({
      command: cmd,
      argv: base,
      stdin: input.brief,
      cwd: hostRoot,
    }),
  };
}

/**
 * Build agent config for local-only mode (aider + ollama).
 * Reads local_agent, local_agent_model, local_agent_args from
 * ~/.minsky/config.json. The brief is passed via aider's --message
 * flag (written to a temp file to avoid shell escaping issues).
 */
function buildLocalAgentConfig(hostRoot) {
  const agent = _minskyConfig.local_agent ?? "aider";
  const model = _minskyConfig.local_agent_model ?? "";
  const extraArgs = _minskyConfig.local_agent_args ?? [];

  // aider path: --message via temp file, no stdin
  const promptDir = mkdtempSync(join(tmpdir(), "minsky-local-"));
  const base = [...extraArgs];

  process.stdout.write(`  [local-only] agent=${agent} model=${model}\n`);

  return {
    command: agent,
    args: base,
    invocation: (input) => {
      const promptPath = join(promptDir, `${input.taskId}.md`);
      writeFileSync(promptPath, input.brief, "utf8");
      return {
        command: agent,
        argv: [...base, "--message-file", promptPath, "--yes"],
        stdin: undefined,
        cwd: hostRoot,
      };
    },
  };
}

function emitLoopSummary(result) {
  process.stdout.write("\n=== host-daemon loop summary ===\n");
  process.stdout.write(`stopReason: ${result.stopReason}\n`);
  process.stdout.write(`iterations: ${result.iterations.length}\n`);
  for (const r of result.iterations) {
    const tag = r.verdict === "validated" ? "✓" : "✗";
    process.stdout.write(
      `  ${tag} #${r.iteration} ${r.taskId} → ${r.verdict} (${r.durationMs}ms)${r.prUrl !== null ? ` PR=${r.prUrl}` : ""}\n`,
    );
  }
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.kind === "help") {
    usage();
    return 0;
  }
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n\n`);
    usage();
    return 64; // EX_USAGE
  }
  if (parsed.kind === "walk") {
    if (!existsSync(parsed.hostsDir)) {
      process.stderr.write(`hosts-dir does not exist: ${parsed.hostsDir}\n`);
      return 1;
    }
    return runWalk(parsed);
  }
  if (!existsSync(parsed.host)) {
    process.stderr.write(`host directory does not exist: ${parsed.host}\n`);
    return 1;
  }
  if (parsed.kind === "loop") {
    await maybePrintCountdownBanner(parsed.live, parsed.host);
    return runLoop(parsed);
  }
  return runPlanned(parsed.taskId, parsed.host, parsed.live);
}

/**
 * 3-second pre-spawn countdown banner. Prints when:
 *   - we're entering an autonomous live spawn (`live === true`), AND
 *   - `MINSKY_NON_INTERACTIVE` is NOT set (supervisor / CI opt-out), AND
 *   - stdout is a TTY (skip the banner when piped or under supervisor).
 *
 * SIGTERM/SIGINT during the 3s aborts before any spawn fires (the CLI's
 * existing signal handlers catch it; we just sleep here).
 */
async function maybePrintCountdownBanner(live, target) {
  if (!live) return;
  if (process.env.MINSKY_NON_INTERACTIVE === "1") return;
  if (process.env.MINSKY_NON_INTERACTIVE === "true") return;
  if (!process.stdout.isTTY) return;
  process.stdout.write(
    `\n⚠  Starting AUTONOMOUS LIVE SPAWN against ${target}\n   Agent: ${readSpawnCommand()}${_minskyConfig.cloud_agent_model || process.env.MINSKY_CLOUD_AGENT_MODEL ? ` (model: ${process.env.MINSKY_CLOUD_AGENT_MODEL ?? _minskyConfig.cloud_agent_model})` : ""}\n   Ctrl-C in the next 3s to abort. Set MINSKY_NON_INTERACTIVE=1 to skip this banner.\n`,
  );
  for (let i = 3; i > 0; i--) {
    process.stdout.write(`   ${i}…\n`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("   spawning.\n\n");
}

/**
 * Multi-host walker driver: iterates bootstrapped subdirs of `hostsDir`,
 * runs `runLoop`-equivalent against each in drain-then-advance order.
 * Reuses `runLoop`'s SIGTERM handler + strategy + git probe per host;
 * `walkHostsDir` (pure orchestrator) decides advance vs halt.
 */
async function runWalk(parsed) {
  const {
    hostsDir,
    live,
    ctoAudit,
    seedOnEmpty,
    loop,
    maxIterations,
    tickIntervalMs,
    maxIterationsPerHost,
  } = parsed;
  const hosts = findBootstrappedSubdirs({
    cwd: hostsDir,
    fs: {
      exists: (p) => existsSync(p),
      listDir: (p) => {
        try {
          return readdirSync(p);
        } catch {
          return [];
        }
      },
    },
  });
  if (hosts.length === 0) {
    process.stderr.write(
      `no bootstrapped hosts found under ${hostsDir} (looked for subdirs with .minsky/repo.yaml).\nRun \`minsky-bootstrap <host-dir>\` on each repo you want to govern.\n`,
    );
    return 1;
  }

  process.stdout.write(
    `\n=== multi-host walk (hosts-dir=${hostsDir}, hosts=${hosts.length}, mode=${live ? "live" : "dry-run"}, cto-audit=${ctoAudit ? "on" : "off"}, seed-on-empty=${seedOnEmpty ? "on" : "off"}) ===\n`,
  );
  for (const h of hosts) process.stdout.write(`  • ${h}\n`);

  await maybePrintCountdownBanner(live, `${hosts.length} hosts under ${hostsDir}`);

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  const walker = await walkHostsDir({
    hosts,
    maxTotalIterations: maxIterations,
    signal: controller.signal,
    runOneHost: async (hostRoot) => {
      // Per-host iteration cap: in multi-host walk mode, each host gets
      // at most `maxIterationsPerHost` iterations per walk pass to ensure
      // fair scheduling across all hosts. Without this, a host with a
      // non-completing task starves all other hosts indefinitely
      // (walker-drains-one-host-forever bug, 2026-05-18). The total
      // walker cap is still `maxTotalIterations`. Operator-tunable via
      // `--max-iterations-per-host=N` (default 3).
      const perHostCap = Math.min(maxIterationsPerHost, maxIterations);
      // Construct a fresh per-host parsed shape and reuse runLoop's
      // construction logic via a thin closure. We need runLoop to RETURN
      // the LoopResult instead of an exit code — refactor below to expose
      // a `runLoopForHost(parsed)` that does.
      const hostParsed = {
        host: hostRoot,
        live,
        ctoAudit,
        seedOnEmpty,
        loop: loop !== false,
        maxIterations: perHostCap,
        tickIntervalMs,
      };
      return runLoopAsResult(hostParsed, controller);
    },
  });

  process.off("SIGTERM", onSignal);
  process.off("SIGINT", onSignal);

  emitWalkerSummary(walker);
  if (walker.stopReason === "scope-leak") return 2;
  // spawn-failed on individual hosts no longer halts the walker (2026-05-18);
  // failures are recorded per-visit and surfaced in the summary.
  return 0;
}

function emitWalkerSummary(walker) {
  process.stdout.write("\n=== multi-host walk summary ===\n");
  process.stdout.write(`stopReason: ${walker.stopReason}\n`);
  process.stdout.write(`totalIterations: ${walker.totalIterations}\n`);
  for (const v of walker.visits) {
    process.stdout.write(
      `  ${v.hostRoot}: ${v.loopResult.iterations.length} iter(s) → ${v.loopResult.stopReason}\n`,
    );
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`minsky-run crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
