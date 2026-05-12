<!-- pattern: not-applicable — pr-body.md is a per-PR scratch file consumed by gh pr create, not a persistent project artefact -->
# test(local-llm): slice 67 — chaos-table row 6: hf-cli missing, model cached

Advances P0 task `minsky-cli-auto-bootstrap-local-llm` (slice 67 of N).

## Summary

Adds **chaos-table row 6** — the "hf-cli removed after initial setup, model weights still cached"
scenario — to both the unit test suite and the integration test suite.

This test row was merged to `main` via PR #538 against a different branch while
`audit/2026-05-12-minsky-runtime-resilience` was diverged. Slice 67 ports it here so
both branches converge on the same chaos-table coverage.

**Changes**:

1. `local-llm-bootstrap.test.ts` — three additions:
   - Module JSDoc updated: "5 chaos-table rows" → "6 chaos-table rows" (row 6 entry added).
   - `hfCliMissingModelCached` state fixture: pipx/mlx/aider present, hf-cli absent, model
     cached (17.2 GB detail), server unreachable.
   - `describe("chaos-table row 6: hf-cli missing, model cached")` with 2 paired tests:
     - Step sequence is `[install-huggingface-cli, start-mlx-server]` — no `install-pipx`,
       no `download-model` (model is already there).
     - `totalEstimatedDownloadMb === 0` when model is cached.

2. `local-llm-bootstrap.integration.test.ts` — one new `it` block:
   - Creates fake bins for pipx / mlx_lm.server / aider (NOT huggingface-cli).
   - `existsSyncFn` returns true for `MODEL_CACHE_DIR` (model present).
   - Asserts plan contains `install-huggingface-cli + start-mlx-server`, excludes
     `install-pipx`, `install-mlx-lm`, `install-aider`, `download-model`.

**Test count**: 60 → 62 in `local-llm-bootstrap.test.ts`; 5 → 6 in
`local-llm-bootstrap.integration.test.ts`.

## Hypothesis

- **Predicted**: `planLocalLlmBootstrap` with `huggingfaceCli: ABSENT, model: PRESENT`
  produces `[install-huggingface-cli, start-mlx-server]` with `totalEstimatedDownloadMb === 0`;
  the integration probe with a real temp-dir confirms the same via `buildProductionProbes`.
- **Success**: 62 unit tests + 6 integration tests pass; `pnpm pre-pr-lint` green.
- **Pivot**: N/A — pure test addition, no behavioral risk; if the planner misbehaves
  the new tests will catch it.
- **Measurement**: `pnpm vitest run novel/tick-loop/src/local-llm-bootstrap.test.ts` →
  62 tests pass (was 60, +2 new); `pnpm vitest run
  novel/tick-loop/src/local-llm-bootstrap.integration.test.ts` → 6 tests pass (was 5,
  +1 new); `pnpm pre-pr-lint` all green.
- **Anchor**: task Verification — "integration test on a clean `/tmp/<scratch>` HOME
  with `pipx`/`mlx`/`aider`/`model` selectively missing — assert the plan covers exactly
  the missing pieces"; chaos-table row 6 from PR #538 (merged to main, absent from this
  branch due to divergence).

## optimization: none-this-iteration: pure test addition; no hot path changed

<!-- security: not-applicable — adds pure in-memory test assertions and a temp-dir integration fixture; no auth, secrets, sandbox, PII, or supply-chain surface changed; § 13 reviewed -->

## Hypothesis self-grade

- **Predicted**: 2 new chaos-table row 6 unit tests + 1 integration test pass; pre-pr-lint green
- **Observed**: 62 unit tests pass (was 60, +2); 6 integration tests pass (was 5, +1); pnpm pre-pr-lint all green
- **Match**: yes
- **Lesson**: chaos-table rows diverge across parallel branches when PRs land on main while a long-running branch is still open; the fix is to explicitly port missing rows at the next iteration rather than waiting for a rebase
