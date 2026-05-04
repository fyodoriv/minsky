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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSpawnPlan,
  findTask,
  loadRepoConfig,
  renderIterationRecord,
  synthesiseExperimentYaml,
} from "../dist/index.js";

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

function emitLiveV0Placeholder(plan, hostRoot, hostRepo) {
  process.stdout.write("\n=== runner plan (live mode requested — v0 placeholder) ===\n");
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(
    "\nv0 live-spawn placeholder: the EXPERIMENT.yaml has been written to the host sidecar.\n",
  );
  process.stdout.write(
    `Next step: open Claude Code in ${hostRoot} with the system prompt above and the brief on stdin.\n`,
  );
  process.stdout.write(
    "v1 will wire @minsky/tick-loop's ProcessSpawnStrategy + @minsky/budget-guard for fully autonomous spawn.\n",
  );
  writeIterationRecord(hostRoot, {
    ts: new Date().toISOString(),
    experiment_id: plan.taskId,
    host_repo: hostRepo,
    branch: plan.branchName,
    verdict: "planned",
    pr_url: null,
    notes: "live-mode v0 placeholder — operator manually drives Claude Code from here",
  });
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
    emitLiveV0Placeholder(plan, hostRoot, config.host_repo);
  } else {
    emitDryRunReport(plan, hostRoot, config.host_repo);
  }
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
