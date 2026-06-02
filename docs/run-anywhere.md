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

## Self-restart with bounded wall-clock ceiling

<!-- scope: human-approved `runany-self-restart-bounded-timelimit` (P0 operator 2026-05-16 directive; this file is the operator-facing reference the task's Files list calls for). -->

Operator-facing reference for how a zero-arg run survives crashes — and how
it stops. The run auto-restarts on any crash with an escalating, capped
backoff that resets after a sustained-healthy window, and stops cleanly once
a hard wall-clock ceiling is reached (rule #6 — stay alive, but bounded). No
zombie, no infinite restart past the deadline.

### Two-layer supervisor (compose, don't duplicate — rule #1)

Restart is split across the OS supervisor and the conductor's own boot gate.
launchd alone cannot escalate a backoff (`ThrottleInterval` is a single flat
number), so the escalation lives with the thing being retried (Beyer SRE 2016
— the retry budget belongs to the retried process, not the supervisor):

| Layer | Owns | Where |
|-------|------|-------|
| launchd `KeepAlive{SuccessfulExit:false}` | respawn on **non-zero** exit only (OTP "transient", Armstrong 2007) | `distribution/launchd/com.minsky.runany.plist` |
| launchd `ThrottleInterval` | flat minimum gap between respawns (5s floor) | same plist |
| Conductor in-process boot gate | the escalating, capped, reset-on-health backoff + the supervised-run deadline origin | `decideStartupThrottle` in `scripts/restart-supervisor.mjs`, wired in `scripts/orchestrate.mjs` |
| Conductor in-process deadline guard | clean stop (exit 0) at the wall-clock ceiling | `scripts/orchestrate.mjs` `schedule()` |

A clean exit 0 at the deadline is a **true terminal stop**: launchd's
`SuccessfulExit:false` policy does not respawn a zero exit, so the run ends.

### Backoff ladder

The default escalating, capped ladder is `[5s, 30s, 300s]` — the last entry
is the cap, so every further consecutive restart waits 300s. It composes the
existing tick-loop `tick-loop-backoff-schedule` anchor rather than introducing
a second drifting schedule. After the conductor stays continuously healthy for
the reset window (default 20m), the next crash is treated as fresh and the
ladder restarts at base — a recovered run is not penalised forever for a
long-past crash-loop. The ladder + origin are read from a single persisted
state file (`.minsky/runany-restart-state.json`) at boot; an absent or corrupt
file degrades to a clean first-run (rule #7), never a throw that would defeat
the supervisor.

### The deadline is bounded across restarts

The ceiling is measured against the **supervised-run origin** (persisted across
launchd respawns), not the current process life — otherwise a crash-loop would
earn a fresh ceiling on every respawn and the deadline would never bite. The
one exception is a sustained-health reset, which earns a fresh wall-clock budget
along with a fresh backoff ladder (documented tradeoff — keeps a long-lived run
that crashes once at hour 9 from being killed by that 9-hours-ago crash).

### Operator knobs (all `<n>s|m|h`; a typo'd value falls back to the default — rule #7)

| Env var | Default | Effect |
|---------|---------|--------|
| `MINSKY_RUN_TIME_LIMIT` | `10h` | hard wall-clock ceiling; conductor exits 0 at/after it and is not respawned |
| `MINSKY_HEALTHY_RESET` | `20m` | sustained-healthy window that resets the backoff ladder to base |
| `MINSKY_NO_STARTUP_BACKOFF` | unset | `=1` skips the boot sleep (state tracking still runs); for tests/CI and fast operator runs that must not block on a 300s backoff |

### Why the plist is named `.plist`, not `.plist.tmpl`

`com.minsky.runany.plist` carries the `${MINSKY_HOME}` envsubst placeholder
like every other `com.minsky.*.plist` unit, so it is a template in spirit. It
keeps the bare `.plist` suffix (not `.plist.tmpl`) because `setup.sh`'s Darwin
`*.plist` glob renders and bootstraps it; a `.tmpl` suffix would make the unit
inert and the supervisor would never start. The unit file's own header comment
pins this decision.

### Measurement (pre-registered, rule #9)

The task's Success threshold is evaluated deterministically by a chaos
harness — committed before the result is observed (Munafò et al. 2017,
Basiri et al. 2016 steady-state hypothesis). The harness is a pure
discrete-event simulation over a virtual clock (no real spawn/kill — that
would be flaky and machine-dependent), driving the same pure `decideRestart`
core the production boot gate uses:

```bash
node scripts/chaos-restart-schedule.mjs --json
# → {"schedule_followed":true,"reset_on_health":true,
#    "stopped_at_limit":true,"restarts_after_limit":0}
node scripts/chaos-restart-schedule.mjs          # human summary
```

Exit code is `0` only when all four observables hold: the backoff intervals
follow the escalating ladder, a sustained-healthy window resets the ladder to
base, the run stops within `600±30s` under `MINSKY_RUN_TIME_LIMIT=600s`, and
zero restarts fire after the deadline. A regression in the decision core
becomes an exit-1 gate break, not a silent mis-restart.

## Permission-scoped writes (home vs foreign)

<!-- scope: human-approved `runany-permission-scoped-writes` (P0 operator 2026-05-16 directive; this file is the operator-facing reference the task's Files list calls for). -->

Operator-facing reference for the least-authority write policy a run-anywhere
conductor applies to every repo under the tree. The rule is
[Saltzer & Schroeder 1975](https://www.cs.virginia.edu/~evans/cs551/saltzer/)
least privilege + fail-safe defaults (rule #13): the run may push code and
open any PR **only** to its **home** repo; for any **foreign** repo it
encounters, the **only** permitted write is a PR whose diff is limited to that
repo's `TASKS.md` (findings filed as tasks.md-spec task blocks). Every code
push or non-TASKS.md change to a foreign repo is refused and logged.

### Home vs foreign

A repo is **home** when its git toplevel equals the invoked (home) repo's
toplevel, OR — when both `origin` URLs are known — their normalised origins
match (so a separate worktree or a fresh clone of the same upstream is still
home, not foreign). Otherwise it is **foreign**. The classification is a
single pure function with no I/O — the caller resolves the git facts and logs
the verdict (rule #10, no model in the gate):

```text
classifyRepo  → "home" | "foreign"     scripts/lib/repo-policy.mjs
assertWriteAllowed → allow | refuse{code}
```

### Decision table (this IS the home × foreign × push/PR/taskmd matrix)

| class   | action      | diff shape       | verdict                       |
|---------|-------------|------------------|-------------------------------|
| home    | push-code   | (any)            | allow                         |
| home    | open-pr     | (any)            | allow                         |
| foreign | push-code   | (any)            | refuse `foreign-code-push`    |
| foreign | open-pr     | TASKS.md-only    | allow                         |
| foreign | open-pr     | other / unknown  | refuse `foreign-nontaskmd-pr` |

Fail-safe: a foreign `open-pr` with an **undetermined** diff (empty / unknown
`changedPaths`) is refused, never allowed — an unknown diff is not assumed
safe. `TASKS.md` matching is a strict basename check, so look-alikes
(`TASKS.md.bak`, `MY-TASKS.md`, `TASKS.markdown`) are rejected.

### Defense-in-depth at the gate (the Pivot's git-layer backstop)

`scripts/local-gate-merge.mjs`'s `decideMerge` runs `decidePrRepoPolicy`
ahead of the vet/review layers: a PR whose head repo classifies as foreign is
refused before any `gh pr merge` call. The gate only ever lists the home
repo's own PRs today, so absent head-repo identity is treated as home (the
safe common case) — but the guard is the Pivot's backstop should a foreign /
fork head ever reach the merge path.

### Scout-and-record across the fleet

Independently of the write policy, every conductor tick vets minsky-on-itself.
On any observed friction — the worker daemon was found DOWN and healed, or the
merge sweep errored — the run files a minsky-self improvement task (recorded
as a `minsky-self-task-filed` ledger event) so a stranger session picks it up.

### Implementation seam

The classification + permission decision is migrated to the post-phase-7b
home for runner logic, `scripts/lib/repo-policy.mjs` (the
`novel/cross-repo-runner/` package the original task `**Files**` named was
deleted in PR #883 and its logic moved to `scripts/lib/*.mjs`; this seam
follows that convention rather than resurrecting the deleted package — rule #1). The conductor (`scripts/orchestrate.mjs`) emits the verdict ledger; the
gate (`scripts/local-gate-merge.mjs`) carries the git-layer backstop.

### Measurement (pre-registered, rule #9)

The task's Success thresholds are evaluated deterministically by the audit
harness — committed before the result is observed (Munafò et al. 2017):

```bash
node scripts/runany-policy-audit.mjs --window=run --json
# → {"foreign_code_pushes":0,"foreign_prs_nontaskmd":0,
#    "minsky_self_tasks_filed":N,"pass":…}
node scripts/runany-policy-audit.mjs --window=run          # human summary
```

Exit code is `0` only when all three pre-registered thresholds hold over the
run window (since the last `run-start` marker): zero foreign code pushes
escaped the gate, zero foreign non-TASKS.md PRs escaped, and at least one
minsky-self improvement task was filed when friction was observed. The escape
counters are 0 by construction — the gate refuses every foreign code write —
so a non-zero count is a regression that flips this exit-1.

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
