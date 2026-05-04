<!-- rule-1: existing sidecar-config tools (direnv, dotenv, devcontainer.json, mise, asdf) rejected because: those tools materialise per-repo *runtime config* (env vars, tool versions, dev-container shape) inside files the host *commits* to its tree. The cross-repo-runner needs the inverse: a per-host *agent-substrate* (rule-#9 experiments/, rule-#5 vision.md symlink, rule-#10 sub-checks the cross-repo CI action runs) that the host's own git history MUST NOT see. The sidecar pattern at `<host>/.minsky/` registered in `~/.config/git/ignore` (decision A2 in `docs/cross-repo-portability.md`) is novel because the existing tools all assume the config travels with the host's commits; we explicitly require the opposite. The bootstrap itself is the smallest viable shape — pure planner + thin CLI executor, no runtime, no daemon — so a third-party scaffolder (Yeoman, cookiecutter, plop) is over-engineering for the 6-action plan we ship. -->

# `@minsky/sidecar-bootstrap`

> `minsky bootstrap <host-dir>` — write a per-host gitignored `.minsky/` sidecar so the cross-repo-runner can govern any host repo.

Pure-functions-with-I/O-at-the-edge (Martin 2017). The package exports inference / planning / diagnostic functions; the CLI (`bin/minsky-bootstrap.mjs`) is the only side-effecting layer.

## Why this exists

User story 006 (cross-repo-runner) needs a per-host substrate: `repo.yaml` overlay, `experiments/` directory, `vision.md` symlink, ignore-list registration. This package is the bootstrap step that materialises that substrate idempotently. Pre-`cross-repo-runner-v0`, this is the precondition.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Pattern**: command pattern (Gamma 1994 — actions are inspectable data) + pure-function-with-I/O-at-edge (Martin 2017) + status lattice (Avizienis et al., *IEEE TDSC* 1 (1), 2004 — green / yellow / red aggregate via `aggregateStatus`).
- **Conformance**: full. The planner / inferer / diagnoser / schema are pure functions. The CLI is the I/O boundary.

## Usage

```bash
# Default: write the sidecar (idempotent — safe to re-run).
minsky-bootstrap /path/to/host-repo

# Read-only diagnostic (no writes).
minsky-bootstrap --doctor /path/to/host-repo

# Re-apply plan; fix drift idempotently.
minsky-bootstrap --repair /path/to/host-repo
```

The bootstrap infers the `repo.yaml` shape from the host's `package.json` + git remote URL. The operator should review and edit `.minsky/repo.yaml` before invoking the cross-repo-runner.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: a fresh `minsky-bootstrap <host>` against a host repo with a `package.json` and a git remote produces 6 sidecar artefacts (`.minsky/`, `.minsky/repo.yaml`, `.minsky/experiments/`, `.minsky/experiments/.gitkeep`, `.minsky/vision.md` symlink, global-ignore entry) and a GREEN `--doctor` verdict on the first re-run.
- **Blast radius**: a single host repo's `.minsky/` sidecar + one entry in the operator's global git ignore. Never touches the host's tracked files. Never modifies the host's `.git/` config.
- **Operator escape hatch**: `rm -rf <host>/.minsky/` removes the entire sidecar; the host is back to its pre-bootstrap state. The global-ignore entry can be removed manually from `~/.config/git/ignore`.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Host directory doesn't exist | bad-input | `loud-crash-supervisor-restart` — CLI exits 1 with `host directory does not exist: <path>` | manual integration test asserts CLI exits non-zero on a missing host path |
| 2 | Host has no git remote URL | host-not-fully-onboarded | `graceful-degrade` — `host_repo` defaults to `unknown/unknown`; operator must edit `.minsky/repo.yaml` | covered by `inference.test.ts` (`malformed URL falls back to unknown/unknown` test case) |
| 3 | Two `minsky-bootstrap` runs race on the same host | concurrency | `loud-crash-supervisor-restart` — second run exits 75 (EX_TEMPFAIL) via mkdir-based lock at `.minsky/.bootstrap.lock.d` | manual integration test asserts the second concurrent invocation exits 75 |
| 4 | Stale non-symlink at `.minsky/vision.md` | host-config-drift | `loud-crash-supervisor-restart` — CLI refuses to overwrite, exits 1 with manual-removal instruction | manual test asserts the CLI's `existsSync && !isSymbolicLink` branch refuses to overwrite |
| 5 | Global git ignore file is read-only | filesystem-permission | `graceful-degrade` — bootstrap continues but the operator must add `.minsky/` to a writable ignore manually; v0 throws here, v1 falls back to per-clone-exclude per the umbrella story's chaos table row #13 | (deferred — covered when `cross-repo-runner-proj-840-integration-test` ships and this fallback is exercised) |
| 6 | `.minsky/repo.yaml` parses but fails validation | upstream-malformed | `loud-crash-supervisor-restart` from `--doctor` — verdict RED with the field-level error from `parseRepoConfig`; operator runs `--repair` | covered by `schema.test.ts` validation cases + `doctor.test.ts` red-status path |
| 7 | Symlink target (canonical `vision.md`) deleted after bootstrap | host-config-drift / external-cleanup | `loud-crash-supervisor-restart` from `--doctor` — verdict RED with "vision.md symlink is broken (target missing)"; operator runs `--repair` after restoring the target | covered by `doctor.test.ts` (broken-symlink red-status case) |

## Invariants

1. **Idempotent**: running `minsky-bootstrap <host>` twice is identical to running it once. The planner skips actions for already-present artefacts.
2. **No host-tracked-file writes**: the only writes are under `<host>/.minsky/` (gitignored) and the operator's global ignore file. The bootstrap never touches the host's tracked source.
3. **No `.git/` mutations**: the bootstrap reads `.git/config` (best-effort, ignored on failure) but never writes to `.git/`.
4. **Inference is advisory**: the operator MUST review `.minsky/repo.yaml` before the cross-repo-runner consumes it. Inference is the bootstrap's *proposal*, not a committed contract.

## Tests

51 paired vitest cases:

- `schema.test.ts` (12) — happy path + 6 validation failures + edge cases
- `inference.test.ts` (15) — defaults / git-remote parsing / package.json scripts / workspaces / default-branch
- `plan.test.ts` (14) — fresh-host action shape + idempotency + ignore-mechanism enum + YAML rendering
- `doctor.test.ts` (10) — green / yellow / red rows + Avizienis lattice aggregation
