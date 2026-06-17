#!/bin/bash
# Bash bootstrap for `minsky-tick-loop.service` (systemd) and the
# `com.minsky.tick-loop` launchd LaunchAgent on macOS.
#
# Sub-task 3/3 of `tick-loop-daemon-real-spawn` (`tick-loop-daemon-real-spawn-flip`):
# the production default is now `ProcessSpawnStrategy` — a real
# `claude --resume` subprocess per iteration. The `--dry-run` argv flag has
# been retired; dry-run is opt-in via the `MINSKY_TICK_DRY_RUN=1` env var
# (set in the supervisor unit file's `Environment=` line during the safe
# rollout window; an operator drops that line to flip to real spawn).
#
# Pattern: thin runner / process-launcher script — the I/O boundary that
# binds the supervisor to the pure `runDaemon` constructor in
# `novel/tick-loop/dist/daemon.js`. Anchors: Martin, *Clean Architecture*,
# 2017 (I/O at the edge); rule #2 (every dep behind interface — the
# `SpawnStrategy` is the seam, the bootstrap doesn't reach vendor SDKs);
# Beck 1999 (CI as the constraint enforcer); Beyer SRE 2016 Ch. 17
# (operator escape hatch — `MINSKY_TICK_DRY_RUN=1` is the env-var lever).
#
# Environment (control surface):
#   MINSKY_HOME                       (required by systemd unit; defaults
#                                     to the repo checkout in launchd)
#   MINSKY_TICK_DRY_RUN=1|true        (optional) flip from real spawn to
#                                     synthetic `DryRunSpawnStrategy`. Unset =
#                                     full real spawn (production default).
#   MINSKY_TICK_INTERVAL_MS           (optional, default 300000 / 5 min)
#   MINSKY_TICK_MAX_ITERATIONS        (optional, default unbounded)
#   MINSKY_LOCAL_WATCHDOG_MS          (optional, default 1800000 / 30 min)
#                                     Per-iteration timeout for local-model
#                                     (aider/opencode) invocations. Claude
#                                     keeps the MINSKY_CLAUDE_PRINT_TIMEOUT_MS
#                                     default (900 s). Set
#                                     MINSKY_CLAUDE_PRINT_TIMEOUT_MS to
#                                     override both providers uniformly.
#
# Args (forwarded to the CLI):
#   --max-iterations=N                cap iteration count
#   --tick-interval-ms=MS             override the 5-min cadence
#   --tasks-md=PATH / --paused-sentinel=PATH (overrides defaults)
#
# Run as:
#   bash distribution/systemd/run-tick-loop.sh --max-iterations=4
#   MINSKY_TICK_DRY_RUN=1 bash distribution/systemd/run-tick-loop.sh ...
#
# `exec node` so the supervisor (systemd-user / launchd) sees the node
# PID directly and a SIGTERM reaches it without a shell-wrapper detour.

set -euo pipefail

# launchd inherits BASH_ENV from the GUI session; tick-loop's sandbox profile
# denies ~/.config/dotfiles — unset before any bash child (with-endpoint-path parity).
unset BASH_ENV ENV

# Default to the repo root when not bootstrapped by setup.sh's envsubst.
MINSKY_HOME="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export MINSKY_HOME

# launchd / systemd-user run with a minimal PATH (often just /usr/bin:/bin).
# Source the shared helper (rule #1 — compose, don't duplicate) so node,
# claude, gh, opencode, uv python, and dotfiles/{jq,python3} shims all
# resolve before /usr/bin/{jq,python3} (CyberArk EPM / tool-shim-public).
_tick_loop_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-launchd-path.sh
. "${_tick_loop_dir}/lib-launchd-path.sh"
unset _tick_loop_dir

