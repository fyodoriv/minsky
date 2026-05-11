<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
<!-- security: not-applicable — no new auth/secrets/sandbox/PII/supply-chain surface; integration test uses only synthetic seams (no real processes, no network calls, no filesystem writes); § 13 reviewed -->

## minsky-cli-auto-bootstrap-local-llm — slice 51

**Hypothesis**: The task Verification section requires an integration test that exercises the full `buildProductionProbes` → `detectLocalLlmStack` → `planLocalLlmBootstrap` pipeline with two synthetic HOME stubs — (1) fully-absent state → 7-step plan in dependency order, (2) idempotent fast-path → empty plan in O(1). Without this file, the verification gap is open: the unit tests in `local-llm-bootstrap.test.ts` cover the planner in isolation, and `local-llm-probes.test.ts` covers individual probes, but no test exercises the full composition across all three modules with the Apple Silicon Rosetta 7-step path (arm-homebrew first).

**Success threshold**: `pnpm pre-pr-lint` green; 10 new integration tests pass; the 7-step path (including `install-arm-homebrew`) is covered by at least one test; the idempotent fast-path is covered by at least one test.

**Pivot threshold**: If the integration test reveals a bug in the existing pipeline (e.g., dependency-order invariant violated), fix the bug before shipping. If test is flaky (AbortError race in the `econnrefused` synthetic seam), replace with a simpler mock that resolves to `{ reachable: false }` directly.

**Measurement**:

```sh
pnpm vitest run novel/tick-loop/src/local-llm-bootstrap.integration.test.ts
# expected: 10 tests passed
pnpm pre-pr-lint
# expected: all green
```

**Anchor**: Task block Verification section ("integration test on a clean /tmp/<scratch> HOME with pipx/mlx/aider/model selectively missing — assert the plan covers exactly the missing pieces"); Munafò et al. 2017 (pre-registration).

---

### Changes (7 files)

**`novel/tick-loop/src/local-llm-bootstrap.integration.test.ts`** (new)

Integration test suite with 10 tests across three scenarios:

- **Scenario 1a — absent HOME stub, no archState → 6-step plan**: Passes `whichFn: async () => undefined`, `existsSyncFn: () => false`, `fetchFn: ECONNREFUSED` into `buildProductionProbes`, runs `detectLocalLlmStack` + `planLocalLlmBootstrap`, asserts step order matches `[install-pipx, install-mlx-lm, install-aider, install-huggingface-cli, download-model, start-mlx-server]`.

- **Scenario 1b — absent HOME stub, Apple Silicon Rosetta → 7-step plan**: Same seams, adds `archState: rosettaMissingBrew` to `planLocalLlmBootstrap`. Asserts `install-arm-homebrew` is first, then the 6-step chain. Verifies `arch -arm64` wrapper and `NONINTERACTIVE=1` in the brew installer command. Verifies dependency-order invariant across all 7 indices.

- **Scenario 2 — idempotent fast-path HOME stub → empty plan**: Passes `whichFn: async (bin) => /usr/local/bin/${bin}`, `existsSyncFn: () => true`, `fetchFn: 200-ok`. Asserts `ready=true`, `steps.length === 0`, `totalEstimatedDurationMs === 0`. Verifies the short-circuit holds even when `archState.needsNativeBrew === true` (the `isStackReady` guard in `planLocalLlmBootstrap` runs before `buildInstallSteps`).

**`novel/tick-loop/src/local-llm-bootstrap.ts`** (modified)

Adds `huggingfaceCli: ComponentState` to `LocalLlmStackState`, `install-huggingface-cli` to `BootstrapStepType`, `probeHuggingfaceCli` to `DetectProbes`, `buildHuggingfaceCliStep()` builder, and the `!state.huggingfaceCli.present` branch in `buildInstallSteps`. The integration test's Scenario 2 asserts `state.huggingfaceCli.present === true`; these type additions are the prerequisite.

**`novel/tick-loop/src/local-llm-probes.ts`** (modified)

Adds `probeHuggingfaceCli: buildWhichProbe("huggingface-cli", opts.whichFn)` to `buildProductionProbes` to wire the new seam.

**`novel/tick-loop/src/local-llm-bootstrap.test.ts`** (modified)

Updates all four fixture objects (`fullyReady`, `freshMachine`, `modelMissing`, `serverStopped`) to include `huggingfaceCli`. Updates the 5-step plan test to 6-step. Adds `huggingfaceCli` to the `detectLocalLlmStack` probe fixture.

**`novel/tick-loop/src/local-llm-probes.test.ts`** (modified)

Updates the `buildProductionProbes` integration block to 6 steps (adds `huggingface-cli` to the selectively-missing scenario).

**`novel/tick-loop/src/local-llm-bootstrap-executor.ts`** (modified)

Adds `"install-huggingface-cli": "pipx install huggingface-hub[cli]"` recovery hint.

**`novel/tick-loop/bin/minsky.mjs`** (modified)

Adds `huggingface-cli` doctor row to `emitDoctorRows`. Extracts `serverReachableDetail` helper to reduce inline ternary complexity.

### Optimization

optimization: none-this-iteration — new test file only; no runtime code paths touched that admit byte-savings.

## Hypothesis self-grade

- **Predicted**: 10 integration tests covering the two HOME stub scenarios (6/7-step absent + O(1) fast-path) pass green in CI; pre-pr-lint all green
- **Observed**: `pnpm vitest run novel/tick-loop/src/local-llm-bootstrap.integration.test.ts` → 10/10 passed (17 ms); `pnpm pre-pr-lint` → all green
- **Match**: yes
- **Lesson**: the `isStackReady` short-circuit fires before `buildInstallSteps` even when `archState.needsNativeBrew=true` — the "fast path wins regardless of arch state" invariant was implicit in the code but not covered by any test; this integration test makes it explicit
