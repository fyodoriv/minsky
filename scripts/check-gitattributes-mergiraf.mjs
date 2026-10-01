#!/usr/bin/env node
// <!-- scope: human-approved slice 5 of daemon-parallel-worktree-launch (operator 2026-05-06: ensure conflict resolution) -->
// Real-FS invariant: `.gitattributes` declares the Mergiraf merge driver for
// the high-conflict file globs, so the daemon's auto-resolution slice can
// rely on it. Slice 5 of `daemon-parallel-worktree-launch`.
//
// Pure decision function `checkMergirafGlobs(text)` returns the missing-glob
// list. CLI thin wrapper exits 0 if all required globs are declared, 1
// otherwise.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REQUIRED_MERGIRAF_GLOBS = Object.freeze([
  "*.ts",
  "*.tsx",
  "*.mjs",
  "*.js",
  "*.json",
  "*.md",
  "*.yml",
  "*.yaml",
]);

/**
 * @param {string} gitattributesText
 * @returns {readonly string[]} the subset of REQUIRED_MERGIRAF_GLOBS that is NOT declared as `merge=mergiraf`
 */
export function findMissingMergirafGlobs(gitattributesText) {
  const lines = gitattributesText.split(/\r?\n/);
  const declared = new Set(
    lines
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter((l) => l.length > 0 && l.includes("merge=mergiraf"))
      .map((l) => l.split(/\s+/)[0]),
  );
  return REQUIRED_MERGIRAF_GLOBS.filter((g) => !declared.has(g));
}

function main() {
  const root = resolve(import.meta.dirname, "..");
  let text;
  try {
    text = readFileSync(resolve(root, ".gitattributes"), "utf8");
  } catch {
    console.error("check-gitattributes-mergiraf: .gitattributes is missing.");
    console.error("Restore it with the slice-5 substrate of daemon-parallel-worktree-launch.");
    process.exit(1);
  }
  const missing = findMissingMergirafGlobs(text);
  if (missing.length === 0) {
    process.stdout.write(
      `check-gitattributes-mergiraf: OK (${REQUIRED_MERGIRAF_GLOBS.length} globs declared).\n`,
    );
    process.exit(0);
  }
  console.error(`check-gitattributes-mergiraf: missing merge=mergiraf for: ${missing.join(", ")}`);
  console.error("Add lines to .gitattributes: `<glob> merge=mergiraf` (one per missing glob).");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
