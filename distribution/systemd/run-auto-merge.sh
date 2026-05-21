#!/bin/bash
# <!-- pattern: Periodic-task pattern (Borg/Bashir/Burns/Hightower _Designing Distributed Systems_ 2017, ch. on "Distributed System Patterns" — periodic-scheduling primitive). The supervisor is the kernel (launchd/systemd) firing this script on a fixed cadence; the script itself does ONE pass of work and exits. -->
#
# Bash runner for `minsky-auto-merge.service` (systemd) and the
# `com.minsky.auto-merge` launchd LaunchAgent (macOS).
#
# What this fixes
# ---------------
# Operator directive 2026-05-20: "Minsky should have a completely working
# 'merge with force admin without reviews if everything else passes'. Set
# it up to default false, but true for minsky itself."
#
# Root cause of the 49-PR backlog: the daemon opens PRs via inner agents
# but the iteration ends there. PRs sit in `mergeStateStatus=BLOCKED`
# (required `ci` check expected but GHA disabled), so they never reach
# `CLEAN` and never auto-merge through GitHub-native means. The
# `local-gate-merge.mjs` script already does the right thing (rebases
# onto current main in scratch, runs `pre-pr-lint --stage=full`,
# admin-squash-merges if green) — it's just never invoked automatically.
#
# This runner closes that loop. Every 5 min, the supervisor wakes this
# script. It runs `local-gate-merge.mjs --no-review --limit=10`, which
# picks up to 10 of the daemon's open MERGEABLE PRs and gates each one.
# Greens land in main; reds stay open with their gate verdict in the
# ledger at `.minsky/local-gate-merge.jsonl`.
#
# Why periodic-not-continuous
# ---------------------------
# The gate is bursty: each PR costs ~5 min of cold-vet (scratch clone +
# pnpm install + full lint stack). A continuous loop would spend most of
# its time idle (no new PRs in the typical iteration window) while still
# holding a process slot the operator can't ignore in `top`. A
# 5-min periodic cycle is cheap when there's nothing to merge (script
# exits in <1s) and naturally rate-limits when there are many PRs (only
# 10 per pass, more next cycle). The cadence is `StartInterval=300`
# in `com.minsky.auto-merge.plist` and `OnUnitActiveSec=5min` in
# `minsky-auto-merge.timer`. Source: rule #15 (operator machine-
# utilisation budget) — bursty work scheduled outside the steady-state
# budget is the right shape.
#
# Why the opt-out is env-only, not a launchd flag
# ------------------------------------------------
# Rule #16 (default by default): the supervisor target wires the
# auto-merge unit on by default. The escape hatch is `MINSKY_AUTO_MERGE=off`
# in the operator's shell or in `~/.minsky/config.json` (for power users
# who want to opt out on a specific machine without removing the plist).
# Same shape as the existing `MINSKY_*` opt-OUT discipline.
#
# Anchor: Beyer SRE 2016 ch. on toil-reduction (automate every step that
#   can be automated; humans are for novel work); rule #16 (default by
#   default — never hide a useful behaviour behind an opt-in flag);
#   rule #6 (stay alive — the auto-merge loop is THE substrate that
#   keeps the daemon-opened PR pipeline drained, which is what makes the
#   daemon's "ship features autonomously" claim actually mean what it
#   says — without auto-merge, PRs pile up monotonically and stability
#   degrades from "ships PRs" to "opens PRs that sit forever").
#
# Failure modes (per rule #7)
# ---------------------------
# | failure mode                       | trigger / fault axis    | expected behavior                    | chaos test                                                                                          |
# |------------------------------------|-------------------------|--------------------------------------|-----------------------------------------------------------------------------------------------------|
# | local-gate-merge script crashes    | dependency-fault        | loud-crash; supervisor logs exit ≠0  | `MINSKY_HOME=/nonexistent ./run-auto-merge.sh` — verify non-zero exit + log entry                  |
# | local-gate-merge hangs on one PR   | dependency-flake        | the script's per-PR `VET_TIMEOUT_MS` kills the vet; iteration continues | `./run-auto-merge.sh` while a PR's vitest hangs — verify ledger marks it `vet-timeout` |
# | MINSKY_AUTO_MERGE=off              | operator-escape-hatch   | graceful-degrade: script exits 0 with "auto-merge disabled" log | `MINSKY_AUTO_MERGE=off ./run-auto-merge.sh` — verify exit 0 + log entry                              |
# | network down (gh pr list fails)    | network-partition       | local-gate-merge logs error; script exits non-zero; next cycle retries  | block github.com via `pfctl`; `./run-auto-merge.sh` — verify retry-friendly exit                    |
# | node binary missing                | dependency-fault        | loud-crash with PATH error           | `PATH=/usr/bin ./run-auto-merge.sh` — verify exit 127 + log entry                                   |

set -euo pipefail

# Resolve MINSKY_HOME: launchd/systemd inject it; manual invocation defaults to the cwd.
MINSKY_HOME="${MINSKY_HOME:-$(pwd)}"
cd "$MINSKY_HOME"

# rule #16 opt-out: any value other than "off" / "false" / "0" leaves auto-merge ON.
# Default ON for the dogfood case (this is the minsky repo's own auto-merge).
auto_merge_flag="${MINSKY_AUTO_MERGE:-on}"
case "$auto_merge_flag" in
  off|false|0|"")
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] auto-merge disabled via MINSKY_AUTO_MERGE=$auto_merge_flag"
    exit 0
    ;;
esac

# Resolve fnm node if available so the script works under launchd's bare PATH.
if [ -d "$HOME/.local/share/fnm" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd)" || true
fi

LOG_FILE="${MINSKY_AUTO_MERGE_LOG:-$HOME/.minsky/auto-merge.log}"
mkdir -p "$(dirname "$LOG_FILE")"

ts="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$ts cycle start (MINSKY_HOME=$MINSKY_HOME)" | tee -a "$LOG_FILE"

# `--no-review` skips the Claude Opus brain layer (operator directive
# 2026-05-20: "without reviews if everything else passes" — the
# deterministic gate IS sufficient for the dogfood case). `--limit=10`
# caps per-cycle work so a single backlog spike doesn't lock up the host.
node "$MINSKY_HOME/scripts/local-gate-merge.mjs" --no-review --limit=10 2>&1 | tee -a "$LOG_FILE"
exit_code="${PIPESTATUS[0]}"

echo "$ts cycle done exit=$exit_code" | tee -a "$LOG_FILE"
exit "$exit_code"
