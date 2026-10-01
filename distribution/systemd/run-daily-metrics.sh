#!/bin/bash
# <!-- scope: human-approved 2026-06-11 operator task "daily METRICS.md regen lands on main" — daily runner that collects + renders docs/METRICS.md and opens the regen PR; shared by the launchd plist + systemd .service unit. -->
# <!-- pattern: not-applicable — thin process-launcher runner the supervisor exec's, mirroring run-weekly-competitive.sh; the periodic-task supervisor pattern (Borg/Bashir/Burns/Hightower 2017) is declared at vision.md § "Pattern conformance index" for the supervisor unit-files. -->
#
# Pattern: Periodic-task pattern (Borg/Bashir/Burns/Hightower _Designing
# Distributed Systems_ 2017 — periodic-scheduling primitive). The
# supervisor (launchd/systemd) fires this script on the daily cadence;
# the script does ONE pass of work and exits.
#
# Bash runner for `minsky-daily-metrics.service` (systemd) and the
# `com.minsky.daily-metrics` launchd LaunchAgent (macOS).
#
# What this does
# --------------
# Runs `scripts/daily-metrics-regen.mjs`, which:
#   1. exits 0 silently when main's docs/METRICS.md already references
#      today's snapshot, when the dated regen branch already exists on
#      origin, or when the fresh render is byte-identical to main's copy;
#   2. otherwise runs the canonical collect-metrics → metrics-render
#      pipeline against a tempfile, builds a plumbing commit on top of
#      origin/main containing ONLY docs/METRICS.md, pushes
#      `chore/metrics-daily-regen-<date>`, and opens the PR via `gh`.
#
# Why this exists
# ---------------
# The `cross-repo-pr-rate` row in docs/METRICS.md carries a 1-day
# freshness budget and `check-metric-freshness` is a whole-tree gate on
# every PR. Nothing scheduled a regen that LANDS ON MAIN, so main went
# red every midnight UTC (2026-06-11T00:00Z, hand-unwedged by PR #1208).
# This runner + the daily timer close that gap. Pre-registration:
# experiments/daily-metrics-regen-lands-on-main.yaml.
#
# Why the opt-out is env-only
# ----------------------------
# Rule #16 (default by default): the supervisor target wires this on by
# default. Escape hatch: `MINSKY_DAILY_METRICS=off` in the operator's
# shell. Same shape as the weekly-competitive opt-out.
#
# Anchor: Beyer et al., _Site Reliability Engineering_, 2016, Ch. 7
#   (automate every step that can be automated); rule #16 (default by
#   default); rule #4 (everything measurable, everything visible).
#
# Failure modes (per rule #7)
# ---------------------------
# | failure mode                              | trigger / fault axis  | expected behavior                              | chaos test                                                                       |
# |-------------------------------------------|-----------------------|------------------------------------------------|----------------------------------------------------------------------------------|
# | regen script exits non-zero               | gate-red / dirty tree | loud-crash; supervisor logs exit ≠0            | dirty docs/METRICS.md; run script — verify exit 3 + log entry                    |
# | rendered doc fails check-metric-freshness | render-regression     | abort BEFORE push/PR (exit 1)                  | render a stale fixture; run regen — verify no branch pushed                      |
# | MINSKY_DAILY_METRICS=off                  | operator-escape-hatch | graceful-degrade: script exits 0 with log      | `MINSKY_DAILY_METRICS=off ./run-daily-metrics.sh` — verify exit 0 + log entry    |
# | node / gh binary missing                  | dependency-fault      | loud-crash with PATH error                     | `PATH=/usr/bin ./run-daily-metrics.sh` — verify non-zero exit + log entry        |

set -euo pipefail

# Resolve MINSKY_HOME: launchd/systemd inject it; manual invocation defaults to cwd.
MINSKY_HOME="${MINSKY_HOME:-$(pwd)}"
cd "$MINSKY_HOME"

# rule #16 opt-out: any value other than "off" / "false" / "0" leaves the daily regen ON.
daily_flag="${MINSKY_DAILY_METRICS:-on}"
case "$daily_flag" in
  off | false | 0 | "")
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] daily-metrics disabled via MINSKY_DAILY_METRICS=$daily_flag"
    exit 0
    ;;
esac

# launchd-safe binary resolution (node + gh) — single source of truth.
. "${MINSKY_HOME}/distribution/systemd/lib-launchd-path.sh"

LOG_DIR="${HOME}/.local/state/minsky"
mkdir -p "$LOG_DIR"
LOG_FILE="${MINSKY_DAILY_METRICS_LOG:-$LOG_DIR/daily-metrics.log}"

ts="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$ts cycle start (MINSKY_HOME=$MINSKY_HOME)" | tee -a "$LOG_FILE"

node "$MINSKY_HOME/scripts/daily-metrics-regen.mjs" 2>&1 | tee -a "$LOG_FILE"
exit_code="${PIPESTATUS[0]}"

echo "$ts cycle done exit=$exit_code" | tee -a "$LOG_FILE"
exit "$exit_code"
