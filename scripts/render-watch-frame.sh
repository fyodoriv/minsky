#!/bin/bash
# Render one frame of the minsky watch dashboard to stdout.
# Usage: bash scripts/render-watch-frame.sh [host-dir]
#
# Reads from:
#   - ~/.minsky/daemon.pid (daemon PID)
#   - ~/.minsky/daemon.log (daemon log)
#   - <host>/.minsky/experiment-store/cross-repo/*.jsonl (iteration records)
#   - <host>/TASKS.md (blocked task count)
#
# Env overrides for testing:
#   MINSKY_DAEMON_PID_FILE  — path to PID file (default ~/.minsky/daemon.pid)
#   MINSKY_DAEMON_LOG_FILE  — path to log file (default ~/.minsky/daemon.log)
#   MINSKY_SCRIPTS_DIR      — path to scripts/ (for stability-number.mjs)

MINSKY_HOME="${HOME:-/root}"
PID_FILE="${MINSKY_DAEMON_PID_FILE:-$MINSKY_HOME/.minsky/daemon.pid}"
LOG_FILE="${MINSKY_DAEMON_LOG_FILE:-$MINSKY_HOME/.minsky/daemon.log}"
SCRIPTS_DIR="${MINSKY_SCRIPTS_DIR:-$(cd "$(dirname "$0")" && pwd)}"
HOST_DIR="${1:-}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  minsky watch — $(date '+%H:%M:%S')  (Ctrl-C to detach, daemon keeps running)  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Daemon status ──
if [ -f "$PID_FILE" ]; then
  daemon_pid=$(cat "$PID_FILE" 2>/dev/null)
  if kill -0 "$daemon_pid" 2>/dev/null; then
    uptime=$(ps -p "$daemon_pid" -o etime= 2>/dev/null | tr -d ' ')
    target=$(ps -p "$daemon_pid" -o args= 2>/dev/null | grep -oE '\-\-host [^ ]+' | head -1)
    agent_count=$(pgrep -f 'devin.*--print\|claude.*--print' 2>/dev/null | wc -l | tr -d ' ')
    echo "  🟢 DAEMON  PID=$daemon_pid  uptime=$uptime  agents=$agent_count"
    echo "     target: $target"
  else
    echo "  🔴 DAEMON  stale PID $daemon_pid (not running)"
    echo "     fix: rm -f $PID_FILE && minsky --daemon --host <repo>"
  fi
else
  echo "  ⚫ DAEMON  not running"
  echo "     start: minsky --daemon --host <repo>"
fi
echo ""

# ── Detect host dir if not provided ──
if [ -z "$HOST_DIR" ]; then
  HOST_DIR=$(ps aux 2>/dev/null | grep minsky-run | grep -v grep | grep -oE '\-\-host [^ ]+' | awk '{print $2}' | head -1)
fi

# ── Stability ──
if [ -n "$HOST_DIR" ] && command -v node >/dev/null 2>&1 && [ -f "$SCRIPTS_DIR/stability-number.mjs" ]; then
  _stab=$(node "$SCRIPTS_DIR/stability-number.mjs" "$HOST_DIR" 2>/dev/null || echo "no data")
  echo "  📈 Stability: $_stab"
fi

# ── Dynamic timeouts ──
dt_line=$(grep 'dynamic-timeouts' "$LOG_FILE" 2>/dev/null | tail -1)
if [ -n "$dt_line" ]; then
  echo "  ⏱  $dt_line"
fi

# ── Current task ──
_current_task=$(grep 'wrote.*experiments.*yaml' "$LOG_FILE" 2>/dev/null | tail -1 | grep -oE '[a-z][-a-z0-9]*\.yaml' | sed 's/\.yaml//')
if [ -n "$_current_task" ]; then
  echo "  🔧 Current: $_current_task"
fi

# ── Last iteration summary ──
_last_iter=$(grep '^⏱ iteration' "$LOG_FILE" 2>/dev/null | tail -1)
if [ -n "$_last_iter" ]; then
  echo "  $_last_iter"
fi
echo ""

