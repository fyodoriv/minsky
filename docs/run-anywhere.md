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
shim no longer duplicates git-root detection in bash — it just exec's
the conductor (one fewer subprocess per zero-arg launch).

## Lifecycle

```text
minsky &        → conductor starts, self-scoped to <detected-root>
minsky status   → shows conductor PID + worker PIDs
minsky stop     → SIGTERM both conductor and workers
```

The conductor uses a self-scheduling `setTimeout` loop (never `while(true)`)
so `minsky stop` always finds a clean shutdown point.

The conductor's startup line carries the resolved root so an operator (or
the measurement harness below) can confirm scope at a glance:

```text
orchestrate: start 2026-05-17T… root=/path/to/any/project interval=1200000ms
```

## Measurement (Acceptance 4)

The runnable proof that zero-arg launch works in every folder type:

```bash
node scripts/runany-zero-arg-measure.mjs   # → "5/5 ok", exit 0
```

It builds the 5 distinct fixtures in a tmpdir — plain git repo,
nested-repos tree (parent-of-repos), plain dir, monorepo (single git
root), detached worktree (`.git` file) — launches the conductor
zero-arg in each exactly as `bin/minsky` does (`MINSKY_HOME` unset so
scope self-resolves from cwd), confirms the startup line reports
`root=<the launch folder>` while the process is still alive, then
SIGTERMs it (the `minsky stop` equivalent). `--keep` leaves the
fixture tree on disk for inspection.

`MINSKY_ORCH_DRY=1` is a **validation-only** env, not part of the
zero-arg UX (an interactive `minsky` with no env still runs a real
merge sweep — the directive's "no params ever required" still holds).
It makes the gate sweep vet-only — no live `gh pr merge`, no ledger
write — so the harness is safe to re-run on any machine. The pure
decision is `resolveSweepDryRun` (`scripts/orchestrate.mjs`); it wires
the already-built `dryRun` seam in `local-gate-merge.mjs` (rule #1 — no
new code path) and short-circuits before the merge round-trip.

Note: a real zero-arg launch also heals the Sonnet worker daemon if it
is down. The harness reproduces this faithfully, so it will kickstart
`com.minsky.opus-sonnet-run` when that agent is loaded but down — run
it when that is acceptable, or pre-start the worker.
