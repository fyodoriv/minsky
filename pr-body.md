## Summary

- Revert `"prepare": "pnpm build"` from `novel/tick-loop/package.json` — this change was already tried and reverted in PR #525 because it breaks `pnpm install` on a true fresh clone.
- Add a drift-guard test that pins tick-loop `package.json` to having **no** `prepare` script, preventing future daemon iterations from re-adding the same harmful change.

**Root cause of the regression:** pnpm runs each workspace package's `prepare` hook BEFORE the root package's `prepare: tsc -b --force` runs. On a fresh clone where ALL `dist/` directories are absent, tick-loop's `pnpm build` (= `tsc -p tsconfig.json`) cannot resolve `@minsky/budget-guard` or `@minsky/token-monitor` because their `dist/` hasn't been generated yet. `pnpm install` exits 1; the root `prepare` never runs; the fresh-clone-smoke CI gate fails. PR #525's commit message recorded this lesson, but the next daemon iteration re-added the change without checking PR history.

**The acceptance criterion** (`rm -rf novel/tick-loop/dist && pnpm install && pnpm minsky doctor` exits 0) is already satisfied by the root `package.json`'s `prepare: tsc -b --force` which builds all workspace packages in dependency order. No package-level prepare is needed or safe.

## Hypothesis self-grade

- **Predicted**: `novel/tick-loop/package.json` prepare script breaks fresh-clone-smoke because pnpm workspace package prepare hooks run before root prepare, leaving workspace deps' dist/ unbuilt; removing it and adding a drift-guard test prevents recurrence
- **Observed**: PR #525 commit history confirms the exact failure mode; removing the script + adding a test that asserts `scripts.prepare` is undefined passes all 12 pre-pr-lint checks including typecheck and task-lint
- **Match**: yes
- **Lesson**: when re-checking a task item, verify PR history (not just `git show origin/main`) — a reverted change may not be visible via file inspection alone

## Optimization

optimization: none-this-iteration: revert + drift-guard test; no brief, cached-prompt, or round-trip surface to shrink

<!-- security: not-applicable — package.json scripts field revert + test file only; no new auth/secrets/sandbox/PII/supply-chain surface; § 13 reviewed -->
