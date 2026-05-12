# minsky-cli-fresh-clone-bootstrap: final deliverables — AGENTS.md setup + README quick-start + drift test + parseForcedShellArch

**Task**: `minsky-cli-fresh-clone-bootstrap`

## Hypothesis

The core bootstrap fix (root `prepare` hook + dist-existence check) landed in earlier PRs. Four remaining deliverables from the task's acceptance criteria had not reached main:

1. `AGENTS.md` "Repository setup" section — agents on a fresh machine need the install command without grepping README.
2. `novel/tick-loop/README.md` "Quick start" — clarifies internal workspace package and dist-existence backstop.
3. `dist-existence-check.test.ts` drift test — pins the inlined stderr literal in `bin/minsky.mjs` against `formatDistMissingMessage`; wording divergence now fails CI instead of silently drifting.
4. `arch-probe.ts` `parseForcedShellArch` export + 6 tests — function referenced by test but not exported (masked by stale `.tsbuildinfo`; revealed by `tsc -b --clean`).

**Success**: all four items land on main with green CI; `pnpm tsc -b` passes on a clean checkout.

**Pivot**: N/A — changes are additive and non-breaking.

**Measurement**: `pnpm tsc -b` exits 0 (confirmed pre-commit). CI: biome + typecheck + 6 new arch-probe tests + 1 new drift test all pass.

**Anchor**: task block `minsky-cli-fresh-clone-bootstrap` § Files + Acceptance; vision.md rule #10 (deterministic enforcement — drift test is the enforcement mechanism for the two-copy invariant); Armstrong 2007 (loud-crash at boundary — drift test makes wording mismatch a loud CI failure).

## Changes

- **`AGENTS.md`**: inserts "Repository setup" section after "Identity" (before "Constitutional rules"). One-liner flow + prepare hook's two steps (tsc -b + lefthook install) + dist-missing backstop note.

- **`novel/tick-loop/README.md`**: adds "Quick start" clarifying this is an internal workspace package; same one-liner + dist-existence backstop note.

- **`novel/tick-loop/src/dist-existence-check.test.ts`**: `bin/minsky.mjs drift — dist-missing message` describe block. Reads `bin/minsky.mjs`, splits `formatDistMissingMessage("__P__")` around sentinel, asserts both structural halves appear in bin source.

- **`novel/tick-loop/src/arch-probe.ts`** + **`arch-probe.test.ts`**: `parseForcedShellArch` export (pure parser for `MINSKY_FORCE_SHELL_ARCH`, slice 11) + 6 tests: `"arm64"`, `"x86_64"`, `undefined`, empty string, mixed-case near-matches, `"other"` (rejected — planner-incoherent on macOS).

## Optimization

optimization: none-this-iteration — all changes are additive; no hot path touched.

## Hypothesis self-grade

- **Predicted**: four remaining deliverables land on main with green CI; `pnpm tsc -b` exits 0; drift test and 6 arch-probe tests pass
- **Observed**: pre-pr-lint all green (biome, typecheck, markdownlint, tasks-lint, rule-2/3/6/7/12, threat-model-section, pr-self-grade, pr-security-review); pre-commit hook: scan-secrets clean, tsc passes, 37 arch-probe + 8 dist-existence-check tests pass
- **Match**: yes
- **Lesson**: stale `.tsbuildinfo` masks missing exports on machines with existing dist/; `tsc -b --clean` is the diagnostic

<!-- security: not-applicable — documentation + pure function export + test additions only; no new auth/secrets/network/PII surface; § 13 reviewed -->
