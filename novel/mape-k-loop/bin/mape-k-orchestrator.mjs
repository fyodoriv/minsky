#!/usr/bin/env node
// @ts-check
/**
 * `mape-k-orchestrator` CLI — the I/O boundary that drives `orchestrate(...)`
 * (see `novel/mape-k-loop/src/orchestrator.ts`).
 *
 * Reads:
 *   - `experiment-store/*.jsonl`  — verdict log (one JSON per line)
 *   - `novel/mape-k-loop/constraints.md`  — tail (last ~4 KiB)
 *   - `.claude/skills/<id>/SKILL.md`  — current prompts (per skill)
 *
 * Writes (unless `--dry-run`):
 *   - appends `result.knowledge.constraintsAppend` to
 *     `novel/mape-k-loop/constraints.md`
 *   - on rollout: writes `result.rolloutDraft.experimentYaml` to
 *     `tmp/proposed-rollouts/<branchSlug>.EXPERIMENT.yaml`
 *   - on calibration drift: writes
 *     `result.knowledge.researchAmendmentProposal` to
 *     `tmp/proposed-rule-9-amendment.md`
 *
 * The CLI does NOT open PRs or push branches — that's a follow-up. v0
 * writes drafts to `tmp/` so the operator (or a CI workflow) can review +
 * commit them.
 *
 * Flags:
 *   --dry-run                          Don't write anything; print a summary.
 *   --ingest-mode                      Skip Plan/Execute (verdict ingest only).
 *   --max-rollouts=N                   Cap rollout drafts per invocation (default 1).
 *   --experiment-store=PATH            Override `experiment-store` directory.
 *   --constraints-md=PATH              Override `constraints.md` path.
 *   --skills-dir=PATH                  Override `.claude/skills` directory.
 *   --tmp-dir=PATH                     Override write target (default `tmp`).
 *
 * Pattern: thin runner / I/O boundary (Martin, *Clean Architecture*, 2017).
 *
 * @otel-exempt CLI module — the load-bearing function is the imported
 *   `orchestrate(...)`, which carries the `mape-k-loop.orchestrate` span.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { StubPromptOptimizer } from "@minsky/prompt-optimizer";

import { orchestrate } from "../dist/orchestrator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");

/**
 * Parse CLI args. Pure function over `argv`.
 *
 * @param {readonly string[]} argv
 */
function parseArgs(argv) {
  const out = {
    dryRun: false,
    ingestMode: false,
    maxRollouts: 1,
    experimentStore: resolve(REPO_ROOT, "experiment-store"),
    constraintsMd: resolve(REPO_ROOT, "novel", "mape-k-loop", "constraints.md"),
    skillsDir: resolve(REPO_ROOT, ".claude", "skills"),
    tmpDir: resolve(REPO_ROOT, "tmp"),
  };
  for (const arg of argv) applyArg(arg, out);
  return out;
}

/**
 * @param {string} arg
 * @param {ReturnType<typeof parseArgs>} out
 */
function applyArg(arg, out) {
  if (arg === "--dry-run") {
    out.dryRun = true;
    return;
  }
  if (arg === "--ingest-mode") {
    out.ingestMode = true;
    return;
  }
  const max = valueAfter(arg, "--max-rollouts=");
  if (max !== undefined) out.maxRollouts = Number(max);
  const store = valueAfter(arg, "--experiment-store=");
  if (store !== undefined) out.experimentStore = resolve(store);
  const constraints = valueAfter(arg, "--constraints-md=");
  if (constraints !== undefined) out.constraintsMd = resolve(constraints);
  const skills = valueAfter(arg, "--skills-dir=");
  if (skills !== undefined) out.skillsDir = resolve(skills);
  const tmp = valueAfter(arg, "--tmp-dir=");
  if (tmp !== undefined) out.tmpDir = resolve(tmp);
}

/**
 * @param {string} arg
 * @param {string} prefix
 */
function valueAfter(arg, prefix) {
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined;
}

/**
 * Read the verdict log from `experiment-store/*.jsonl`. One JSON per line.
 * Malformed lines are dropped silently — graceful-degrade per rule #7.
 *
 * @param {string} dir
 */
function readVerdictLog(dir) {
  if (!existsSync(dir)) return [];
  const entries = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const path = join(dir, file);
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parsed = tryParseLine(trimmed);
      if (parsed !== undefined) entries.push(parsed);
    }
  }
  return entries;
}

/**
 * @param {string} line
 */
function tryParseLine(line) {
  // rule-6: handled-locally — JSONL parse failure is the documented
  // graceful-degrade path (rule #7); a corrupt line must not crash the
  // ingest run.
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Read the current prompts from `.claude/skills/<id>/SKILL.md`. Skips
 * non-directories silently — graceful-degrade per rule #7.
 *
 * @param {string} dir
 * @returns {Record<string, string>}
 */
function readCurrentPrompts(dir) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name, "SKILL.md");
    if (!existsSync(path)) continue;
    out[name] = readFileSync(path, "utf-8");
  }
  return out;
}

/**
 * Read the last 4 KiB of `constraints.md` (or whole file if smaller).
 *
 * @param {string} path
 */
function readConstraintsMdTail(path) {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf-8");
  const TAIL = 4096;
  return content.length <= TAIL ? content : content.slice(-TAIL);
}

const args = parseArgs(process.argv.slice(2));

const verdictLog = readVerdictLog(args.experimentStore);
const constraintsMdTail = readConstraintsMdTail(args.constraintsMd);
const currentPrompts = readCurrentPrompts(args.skillsDir);

const result = await orchestrate({
  verdictLog,
  constraintsMdTail,
  currentPrompts,
  optimizer: new StubPromptOptimizer(),
  history: [],
  now: new Date(),
  ingestMode: args.ingestMode,
  maxRollouts: args.maxRollouts,
});

process.stdout.write(
  `[mape-k-orchestrator] verdict-log entries: ${verdictLog.length}; ingest-mode: ${args.ingestMode}; rollout: ${result.rolloutDraft !== undefined}\n`,
);

if (args.dryRun) {
  process.stdout.write("[mape-k-orchestrator] --dry-run: skipping writes.\n");
  process.exit(0);
}

mkdirSync(args.tmpDir, { recursive: true });

if (result.knowledge.constraintsAppend.length > 0) {
  const existed = existsSync(args.constraintsMd);
  const prefix = existed ? "" : "# constraints.md\n\n";
  appendFileSync(args.constraintsMd, prefix + result.knowledge.constraintsAppend, "utf-8");
  process.stdout.write(`[mape-k-orchestrator] appended to ${args.constraintsMd}\n`);
}

if (result.knowledge.researchAmendmentProposal !== null) {
  const path = join(args.tmpDir, "proposed-rule-9-amendment.md");
  writeFileSync(path, result.knowledge.researchAmendmentProposal, "utf-8");
  process.stdout.write(`[mape-k-orchestrator] wrote ${path}\n`);
}

if (result.rolloutDraft !== undefined) {
  const dir = join(args.tmpDir, "proposed-rollouts");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${result.rolloutDraft.branchSlug}.EXPERIMENT.yaml`);
  writeFileSync(path, result.rolloutDraft.experimentYaml, "utf-8");
  process.stdout.write(
    `[mape-k-orchestrator] wrote rollout draft ${path} (variant: ${result.rolloutDraft.variantId})\n`,
  );
}