# IRON gate (2026-06-17): exit 0 when prerequisites are missing so launchd's
# KeepAlive: SuccessfulExit=false does NOT respawn every ThrottleInterval and
# hammer /usr/bin/{jq,python3} (CyberArk EPM popups). Non-zero exit = respawn.
_endpoint_ready="${HOME}/.local/state/dotfiles/endpoint-ready"
_tick_enabled_sentinel="${MINSKY_HOME}/.minsky/tick-loop-enabled"
if [[ ! -f "${_endpoint_ready}" ]]; then
  printf 'tick-loop: dormant — endpoint-ready sentinel missing (%s); exit 0 (no respawn)\n' "${_endpoint_ready}" >&2
  exit 0
fi
if [[ "${MINSKY_TICK_LOOP_ENABLED:-0}" != "1" && ! -f "${_tick_enabled_sentinel}" ]]; then
  printf 'tick-loop: dormant — not enabled (run: minsky enable-tick-loop); exit 0\n' >&2
  exit 0
fi
if [[ -z "${MINSKY_JQ:-}" ]]; then
  printf 'tick-loop: dormant — no EPM-safe jq (MINSKY_JQ unset); exit 0\n' >&2
  exit 0
fi
unset _endpoint_ready _tick_enabled_sentinel

# Optional env-var → CLI arg mapping. The CLI itself accepts the same
# flags directly, so explicit args (passed by the operator) override.
#
# Phase-11b step 5 (2026-05-25): the exec target flipped from
# `node novel/tick-loop/bin/tick-loop.mjs` to
# `bash ${MINSKY_HOME}/bin/minsky-run.sh --host ${MINSKY_HOME}`.
# `MINSKY_TICK_INTERVAL_MS` maps to bash's `--tick-interval-ms` (the
# bash skeleton's per-batch sleep, restored 2026-05-28 via the
# `bash-skeleton-tick-interval-ms-flag` task).
# `MINSKY_TICK_MAX_ITERATIONS` maps directly to bash's
# `--max-iterations`. `MINSKY_TICK_DRY_RUN=1` maps to `--dry-run`.
EXTRA_ARGS=()
if [[ -n "${MINSKY_TICK_INTERVAL_MS:-}" ]]; then
  EXTRA_ARGS+=("--tick-interval-ms" "${MINSKY_TICK_INTERVAL_MS}")
fi
if [[ -n "${MINSKY_TICK_MAX_ITERATIONS:-}" ]]; then
  EXTRA_ARGS+=("--max-iterations" "${MINSKY_TICK_MAX_ITERATIONS}")
fi
if [[ "${MINSKY_TICK_DRY_RUN:-}" == "1" || "${MINSKY_TICK_DRY_RUN:-}" == "true" ]]; then
  EXTRA_ARGS+=("--dry-run")
fi

