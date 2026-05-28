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

# Default to the repo root when not bootstrapped by setup.sh's envsubst.
MINSKY_HOME="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export MINSKY_HOME

# launchd / systemd-user run with a minimal PATH (often just /usr/bin:/bin)
# that doesn't include operator-installed node managers (fnm, nvm, asdf,
# Homebrew). Prepend the common node-installation locations so `exec node`
# below finds the binary. The first match wins; if `node` is already on
# PATH (e.g., the operator pre-set PATH in the unit file), the original
# PATH stays first and this is a no-op for resolution.
#
# Search strategy: glob fnm + nvm + asdf install dirs (operator-local), plus
# Homebrew (system-installed), plus /usr/local/bin (manual installs). We
# pick the highest-numbered version dir per manager to avoid pinning to a
# stale version. ${HOME} is always set under launchd / systemd-user.
node_path_extras=""
for fnm_dir in "${HOME}"/.local/share/fnm/node-versions/*/installation/bin; do
  [ -x "${fnm_dir}/node" ] && node_path_extras="${fnm_dir}:${node_path_extras}"
done
for nvm_dir in "${HOME}"/.nvm/versions/node/*/bin; do
  [ -x "${nvm_dir}/node" ] && node_path_extras="${nvm_dir}:${node_path_extras}"
done
for asdf_dir in "${HOME}"/.asdf/installs/nodejs/*/bin; do
  [ -x "${asdf_dir}/node" ] && node_path_extras="${asdf_dir}:${node_path_extras}"
done
for brew_prefix in /opt/homebrew/bin /usr/local/bin; do
  [ -x "${brew_prefix}/node" ] && node_path_extras="${brew_prefix}:${node_path_extras}"
done
PATH="${node_path_extras}${PATH:-/usr/bin:/bin}"

# Same problem as `node`, separate axis: the supervisor spawns `claude
# --print` (the headless Claude Code CLI) per iteration. The Claude
# Code installer's default location is `~/.local/bin/claude` (also
# `~/.npm-global/bin/claude` for npm-global installs and
# `/opt/homebrew/bin/claude` / `/usr/local/bin/claude` for Homebrew).
# A spawn against a missing `claude` is `ENOENT`, which the daemon
# surfaces as an unhandled exception → process exit → launchd respawn
# loop at `ThrottleInterval` cadence (5s). Surfaced live 2026-05-04
# during the post-#158 dogfood restart.
for claude_dir in "${HOME}"/.local/bin "${HOME}"/.npm-global/bin /opt/homebrew/bin /usr/local/bin; do
  [ -x "${claude_dir}/claude" ] && PATH="${claude_dir}:${PATH}" && break
done
# Same pattern for `gh` (GitHub CLI) — used by the file-collision check and
# auto-merge sweep. Homebrew is the canonical install path on macOS.
for gh_dir in /opt/homebrew/bin /usr/local/bin "${HOME}"/.local/bin; do
  [ -x "${gh_dir}/gh" ] && PATH="${gh_dir}:${PATH}" && break
done
# Same pattern for `opencode` — the local-LLM spawn target used when the
# daemon falls back to Ollama/local models. Default install is
# ~/.opencode/bin/opencode (the opencode CLI installer's standard location).
# Surfaced via ENOENT in the daemon error log when launchd PATH lacks it.
for opencode_dir in "${HOME}"/.opencode/bin "${HOME}"/.local/bin "${HOME}"/.npm-global/bin /opt/homebrew/bin /usr/local/bin; do
  [ -x "${opencode_dir}/opencode" ] && PATH="${opencode_dir}:${PATH}" && break
done
export PATH

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
exec bash "${MINSKY_HOME}/bin/minsky-run.sh" --host "${MINSKY_HOME}" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} "$@"
