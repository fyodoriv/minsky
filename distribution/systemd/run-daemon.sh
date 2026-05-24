#!/bin/bash
# Bash launcher for `minsky-daemon.service` (Linux equivalent of the
# macOS `com.minsky.daemon` launchd LaunchAgent).
#
# Reads `default_host` from `~/.minsky/config.json` and execs the
# cross-repo-runner in autonomous-loop mode. Mirrors the launchd plist
# rendered by `bin/minsky install-daemon`.
#
# Pattern: thin runner / process-launcher script — the I/O boundary that
# binds the supervisor (systemd-user) to `novel/cross-repo-runner/bin/minsky-run.mjs`.
# `exec node` so systemd sees the node PID directly and a SIGTERM
# reaches it without a shell-wrapper detour (matches `run-tick-loop.sh`).
#
# Acceptance criterion (d) of `daemon-survives-machine-restart`: stale
# PID cleanup, dirty-state reset on a crashed-iteration branch, and
# iteration-resume happen inside the runner / `bin/minsky --daemon`
# startup path (see `bin/minsky` lines 547–581 in this repo). This
# script's only job is to resolve the host and exec the runner.
#
# Environment:
#   MINSKY_HOME                       (required) absolute path to the
#                                     minsky repo checkout — set by the
#                                     systemd unit, NOT inferred from $0
#                                     because exec-from-systemd has no
#                                     reliable script-path anchor.
#   MINSKY_DAEMON_HOST                (optional override) skip the
#                                     config.json lookup and use this.
#   MINSKY_BASH_RUNNER                (Phase 7b'-prep) when "1", exec
#                                     `bin/minsky --bash-runner` (the
#                                     Path A bash port) instead of the
#                                     Node runner. Operator opt-in for
#                                     live-fire smoke; default stays the
#                                     Node runner until the bash port
#                                     is confirmed stable in dogfood.
#                                     Plan: docs/plans/2026-05-24-
#                                     path-a-aggressive-cut.md § Phase 7b'

set -euo pipefail

if [ -z "${MINSKY_HOME:-}" ]; then
  echo "minsky-daemon: MINSKY_HOME not set — refusing to start" >&2
  exit 1
fi

CONFIG_FILE="${MINSKY_CONFIG_FILE:-$HOME/.minsky/config.json}"

# Resolve default_host:
#   1. $MINSKY_DAEMON_HOST  (operator escape hatch)
#   2. ~/.minsky/config.json::default_host
#   3. fail loud (rule #6 — let-it-crash AT the boundary, not silently)
HOST="${MINSKY_DAEMON_HOST:-}"
if [ -z "$HOST" ] && [ -f "$CONFIG_FILE" ]; then
  HOST=$(python3 -c "import json,sys
try:
    with open('$CONFIG_FILE') as f:
        print(json.load(f).get('default_host',''))
except Exception:
    sys.exit(0)
" 2>/dev/null || echo "")
fi

if [ -z "$HOST" ]; then
  echo "minsky-daemon: no default_host in $CONFIG_FILE and MINSKY_DAEMON_HOST is unset — refusing to start" >&2
  echo "minsky-daemon: fix → write {\"default_host\": \"/path/to/repo\"} to $CONFIG_FILE" >&2
  exit 1
fi

# Phase 7b'-prep: when MINSKY_BASH_RUNNER=1, dispatch to bin/minsky's
# bash-runner branch (#803) instead of the Node runner. Same supervisor
# semantics (systemd sees the bash PID directly, SIGTERM reaches it).
if [ "${MINSKY_BASH_RUNNER:-0}" = "1" ]; then
  BASH_RUNNER="$MINSKY_HOME/bin/minsky-run.sh"
  if [ ! -x "$BASH_RUNNER" ]; then
    echo "minsky-daemon: MINSKY_BASH_RUNNER=1 but $BASH_RUNNER not executable" >&2
    exit 1
  fi
  # The bash runner takes --hosts-dir (a parent containing N host repos)
  # in walker mode. For the single-host daemon path, we pass the host's
  # PARENT as --hosts-dir so the bash walker discovers exactly one host
  # and iterates against it. Matches the Node runner's --host semantics
  # via composition rather than a separate single-host flag (rule #1 —
  # don't add a new mode to the bash port when --hosts-dir already
  # subsumes it).
  HOST_PARENT="$(dirname "$HOST")"
  exec bash "$BASH_RUNNER" --hosts-dir "$HOST_PARENT"
fi

RUNNER="$MINSKY_HOME/novel/cross-repo-runner/bin/minsky-run.mjs"
if [ ! -f "$RUNNER" ]; then
  echo "minsky-daemon: runner missing at $RUNNER — distribution layout drift" >&2
  exit 1
fi

exec node "$RUNNER" --host "$HOST" --loop
