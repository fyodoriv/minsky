<!-- pattern: not-applicable — PR description document, not a source artefact -->
# feat(local-llm): slice 64 — smoke tests for env-var early-exit paths in maybeBootstrapLocalLlm

## Summary

- **Slice 64**: adds 3 paired smoke tests for the three env-var short-circuit paths in `maybeBootstrapLocalLlm` that had no coverage:
  - `MINSKY_NO_AUTO_BOOTSTRAP=1` → returns `{}` without calling any probe or `bootstrapFn`
  - `MINSKY_LOCAL_LLM=1` (already opted in) → returns `{}` without re-running bootstrap
  - `MINSKY_LLM_PROVIDER=local-preferred` → calls `bootstrapFn` directly, skipping the live server/claude probe
- Test count in `minsky-bootstrap-smoke.test.ts` increases from 6 to 9. All 9 pass.
- Uses `vi.stubEnv` / `vi.unstubAllEnvs` (vitest built-in) for clean per-test env isolation.

**Optimization**: none-this-iteration: test-only slice; no new production code path added.

## Hypothesis

The three env-var short-circuit paths in `maybeBootstrapLocalLlm` (`MINSKY_NO_AUTO_BOOTSTRAP=1`, `MINSKY_LOCAL_LLM=1`, `MINSKY_LLM_PROVIDER=local-preferred`) had no test coverage. Adding coverage will catch any future regressions in these critical operator escape-hatch / bootstrap-shortcut paths, particularly the `MINSKY_LLM_PROVIDER=local-preferred → bootstrapFn` wiring which exercises the DI seam added in slice 63.

**Success**: test count 6 → 9; all 9 pass; `pnpm pre-pr-lint` green.

**Pivot**: if `vi.stubEnv` causes interference with import-time env checks in `minsky.mjs`, restructure tests to inject env via `opts` instead of env mutation.

**Measurement**: `pnpm vitest run novel/tick-loop/src/minsky-bootstrap-smoke.test.ts` — 9/9 pass.

**Anchor**: Rule #9 (pre-registered HDD); paired-test discipline (task block § Details point f).

## Changed files

- `novel/tick-loop/src/minsky-bootstrap-smoke.test.ts` — 3 new tests for env-var early-exit paths; `afterEach` + `vi` imported

## Hypothesis self-grade

- **Predicted**: 3 env-var paths have no coverage; adding them pins the `MINSKY_LLM_PROVIDER=local-preferred → bootstrapFn` wiring and the two no-op exits against future regressions
- **Observed**: 9/9 tests pass including 3 new slice-64 tests; `vi.stubEnv` works cleanly with no test interference; `MINSKY_LLM_PROVIDER=local-preferred` correctly routes through `bootstrapFn` DI seam
- **Match**: yes
- **Lesson**: `vi.stubEnv` + `afterEach(() => vi.unstubAllEnvs())` is the correct pattern for env-var isolation in vitest — cleaner than manual save/restore; reuse for any future env-dependent tests

<!-- security: not-applicable — test-only slice; no production code changed; no auth/secrets/sandbox/PII/supply-chain surface; § 13 reviewed -->