# `MINSKY_TICK_DRY_RUN` (read by the CLI directly) is the env-var control
# surface for dry-run; unset = real spawn (production default).
#
# Self-diagnose probe (advisory). Runs `scripts/self-diagnose.mjs` once
# at supervisor start — invariant violations write a P0 task block to
# stdout (and to TASKS.md when --write-tasks-md is passed; v0 leaves the
# write opt-in pending the operator/automation review of false-positive
# rate). Non-zero exit code is logged but does not block startup —
# rule #7 graceful-degrade. Wallclock + finding count get echoed so the
# supervisor log surfaces "self-diagnose ran, N findings" on every boot.
#
# Skipped under MINSKY_TICK_DRY_RUN=1 because dry-run smoke tests don't
# stand up the full token-monitor data path; the probe would
# false-positive against an empty fixture and obscure real findings.
if [[ "${MINSKY_TICK_DRY_RUN:-}" != "1" && "${MINSKY_TICK_DRY_RUN:-}" != "true" ]]; then
  diagnose_start=$(date -u +%FT%TZ)
  # `--human` format (operator directive 2026-05-26): one block per
  # finding with an explicit `[🤖 minsky-will-fix]` / `[🤖→👤 minsky-tries
  # -then-operator]` / `[👤 needs-operator]` actor label so the operator
  # reading the boot log can tell at a glance which findings are their
  # action items versus which the daemon will handle on its own.
  # Previous shape was `--json` — readable to scrapers but the operator
  # had to mentally parse a multi-line JSON dump to find their action
  # items. The `--json` mode is still available for scrapers; nothing
  # consumes it in this script.
  printf 'self-diagnose: ran at %s\n' "${diagnose_start}"
  node "${MINSKY_HOME}/scripts/self-diagnose.mjs" --human 2>&1 || true

  # Autonomic-fix passes (operator directive 2026-05-26: "In minsky I
  # don't want to run anything, it should resolve things automatically
  # as rational"). For every `[👤 needs-operator]` finding that has a
  # safe + bounded + idempotent fix, run the fix instead of asking.
  #
  # Both are gated by env vars in case the operator wants to disable
  # (rule #2 escape hatch). Default ON per rule #16 (Default by default)
  # — the autonomic action is the right default for a self-supervised
  # dogfood loop.
  #
  # Errors are advisory: a failed auto-fix leaves the finding on the
  # log; the supervisor's next cycle retries. Never blocks startup.
  printf 'autonomic-fix: pass 1 — close orphan PRs (MINSKY_AUTO_CLOSE_ORPHAN_PRS=%s)\n' "${MINSKY_AUTO_CLOSE_ORPHAN_PRS:-on}"
  node "${MINSKY_HOME}/scripts/auto-close-orphan-prs.mjs" 2>&1 || true
  printf 'autonomic-fix: pass 2 — rebase dirty PRs (MINSKY_AUTO_REBASE_DIRTY_PRS=%s)\n' "${MINSKY_AUTO_REBASE_DIRTY_PRS:-on}"
  node "${MINSKY_HOME}/scripts/auto-rebase-dirty-prs.mjs" 2>&1 || true

  # Daily metrics render (advisory, once-per-UTC-date). Without this the
  # daemon never re-renders `docs/METRICS.md` — the TS daily-fire was
  # deleted in phase-11b and the live bash daemon only runs self-diagnose
  # / orphan-PR / rebase / auto-merge maintenance. `docs/METRICS.md` then
  # goes dark: `_Updated:` stamps drift past their `_Budget:` windows and
  # `scripts/check-metric-freshness.mjs` starts reporting stale sections —
  # the canonical monitoring-data-going-dark silent failure (Beyer et al.,
  # SRE 2016, Ch. 6). The daemon's existing commit path carries the bump.
  #
  # Idempotent: gated on the absence of a per-UTC-date sentinel under
  # `${MINSKY_HOME}/.minsky/metric-render-sentinels/<date>` so it fires at
  # MOST once per day. Re-running the maintenance block the same day is a
  # no-op (the sentinel already exists). The sentinel dir lives under the
  # gitignored `.minsky/` tree, so it never pollutes the working tree the
  # auto-commit path scans.
  #
  # Errors are advisory (rule #7 graceful-degrade): a failed render (dirty
  # tree, dist not built, sentinel-write race with a parallel agent) leaves
  # the prior `docs/METRICS.md` in place and the next day's maintenance
  # block retries — never blocks startup. The sentinel is written ONLY on a
  # successful render so a failed render retries the same day.
  #
  # Opt-out: MINSKY_DAILY_METRICS_RENDER=off disables the fire entirely
  # (rule #2 escape hatch). Default ON per rule #16 (Default by default) —
  # a self-supervised dogfood loop that lets its own observability surface
  # go stale is a constitutional violation of rule #4 (everything visible).
  if [[ "${MINSKY_DAILY_METRICS_RENDER:-on}" != "off" ]]; then
    metric_render_date="$(date -u +%F)"
    metric_render_sentinel_dir="${MINSKY_HOME}/.minsky/metric-render-sentinels"
    metric_render_sentinel="${metric_render_sentinel_dir}/${metric_render_date}"
    if [[ -f "${metric_render_sentinel}" ]]; then
      printf 'metrics-render: already rendered for %s (sentinel present); skipping\n' "${metric_render_date}"
    else
      printf 'metrics-render: rendering docs/METRICS.md for %s (MINSKY_DAILY_METRICS_RENDER=%s)\n' "${metric_render_date}" "${MINSKY_DAILY_METRICS_RENDER:-on}"
      if bash "${MINSKY_HOME}/bin/minsky" metrics render 2>&1; then
        mkdir -p "${metric_render_sentinel_dir}" 2>/dev/null || true
        printf '%s\n' "$(date -u +%FT%TZ)" > "${metric_render_sentinel}" 2>/dev/null || true
      else
        printf 'metrics-render: render exited non-zero (advisory; will retry %s on next cycle)\n' "${metric_render_date}"
      fi
    fi
  fi
