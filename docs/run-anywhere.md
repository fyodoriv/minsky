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

## Per-iteration provider decision

<!-- scope: human-approved `runany-dynamic-model-or-local-fallback` slices 1+2 (P0 operator 2026-05-16 directive; this file is the operator-facing reference the task's Files list calls for). -->

Operator-facing reference for the zero-arg run-anywhere entrypoint's
per-iteration **pin > dynamic > local** provider decision.

## TL;DR

With no operator pin, Minsky tracks remaining budget and picks the
highest-quality model that fits. When **every** configured remote backend
is down — or the budget is exhausted — Minsky switches **fully and
automatically** to the local stack within one iteration and keeps running.
Recovery to remote is automatic the first iteration a backend probes
reachable again. An operator pin overrides all of this, verbatim.

```text
operator pin set            → pinned model (verbatim, ignores budget + liveness)
all remote backends down    → local (≤1 iteration, never a wedged/hold state)
otherwise                   → strategic picker by remaining budget band
```

## Decision table (first match wins)

The decision is a single pure function — `decideRunAnyProvider`
(`novel/tick-loop/src/runany-provider-decision.ts`, exported from
`@minsky/tick-loop`). Pollack decision table (CACM 1962); first matching
row fires:

1. **`operator-pin`** — `MINSKY_STRATEGIC_PIN_MODEL` (or explicit flag) is
   set and maps to a catalog row → that model, every iteration, regardless
   of budget or backend liveness. The operator's explicit choice is final
   (rule #7 operator escape hatch). An unknown pin is ignored and the walk
   falls through to row 3 (graceful-degrade).
2. **`local-fallback`** — at least one remote backend is configured **and
   every one of them is unreachable** → the highest-tier `local` catalog
   row (synthesised `local` if the catalog has none). Never a `hold`/wedge
   state; `local` is the always-available last resort.
3. **`dynamic`** — delegate to `pickStrategicModel` (see
   [strategic-model-router.md](./strategic-model-router.md)): the
   highest-quality model whose per-window floors fit the current remaining
   budget. A budget-exhausted dynamic pick is still the local catalog row,
   so the daemon keeps running either way.

An **empty** backend list means "no remote configured" — not "all remote
down" — so the dynamic picker still governs (budget alone gates `local`).

## Recovery

The function is pure and recomputed every iteration over the live backend
liveness probe, so when a previously-down backend probes reachable again
the next iteration returns a remote model automatically — no flap state is
held here (hysteresis is the picker's job).

## Measurement (pre-registered, rule #9)

The task's Success threshold is evaluated deterministically by the audit
harness — committed before the result is observed (Munafò et al. 2017):

```bash
node scripts/runany-model-audit.mjs --scenario=pin --json
node scripts/runany-model-audit.mjs --scenario=dynamic --json
node scripts/runany-model-audit.mjs --scenario=all-down --json
node scripts/runany-model-audit.mjs --scenario=all          # human summary, all three
```

Exit code is `0` only when every requested scenario meets its
pre-registered threshold:

| Scenario   | Threshold                                                              |
|------------|------------------------------------------------------------------------|
| `pin`      | 100% pinned-model dispatch across all budget/liveness bands; 0 wedged   |
| `dynamic`  | selected tier monotone non-decreasing as budget drops; tier-1 at top band; `local` at bottom band |
| `all-down` | ≤1 iteration to switch to local; ≥95% local dispatch thereafter; 0 wedged |

A regression in the decider becomes an exit-1 gate break, not a silent
mis-degrade.

## Status

- **Slice 1** (shipped) — pure `decideRunAnyProvider` decision table + chaos tests.
- **Slice 2** (this) — `@minsky/tick-loop` export + pre-registered measurement harness.
- **Next** — wire the decider + a multi-backend liveness probe into the
  run-anywhere entrypoint (`bin/minsky.mjs` / `scripts/orchestrate.mjs`);
  probe-result cache (TTL ≥60s) per the task Pivot.
