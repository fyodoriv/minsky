// <!-- scope: human-approved 2026-05-24 operator directive "Let's work on completely integrating with openhands today" — Path C reshape phase 1 -->
// Public API for @minsky/agent-runtime-openhands.
//
// Single import surface: callers use `buildOpenHandsInvocation` to
// produce a spawn envelope; the daemon (`bin/minsky-run.mjs`) calls
// `child_process.spawn(command, argv, { cwd })` with the result.

export type {
  OpenHandsInvocation,
  OpenHandsSpawnInput,
} from "./spawner.js";
export { buildOpenHandsInvocation, resolveShimPath } from "./spawner.js";
