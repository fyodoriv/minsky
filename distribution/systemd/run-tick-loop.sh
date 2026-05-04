#!/bin/bash
# Bash bootstrap for `minsky-tick-loop.service` (systemd) and the
# `com.minsky.tick-loop` launchd LaunchAgent on macOS.
#
# v0 (sub-task `tick-loop-daemon-v0`): execs into `node bin/tick-loop.mjs
# --dry-run …` so the supervisor sees the node PID directly. Real
# subprocess spawning (`child_process.spawn('claude', …)`) is deferred to
# the follow-up `tick-loop-daemon-real-spawn`; v0 only wires the
# orchestrator + CLI + bash bootstrap + tests via the dry-run path.
#
# Pattern: thin runner / process-launcher script — the I/O boundary that
# binds the supervisor to the pure `runDaemon` constructor in
# `novel/tick-loop/dist/daemon.js`. Anchors: Martin, *Clean Architecture*,
# 2017 (I/O at the edge); rule #2 (every dep behind interface — the
# `MockAnthropicClient` is the seam, the bootstrap doesn't reach
# vendor SDKs); Beck 1999 (CI as the constraint enforcer).
#
# Environment:
#   MINSKY_HOME                       (required by systemd unit; defaults
#                                     to the repo checkout in launchd)
#   MINSKY_TICK_INTERVAL_MS           (optional, default 300000 / 5 min)
#   MINSKY_TICK_MAX_ITERATIONS        (optional, default unbounded)
#
# Args (forwarded to the CLI):
#   --dry-run                         v0 mandatory; daemon throws otherwise
#   --max-iterations=N                cap iteration count
#   --tick-interval-ms=MS             override the 5-min cadence
#
# Run as:
#   bash distribution/systemd/run-tick-loop.sh --dry-run --max-iterations=4
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

# v0 ALWAYS forwards `--dry-run`. The follow-up `tick-loop-daemon-real-spawn`
# replaces this with a flag-driven gate.
exec node "${MINSKY_HOME}/novel/tick-loop/bin/tick-loop.mjs" --dry-run "${EXTRA_ARGS[@]}" "$@"
