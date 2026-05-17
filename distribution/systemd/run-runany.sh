#!/bin/bash
# <!-- scope: human-approved task runany-self-restart-bounded-timelimit — the supervising wrapper the task Details + Touches (distribution/launchd/**) explicitly direct; operator 2026-05-16 directive -->
# Bash bootstrap for the `com.minsky.runany` launchd LaunchAgent (macOS)
# and `minsky-runany.service` (systemd) — the supervised wrapper for the
# run-anywhere conductor (`scripts/orchestrate.mjs`).
#
# Task: `runany-self-restart-bounded-timelimit` (TASKS.md P0). The
# supervision is a two-layer composition (rule #1 — compose, don't
# duplicate):
#
#   1. launchd `KeepAlive{SuccessfulExit:false}` + a flat
#      `ThrottleInterval` floor (the .plist) — the OS half: respawn ONLY
#      on non-zero exit. A clean exit 0 at `MINSKY_RUN_TIME_LIMIT` is
#      NOT respawned, so the wall-clock ceiling is a true terminal stop
#      (Acceptance #3). launchd's ThrottleInterval is a single *flat*
#      number — it cannot escalate.
#   2. The conductor's in-process startup self-throttle
#      (`decideStartupThrottle` in scripts/restart-supervisor.mjs, wired
#      in scripts/orchestrate.mjs) — the escalation half: reads its own
#      persisted crash history at boot and sleeps the escalating, capped,
#      reset-on-sustained-health backoff before resuming (Beyer SRE 2016
#      — the retry budget belongs to the thing being retried).
#
# This runner is just the I/O boundary that binds launchd to the node
# entrypoint (Martin, *Clean Architecture*, 2017 — I/O at the edge).
#
# Environment (control surface — see docs/run-anywhere.md):
#   MINSKY_HOME              repo checkout (set by setup.sh envsubst;
#                            falls back to the repo root otherwise)
#   MINSKY_RUN_TIME_LIMIT    hard wall-clock ceiling, `<n>s|m|h`
#                            (default 10h). At the limit the conductor
#                            exits 0 cleanly and is NOT respawned.
#   MINSKY_ORCH_INTERVAL_MS  conductor tick period (default 1200000)
#   MINSKY_NO_STARTUP_BACKOFF=1  skip the boot self-throttle sleep
#                            (CI / fast operator runs; state still tracked)
#
# Run as:
#   bash distribution/systemd/run-runany.sh
#   MINSKY_RUN_TIME_LIMIT=600s bash distribution/systemd/run-runany.sh
#
# `exec node` so the supervisor sees the node PID directly and SIGTERM
# reaches it without a shell-wrapper detour.

set -euo pipefail

# Default to the repo root when not bootstrapped by setup.sh's envsubst.
MINSKY_HOME="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export MINSKY_HOME

# Resolve node / gh / claude / opencode on the minimal launchd PATH.
# Single source of truth (rule #1) — see lib-launchd-path.sh.
# shellcheck source=distribution/systemd/lib-launchd-path.sh
. "${MINSKY_HOME}/distribution/systemd/lib-launchd-path.sh"

exec node "${MINSKY_HOME}/scripts/orchestrate.mjs" "$@"
