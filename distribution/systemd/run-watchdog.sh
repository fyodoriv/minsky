#!/bin/bash
# <!-- scope: human-approved 2026-06-12 operator EPM-alert triage — watchdog runner must source lib-launchd-path.sh so launchd spawns never resolve /usr/bin/{node,python3} (CyberArk EPM kills them and pops security alerts) -->
# Bash bootstrap for `com.minsky.watchdog` launchd LaunchAgent.
#
# Replaces `/usr/bin/env node` in the plist — CyberArk EPM blocks env
# (Publisher: Software Signing) on this fleet. Sources lib-launchd-path.sh
# so node, dotfiles shims, and uv python resolve under launchd's minimal PATH.
#
# Pattern: thin runner / process-launcher (Martin, Clean Architecture — I/O at edge).

set -euo pipefail

MINSKY_HOME="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export MINSKY_HOME

_watchdog_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-launchd-path.sh
. "${_watchdog_dir}/lib-launchd-path.sh"
unset _watchdog_dir

exec node "${MINSKY_HOME}/scripts/watchdog.mjs" "$@"
