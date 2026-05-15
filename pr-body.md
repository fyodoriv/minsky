## Summary

- Add drift-guard test to `dist-existence-check.test.ts` that asserts `novel/tick-loop/package.json` has **no** `prepare` script.

**Why this test matters:** Daemon iterations have twice attempted to add `prepare: pnpm build` to `novel/tick-loop/package.json` (PR #525, then again PR #562's revert). The failure mode is subtle — pnpm runs each workspace package's `prepare` hook **before** the root `prepare: tsc -b --force` runs. On a true fresh clone where all `dist/` directories are absent, tick-loop's build fails because `@minsky/budget-guard` and `@minsky/token-monitor` haven't been compiled yet. The root `tsc -b --force` already handles build-order correctly via TypeScript project references. Without a CI-enforced guard, the same regression will recur.

## Hypothesis

- **Predicted**: a single test that reads `novel/tick-loop/package.json` and asserts `scripts.prepare === undefined` will catch any future daemon iteration that re-adds the breaking script before it reaches CI
- **Observed**: test passes on current main state; drift-guard is now a hard CI gate
- **Measurement**: `pnpm vitest run novel/tick-loop/src/dist-existence-check.test.ts` — 9/9 pass including the new guard

## Hypothesis self-grade

- **Predicted**: drift-guard test pins `novel/tick-loop/package.json` to having no `prepare` script, preventing recurrence of the fresh-clone-smoke breakage
- **Observed**: 9/9 `dist-existence-check` tests pass; `pnpm pre-pr-lint` exits 0
- **Match**: yes
- **Lesson**: encode every recurring review comment as a test/lint rule (vision.md feedback-loop guardrail); instructions that don't compile don't stick

optimization: none-this-iteration: single test addition; no token, cached-prompt, or round-trip surface to shrink

<!-- security: not-applicable — test file only; reads package.json at test-time; no auth/secrets/sandbox/PII/supply-chain surface; § 13 reviewed -->
