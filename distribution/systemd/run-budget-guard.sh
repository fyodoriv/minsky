#!/bin/bash
# Bash bootstrap for `minsky-budget-guard.service` (systemd) and the
# `com.minsky.budget-guard` launchd LaunchAgent (macOS).
#
# Why this is a sleep-forever stub
# --------------------------------
# The supervisor unit-files (`distribution/{systemd,launchd}/minsky-budget-
# guard.*`) were authored when the original architecture envisioned a
# *standalone* budget-guard process that polled the TokenMonitor on an
# independent cadence. The architecture evolved: budget-guard now runs
# *in-tick* — the tick-loop daemon constructs a real `BudgetGuard` via
# the facade in `novel/tick-loop/src/budget-guard-facade.ts`
# (`fromRealBudgetGuard(guard)`) and calls `decide()` per iteration
# (sub-task 2/3 of `tick-loop-daemon-real-spawn`).
#
# So the standalone budget-guard process is vestigial. We keep the
# supervisor unit-file so the topology in `distribution/README.md` § "Failure
# modes & chaos verification" rows 3 and 4 stays empirically testable
# (`linux-supervisor-integration` / `macos-supervisor-integration` write
# their own stub runners and assert `Restart=always` semantics — the policy
# is what matters, not the runner). For Minsky-on-itself dogfooding, this
# stub keeps the supervisor target healthy without claiming to do
# budget-guard work that's already being done in-tick.
#
# Pattern: sleep-forever supervisor sentinel — closest published primitive
# is the `pause` container in Kubernetes (Borg/Bashir/Burns/Hightower
# *Designing Distributed Systems*, 2017, ch. on the "Sidecar Pattern"); a
# placeholder process that exists to anchor lifecycle, not to compute.
#
# Anchor: rule #1 (don't reinvent — the supervisor topology already exists;
# this stub is the smallest viable runner that respects it); rule #6
# (let-it-crash — `exec sleep` means SIGTERM kills the process cleanly,
# launchd / systemd respect their respective restart policies).
#
# When this script becomes load-bearing again
# -------------------------------------------
# If a future change moves budget-guard back to a standalone process (e.g.,
# a separate OTEL emitter that polls every 60s and writes to the
# observability backend), replace the body of this script with the real
# command. The supervisor unit-file's Restart= / KeepAlive= directives
# are already correct for an `always` policy.

set -euo pipefail

# Default to the repo root when not bootstrapped by setup.sh's envsubst.
MINSKY_HOME="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export MINSKY_HOME

# Sleep-forever sentinel. SIGTERM exits cleanly (default `sleep` behaviour);
# the supervisor's Restart=always (systemd) / KeepAlive=true (launchd) brings
# us back per the chaos-table policy.
exec sleep infinity
