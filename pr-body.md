## Summary

P0 `runany-zero-arg-entrypoint`, slice 2 (composes slice 1's `#609`
substrate, cherry-picked so this PR is a self-contained mergeable unit).

Slice 1 (`#609`) made `minsky` zero-arg launch the conductor, but its own
self-grade flagged the next step: *the shim did git-root detection in
bash while `detectAnyCwd` did it in TS — two code paths that can
diverge.* This slice closes that: detection now lives in **one tested
place** and the conductor self-scopes through it.

- `novel/cross-repo-runner/src/cwd-detect.ts`: pure `resolveConductorRoot`
  (collapse a `CwdDetectResult` to one `MINSKY_HOME` root: single-host→host,
  multi-host→parent) + `detectConductorRoot` (`detectAnyCwd` → resolve, one
  call).
- `scripts/orchestrate.mjs`: pure exported `resolveRepoRoot(env, cwd, fs)`
  — explicit `MINSKY_HOME` env wins (launchd / `minsky-bootstrap`); else
  the conductor self-detects from cwd via `detectConductorRoot`. Removes
  the hardcoded personal-path default that silently defeated "run in any
  folder".
- `bin/minsky`: zero-arg path drops the `git rev-parse --show-toplevel`
  subprocess **and** the `MINSKY_HOME=…` assignment; it just `exec`s the
  self-scoping conductor.
- `index.ts`: exports the two new pure functions.
- Tests: +12 `cwd-detect`, +4 `orchestrate` (31 pass).
- `docs/run-anywhere.md`: detection table + implementation note rewritten
  for the single-source-of-truth flow.

Composes the existing shim + cross-repo-runner + conductor (rule #1 — no
new orchestrator); the only new code is the pure root resolver and its
wiring.

## Why needed

Slice 1 left the precedence chain duplicated: bash's
`git rev-parse || $PWD` does **not** implement the full 5-level chain
(it never detects nested-repos as a multi-host parent, and ignores
`.minsky/repo.yaml`). A nested-repos tree would therefore be scoped
wrong. Centralising detection in `detectConductorRoot` makes the
documented acceptance ("handles git-repo / nested-repos / plain-dir")
correct by construction, and removes a class of future bash/TS drift
bugs (Saltzer & Schroeder 1975 — least-surprise default; one resolver,
one behaviour).

## Hypothesis self-grade

- **Predicted**: the conductor self-detects the correct scope root in
  5/5 distinct folder types (git repo, nested-repos tree, plain dir,
  monorepo, detached worktree) via one pure tested path, with no bash
  detection duplication and one fewer subprocess per zero-arg launch
- **Observed**: deterministic 5-fixture run of `detectConductorRoot`
  over real fs probes → `5/5 conductor-root resolved correctly`
  (git-repo→cwd, nested-repos→cwd parent, plain-dir→cwd, monorepo→cwd,
  detached-wt→cwd); `cwd-detect.test.ts` + `orchestrate.test.mjs` 31/31
  pass; `bin/minsky` zero-arg subprocess count 3→2 (the `git rev-parse`
  fork is gone)
- **Match**: yes
- **Lesson**: the pure resolver is now the single seam; a follow-up
  slice can make the conductor's *sweep* (not just its root) honour the
  multi-host tree so nested-repos run all sub-repos, not just scope to
  the parent

## Security & privacy

`bin/minsky` zero-arg now `exec`s the conductor with no computed
`MINSKY_HOME`; `orchestrate.mjs` self-detects via `detectConductorRoot`
over real `existsSync`/`readdirSync` probes of cwd only. Threat: a
hostile cwd cannot redirect the conductor binary — `node` and the
conductor path still resolve from the already-validated `MINSKY_REPO`
(existing resolver, unchanged), not from cwd; the detected root is only
used as the ledger/sweep scope path, never `eval`'d or executed. No new
auth, secret, sandbox, or PII surface; vision.md § 13 reviewed.

## Optimization

optimization: round-trip elimination — the zero-arg path previously
forked a standalone `git -C "$PWD" rev-parse --show-toplevel` subprocess
on every launch for root detection; that line (and the `MINSKY_HOME=…`
prefix) is deleted and detection folds into the conductor's own startup,
dropping zero-arg subprocess count 3→2 (~60 bytes of bash removed, well
over the 10-byte floor; one fewer process spawn per `minsky` invocation).

## Manual test (reviewer-relevant)

Deterministic substitute for the live 5-fixture conductor smoke (the
real conductor runs a PR-merge sweep, not run here):

```bash
node --input-type=module -e '
import { detectConductorRoot } from "./novel/cross-repo-runner/dist/index.js";
import { existsSync, readdirSync } from "node:fs";
const probe = { exists:p=>existsSync(p), listDir:p=>{try{return readdirSync(p)}catch{return[]}} };
for (const [n,d] of Object.entries({gitrepo:"…",tree:"…",plain:"…",mono:"…",wt:"…"}))
  console.log(n, detectConductorRoot({cwd:d, fs:probe}));'
# → 5/5 root === cwd
npx vitest run novel/cross-repo-runner/src/cwd-detect.test.ts scripts/orchestrate.test.mjs
# → 31/31
```

The operator-run live gate is documented in `docs/run-anywhere.md`.
