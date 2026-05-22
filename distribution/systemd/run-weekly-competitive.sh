#!/bin/bash
# <!-- pattern: Periodic-task pattern (Borg/Bashir/Burns/Hightower _Designing Distributed Systems_ 2017, ch. on "Distributed System Patterns" — periodic-scheduling primitive). The supervisor is the kernel (launchd/systemd) firing this script weekly; the script itself does ONE pass of work and exits. -->
#
# Bash runner for `minsky-weekly-competitive.service` (systemd) and the
# `com.minsky.weekly-competitive` launchd LaunchAgent (macOS).
#
# What this does
# --------------
# Refreshes `~/.minsky/competitive-scorecard.json` by running
# `bin/minsky competitive --host $MINSKY_HOME`. The CLI reads the local
# ledger at `.minsky/orchestrate.jsonl`, joins against the published
# competitor corpus in `@minsky/competitive-benchmark`, and writes the
# scorecard JSON. Exit 0 when the M1.10 shape gate (≥4 competitors × ≥5
# shared metrics) is met; exit 1 when the corpus is too thin.
#
# Why this exists
# ---------------
# M1.10 acceptance ("scorecard updates weekly"): without scheduled
# automation, the JSON drifts and the operator's dashboard claims stale
# freshness. The plist + this script close that gap. Default Monday
# 04:00 (launchd's StartCalendarInterval + systemd's OnCalendar).
#
# Why weekly, not daily
# ---------------------
# The competitor corpus is publication-driven (a competitor publishes a
# new SWE-bench number or PR-acceptance study at most once per quarter).
# The host's own ledger DOES change daily, but the deltas the operator
# cares about are weekly-scale ("did this week's iterations close the
# gap with Devin?"). A daily refresh would be vanity. Source: rule #15
# (operator machine-utilisation budget — bursty work, not steady-state).
#
# Why the opt-out is env-only
# ----------------------------
# Rule #16 (default by default): the supervisor target wires this on
# by default. Escape hatch: `MINSKY_WEEKLY_COMPETITIVE=off` in the
# operator's shell or in `~/.minsky/config.json`. Same shape as the
# auto-merge opt-out.
#
# Anchor: Beyer SRE 2016 ch. on toil-reduction (automate every step
#   that can be automated); rule #16 (default by default); rule #4
#   (everything measurable, everything visible — a scheduled artefact
#   is a stronger visibility primitive than an on-demand one).
#
# Failure modes (per rule #7)
# ---------------------------
# | failure mode                            | trigger / fault axis | expected behavior                          | chaos test                                                                                  |
# |-----------------------------------------|----------------------|--------------------------------------------|---------------------------------------------------------------------------------------------|
# | bin/minsky competitive returns non-zero | corpus-thin          | loud-crash; supervisor logs exit ≠0        | revert a corpus expansion; run script — verify non-zero exit + log entry                    |
# | builder dist missing                    | dependency-fault     | exit code 2 (per CLI usage)                | rm -rf novel/competitive-benchmark/dist; run script — verify exit 2 + actionable message    |
# | MINSKY_WEEKLY_COMPETITIVE=off           | operator-escape-hatch| graceful-degrade: script exits 0 with log  | `MINSKY_WEEKLY_COMPETITIVE=off ./run-weekly-competitive.sh` — verify exit 0 + log entry      |
# | node binary missing                     | dependency-fault     | loud-crash with PATH error                 | `PATH=/usr/bin ./run-weekly-competitive.sh` — verify exit 127 + log entry                   |

set -euo pipefail

# Resolve MINSKY_HOME: launchd/systemd inject it; manual invocation defaults to cwd.
MINSKY_HOME="${MINSKY_HOME:-$(pwd)}"
cd "$MINSKY_HOME"

# rule #16 opt-out: any value other than "off" / "false" / "0" leaves the weekly refresh ON.
weekly_flag="${MINSKY_WEEKLY_COMPETITIVE:-on}"
case "$weekly_flag" in
  off | false | 0 | "")
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] weekly-competitive disabled via MINSKY_WEEKLY_COMPETITIVE=$weekly_flag"
    exit 0
    ;;
esac

# Resolve fnm node if available so the script works under launchd's bare PATH.
if [ -d "$HOME/.local/share/fnm" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd)" || true
fi

LOG_DIR="${HOME}/.local/state/minsky"
mkdir -p "$LOG_DIR"
LOG_FILE="${MINSKY_WEEKLY_COMPETITIVE_LOG:-$LOG_DIR/competitive.log}"

ts="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$ts cycle start (MINSKY_HOME=$MINSKY_HOME)" | tee -a "$LOG_FILE"

# `bin/minsky competitive` writes <host>/.minsky/competitive-scorecard.json
# and exits 0 on shape-met, 1 on shape-gap, 2 on read/write error.
"$MINSKY_HOME/bin/minsky" competitive --host "$MINSKY_HOME" 2>&1 | tee -a "$LOG_FILE"
exit_code="${PIPESTATUS[0]}"

echo "$ts cycle done exit=$exit_code" | tee -a "$LOG_FILE"
exit "$exit_code"
