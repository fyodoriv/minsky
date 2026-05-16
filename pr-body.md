## Why needed

P0 `local-worker-worktree-never-created`. Slices 1+2 (PR #572, merged) made `buildLocalStrategy` create the per-worker git worktree via `ensureWorktree` before the aider/opencode spawn. This is **Slice 3**: the defense-in-depth workspace-boundary guard the task's Acceptance #3 and `Files` list (`spawn-strategy.ts` — "surface a clear cwd-missing error") call for, plus the Acceptance #6 doc note.

Before this, if the resolved worktree `cwd` was missing for *any* reason (prune race, stale gitdir, an `ensureWorktree` regression), Node's `child_process.spawn` emitted a cryptic `spawn aider ENOENT` that names the *command*, not the missing directory — un-actionable for the operator, and the model was effectively spawned against a bad cwd. That cryptic-ENOENT was exactly the symptom the operator hit across ~100 dogfood iterations.

**Bundled prerequisite (same `local-preferred` domain):** the pre-push hook runs `pre-pr-lint --stage=full`, whose full vitest run was red on `origin/main` *before* this branch — `minsky-bootstrap-smoke.test.ts` is not env-hermetic and `maybeBootstrapLocalLlm` early-returns on ambient `MINSKY_LOCAL_LLM` / `MINSKY_LLM_PROVIDER` / `MINSKY_NO_AUTO_BOOTSTRAP` *before* the DI seam is consulted (minsky.mjs:328/332/348). The Minsky daemon spawns its workers with `MINSKY_LLM_PROVIDER=local-preferred MINSKY_LOCAL_LLM=1` — the **exact** environment this P0 targets — so the smoke test's DI-seam assertions returned `{}` from the env short-circuit and 2/3 tests failed in any local-preferred shell. That blocked **every** push from a local-preferred daemon (`blocks-fanout`), so slice 3 could not ship without it. The test SUT (`bin/minsky.mjs`) is byte-identical to `origin/main`: this is a pre-existing test-isolation defect, not a slice-3 regression.

## What changed

- `novel/tick-loop/src/spawn-strategy.ts`: `ProcessSpawnStrategy` gains an injectable `existsFn` seam (default `node:fs.existsSync`, same pattern as `spawnFn`). `spawn()` now checks the resolved invocation `cwd` exists **before** calling `child_process.spawn`; a missing cwd rejects loud with a one-line operator-actionable message naming the directory, the command, and the P0 task (rule #6 / Armstrong 2007 — fail at the workspace boundary, never spawn the model into a bad cwd). The guard only runs when the invocation has a `cwd` (legacy / single-process path is unaffected).
- `novel/tick-loop/src/spawn-strategy.test.ts`: 3 paired tests — cwd-missing → reject names the dir + P0 task and `spawnFn` is **not** called; cwd-present → proceeds and the checked path is the cwd; no-cwd → guard skipped (legacy path unaffected).
- `novel/tick-loop/src/minsky-bootstrap-smoke.test.ts`: made env-hermetic — a `beforeEach`/`afterEach` snapshots and clears the three ambient gating keys (`MINSKY_NO_AUTO_BOOTSTRAP`, `MINSKY_LOCAL_LLM`, `MINSKY_LLM_PROVIDER`) so the DI seam is exercised regardless of the shell's `local-preferred` env, then restores them. Test-only; no production behavior change.
- `docs/local-llm-fallback.md`: new "Worktree lifecycle — the local path owns it" section + a failure-modes table row (Acceptance #6).
- `TASKS.md`: Progress line updated (no new task block).

## Manual test delta

- `npx vitest run novel/tick-loop/src/spawn-strategy.test.ts` → 20 passed (3 new, slice 3).
- `npx vitest run novel/tick-loop/src/minsky-bootstrap-smoke.test.ts` → 3 passed (was 2 failed | 1 passed in the daemon's `local-preferred` env before the hermetic fix).
- `npx @tasks-md/lint TASKS.md` → 0 errors.

## Optimization

`optimization: skip-earlier gate` — the cwd-missing case is now detected before the `child_process.spawn` round-trip, eliminating a wasted subprocess spawn and the cryptic-`ENOENT`-then-operator-diagnosis round-trip on every broken-worktree local iteration. The operator-facing diagnostic is one precise line instead of a stack trace (well over the ≥10-byte bar in actionable signal; strictly fewer syscalls on the failure path).

## Security & privacy

Surface: subprocess spawn / sandbox boundary. The change *narrows* the surface — it refuses to `spawn` a child when the intended working directory does not exist, instead of letting the OS resolve the spawn against an unexpected/inherited cwd. Threat: a model process running in an unintended directory (e.g. the repo root instead of an isolated worktree) could read/write outside its intended blast radius. Mitigation: explicit pre-spawn existence check that fails closed (reject, no spawn) with no path data leaked beyond the resolved cwd the operator already configured. The bundled test-isolation change is test-only (no runtime/secret/PII surface). No new secrets, auth, PII, or network surface; vision.md § 13 reviewed.

## Hypothesis self-grade

- **Predicted**: a missing worktree `cwd` on the local spawn path will produce a loud one-line operator-actionable error that names the directory and the P0 task, and the model subprocess will NOT be spawned (no cryptic `spawn aider ENOENT`); verified by the 3 new paired tests, with the full pre-push vitest green so the fix can actually ship from a local-preferred daemon.
- **Observed**: `npx vitest run novel/tick-loop/src/spawn-strategy.test.ts` → 20 passed; the cwd-missing test asserts the rejection matches `/worktree cwd "…daemon-0-some-task" does not exist/` and `/local-worker-worktree-never-created/` with `spawnCalls === 0`; the hermetic `minsky-bootstrap-smoke.test.ts` → 3 passed (was 2 failed in the daemon env), unblocking the pre-push full-stage gate.
- **Match**: yes
- **Lesson**: a DI-seam unit test that reads ambient `process.env` is not actually hermetic — it must sandbox the gating keys or it fails in exactly the environment the feature targets; the task's remaining Acceptance #4/#5 (2h success_ratio ≥ 0.7, ≥1 local-authored merged PR) are runtime-only and now unblocked.
