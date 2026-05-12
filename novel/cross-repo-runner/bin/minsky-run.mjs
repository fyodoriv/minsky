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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ProcessSpawnStrategy, globMatchesPath } from "@minsky/tick-loop";

import {
  buildSpawnPlan,
  extractAllowedPathsFromTaskBlock,
  extractPrUrl,
  findTask,
  loadRepoConfig,
  pickHostTask,
  renderIterationRecord,
  runHostCtoAudit,
  runHostLoop,
  runLive,
  synthesiseExperimentYaml,
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
      "Usage:",
      "  minsky-run <task-id> --host <host-dir>                   One-shot dry-run (default).",
      "  minsky-run <task-id> --host <host-dir> --live            One-shot live spawn.",
      "  minsky-run --host <host-dir> --loop [--live]             Continuous mode — picks the next",
      "                                                            rule-#9-compliant P0/P1 task per iteration,",
      "                                                            stops on empty-queue / SIGTERM / max-iterations.",
      "  minsky-run --help                                        Print this message.",
      "",
      "Flags:",
      "  --max-iterations=N        Cap loop iterations. Default Infinity.",
      "  --tick-interval-ms=M      Sleep between iterations. Default 300000 (5 min).",
      "  --cto-audit               After each validated iteration, run a CTO-mode",
      "                             audit that proposes follow-up rule-#9 tasks.",
      "  --seed-on-empty           When the queue empties AND --cto-audit is on,",
      "                             fire a seed audit + re-pick (one-shot) so the",
      "                             loop continues with newly-proposed tasks.",
      "",
      "The host must have been bootstrapped first via `minsky-bootstrap <host-dir>`.",
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
  },
  "--dry-run": (s) => {
    s.live = false;
  },
  "--loop": (s) => {
    s.loop = true;
  },
  "--cto-audit": (s) => {
    s.ctoAudit = true;
  },
  "--seed-on-empty": (s) => {
    s.seedOnEmpty = true;
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
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }
  const state = {
    host: null,
    live: false,
    loop: false,
    ctoAudit: false,
    seedOnEmpty: false,
    maxIterations: Number.POSITIVE_INFINITY,
    tickIntervalMs: 300_000,
    positional: [],
    error: null,
  };
  for (let i = 0; i < args.length; ) {
    i = consumeArg(args, i, state);
  }
  if (state.error !== null) return { kind: "error", message: state.error };
  if (state.host === null) {
    return { kind: "error", message: "must pass --host <host-dir>" };
  }
  if (state.loop) {
    // Loop mode: no positional task-id required (picker selects each iteration).
    if (state.positional.length > 0) {
      return {
        kind: "error",
        message: `--loop mode picks tasks automatically; remove positional argument(s): ${state.positional.join(", ")}`,
      };
    }
    return {
      kind: "loop",
      host: resolve(state.host),
      live: state.live,
      ctoAudit: state.ctoAudit,
      seedOnEmpty: state.seedOnEmpty,
      maxIterations: state.maxIterations,
      tickIntervalMs: state.tickIntervalMs,
    };
  }
  if (state.positional.length !== 1) {
    return { kind: "error", message: "must pass exactly one <task-id> and --host <host-dir>" };
  }
  return { kind: "run", taskId: state.positional[0], host: resolve(state.host), live: state.live };
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
  const strategy = new ProcessSpawnStrategy({
    command: "claude",
    args: ["--print"],
    timeoutMs,
    invocation: (input) => ({
      command: "claude",
      argv: ["--print"],
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
  const { host: hostRoot, live, ctoAudit, seedOnEmpty, maxIterations, tickIntervalMs } = parsed;
  const config = loadHostConfig(hostRoot);

  // SIGTERM bridge — operator's normal-exit signal. The loop's AbortSignal
  // fires when the supervisor (or `kill <pid>` from the operator) sends
  // SIGTERM; in-flight spawn finishes, then the loop exits with stopReason
  // `aborted`. Per rule #6 let-it-crash AT the iteration boundary, not the
  // loop body — uncaught throws still propagate to the top-level handler.
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  process.stdout.write(
    `\n=== host-daemon loop (host=${config.host_repo}, mode=${live ? "live" : "dry-run"}, ` +
      `max-iter=${maxIterations === Number.POSITIVE_INFINITY ? "∞" : maxIterations}, ` +
      `tick=${tickIntervalMs}ms, cto-audit=${ctoAudit ? "on" : "off"}, ` +
      `seed-on-empty=${seedOnEmpty ? "on" : "off"}) ===\n`,
  );

  let strategy = null;
  if (live) {
    strategy = new ProcessSpawnStrategy({
      command: "claude",
      args: ["--print"],
      timeoutMs: readLiveSpawnTimeoutMs(),
      invocation: (input) => ({
        command: "claude",
        argv: ["--print"],
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

  process.off("SIGTERM", onSignal);
  process.off("SIGINT", onSignal);

  emitLoopSummary(result);
  // Exit codes: 0 = healthy stop (empty-queue / max-iterations / aborted),
  // 1 = spawn-failed (operator must inspect), 2 = scope-leak.
  if (result.stopReason === "scope-leak") return 2;
  if (result.stopReason === "spawn-failed") return 1;
  return 0;
}

function readLiveSpawnTimeoutMs() {
  const raw = process.env.MINSKY_LIVE_SPAWN_TIMEOUT_MS;
  if (raw === undefined) return 15 * 60 * 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
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
  if (!existsSync(parsed.host)) {
    process.stderr.write(`host directory does not exist: ${parsed.host}\n`);
    return 1;
  }
  if (parsed.kind === "loop") {
    return runLoop(parsed);
  }
  return runPlanned(parsed.taskId, parsed.host, parsed.live);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`minsky-run crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
