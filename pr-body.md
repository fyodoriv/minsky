<!-- pattern: not-applicable — ephemeral PR description file; not a shipped artefact -->

## Summary

Completes the final deliverables for `minsky-cli-fresh-clone-bootstrap`: drift test that pins the inline error literal against the canonical formatter, `AGENTS.md` "Repository setup" section, and `novel/tick-loop/README.md` "Quick start" section.

**Context**: prior iterations (already on main) shipped the core fix — root `package.json` `prepare` hook (`tsc -b`) builds all workspace packages including `@minsky/tick-loop` on `pnpm install`, so `git clone && pnpm install && pnpm minsky` works with no separate build step. `bin/minsky.mjs` already has the dist-existence pre-flight check (exits 1 with a one-line recovery hint instead of `ERR_MODULE_NOT_FOUND`). `dist-existence-check.ts` + basic tests are already on main.

**Changes shipped this iteration:**

1. `novel/tick-loop/src/dist-existence-check.test.ts` — added drift test (`bin/minsky.mjs drift — dist-missing message`) that reads the bin source, normalises escaped backticks, and asserts both structural halves of the inline error literal match `formatDistMissingMessage`'s output. Any wording divergence between the inlined copy and the canonical formatter now fails CI — no silent drift.
2. `AGENTS.md` — added "Repository setup" section with the fresh-clone one-liner (`git clone … && pnpm install && pnpm minsky doctor`) so agents always have a clear entry point without scrolling through constitutional rules.
3. `novel/tick-loop/README.md` — added "Quick start" section clarifying that operators use the root repo, with the same one-liner and a note about the dist-existence check backstop.

**Measurement** (fresh-clone simulation, validated prior iterations):

```bash
rm -rf novel/tick-loop/dist novel/tick-loop/tsconfig.tsbuildinfo
pnpm install   # root prepare: tsc -b builds tick-loop dist/
pnpm minsky doctor   # exits 0, prints doctor output
```

optimization: none-this-iteration: documentation and test additions; no recurring computation path to optimize

<!-- security: not-applicable — adds documentation and a read-only test; no new auth/secrets/sandbox/PII/supply-chain surface -->

## Hypothesis self-grade

- **Predicted**: post-fix, on a fresh clone with `dist/` deleted, `pnpm install` ALONE leaves the repo in a state where `pnpm minsky doctor` exits 0 and prints the doctor output; drift test pins inline error literal; docs cover fresh-clone flow for operators and agents
- **Observed**: all 8 `dist-existence-check.test.ts` tests pass including new drift test; AGENTS.md "Repository setup" section ships; tick-loop README "Quick start" section added; `rm -rf novel/tick-loop/dist && pnpm install && pnpm minsky doctor` validated green in prior iterations
- **Match**: yes
- **Lesson**: the inline-message drift test is the load-bearing CI gate — it's cheaper to add a structural-slice test than to keep two copies in sync manually; the drift test makes divergence visible at PR time rather than after an operator hits a confusing error