# ── Recent iterations ──
echo "  📊 RECENT ITERATIONS"
echo "  ────────────────────────────────────────────────────────"
if [ -n "$HOST_DIR" ] && [ -d "$HOST_DIR/.minsky/experiment-store/cross-repo" ]; then
  found=0
  for f in "$HOST_DIR"/.minsky/experiment-store/cross-repo/*.jsonl; do
    [ -f "$f" ] || continue
    found=1
    task=$(basename "$f" .jsonl)
    count=$(wc -l < "$f" | tr -d ' ')
    last=$(tail -1 "$f" 2>/dev/null)
    if [ -n "$last" ]; then
      verdict=$(echo "$last" | grep -o '"verdict":"[^"]*"' | sed 's/"verdict":"//;s/"//')
      ts=$(echo "$last" | grep -o '"ts":"[^"]*"' | sed 's/"ts":"//;s/"//;s/T/ /' | cut -c1-19)
      pr=$(echo "$last" | grep -o '"pr_url":"[^"]*"' | sed 's/"pr_url":"//;s/"//')
      if [ "$pr" = "null" ] || [ -z "$pr" ]; then pr="—"; fi
      printf "  %-42s %s %-12s pr=%s  (%s total)\n" "$task" "$ts" "$verdict" "$pr" "$count"
    fi
  done
  [ "$found" -eq 0 ] && echo "  (no experiment data yet)"
else
  echo "  (no experiment data yet)"
fi
echo ""

# ── Human help needed ──
echo "  🆘 NEEDS HUMAN ACTION"
echo "  ────────────────────────────────────────────────────────"
_help_needed=0

# Scope-leak
if [ -n "$HOST_DIR" ] && [ -d "$HOST_DIR/.minsky/experiment-store/cross-repo" ]; then
  for f in "$HOST_DIR"/.minsky/experiment-store/cross-repo/*.jsonl; do
    [ -f "$f" ] || continue
    v=$(tail -1 "$f" | grep -o '"verdict":"[^"]*"' | sed 's/"verdict":"//;s/"//')
    if [ "$v" = "scope-leak" ]; then
      echo "  ⚠️  scope-leak detected on $(basename "$f" .jsonl). Commit changes, then: minsky stop && minsky"
      _help_needed=1
    fi
  done
fi

# Repeated spawn-failed
if [ -f "$LOG_FILE" ]; then
  _recent_fails=$(tail -20 "$LOG_FILE" | grep -c 'spawn-failed' 2>/dev/null || echo "0")
  _recent_fails=$(echo "$_recent_fails" | tr -d '[:space:]')
  if [ "${_recent_fails:-0}" -ge 3 ] 2>/dev/null; then
    echo "  ⚠️  3+ recent spawn failures. Check: devin --version / claude --version"
    _help_needed=1
  fi
fi

# Blocked tasks
if [ -n "$HOST_DIR" ] && [ -f "$HOST_DIR/TASKS.md" ]; then
  _blocked=$(grep -c '\*\*Blocked\*\*:' "$HOST_DIR/TASKS.md" 2>/dev/null || echo "0")
  _blocked=$(echo "$_blocked" | tr -d '[:space:]')
  if [ "${_blocked:-0}" -gt 0 ] 2>/dev/null; then
    echo "  📋 $_blocked tasks marked as blocked — review TASKS.md"
    _help_needed=1
  fi
fi

# Stale daemon log
if [ -f "$LOG_FILE" ]; then
  _log_mtime=$(stat -f %m "$LOG_FILE" 2>/dev/null || stat -c %Y "$LOG_FILE" 2>/dev/null || echo 0)
  _log_age=$(( $(date +%s) - _log_mtime ))
  if [ "$_log_age" -gt 1200 ]; then
    echo "  ⚠️  Daemon log not updated in $((_log_age / 60))min — may be stuck"
    _help_needed=1
  fi
fi

if [ "$_help_needed" -eq 0 ]; then
  echo "  ✅ No human action needed — minsky is running autonomously"
fi
echo ""

# ── Log tail ──
echo "  📝 LOG (last 5 lines)"
echo "  ────────────────────────────────────────────────────────"
if [ -f "$LOG_FILE" ]; then
  tail -5 "$LOG_FILE" | sed 's/^/  /'
else
  echo "  (no log)"
fi
