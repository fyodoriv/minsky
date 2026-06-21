#!/usr/bin/env node
// Dry-run sweeper for stale DELIVERED-retained TASKS.md blocks.
// Usage: node scripts/sweep-stale-task-blocks.mjs --dry-run <path-to-TASKS.md>
// Output (--dry-run): { would_patch: [{ task_id, citing_files: [] }, ...] }
//
// A block is "stale" when **Blocked**: matches /DELIVERED.*block retained.*freeform-cite/.
// Blocks with DELIVERED but no freeform-cite emit "skipping — may need operator review".
// Pattern: Beck 2002 TDD Ch.2 "fake it" — dry-run first, mutate in slice-2.

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TASK_HEADER_RE = /^- \[ \] `([a-z0-9][a-z0-9-]*)` /;
const BLOCKED_RE = /^\s+- \*\*Blocked\*\*:\s*(.+)/;
const STALE_RE = /DELIVERED.*block retained.*freeform-cite/;
const DELIVERED_RE = /DELIVERED/;

/** @param {string} tasksContent @returns {{ id: string; blockedValue: string }[]} */
export function parseStalePatchCandidates(tasksContent) {
  const lines = tasksContent.split("\n");
  /** @type {{ id: string; blockedValue: string }[]} */
  const results = [];
  let id = /** @type {string|null} */ (null);
  let blocked = /** @type {string|null} */ (null);

  const flush = () => {
    if (id && blocked) {
      if (STALE_RE.test(blocked)) {
        results.push({ id, blockedValue: blocked });
      } else if (DELIVERED_RE.test(blocked)) {
        process.stderr.write(`skipping \`${id}\` — may need operator review\n`);
      }
    }
    id = null;
    blocked = null;
  };

  for (const line of lines) {
    const h = TASK_HEADER_RE.exec(line);
    if (h) { flush(); id = h[1] ?? null; continue; }
    const b = BLOCKED_RE.exec(line);
    if (b && id) { blocked = b[1] ?? null; }
  }
  flush();
  return results;
}

/** @param {string} taskId @param {string} repoRoot @returns {string[]} */
export function findCitingFiles(taskId, repoRoot) {
  const dirs = ["tests", "scripts", "user-stories", "novel"].filter((d) => {
    try { statSync(resolve(repoRoot, d)); return true; } catch { return false; }
  });
  if (dirs.length === 0) return [];
  try {
    const out = execSync(`rg -l ${JSON.stringify(taskId)} ${dirs.join(" ")}`, {
      encoding: "utf8",
      cwd: repoRoot,
    });
    return out.split("\n").filter((f) => f.trim().length > 0);
  } catch {
    return [];
  }
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const tasksPath = argv.find((a) => !a.startsWith("--"));
  if (!tasksPath) {
    process.stderr.write("Usage: sweep-stale-task-blocks.mjs --dry-run <path-to-TASKS.md>\n");
    process.exit(1);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const content = readFileSync(resolve(repoRoot, tasksPath), "utf8");
  const candidates = parseStalePatchCandidates(content);
  const wouldPatch = candidates.map(({ id }) => ({
    task_id: id,
    citing_files: findCitingFiles(id, repoRoot),
  }));

  if (dryRun) {
    process.stdout.write(JSON.stringify({ would_patch: wouldPatch }, null, 2) + "\n");
    process.exit(0);
  }
  process.stderr.write("Live mode not implemented in slice-1; pass --dry-run.\n");
  process.exit(1);
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main();
