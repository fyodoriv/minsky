#!/bin/bash
# Minsky observer — watches the daemon for 4h, heals on failure
# Usage: bash scripts/observer-watch.sh [hours=4]
#
# launchd integration: when wired through `~/Library/LaunchAgents/com.minsky.observer.plist`,
# set BOTH `RunAtLoad=true` AND `KeepAlive=true` in the plist. The script
# defensively wraps every minsky-command invocation with `|| log <warn>`
# (no `set -e`), but if the script is killed by an external signal or
# the loop terminates, launchd KeepAlive=true restarts it. Without
# KeepAlive=true a single defensive-but-non-zero exit can take the
# observer down (the 2026-05-18 incident: "minsky --daemon" returned
# 'daemon already running (PID XXXX)' (stale PID), the script handled
# the non-zero exit defensively, but launchd then noticed the process
# died with non-zero and didn't restart it because KeepAlive=false).
set -uo pipefail
# NOTE: no set -e — minsky commands return non-zero on expected conditions
# (stale PID, already running, etc.) and we handle those explicitly.

HOURS=${1:-4}
END_TIME=$(($(date +%s) + HOURS * 3600))
CHECK_INTERVAL=60  # seconds
RESTART_BUDGET=5
RESTARTS_USED=0
CONSECUTIVE_FAILS=0
LAST_TOTAL_ITERATIONS=0
STUCK_CHECKS=0

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "Observer starting — watching minsky for ${HOURS}h (until $(date -v+${HOURS}H '+%H:%M'))"
log "Restart budget: ${RESTART_BUDGET}, check interval: ${CHECK_INTERVAL}s"

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  # Check if daemon is running
  if ! minsky status 2>&1 | grep -q "running (PID"; then
    CONSECUTIVE_FAILS=$((CONSECUTIVE_FAILS + 1))

    if [ "$RESTARTS_USED" -ge "$RESTART_BUDGET" ]; then
      log "❌ RESTART BUDGET EXHAUSTED ($RESTARTS_USED/$RESTART_BUDGET). Stopping observer."
      log "Last 20 log lines:"
      tail -20 ~/.minsky/daemon.log
      exit 1
    fi

    RESTARTS_USED=$((RESTARTS_USED + 1))
    BACKOFF=$((10 * CONSECUTIVE_FAILS))
    [ "$BACKOFF" -gt 120 ] && BACKOFF=120

    log "⚠️  Daemon not running (fail #${CONSECUTIVE_FAILS}). Restart ${RESTARTS_USED}/${RESTART_BUDGET} in ${BACKOFF}s"
    log "  Last log: $(tail -1 ~/.minsky/daemon.log 2>/dev/null || echo 'no log')"

    sleep "$BACKOFF"
    # Clean stale PID if the process is actually dead
    if [ -f ~/.minsky/daemon.pid ]; then
      STALE_PID=$(cat ~/.minsky/daemon.pid 2>/dev/null || echo "")
      if [ -n "$STALE_PID" ] && ! kill -0 "$STALE_PID" 2>/dev/null; then
        log "  Removing stale PID file (PID $STALE_PID not running)"
        rm -f ~/.minsky/daemon.pid
      fi
    fi
    minsky --daemon --hosts-dir ~/apps/tooling 2>&1 || log "  Warning: minsky --daemon exited non-zero (may already be running)"
    log "  Restarted daemon"
    sleep 10
    continue
  fi

  # Daemon is running — reset consecutive fail counter
  CONSECUTIVE_FAILS=0

  # Extract current state
  STATUS=$(minsky status 2>&1)
  PID=$(echo "$STATUS" | grep -o 'PID [0-9]*' | head -1 | grep -o '[0-9]*')
  UPTIME=$(echo "$STATUS" | grep -oE '[0-9]+:[0-9]+' | head -1)

  # Check last log line for progress
  LAST_LOG=$(tail -1 ~/.minsky/daemon.log 2>/dev/null || echo "")

  # Check for iteration progress
  TOTAL_ITERATIONS=$(grep -c 'iteration record' ~/.minsky/daemon.log 2>/dev/null || echo 0)

  if [ "$TOTAL_ITERATIONS" = "$LAST_TOTAL_ITERATIONS" ]; then
    STUCK_CHECKS=$((STUCK_CHECKS + 1))
  else
    STUCK_CHECKS=0
    LAST_TOTAL_ITERATIONS=$TOTAL_ITERATIONS
  fi

  # Report
  SPAWN_FAILED=$(grep -c 'spawn-failed' ~/.minsky/daemon.log 2>/dev/null || echo 0)
  VALIDATED=$(grep -c 'validated' ~/.minsky/daemon.log 2>/dev/null || echo 0)
  REMAINING=$((END_TIME - $(date +%s)))
  REMAINING_MIN=$((REMAINING / 60))

  log "✅ PID=$PID uptime=$UPTIME iterations=$TOTAL_ITERATIONS validated=$VALIDATED spawn-failed=$SPAWN_FAILED stuck-checks=$STUCK_CHECKS remaining=${REMAINING_MIN}m restarts=${RESTARTS_USED}/${RESTART_BUDGET}"

  # Heal: stuck for >10 min (10 checks × 60s)
  if [ "$STUCK_CHECKS" -ge 10 ]; then
    log "⚠️  No progress for 10min. Sending SIGTERM + restart."
    minsky stop 2>&1 || true
    sleep 5
    rm -f ~/.minsky/daemon.pid
    STUCK_CHECKS=0
    RESTARTS_USED=$((RESTARTS_USED + 1))
    minsky --daemon --hosts-dir ~/apps/tooling 2>&1 || log "  Warning: restart exited non-zero"
    log "  Restarted after stuck detection"
  fi

  sleep "$CHECK_INTERVAL"
done

log "🏁 Observer finished — ${HOURS}h watch complete"
log "Final status:"
minsky status 2>&1 || log "  Warning: terminal 'minsky status' exited non-zero — daemon likely down"
log "Total restarts used: ${RESTARTS_USED}/${RESTART_BUDGET}"
FINAL_ITERATIONS=$(grep -c 'iteration record' ~/.minsky/daemon.log 2>/dev/null || echo 0)
FINAL_VALIDATED=$(grep -c 'validated' ~/.minsky/daemon.log 2>/dev/null || echo 0)
FINAL_FAILED=$(grep -c 'spawn-failed' ~/.minsky/daemon.log 2>/dev/null || echo 0)
log "Iterations: ${FINAL_ITERATIONS} total, ${FINAL_VALIDATED} validated, ${FINAL_FAILED} spawn-failed"
# Force clean exit so launchd's KeepAlive (when wired per the header
# block) only restarts the observer on UNEXPECTED termination, not on
# clean completion of the configured watch period.
exit 0
