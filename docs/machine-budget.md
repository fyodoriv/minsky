# Machine-utilisation budget + cross-repo propagation runbook

This file exists because minsky must run the host *to* a single operator-defined machine-utilisation budget — never idling expensive hardware, never gridlocking it — and the budget, the autoscaler that matches it, the OS throttles that can make it unreachable, and the cross-repo propagation that keeps host changes durable are otherwise prose-only and regressed silently once (the worker plist shipped `ProcessType=Background`, making the budget physically unreachable). It is the operator runbook for `operator-machine-budget-autoscale` (vision.md rule #15).

## The budget (one number)

The operator defines ONE percentage. minsky resolves it, in precedence order:

1. `MINSKY_MACHINE_BUDGET_PCT` env override (one session).
2. `~/.minsky/config.json` `machineBudgetPct` field (persistent per-machine).
3. The pinned policy default — **70** (`MACHINE_BUDGET_POLICY.defaultBudgetPct`).

A weekly-gated swarm window (`MINSKY_SWARM_MODE=1`) raises the *ceiling* from 100 to **80** (`swarmMaxBudgetPct`) — anything above 80 is capped while the switch is on. The budget is clamped to `[1, ceiling]`; a garbage/out-of-range value is ignored and the next layer wins (fail-safe default).

```bash
# Common case (default 70%):
node novel/tick-loop/bin/tick-loop.mjs --json

# Swarm window (≤80% ceiling):
MINSKY_MACHINE_BUDGET_PCT=80 MINSKY_SWARM_MODE=1 node novel/tick-loop/bin/tick-loop.mjs --json
```

## The autoscaler (match, don't overshoot)

`computeWorkerTarget` (`novel/tick-loop/src/machine-budget-autoscaler.ts`) is a pure closed-loop controller. It drives worker concurrency toward the budget by reading back *effective* throughput — active model subprocesses + PRs produced — never the nominal worker count it last requested. Three regimes:

- **ramp-up** — below budget and throughput still rising → +1 worker (single step, no doubling, to avoid oscillation).
- **knee-hold** / **at-budget** — at the budget, or a prior ramp stopped raising throughput (the saturation knee) → hold.
- **gridlock-backoff** — load runaway (`loadAvg ≥ cores × 4`) AND active subprocs collapsed toward 0 → halve the target immediately (circuit-break).

The ramp ceiling is `floor(cores × budgetPct / 100)` (70% of 10 cores → 7). This replaces the old fixed `--spawn-additional-workers` constant, which could not track the per-host saturation knee — empirically a 10-core box did useful work at ~10 workers (load ~37) but gridlocked to zero at 20 (load ~61).

## Throttle removal (make the budget reachable)

`detectThrottles` (`novel/tick-loop/src/os-throttle-detect.ts`) finds OS throttles that contradict a non-trivial budget:

| Throttle | Why it contradicts the budget | Fix | Mirror |
|---|---|---|---|
| launchd `ProcessType=Background` | macOS QoS-throttles CPU/IO | `ProcessType=Standard` | dotfiles |
| launchd `Nice > 0` | deprioritises the worker | remove `<Nice>` / set 0 | dotfiles |
| `ulimit -n < 2048` | fd starvation caps concurrency | raise open-file limit | dotfiles |
| stale `MINSKY_*` cap (e.g. `MINSKY_SPAWN_ADDITIONAL_WORKERS`) | hard ceiling overrides the autoscaler | unset; encode durable caps as an agentbrew rule | agentbrew |

The repo-tracked worker plist (`distribution/launchd/com.minsky.tick-loop.plist`) pins `ProcessType=Standard`; the deterministic gate `scripts/check-machine-budget.mjs` hard-fails CI if it ever drifts back to `Background` on any minsky worker/tick-loop plist.

## Cross-repo propagation (durable, not one-off)

Per rule #1, every host-level change is propagated to the enterprise mirror that durably owns it instead of being re-applied as a one-off each reboot. `renderMirrorTasks` produces a tasks.md-spec P0 block targeting:

- `~/apps/dotfiles/TASKS.md` — launchd / shell / sysctl / ulimit changes.
- `~/apps/agentbrew/TASKS.md` — the agent rule/skill encoding of the budget.

The I/O edge (`bin/tick-loop.mjs`) appends the block; minsky then *pulls* the durable version. The pure renderer keeps the block text deterministically testable.

## Verify

```bash
node scripts/check-machine-budget.mjs                                   # the rule-#10 gate
pnpm vitest run novel/tick-loop/src/machine-budget-autoscaler.test.ts   # ramp / knee / gridlock
pnpm vitest run novel/tick-loop/src/os-throttle-detect.test.ts          # throttle detection
```

## Failure modes

- **Controller oscillation (concurrency hunting)** — Pivot (rule #9): fall back to a per-host calibrated constant table (measured knee per core-count) selected by the budget. Still no `Background` throttle, still cross-repo-propagated; never a single hand-edited global constant.
- **Non-launchd / partial host probe** (Linux, missing plist) — degrades gracefully to a clean result; the probe never crashes (rule #7).
- **Garbage budget value** — rejected by `resolveMachineBudgetPct`, falls through to the default.
