<!-- pattern: not-applicable — pr-body.md is a per-PR scratch file consumed by gh pr create, not a persistent project artefact -->
# feat(local-llm): slice 66 — step-specific recovery hints in bootstrap failure output

Advances P0 task `minsky-cli-auto-bootstrap-local-llm` (slice 66 of N).

## Summary

Addresses task Details (e): "pipx install fails → loud-crash with the exact `pipx` error + a recovery hint (`brew install pipx`)".

Before this slice, when bootstrap failed the operator saw only:

```
minsky: local-LLM bootstrap failed (install-pipx: exit code 1: ...)
minsky: continuing without local-LLM fallback; daemon will use claude only
```

After:

```
minsky: local-LLM bootstrap failed (install-pipx: exit code 1: ...)
minsky: hint: Try: pip3 install --user pipx  (or: pip install --user pipx)
minsky: continuing without local-LLM fallback; daemon will use claude only
```

**Changes**:

1. `local-llm-bootstrap.ts` — add `BOOTSTRAP_STEP_RECOVERY_HINTS` lookup map (pure
   `Record<BootstrapStepType, string>`) and `recoveryHintForBootstrapStep(type)`
   exported pure function. One hint per step type (all 7 covered). Complexity: 1
   (single property lookup — avoids switch sprawl).

2. `index.ts` — re-export `recoveryHintForBootstrapStep` so `bin/minsky.mjs` can
   import it via the compiled `dist/index.js`.

3. `bin/minsky.mjs` — two extractions required to keep `runBootstrapLocalLlm`
   cognitive complexity ≤ biome's cap of 10:
   - `emitBootstrapFailureMessage(result)` — failure log + recovery hint (slice 66)
   - `finaliseBootstrapSuccess(plan)` — server readiness wait + env return (slice 62
     logic, extracted because its `some()` + `if` added to the complexity budget)
   The main function now reads: `if (!result.success) { emitBootstrapFailureMessage(result); return {}; } return await finaliseBootstrapSuccess(plan);`

4. `local-llm-bootstrap.test.ts` — 8 paired tests for `recoveryHintForBootstrapStep`:
   one per step type (content assertion) + one exhaustiveness test (all 7 types return
   non-undefined).

## Hypothesis

- **Predicted**: operators encountering a bootstrap failure see a step-specific
  actionable hint rather than a generic failure message; all 7 `BootstrapStepType`
  values return a defined hint string; complexity gate stays green.
- **Success**: 8 new paired tests pass; `pnpm pre-pr-lint` all green.
- **Pivot**: N/A — pure data + one exported function; no behavioral risk.
- **Measurement**: `pnpm vitest run novel/tick-loop/src/local-llm-bootstrap.test.ts`
  → 60 tests pass (was 52, +8 new); `pnpm pre-pr-lint` all green.
- **Anchor**: task Details (e) — "pipx install fails → loud-crash with the exact
  `pipx` error + a recovery hint (`brew install pipx`)"; vision.md rule #2 (pure
  data over imperative dispatch); rule #10 (recovery hints belong to the module
  that owns the step types, not the caller).

## optimization: none-this-iteration: recovery hints are operator-facing UX in the failure path, not a hot path; no measurable latency reduction applies

<!-- security: not-applicable — adds a pure string lookup and two log lines in the failure path; no auth, secrets, sandbox, PII, or supply-chain surface changed; § 13 reviewed -->

## Hypothesis self-grade

- **Predicted**: 8 paired tests pass for recoveryHintForBootstrapStep; pre-pr-lint green
- **Observed**: 60 tests pass in local-llm-bootstrap.test.ts (+8 new); pnpm pre-pr-lint all green; biome complexity check passes after extracting emitBootstrapFailureMessage + finaliseBootstrapSuccess helpers
- **Match**: yes
- **Lesson**: adding 2 branches (ternary + if-hint) to a function already at cognitive complexity 9 breaches the cap of 10; extract-on-addition is cheaper than extract-after-breach
