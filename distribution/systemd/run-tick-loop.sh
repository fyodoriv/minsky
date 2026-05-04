#!/bin/bash
# Bash bootstrap for `minsky-tick-loop.service` (systemd) and the
# `com.minsky.tick-loop` launchd LaunchAgent on macOS.
#
# Sub-task 3/3 of `tick-loop-daemon-real-spawn` (`tick-loop-daemon-real-spawn-flip`):
# the production default is now `ProcessSpawnStrategy` — a real
# `claude --resume` subprocess per iteration. The `--dry-run` argv flag has
# been retired; dry-run is opt-in via the `MINSKY_TICK_DRY_RUN=1` env var
# (set in the supervisor unit file's `Environment=` line during the safe
# rollout window; an operator drops that line to flip to real spawn).
#
# Pattern: thin runner / process-launcher script — the I/O boundary that
# binds the supervisor to the pure `runDaemon` constructor in
# `novel/tick-loop/dist/daemon.js`. Anchors: Martin, *Clean Architecture*,
# 2017 (I/O at the edge); rule #2 (every dep behind interface — the
# `SpawnStrategy` is the seam, the bootstrap doesn't reach vendor SDKs);
# Beck 1999 (CI as the constraint enforcer); Beyer SRE 2016 Ch. 17
# (operator escape hatch — `MINSKY_TICK_DRY_RUN=1` is the env-var lever).
#
# Environment (control surface):
#   MINSKY_HOME                       (required by systemd unit; defaults
#                                     to the repo checkout in launchd)
#   MINSKY_TICK_DRY_RUN=1|true        (optional) flip from real spawn to
#                                     synthetic `DryRunSpawnStrategy`. Unset =
#                                     full real spawn (production default).
#   MINSKY_TICK_INTERVAL_MS           (optional, default 300000 / 5 min)
#   MINSKY_TICK_MAX_ITERATIONS        (optional, default unbounded)
#
# Args (forwarded to the CLI):
#   --max-iterations=N                cap iteration count
#   --tick-interval-ms=MS             override the 5-min cadence
#   --tasks-md=PATH / --paused-sentinel=PATH (overrides defaults)
#
# Run as:
#   bash distribution/systemd/run-tick-loop.sh --max-iterations=4
#   MINSKY_TICK_DRY_RUN=1 bash distribution/systemd/run-tick-loop.sh ...
#
# `exec node` so the supervisor (systemd-user / launchd) sees the node
# PID directly and a SIGTERM reaches it without a shell-wrapper detour.

set -euo pipefail

# Default to the repo root when not bootstrapped by setup.sh's envsubst.
MINSKY_HOME="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export MINSKY_HOME

# Optional env-var → CLI arg mapping. The CLI itself accepts the same
# flags directly, so explicit args (passed by the operator) override.
EXTRA_ARGS=()
if [[ -n "${MINSKY_TICK_INTERVAL_MS:-}" ]]; then
  EXTRA_ARGS+=("--tick-interval-ms=${MINSKY_TICK_INTERVAL_MS}")
fi
if [[ -n "${MINSKY_TICK_MAX_ITERATIONS:-}" ]]; then
  EXTRA_ARGS+=("--max-iterations=${MINSKY_TICK_MAX_ITERATIONS}")
fi

# `MINSKY_TICK_DRY_RUN` (read by the CLI directly) is the env-var control
# surface for dry-run; unset = real spawn (production default).
#
# Bash quirk: under `set -u`, `"${EXTRA_ARGS[@]}"` triggers an unbound-
# variable error when EXTRA_ARGS is empty (no env-var mappings hit
# above). The `+"${EXTRA_ARGS[@]}"` parameter-substitution form expands
# to nothing when the array is unset/empty and to the array contents
# otherwise — portable across bash 3 (macOS default) and bash 5 (Linux).
exec node "${MINSKY_HOME}/novel/tick-loop/bin/tick-loop.mjs" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} "$@"
