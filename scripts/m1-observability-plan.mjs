#!/usr/bin/env node
// M1 Observability Plan — for each M1 task, determines what observability
// signals are needed and generates a concrete instrumentation checklist.
//
// Usage: node scripts/m1-observability-plan.mjs [--json] [--gaps-only]
//
// Six observability signals per task:
//   1. OTEL span — emitted when the feature runs
//   2. Daemon log — human-readable line in daemon.log
//   3. Dashboard — visible in minsky watch / minsky status
//   4. Experiment store — iteration records in .minsky/experiment-store/
//   5. Self-diagnose invariant — catches regressions at runtime
//   6. METRICS.md — tracked in the project metrics

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const jsonMode = process.argv.includes("--json");
const gapsOnly = process.argv.includes("--gaps-only");

const content = readFileSync(join(ROOT, "TASKS.md"), "utf8");

const SIGNAL_KEYWORDS = {
  otel_span: ["otel", "span", "tick-loop.", "trace"],
  daemon_log: ["daemon.log", "daemon log", "log line", "process.stdout.write"],
  dashboard: ["dashboard", "watch", "minsky status"],
  experiment_store: ["experiment-store", "jsonl", "iteration record"],
  self_diagnose: ["self-diagnose", "invariant", "self_diagnose"],
  metrics_md: ["metrics.md", "metrics"],
};

/**
 * Classify each task by what observability it needs.
 * @param {string} taskId
 * @param {string} block
 */
function classifyTask(taskId, block) {
  const lower = block.toLowerCase();

  // What signals does the task MENTION?
  /** @type {Record<string, boolean>} */
  const mentioned = {};
  for (const [name, keywords] of Object.entries(SIGNAL_KEYWORDS)) {
    mentioned[name] = keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  // What signals does this task NEED? (heuristic by task type)
  /** @type {Record<string, boolean>} */
  const needed = {
    otel_span: true, // every task should emit a span
    daemon_log: lower.includes("daemon") || lower.includes("iteration") || lower.includes("spawn"),
    dashboard:
      lower.includes("status") ||
      lower.includes("watch") ||
      lower.includes("dashboard") ||
      lower.includes("stability"),
    experiment_store:
      lower.includes("iteration") || lower.includes("spawn") || lower.includes("validated"),
    self_diagnose:
      lower.includes("bug") ||
      lower.includes("error") ||
      lower.includes("fail") ||
      lower.includes("crash") ||
      lower.includes("stuck"),
    metrics_md:
      lower.includes("metric") ||
      lower.includes("stability") ||
      lower.includes("throughput") ||
      lower.includes("rate"),
  };

  // Generate the plan
  /** @type {string[]} */
  const gaps = [];
  for (const [signal, isNeeded] of Object.entries(needed)) {
    if (isNeeded && !mentioned[signal]) {
      gaps.push(signal);
    }
  }

  const score = Object.values(mentioned).filter(Boolean).length;
  return { taskId, score, mentioned, needed, gaps };
}

// Extract all M1 tasks
/** @type {ReturnType<typeof classifyTask>[]} */
const tasks = [];
const taskRegex = /- \[ \] `([^`]+)`(.*?)(?=\n- \[ \] |\n## |Z)/gs;
/** @type {RegExpExecArray | null} */
let match;
// biome-ignore lint/suspicious/noAssignInExpressions: standard JS regex iteration idiom
while ((match = taskRegex.exec(content)) !== null) {
  const taskId = match[1] ?? "";
  const block = match[2] ?? "";
  if (block.includes("**Milestone**: M1") || !block.includes("**Milestone**")) {
    tasks.push(classifyTask(taskId, block));
  }
}

// Summary
const total = tasks.length;
const avgScore = (tasks.reduce((s, t) => s + t.score, 0) / total).toFixed(1);
const zeroGaps = tasks.filter((t) => t.gaps.length === 0).length;
const totalGaps = tasks.reduce((s, t) => s + t.gaps.length, 0);

if (jsonMode) {
  console.info(
    JSON.stringify({ total, avgScore: Number(avgScore), zeroGaps, totalGaps, tasks }, null, 2),
  );
} else {
  console.info("\n🔭 M1 Observability Plan\n");
  console.info(`   Total M1 tasks: ${total}`);
  console.info(`   Avg observability score: ${avgScore}/6`);
  console.info(`   Fully observed (0 gaps): ${zeroGaps}/${total}`);
  console.info(`   Total gaps to close: ${totalGaps}\n`);

  // Per-signal gap count
  /** @type {Record<string, number>} */
  const signalGaps = {};
  for (const t of tasks) {
    for (const g of t.gaps) {
      signalGaps[g] = (signalGaps[g] ?? 0) + 1;
    }
  }
  console.info("   Gap by signal type:");
  for (const [signal, count] of Object.entries(signalGaps).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.min(count, 40));
    console.info(`     ${signal.padEnd(20)} ${String(count).padStart(3)} tasks  ${bar}`);
  }
  console.info();

  // Task-level detail
  if (!gapsOnly) {
    console.info("   Per-task gaps:");
    for (const t of tasks
      .filter((t) => t.gaps.length > 0)
      .sort((a, b) => b.gaps.length - a.gaps.length)) {
      console.info(`     ${t.taskId}`);
      console.info(`       score: ${t.score}/6, gaps: ${t.gaps.join(", ")}`);
    }
  } else {
    // Just the tasks with the most gaps
    console.info("   Top 20 worst-observed tasks:");
    for (const t of tasks.sort((a, b) => b.gaps.length - a.gaps.length).slice(0, 20)) {
      console.info(`     ${t.gaps.length} gaps: ${t.taskId} → add: ${t.gaps.join(", ")}`);
    }
  }
  console.info();
}
