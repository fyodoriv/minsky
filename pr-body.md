# test(bootstrap): drift-guard for minsky.mjs inline dist-error vs formatDistMissingMessage

<!-- pattern: not-applicable — pr-body.md is a per-PR scratch file consumed by gh pr create, not a persistent project artefact -->

**Task**: `minsky-cli-fresh-clone-bootstrap`

## Hypothesis

The core bootstrap fix (root `prepare` hook + dist-existence check + OTel fix) landed in prior merged PRs. One deliverable from the task's acceptance criteria has not reached main:

- `dist-existence-check.test.ts` drift test — pins the inlined stderr literal in `bin/minsky.mjs` against `formatDistMissingMessage`; wording divergence now fails CI instead of silently drifting.

`bin/minsky.mjs` deliberately inlines the dist-missing message rather than importing `formatDistMissingMessage` — the whole point of the check is that `dist/` may be missing when the check runs, so the check cannot depend on `dist/`. This means two copies of the same string exist; the drift test pins them.

**Drift test technique**: reads `bin/minsky.mjs` as text, normalizes escaped template-literal backticks (`\`` → `` ` ``), splits `formatDistMissingMessage("__P__")` around the sentinel, asserts both structural halves appear in the bin source. Catches wording divergence without requiring exact path matches.

**Success**: drift test lands on main with green CI; 8 dist-existence-check tests all pass.

**Pivot**: N/A — additive test-only change.

**Measurement**: `pnpm vitest run novel/tick-loop/src/dist-existence-check.test.ts` → 8 tests pass (7 pre-existing + 1 new drift test). CI: biome + typecheck + all tests pass.

**Anchor**: task block `minsky-cli-fresh-clone-bootstrap` § Files + Acceptance; vision.md rule #10 (deterministic enforcement — drift test is the enforcement mechanism for the two-copy invariant); Armstrong 2007 (loud-crash at boundary — drift test makes wording mismatch a loud CI failure).

## Changes

- **`novel/tick-loop/src/dist-existence-check.test.ts`**: adds `import { readFileSync } from "node:fs"` + `import { join } from "node:path"` + new `describe("bin/minsky.mjs drift — dist-missing message")` block with one test. The test reads the bin source, normalizes escaped backticks, splits the canonical formatter output around a `"__P__"` sentinel, and asserts both structural halves appear in the normalized source.

## Optimization

optimization: none-this-iteration — test-only addition; no hot path, brief, or round-trip touched.

## Hypothesis self-grade

- **Predicted**: adding a drift test that reads `bin/minsky.mjs` and asserts its inline error literal matches the structural slices of `formatDistMissingMessage("__P__")` will catch any future wording divergence between the two copies at CI time
- **Observed**: `pnpm vitest run novel/tick-loop/src/dist-existence-check.test.ts` → 8 tests pass; pre-pr-lint all green
- **Match**: yes
- **Lesson**: the sentinel-split technique (split canonical around `__P__`, assert both halves present in source) is robust against path separators or terminal-width changes — only catches actual wording divergence

<!-- security: not-applicable — adds test coverage for a read-only filesystem check; no new auth/secrets/sandbox/PII/supply-chain surface; § 13 reviewed -->