fi

# Auto-merge sweep (advisory). Runs `scripts/auto-merge-clean-prs.mjs`
# when `MINSKY_AUTO_MERGE=1` — drains every CLEAN PR via `gh pr merge
# --squash --delete-branch`. Off by default so the operator opts in
# explicitly (rule #2 escape hatch); a label `minsky-no-merge` on a PR
# overrides the sweep for that single PR. Skipped under dry-run for the
# same reason self-diagnose is — dry-run is a hermetic smoke that
# shouldn't reach out to GitHub.
#
# Failure of `gh pr merge` (auth / network / GH-state-changed-mid-sweep)
# is logged but does not block startup — rule #7 graceful-degrade.
if [[ "${MINSKY_AUTO_MERGE:-}" == "1" || "${MINSKY_AUTO_MERGE:-}" == "true" ]] && [[ "${MINSKY_TICK_DRY_RUN:-}" != "1" && "${MINSKY_TICK_DRY_RUN:-}" != "true" ]]; then
  printf 'auto-merge: starting sweep (MINSKY_AUTO_MERGE=on)\n'
  node "${MINSKY_HOME}/scripts/auto-merge-clean-prs.mjs" || printf 'auto-merge: sweep exited non-zero (advisory; continuing)\n'
fi

# Bash quirk: under `set -u`, `"${EXTRA_ARGS[@]}"` triggers an unbound-
# variable error when EXTRA_ARGS is empty (no env-var mappings hit
# above). The `+"${EXTRA_ARGS[@]}"` parameter-substitution form expands
# to nothing when the array is unset/empty and to the array contents
# otherwise — portable across bash 3 (macOS default) and bash 5 (Linux).
#
# Phase-11b step 5 (2026-05-25): exec target flipped from
# `node novel/tick-loop/bin/tick-loop.mjs` (the TS daemon's main entry,
# being deleted in step 8) to `bash bin/minsky-run.sh` (the canonical
# bash skeleton; see vision.md § 16). The `--host ${MINSKY_HOME}`
# arg pins the bash walker to the Minsky-on-itself host — the same
# single-host scope the TS daemon implicitly had. launchd's
# `KeepAlive=true` respawns the bash skeleton after each iteration
# batch exits (typical tick: process N hosts → exit → ThrottleInterval
# 5s → respawn). The TS daemon's in-process 5-min sleep is gone; if
# cadence proves too aggressive, file
# `bash-skeleton-tick-interval-ms-flag` (P3).
# `--loop` (added 2026-05-28 in the supervisor-stays-alive refinement)
# wraps walk_hosts in while-true so the bash never exits on its own.
# Without it (and without the prior PR #983's MAX_ITERATIONS=0 wrapping),
# walk_hosts returns 0 after iterations-per-host × #hosts iterations,
# bash exits 0, and launchd's `KeepAlive: SuccessfulExit=false` (OTP
# transient restart) refuses to respawn — supervisor dies for good.
# Observed 2026-05-28: tick-loop stayed dead for 10+ minutes after 3
# successful iterations. See bin/minsky-run.sh § "Iteration loop" for
# the rule #6 (stay alive) anchor. Ad-hoc CLI invocations / tests don't
# pass --loop and keep the one-walk-and-exit historical behavior.
exec bash "${MINSKY_HOME}/bin/minsky-run.sh" --loop --host "${MINSKY_HOME}" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} "$@"
