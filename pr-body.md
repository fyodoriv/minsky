<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
## feat(minsky-cli): slice 36 — step-specific recovery hints on bootstrap failure

### Summary

**Closes the remaining failure-mode gap from the task's Details section**: "pipx install fails → loud-crash with the exact `pipx` error + a recovery hint (`brew install pipx`)". Previously `executePlanWithProductionIo` reported the error but gave no step-specific recovery command, forcing the operator to consult the docs.

**Change**: add `recoveryHintForStep(stepType)` — a pure exported function in `local-llm-bootstrap-executor.ts` — that maps each of the 6 `BootstrapStepType` values to a concrete operator-actionable command. Wire it into `executePlanWithProductionIo` in `bin/minsky.mjs` so the failure path emits a `minsky: recovery: <cmd>` line immediately after the failure reason.

Examples of what the operator now sees on failure:

| Failed step | Recovery line |
|---|---|
| `install-pipx` | `minsky: recovery: brew install pipx` |
| `install-mlx-lm` | `minsky: recovery: pipx install mlx-lm` |
| `download-model` | `minsky: recovery: retry is idempotent — rerun \`minsky bootstrap-local-llm\`` |
| `install-arm-homebrew` | `minsky: recovery: /bin/bash -c "$(curl ...)"` |

**Files changed:**

- `novel/tick-loop/src/local-llm-bootstrap-executor.ts` — scope comment; import `BootstrapStepType`; add exported `recoveryHintForStep` function with a `Record<BootstrapStepType, string>` map
- `novel/tick-loop/src/local-llm-bootstrap-executor.test.ts` — import `recoveryHintForStep`; add 4 paired tests (pipx hint, exhaustive-type-coverage, mlx-lm hint, download-model idempotent-retry wording)
- `novel/tick-loop/src/index.ts` — re-export `recoveryHintForStep`
- `novel/tick-loop/bin/minsky.mjs` — scope comment; add `recoveryHintForStep` to import destructuring; wire into `executePlanWithProductionIo`'s failure path

### Experiment

**Hypothesis**: When a bootstrap step fails, the operator sees a concrete recovery command on the next line (one per failing step type), removing the need to consult `docs/local-llm-fallback.md` for remediation. All 6 step types have a registered hint. `pnpm test` passes (19 executor tests, 4 new).

**Success threshold**: `pnpm test` passes; TypeScript build clean; 4 new tests green; `recoveryHintForStep` returns a non-empty string for every `BootstrapStepType`.

**Pivot threshold**: If the hint map becomes stale (step command changes), the paired test for exhaustive-type coverage catches it at type-check time — the `Record<BootstrapStepType, string>` type forces exhaustiveness.

**Measurement**: `pnpm test` passes (19 executor tests). TypeScript exhaustiveness: `Record<BootstrapStepType, string>` (not `Partial<Record<...>>`) means a compile error if a new step type is added without a hint.

**Anchor**: Task Details section (operator 2026-05-08): "pipx install fails → loud-crash with the exact `pipx` error + a recovery hint (`brew install pipx`)". Hughes, "Why Functional Programming Matters", 1989 — pure function over step-type enum is the correct shape for a mapper with no I/O.

**Optimization (optimization-discipline gate)**: optimization: none-this-iteration — all measurable round-trip elimination opportunities were exhausted in slices 26-35 (server-first probe, PID-alive skip, Promise.all runDoctor). This slice addresses a correctness gap (missing UX behavior from the task spec), not a performance gap.

## Hypothesis self-grade

- **Predicted**: `recoveryHintForStep` returns a non-empty hint for all 6 step types; `executePlanWithProductionIo` emits it after the failure line; 4 new tests pass; TypeScript exhaustiveness check via `Record<BootstrapStepType, string>`
- **Observed**: build clean; 19 executor tests pass (15 existing + 4 new); `Record<BootstrapStepType, string>` (non-partial) enforces exhaustiveness at compile time; wiring in minsky.mjs adds the recovery line only when a hint is defined (non-undefined check preserved for future extension)
- **Match**: yes
- **Lesson**: using `Record<T, string>` instead of `Partial<Record<T, string>>` for the hints map gives compile-time exhaustiveness for free — if a new step type is added to `BootstrapStepType`, the executor file fails to compile until a hint is registered

<!-- security: not-applicable — pure string map + stderr write; no auth/secrets/sandbox/PII/supply-chain surface; the recovery hints are read-only operator guidance (no shell evaluation); § 13 reviewed -->
