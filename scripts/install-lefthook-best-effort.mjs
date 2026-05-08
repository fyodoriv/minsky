#!/usr/bin/env node
// <!-- scope: human-approved fresh-clone-bootstrap-bulletproof-lefthook (operator 2026-05-08 — "It's because of hardcoded username. On that machine it's different") -->
//
// Best-effort `lefthook install`. Used by the root `prepare` script so a
// failed hook installation never breaks `pnpm install`. The shell-only
// fallback `(lefthook install || echo 'warning')` is robust on a sane
// shell, but pnpm v9's lifecycle runner has historically tripped on
// edge cases (different machines, pnpm cache, dotfiles syncing weird
// `core.hooksPath` values across machines, sudo'd installs). A node
// script gives us a single deterministic exit code (always 0) plus a
// structured warning the operator can grep for in install logs.
//
// Failure modes (rule #7):
//   1. core.hooksPath points at a path the current user can't write
//      (typical: dotfiles synced across machines with hardcoded
//      `/Users/<username>/...` paths; on a machine with a different
//      username the path is invalid → mkdir EACCES).
//   2. .git/hooks/ is owned by a different user (the repo was cloned
//      via sudo once, then pnpm install runs as the regular user).
//   3. lefthook binary missing (rare: pnpm install hadn't completed
//      yet — but this script runs from prepare AFTER deps install).
//   4. .git/ is read-only (rare: read-only NFS mount).
//
// All of these → log a one-line warning, exit 0. The operator can
// then run `pnpm exec lefthook install` manually after fixing the
// underlying issue, and CI's lefthook gate is unaffected (it doesn't
// rely on this script — CI installs hooks via its own setup).
//
// Pattern: graceful-degrade per rule #6 (let-it-crash AT the right
// boundary — Armstrong 2007). Hook installation is operator-config-
// dependent (out-of-band — the install script can't fix the
// permission); the right boundary for failure is a warning + recovery
// instructions, not a blocked install.

import { spawnSync } from "node:child_process";

const result = spawnSync("lefthook", ["install"], {
  stdio: "inherit",
  shell: false,
});

if (result.status === 0) {
  // lefthook printed its own success line; nothing else to log.
  process.exit(0);
}

const errCode = /** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code;
const reason =
  errCode === "ENOENT"
    ? "lefthook binary not found"
    : `lefthook install exited ${result.status ?? "<signal>"}`;

process.stderr.write(
  `\n[install-lefthook] warning: ${reason}; local pre-commit / pre-push gates disabled. Common causes: (a) \`git config core.hooksPath\` points to a path the current user can't write (e.g., dotfiles synced from another machine with a hardcoded \`/Users/<other-username>/...\`); (b) \`.git/hooks/\` is owned by a different user. After fixing, run \`pnpm exec lefthook install\` manually.\n`,
);
process.exit(0);
