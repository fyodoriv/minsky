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
  renderIterationRecord,
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
      "  minsky-run <task-id> --host <host-dir>            Dry-run (default).",
      "  minsky-run <task-id> --host <host-dir> --live     Live spawn.",
      "  minsky-run --help                                 Print this message.",
      "",
      "The host must have been bootstrapped first via `minsky-bootstrap <host-dir>`.",
      "",
    ].join("\n"),
  );
}

function consumeArg(args, i, state) {
  const a = args[i];
  if (a === "--host") {
    state.host = args[i + 1] ?? null;
    return i + 2;
  }
  if (a === "--live") {
    state.live = true;
    return i + 1;
  }
  if (a === "--dry-run") {
    state.live = false;
    return i + 1;
  }
  if (a?.startsWith("--")) {
    state.error = `unknown flag: ${a}`;
    return args.length;
  }
  if (a !== undefined) state.positional.push(a);
  return i + 1;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }
  const state = { host: null, live: false, positional: [], error: null };
  for (let i = 0; i < args.length; ) {
    i = consumeArg(args, i, state);
  }
  if (state.error !== null) return { kind: "error", message: state.error };
  if (state.positional.length !== 1 || state.host === null) {
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
  return runPlanned(parsed.taskId, parsed.host, parsed.live);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`minsky-run crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
