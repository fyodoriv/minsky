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

The zero-arg scope is decided by the pure resolver
`scripts/runany-context.mjs` (`resolveRunanyContext`), called from the
smart-auto-attach block in `bin/minsky`. The decision is deterministic and
side-effect-free — the filesystem probes (`readdir`, the `.git` check) are
injected seams, so the classification is unit-tested in
`scripts/runany-context.test.mjs` across all five cwd shapes.

Classification (first match wins):

1. **Git repo** (`.git` directory **or** file present in cwd) → single-host,
   `--host <cwd>`. This covers a plain repo, a monorepo, and a detached
   worktree checkout (whose `.git` is a file). Nested repos inside a git repo
   are submodules/vendored, not separate targets.
2. **Nested repos** (cwd is not a repo but has one or more git repos one
   level down) → multi-host, `--hosts-dir <cwd>` — the conductor walks every
   child repo.
3. **Plain dir** (neither of the above) → single-host, `--host <cwd>`.

Inspect the verdict without launching anything:

```bash
node scripts/runany-context.mjs "$PWD"          # the two-token daemon argv
node scripts/runany-context.mjs "$PWD" --json   # full classification
```

The resolver follows rule #6 (stay alive): a missing/unreadable directory, a
TOCTOU race on the `.git` probe, or a missing resolver script all degrade to
single-host-at-cwd rather than crashing the launch — the `bin/minsky` shim
falls back to `--host <cwd>` whenever the resolver returns nothing.

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
(`scripts/lib/runany-provider-decision.mjs`). Pollack decision table
(CACM 1962); first matching row fires:

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

## Wiring into the entrypoint

`bin/minsky-run.sh` resolves the next iteration's provider by calling
`scripts/runany-resolve-model.mjs` before spawning the agent. That CLI is
the single I/O boundary around the pure decider:

1. reads the operator pin from `MINSKY_STRATEGIC_PIN_MODEL` (alias
   `MINSKY_PIN_MODEL`);
2. reads the budget snapshot from `~/.minsky/token-monitor.json` (the same
   file `bin/check-budget.sh` reads — override with `MINSKY_TOKEN_SNAPSHOT`)
   and maps it to the continuous `RemainingFractions` triple;
3. probes every configured remote backend (`MINSKY_REMOTE_BACKENDS`, a
   comma-separated `id=host:port` list; default `claude=api.anthropic.com:443`)
   by TCP connect, behind a TTL cache (`scripts/lib/runany-backend-liveness.mjs`);
4. calls `decideRunAnyProvider` and prints the chosen model (bare id by
   default, full decision with `--json`).

When the resolver returns `agent:"local"` (budget-exhausted dynamic OR
all-remote-down), the runner flips fully to the local stack for that
iteration — exactly as if `local_llm_enabled: true` were set in
`~/.minsky/config.json`. An explicit `local_llm_enabled: true` in the
config still wins (operator override), and any resolver failure degrades to
the existing config-driven model (rule #6 — the agent always gets a model).

```bash
node scripts/runany-resolve-model.mjs            # → bare model id (the runner captures this)
node scripts/runany-resolve-model.mjs --json     # → full decision + per-backend liveness
node scripts/runany-resolve-model.mjs --force-probe  # bypass the TTL cache (provider-error path)
```

## Recovery

The decision is recomputed every iteration over a fresh-or-cached
multi-backend liveness probe, so when a previously-down backend probes
reachable again the next iteration returns a remote model automatically.
Within an iteration the liveness reads are served from a TTL cache (≥60s,
the task Pivot) so the per-iteration probe cost stays bounded; `--force-probe`
(or a cache miss / TTL expiry) forces a fresh read. No flap state is held in
the decider itself — hysteresis is the picker's job.

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
- **Slice 2** (shipped) — pre-registered measurement harness
  (`scripts/runany-model-audit.mjs`); decider + router ported to `scripts/lib/`.
- **Slice 3** (this) — wired the decider + a multi-backend liveness probe
  into the run-anywhere entrypoint. `scripts/runany-resolve-model.mjs` is the
  I/O boundary called from `bin/minsky-run.sh`; liveness is cached with a
  ≥60s TTL (`scripts/lib/runany-backend-liveness.mjs`) per the task Pivot.
