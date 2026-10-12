// Shared `--repo` flag for check-rule scripts, so a sibling repo (agentbrew,
// dotfiles) can run the same deterministic gate on its own tree.
// Without the flag, the script keeps its old root: this checkout.

import { resolve } from "node:path";

/**
 * Return the repo root named by `--repo=<path>` or `--repo <path>`.
 *
 * @param {readonly string[]} argv  process.argv.slice(2)
 * @param {string} fallback          root to use when the flag is absent
 * @returns {string}
 */
export function repoFromArgv(argv, fallback) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const next = argv[i + 1];
    if (arg.startsWith("--repo=")) return resolve(arg.slice("--repo=".length));
    if (arg === "--repo" && next !== undefined) return resolve(next);
  }
  return fallback;
}
