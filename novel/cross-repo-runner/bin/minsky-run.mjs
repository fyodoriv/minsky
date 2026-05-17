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

import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ProcessSpawnStrategy, globMatchesPath } from "@minsky/tick-loop";

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
      "  --max-iterations=N        Cap loop iterations. Default Infinity.",
      "  --tick-interval-ms=M      Sleep between iterations. Default 300000 (5 min).",
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

const KEY_VALUE_FLAGS = {
  "--max-iterations=": applyMaxIterations,
  "--tick-interval-ms=": applyTickIntervalMs,
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
  return {
    kind: "loop",
    host: resolve(resolvedHost),
    ...defaults,
    maxIterations: state.maxIterations,
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

function writeIterationRecord(hostRoot, record) {
  const storeDir = resolve(hostRoot, ".minsky", "experiment-store", "cross-repo");
  mkdirSync(storeDir, { recursive: true });
  const filePath = resolve(storeDir, `${record.experiment_id}.jsonl`);
  writeFileSync(filePath, renderIterationRecord(record), { flag: "a" });
  process.stdout.write(`✓ appended iteration record to ${filePath}\n`);
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
 * Watchdog: 15 min default (mirrors the daemon's `MINSKY_CLAUDE_PRINT_TIMEOUT_MS`),
 * operator-overridable via `MINSKY_LIVE_SPAWN_TIMEOUT_MS`.
 */
async function emitLiveSpawn(plan, hostRoot, hostRepo, rawTaskBlock) {
  process.stdout.write("\n=== runner plan (live spawn) ===\n");
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`\nSpawning \`claude --print\` in ${hostRoot}...\n`);
  const allowedPaths = extractAllowedPathsFromTaskBlock(rawTaskBlock);
  if (allowedPaths.length === 0) {
    process.stdout.write(
      "ℹ no **Touches** or **Files** declared on the task — scope-leak check disabled.\n",
    );
  } else {
    process.stdout.write(`ℹ scope: ${allowedPaths.join(", ")}\n`);
  }
  const timeoutMs = (() => {
    const raw = process.env.MINSKY_LIVE_SPAWN_TIMEOUT_MS;
    if (raw === undefined) return 15 * 60 * 1000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
  })();
  const claudeArgs = readClaudeSpawnArgs();
  const strategy = new ProcessSpawnStrategy({
    command: "claude",
    args: claudeArgs,
    timeoutMs,
    invocation: (input) => ({
      command: "claude",
      argv: claudeArgs,
      stdin: input.brief,
      cwd: hostRoot,
    }),
  });
  const git = makeGitProbe(hostRoot);
  const outcome = await runLive({
    plan,
    allowedPaths,
    spawn: strategy,
    git,
    globMatchesPath,
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
  const synth = synthesiseExperimentYaml(taskResult.task);
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

  let strategy = null;
  if (live) {
    const claudeArgs = readClaudeSpawnArgs();
    strategy = new ProcessSpawnStrategy({
      command: "claude",
      args: claudeArgs,
      timeoutMs: readLiveSpawnTimeoutMs(),
      invocation: (input) => ({
        command: "claude",
        argv: claudeArgs,
        stdin: input.brief,
        cwd: hostRoot,
      }),
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
    pickTask: () => {
      lastTasksMd = loadHostTasks(hostRoot, config.tasks_md_path);
      const task = pickHostTask(lastTasksMd);
      if (task === null) return null;
      const synth = synthesiseExperimentYaml(task);
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
      const synth = synthesiseExperimentYaml(task);
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
    signal: controller.signal,
    recordIteration: (record) => {
      writeIterationRecord(hostRoot, {
        ts: new Date().toISOString(),
        experiment_id: record.taskId,
        host_repo: config.host_repo,
        branch: `${config.branch_prefix}${record.taskId}`,
        verdict:
          record.verdict === "validated"
            ? "validated"
            : record.verdict === "scope-leak"
              ? "scope-leak"
              : "spawn-failed",
        pr_url: record.prUrl,
        notes: `loop iteration=${record.iteration}; ${record.durationMs}ms; ${live ? "live" : "dry-run"}`,
      });
    },
    seedOnEmpty: ctoAudit && seedOnEmpty,
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

function readLiveSpawnTimeoutMs() {
  const raw = process.env.MINSKY_LIVE_SPAWN_TIMEOUT_MS;
  if (raw === undefined) return 15 * 60 * 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
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
function readClaudeSpawnArgs() {
  const raw = process.env.MINSKY_CLAUDE_SETTING_SOURCES;
  const sources = raw === undefined ? "project,local" : raw;
  // `--permission-mode acceptEdits` lets claude --print actually USE its tools
  // (Edit/Write/Bash/etc) without an interactive permission prompt; without it,
  // the default permission mode requires a human at the keyboard, so claude
  // produces validated text output but never edits files, commits, or opens a
  // PR. Discovered 2026-05-16 — bulletproof-ux-dashboard iter 9 produced
  // `verdict: validated, pr_url: null` because claude wrote a 5-page analysis
  // but never invoked any Edit tool. Operators can override:
  //   MINSKY_CLAUDE_PERMISSION_MODE=""             → omit the flag entirely
  //   MINSKY_CLAUDE_PERMISSION_MODE=bypassPermissions  → fully permissive
  const permMode = process.env.MINSKY_CLAUDE_PERMISSION_MODE ?? "acceptEdits";
  const base = ["--print"];
  if (sources !== "") base.push("--setting-sources", sources);
  if (permMode !== "") base.push("--permission-mode", permMode);
  return base;
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
    `\n⚠  Starting AUTONOMOUS LIVE SPAWN against ${target}\n   Ctrl-C in the next 3s to abort. Set MINSKY_NON_INTERACTIVE=1 to skip this banner.\n`,
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
  const { hostsDir, live, ctoAudit, seedOnEmpty, loop, maxIterations, tickIntervalMs } = parsed;
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
        maxIterations,
        tickIntervalMs,
      };
      return runLoopAsResult(hostParsed, controller);
    },
  });

  process.off("SIGTERM", onSignal);
  process.off("SIGINT", onSignal);

  emitWalkerSummary(walker);
  if (walker.stopReason === "scope-leak") return 2;
  if (walker.stopReason === "spawn-failed") return 1;
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
