#!/usr/bin/env bash
# <!-- scope: human-approved closing task `path-a-phase-9-delete-budget-guard`. Shell replacement for the deleted `novel/budget-guard/` TypeScript watchdog. -->
#
# bin/check-budget.sh — token-budget watchdog (Phase 9 Path A replacement)
#
# Reads a token snapshot from stdin (JSON with `used`, `limit`,
# `weekly_consumed_fraction`) or from `~/.minsky/token-monitor.json`,
# applies the same thresholds the TypeScript `@minsky/budget-guard`
# package used (DEFAULT_THRESHOLDS: degradeAt=0.7, circuitBreakAt=0.85,
# weeklyWarnAt=0.2), and prints + exits with one of:
#
#   NORMAL                  exit 0  — under 70% of window
#   THROTTLE                exit 0  — 70%–85% of window (graceful-degrade)
#   PAUSE                   exit 1  — ≥85% of window (circuit-break-and-notify)
#   WEEKLY_WARN             exit 0  — under 20% remaining in weekly cap
#
# The 4-state output matches the original `BudgetAction` union from
# `novel/budget-guard/src/index.ts` (DEFAULT_THRESHOLDS deleted in this
# same PR — the constants below are the durable source of truth).
#
# Usage:
#   bin/check-budget.sh                   # reads ~/.minsky/token-monitor.json
#   bin/check-budget.sh --help            # prints this header
#   bin/check-budget.sh --thresholds      # prints the 3 threshold values
#   bin/check-budget.sh < snapshot.json   # reads stdin
#
# Anchor: Beyer et al. 2016, *Site Reliability Engineering* Ch. 3
# (error budgets). Thresholds match the user-story 004 prose.

set -euo pipefail

DEGRADE_AT="${MINSKY_BUDGET_DEGRADE_AT:-0.7}"
CIRCUIT_BREAK_AT="${MINSKY_BUDGET_CIRCUIT_BREAK_AT:-0.85}"
WEEKLY_WARN_AT="${MINSKY_BUDGET_WEEKLY_WARN_AT:-0.2}"

print_help() {
  sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
}

print_thresholds() {
  echo "degradeAt=${DEGRADE_AT}"
  echo "circuitBreakAt=${CIRCUIT_BREAK_AT}"
  echo "weeklyWarnAt=${WEEKLY_WARN_AT}"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_help
  exit 0
fi

if [[ "${1:-}" == "--thresholds" ]]; then
  print_thresholds
  exit 0
fi

# Source the snapshot JSON: stdin if piped, otherwise the canonical file.
if [[ -t 0 ]]; then
  SNAPSHOT_FILE="${MINSKY_HOME:-${HOME}}/.minsky/token-monitor.json"
  if [[ ! -f "${SNAPSHOT_FILE}" ]]; then
    # No data → NORMAL (the daemon's cold-start path).
    echo "NORMAL"
    exit 0
  fi
  SNAPSHOT_JSON="$(cat "${SNAPSHOT_FILE}")"
else
  SNAPSHOT_JSON="$(cat)"
fi

# Parse the snapshot using node — pipe through a small inline script
# (avoids jq dependency; node is already required for the rest of
# the toolchain).
node --input-type=module -e "
  const snapshot = JSON.parse(process.argv[1]);
  const used = Number(snapshot.used ?? 0);
  const limit = Number(snapshot.limit ?? 1);
  const weeklyConsumed = Number(snapshot.weekly_consumed_fraction ?? 0);
  const degradeAt = Number('${DEGRADE_AT}');
  const circuitBreakAt = Number('${CIRCUIT_BREAK_AT}');
  const weeklyWarnAt = Number('${WEEKLY_WARN_AT}');
  if (limit <= 0) { console.log('NORMAL'); process.exit(0); }
  const consumed = used / limit;
  // Window-level checks take precedence (degradeAt/circuitBreakAt).
  if (consumed >= circuitBreakAt) {
    console.log('PAUSE');
    process.exit(1);
  }
  if (consumed >= degradeAt) {
    console.log('THROTTLE');
    process.exit(0);
  }
  // Weekly-level check: if remaining weekly fraction is below the
  // warn threshold (e.g. 20%), emit WEEKLY_WARN. We compute
  // remaining as (1 - weeklyConsumed); warn fires when remaining
  // <= weeklyWarnAt.
  const weeklyRemaining = 1 - weeklyConsumed;
  if (weeklyRemaining <= weeklyWarnAt && weeklyConsumed > 0) {
    console.log('WEEKLY_WARN');
    process.exit(0);
  }
  console.log('NORMAL');
" "${SNAPSHOT_JSON}"
