<!-- pattern: not-applicable — pr-body.md is a per-PR scratch file consumed by gh pr create, not a persistent project artefact -->
# docs(local-llm): slice 68 — sync source chaos table + JSDoc for row 6

Advances P0 task `minsky-cli-auto-bootstrap-local-llm` (slice 68 of N).

## Summary

Slice 67 added tests for **chaos-table row 6** (hf-cli missing, model cached) but left the
source module's chaos table and two function JSDoc blocks incomplete. This slice closes both gaps.

**Changes**:

1. `local-llm-bootstrap.ts` — three additions:
   - Chaos table row 6 added to the module JSDoc:
     `hf-cli removed post-install, model still cached` → plan returns
     `[install-huggingface-cli, start-mlx-server]`; model NOT re-downloaded.
   - Row 4 count corrected: "full 5-step plan" → "full 6-step plan" (the plan now has
     6 step types: install-pipx / install-mlx-lm / install-aider / install-huggingface-cli
     / download-model / start-mlx-server; the old "5" predated `install-huggingface-cli`).
   - `@otel-exempt` JSDoc blocks added to `recoveryHintForBootstrapStep` and `summarisePlan`
     (plain lookups/formatters; instrumenting them adds noise with zero observability signal).

No logic changes. The chaos table is the documented contract for this module's failure modes;
keeping it in sync with the tests is how the rule-7 gate (`rule-7-chaos-coverage`) stays green.

## Hypothesis

- **Predicted**: source chaos table and test headers describe the same 6 rows after this
  patch; `pnpm pre-pr-lint` passes with no new lint failures.
- **Success**: `pnpm pre-pr-lint` all green; `pnpm vitest run` 3025 tests pass.
- **Pivot**: N/A — documentation-only; no behavioral risk.
- **Measurement**: `pnpm pre-pr-lint` all green (observed above); `pnpm vitest run` →
  3025 tests pass (no regressions).
- **Anchor**: rule #7 (chaos-coverage) — each chaos-table row in the source must have a
  corresponding test; the table is the contract, the tests are the evidence.

## optimization: none-this-iteration: doc-only patch; no hot path changed

<!-- security: not-applicable — documentation and JSDoc comments only; no auth, secrets, sandbox, PII, or supply-chain surface changed; § 13 reviewed -->

## Hypothesis self-grade

- **Predicted**: source chaos table updated to 6 rows; pre-pr-lint green; 3025 tests pass
- **Observed**: pre-pr-lint all green; 3025 tests pass (172 files, 1 skipped)
- **Match**: yes
- **Lesson**: when adding a test row, always update the source chaos table in the same commit so the documented contract stays in sync with the test evidence
