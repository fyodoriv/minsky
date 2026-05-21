# Run anywhere — zero-arg `minsky`

`minsky` with no arguments starts the orchestrator conductor scoped to the
current working directory. No env vars, no flags, no prior setup required.

## Usage

```bash
cd /path/to/any/project
minsky            # detect context → launch conductor
minsky status     # show running conductor + worker processes
minsky stop       # SIGTERM conductor + workers
```

## How detection works

| CWD type | Detected as | `MINSKY_HOME` |
|----------|-------------|---------------|
| Git repo (has `.git`) | single-host | `git rev-parse --show-toplevel` |
| Detached worktree (`.git` file) | single-host | worktree root |
| Monorepo (single `.git` at root) | single-host | git root |
| Parent of git repos | multi-host parent | `$PWD` |
| Plain directory (no git) | single-host | `$PWD` |

The conductor (`scripts/orchestrate.mjs`) reads `MINSKY_HOME` and scopes
its ledger and sweep to that root.

## Implementation

Detection priority (from `novel/cross-repo-runner/src/cwd-detect.ts`):

1. **Bootstrapped** (`.minsky/repo.yaml` present) → existing single-host path
2. **Bootstrapped subdirs** → existing multi-host walk path
3. **Git root** (`.git` present in cwd) → single-host via `detectAnyCwd`
4. **Git-root subdirs** → multi-host via `detectAnyCwd`
5. **Plain dir** → single-host, cwd as root

The `bin/minsky` shim uses `git rev-parse --show-toplevel` for git-root
detection and falls back to `$PWD` when not in a git repository.

## Lifecycle

```text
minsky &        → conductor starts, MINSKY_HOME=<detected-root>
minsky status   → shows conductor PID + worker PIDs
minsky stop     → SIGTERM both conductor and workers
```

The conductor uses a self-scheduling `setTimeout` loop (never `while(true)`)
so `minsky stop` always finds a clean shutdown point.
