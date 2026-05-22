#!/bin/bash
# <!-- scope: human-approved 2026-05-22 M1.10 self-refresh — weekly runner that scores the corpus freshness, auto-files refresh tasks for very-stale entries, and (optionally) commits the TASKS.md edit so the tick-loop picks it up via /next-task. -->
# <!-- pattern: not-applicable — thin process-launcher runner; the periodic-task supervisor pattern (Borg/Bashir/Burns/Hightower 2017) is declared at vision.md § "Pattern conformance index" row 95 for the corpus self-refresh substrate. -->
#
# Pattern: Periodic-task pattern (Borg/Bashir/Burns/Hightower _Designing
# Distributed Systems_ 2017). The supervisor (launchd/systemd) fires
# this script weekly; the script does ONE pass of work and exits.
#
# Bash runner for minsky-corpus-refresh-check.service (systemd) and
# com.minsky.corpus-refresh-check launchd LaunchAgent (macOS).
#
# What this does
# --------------
# 1. Runs `node scripts/check-corpus-freshness.mjs` — exits 0 if the
#    corpus is fresh, 1 if any entry is "very-stale" (>180 days).
# 2. On exit 1, runs `node scripts/auto-file-corpus-refresh-tasks.mjs`
#    which appends `corpus-refresh-<id>` task blocks to TASKS.md for
#    every very-stale id that doesn't already have one (idempotent).
# 3. If TASKS.md changed AND `MINSKY_CORPUS_REFRESH_AUTOCOMMIT=on` is
#    set, commits the edit with a fixed message so the tick-loop's
#    next iteration picks the new tasks. Otherwise leaves the edit
#    uncommitted for the operator to review.
#
# Why this exists
# ---------------
# Operator directive 2026-05-22: "add a mechanism so that minsky keeps
# competitors list updated and competitors there too". Without this
# runner, the freshness check is a tool the operator must remember to
# invoke; with it, the same launchd cadence that refreshes the
# scoreboard also refreshes the source data. Closes the corpus-
# staleness feedback loop end-to-end.
#
# Opt-out (rule #16): MINSKY_CORPUS_REFRESH_CHECK=off in the operator's
# shell or in ~/.minsky/config.json. Auto-commit is OFF by default;
# set MINSKY_CORPUS_REFRESH_AUTOCOMMIT=on to enable.

set -euo pipefail

MINSKY_HOME="${MINSKY_HOME:-$(pwd)}"
cd "$MINSKY_HOME"

flag="${MINSKY_CORPUS_REFRESH_CHECK:-on}"
case "$flag" in
  off | false | 0 | "")
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] corpus-refresh-check disabled via MINSKY_CORPUS_REFRESH_CHECK=$flag"
    exit 0
    ;;
esac

# Resolve fnm node if available so the script works under launchd's bare PATH.
if [ -d "$HOME/.local/share/fnm" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd)" || true
fi

LOG_DIR="${HOME}/.local/state/minsky"
mkdir -p "$LOG_DIR"
LOG_FILE="${MINSKY_CORPUS_REFRESH_LOG:-$LOG_DIR/corpus-refresh.log}"

ts="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$ts cycle start (MINSKY_HOME=$MINSKY_HOME)" | tee -a "$LOG_FILE"

# Step 1 — freshness check (exit 0 = fresh, 1 = very-stale present).
set +e
node "$MINSKY_HOME/scripts/check-corpus-freshness.mjs" 2>&1 | tee -a "$LOG_FILE"
freshness_exit="${PIPESTATUS[0]}"
set -e

if [ "$freshness_exit" = "0" ]; then
  echo "$ts corpus is fresh — no auto-file pass needed" | tee -a "$LOG_FILE"
  exit 0
fi

if [ "$freshness_exit" != "1" ]; then
  echo "$ts freshness check exited $freshness_exit (read error?) — aborting cycle" | tee -a "$LOG_FILE"
  exit "$freshness_exit"
fi

# Step 2 — auto-file refresh tasks (idempotent).
set +e
node "$MINSKY_HOME/scripts/auto-file-corpus-refresh-tasks.mjs" 2>&1 | tee -a "$LOG_FILE"
autofile_exit="${PIPESTATUS[0]}"
set -e

if [ "$autofile_exit" != "0" ]; then
  echo "$ts auto-file exited $autofile_exit (parse error?)" | tee -a "$LOG_FILE"
  exit "$autofile_exit"
fi

# Step 3 — optional auto-commit. Default OFF — the operator opts in.
autocommit="${MINSKY_CORPUS_REFRESH_AUTOCOMMIT:-off}"
case "$autocommit" in
  on | true | 1)
    if git -C "$MINSKY_HOME" diff --quiet TASKS.md; then
      echo "$ts no TASKS.md edits to commit" | tee -a "$LOG_FILE"
    else
      git -C "$MINSKY_HOME" add TASKS.md
      git -C "$MINSKY_HOME" commit -m "chore(corpus-refresh): auto-file refresh tasks for very-stale readings

Filed by scripts/auto-file-corpus-refresh-tasks.mjs from the
weekly com.minsky.corpus-refresh-check.plist cycle. Each block
points the tick-loop at /competitor-research <url> to refresh the
underlying reading. See vision.md row 95 for the substrate."
      echo "$ts auto-committed TASKS.md edits" | tee -a "$LOG_FILE"
    fi
    ;;
  *)
    if ! git -C "$MINSKY_HOME" diff --quiet TASKS.md; then
      echo "$ts TASKS.md has uncommitted refresh-task edits; set MINSKY_CORPUS_REFRESH_AUTOCOMMIT=on to auto-commit" | tee -a "$LOG_FILE"
    fi
    ;;
esac

echo "$ts cycle done" | tee -a "$LOG_FILE"
exit 0
