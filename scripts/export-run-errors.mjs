#!/usr/bin/env node
// @ts-check
// Export the FULL list of errors captured for a run (task `obs-error-capture-
// and-reporter`). Reads `.minsky/runs/<id>/errors.jsonl` and prints a JSON
// array — the queryable "full error list" the runbook promises.
//
//   node scripts/export-run-errors.mjs --run latest --json
//   node scripts/export-run-errors.mjs --run <run-id> --json
//
// `--run latest` picks the most-recently-modified run dir. Missing file → [].

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const RUNS = join(REPO, ".minsky", "runs");

/** @returns {string | null} newest run-id by dir mtime */
function latestRunDir() {
  if (!existsSync(RUNS)) return null;
  const dirs = readdirSync(RUNS)
    .map((n) => ({ n, p: join(RUNS, n) }))
    .filter((e) => {
      try {
        return statSync(e.p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b.p).mtimeMs - statSync(a.p).mtimeMs);
  const top = dirs[0];
  return top ? top.n : null;
}

/** @param {string} runId @returns {unknown[]} */
function readErrors(runId) {
  const f = join(RUNS, runId, "errors.jsonl");
  if (!existsSync(f)) return [];
  const raw = readFileSync(f, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--run");
  const arg = i >= 0 ? args[i + 1] : "latest";
  const runId = !arg || arg === "latest" ? latestRunDir() : arg;
  const errors = runId ? readErrors(runId) : [];
  process.stdout.write(`${JSON.stringify(errors)}\n`);
}

main();
