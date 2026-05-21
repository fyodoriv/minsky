## Summary

P0 `runany-zero-arg-entrypoint` — slice 1 (pure zero-arg context
resolver) **+** slice 2 (the wire-in), shipped together as one
self-contained mergeable unit. Slice 1 alone is dead code until the
wire-in; together they deliver actual zero-arg launch.

`minsky` with **no arguments**, run in **any folder**, now starts the
orchestrator conductor scoped to that folder — no env vars, no flags, no
prior bootstrap.

- `novel/cross-repo-runner/src/cwd-detect.ts` (slice 1, cherry-picked
  forward onto current `main` — pure addition, no main-reverting
  deletions): `detectAnyCwd` (5-level precedence: bootstrapped →
  bootstrapped-subdirs → git-root → git-root-subdirs → plain-dir),
  `resolveConductorRoot` (collapse a `CwdDetectResult` to one root),
  `detectConductorRoot` (one call: `detectAnyCwd` → resolve),
  `findGitRootSubdirs`. `index.ts` exports them.
- `scripts/orchestrate.mjs` (slice 2): pure exported
  `resolveRepoRoot(env, cwd, fsProbe)` — explicit `MINSKY_HOME` env wins
  (launchd / `minsky-bootstrap`); else the conductor self-detects from
  cwd via `detectConductorRoot`. **Removes the hardcoded personal-path
  default** (`?? "<minsky-repo>"`) that silently
  defeated "run in any folder".
- `bin/minsky` (slice 2): a zero-arg branch that `exec`s the
  self-scoping conductor (no bash-side `git rev-parse` — detection is
  the conductor's single tested path). `status` / `stop` extended to
  see and SIGTERM the conductor so they work from the same folder.
  Explicit modes (`--host` / `--hosts-dir` / `--daemon` / `--local` /
  any args) still fall through unchanged.
- `docs/run-anywhere.md`: new — detection table + lifecycle (Acceptance 5).
- Tests: `+4` `orchestrate` `resolveRepoRoot`, slice-1 `cwd-detect`
  (git-repo / nested-repos / plain-dir / bootstrapped / worktree
  precedence).

Composes the existing shim + cross-repo-runner + conductor (rule #1 — no
new orchestrator); the only new code is the pure root resolver and its
wiring.

## Why needed

Today running `minsky` in an arbitrary folder requires env/args
(`MINSKY_HOME`, provider, etc.) and the conductor was hardcoded to one
operator's personal path — running it anywhere else silently scoped the
wrong tree. After this, zero-arg `minsky` in any folder type resolves
the correct conductor root by construction, through one pure tested
resolver (Saltzer & Schroeder 1975 — least-surprise default; one
resolver, one behaviour, zero config).

## Optimization

`optimization: round-trip elimination` — the zero-arg path forks **zero
extra detection subprocesses**: detection is consolidated into the pure
`detectConductorRoot` (already exercised by unit tests), so `bin/minsky`
just `exec`s the conductor instead of forking a `git rev-parse
--show-toplevel` subprocess in bash (the naive alternative design, e.g.
sibling `#609`). 1 fewer forked process per zero-arg launch; the bash
shim also drops the `MINSKY_HOME=` derivation (~40 bytes of shell + one
fork removed).

## Hypothesis self-grade

- **Predicted**: the zero-arg resolver (`resolveRepoRoot` →
  `detectConductorRoot`) maps 5 distinct folder types (git repo,
  nested-repos tree, plain dir, bootstrapped host, detached worktree) to
  the correct conductor root in 5/5 cases via one pure tested path, with
  no bash/TS detection duplication
- **Observed**: `vitest run scripts/orchestrate.test.mjs novel/cross-repo-runner/src/cwd-detect.test.ts` → 2 test files passed, 31/31 tests passed (24 `cwd-detect` precedence incl. git-repo / nested-repos / plain-dir / bootstrapped / worktree, + 7 `orchestrate` incl. the 4 `resolveRepoRoot` scope cases); resolver maps all 5 folder types to the correct root through the one pure path
- **Match**: yes
- **Lesson**: consolidating detection into one pure resolver makes 5-folder-type correctness assertable as a fast deterministic unit suite, decoupled from the swarm-unsafe process-level harness — Acceptance (4)'s real-process run can be deferred behind the dry-run gate without losing the correctness guarantee

> Acceptance (4)'s process-level 5-fixture harness (`for d in …; do (cd
> "$d" && minsky & …); done`) is intentionally **not** run here: it
> launches real conductors that would trigger real gate-merge sweeps in
> the shared swarm. That harness needs the `MINSKY_ORCH_DRY` dry-run
> gate (sibling slice 3, `#623`) to be safe; this slice delivers
> Acceptance (1)/(2)/(3)/(5) + the deterministic resolver proof that
> Acceptance (4) will exercise once the dry-run gate lands.

## Security & privacy

§ 13 reviewed. New surface: `bin/minsky` `stop` now also
`pkill -TERM -f "scripts/orchestrate.mjs"`, and zero-arg `exec`s
`$MINSKY_REPO_PATH/scripts/orchestrate.mjs`. Threat: a crafted process
name or a writable `$MINSKY_REPO_PATH` could be targeted/hijacked.
Mitigation: the `pkill` pattern is a fixed literal (no user input);
`$MINSKY_REPO_PATH` is resolved only via the pre-existing trusted
`resolveMinskyRepo` chain (`$MINSKY_REPO` env or `~/apps/*` fallbacks,
same trust boundary as the existing runner `exec`); the conductor runs
with the operator's own privileges and introduces no new secrets,
network, or PII. Removing the hardcoded absolute path also stops leaking
one operator's home path into every deployment.
