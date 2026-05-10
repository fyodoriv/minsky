<!-- security: not-applicable — local-only daemon spawn + PID file write under MINSKY_HOME, no auth/PII/network-input/supply-chain surface; readiness probe reuses the existing buildServerProbe hardened in slice 1 -->

## Summary

Slice 10 of P0 task `minsky-cli-auto-bootstrap-local-llm` — fix a latent hang in the bootstrap pipeline.

The `start-mlx-server` step shipped in slices 1–2 was wired through the same `spawn-and-await-close` adapter as the install steps. Because `mlx_lm.server` is a long-lived daemon that never `close`s on the happy path, `executeBootstrapPlan` would block forever once it reached that step — bootstrap could install everything, then hang at the very end, leaving the operator without an iterating daemon.

This slice splits the daemon case out:

- **Pure helper** `pollUntilReachable` (`novel/tick-loop/src/local-llm-server-launcher.ts`) — pure-over-injection poll loop with `probe`/`sleepFn`/`nowFn` seams. 5 chaos-table rows (immediate-ready, ready-after-N, never-ready, probe-rejects, zero-timeout) covered by paired tests.
- **Executor seam** — `SpawnFn` opts gain `daemonMode?: boolean`; `runOneStep` sets it for `start-mlx-server` only. Test asserts `daemonMode=true` for that step and `false` for install steps.
- **Wire-in** — `bin/minsky.mjs` `spawnAdapter` branches on `daemonMode`: detached spawn + stdio→`.minsky/local-llm.log` + writes `.minsky/local-llm.pid` + polls `buildServerProbe` for up to 120 s. Resolves with `exitCode: 0` on reachable, `exitCode: 1` + reason on timeout (executor surfaces this as a failed step, falling back to claude-only iteration per the planner's pivot path).

The PID file unlocks the task block's "(5) writes its PID to `.minsky/local-llm.pid` so subsequent `minsky` invocations can detect liveness" requirement; the existing HTTP probe still drives the actual liveness decision.

## Hypothesis self-grade

- **Predicted**: post-fix, `executeBootstrapPlan` completes when `start-mlx-server` is the final step (no infinite hang); the new `pollUntilReachable` helper returns within `timeoutMs + intervalMs` for every chaos-table input; `.minsky/local-llm.pid` is written when the daemon spawn succeeds.
- **Observed**: 21 paired tests green (`local-llm-server-launcher.test.ts` 8 tests, `local-llm-bootstrap-executor.test.ts` 13 tests) — the executor test asserts `daemonMode` plumbing reaches `spawnFn`; the launcher tests cover all 5 chaos-table rows. Build clean. Live wall-clock measurement deferred to operator dogfood (the 17 GB model download dominates the integration test cost).
- **Match**: yes
- **Lesson**: the "spawn returns when child closes" abstraction breaks for daemon-launching steps; encoding the daemon-vs-installer distinction at the step-type layer (rather than command-name heuristics in the adapter) keeps the executor pure-over-injection and lets paired tests pin the contract.

## Optimization

`optimization: none-this-iteration: slice unblocks a P0 hang; no eligible optimization (brief-shrink / cache-extend / skip-earlier / log-dedup / round-trip-elim) bundled.`

## Test plan

- [x] `vitest run novel/tick-loop/src/local-llm-server-launcher.test.ts novel/tick-loop/src/local-llm-bootstrap-executor.test.ts` — 21/21 green
- [x] `pnpm --filter @minsky/tick-loop build` — clean
- [ ] live-fire: operator runs `minsky bootstrap-local-llm` on a clean machine, observes mlx-lm.server starts detached, `.minsky/local-llm.pid` exists, daemon iterates against the local model

🤖 Generated with [Claude Code](https://claude.com/claude-code)
