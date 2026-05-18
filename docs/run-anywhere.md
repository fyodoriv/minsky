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

| CWD type | Detected as | Conductor root |
|----------|-------------|----------------|
| Git repo (has `.git`) | single-host | cwd |
| Detached worktree (`.git` file) | single-host | cwd (worktree root) |
| Monorepo (single `.git` at root) | single-host | cwd |
| Parent of git repos | multi-host parent | cwd (sweeps the tree) |
| Plain directory (no git) | single-host | cwd |

The conductor (`scripts/orchestrate.mjs`) self-detects this root via the
pure `detectConductorRoot` resolver and scopes its ledger and sweep to
it. An explicit `MINSKY_HOME` env var (set by launchd units or
`minsky-bootstrap`) still wins — detection is the zero-config fallback.

## Implementation

Detection priority (from `novel/cross-repo-runner/src/cwd-detect.ts`):

1. **Bootstrapped** (`.minsky/repo.yaml` present) → existing single-host path
2. **Bootstrapped subdirs** → existing multi-host walk path
3. **Git root** (`.git` present in cwd) → single-host via `detectAnyCwd`
4. **Git-root subdirs** → multi-host via `detectAnyCwd`
5. **Plain dir** → single-host, cwd as root

Detection runs in **one tested place**: `detectConductorRoot` in
`cwd-detect.ts`, called by the conductor at startup. The `bin/minsky`
shim no longer duplicates git-root detection in bash — it forks zero
extra detection subprocesses on a zero-arg launch (it just exec's the
conductor).

## Lifecycle

```text
minsky &        → conductor starts, self-scoped to <detected-root>
minsky status   → shows conductor PID + worker PIDs
minsky stop     → SIGTERM both conductor and workers
```

The conductor uses a self-scheduling `setTimeout` loop (never `while(true)`)
so `minsky stop` always finds a clean shutdown point.
