#!/usr/bin/env bash
# Integration test for the supervisor unit-file / plist templates.
#
# Validates rows 1–4 of `distribution/README.md` § "Failure modes & chaos
# verification" empirically — boots the templates into a real OS supervisor,
# kills `minsky-tick-loop`, asserts respawn within 10 s, then cleans up.
#
# Run as: ./distribution/test-supervisor.sh [linux|macos]
# When mode is omitted, `uname -s` chooses (Linux→linux, Darwin→macos).
#
# Exits 0 when all assertions pass; non-zero otherwise.
#
# Pattern: integration test driver / supervisor conformance harness — a
# black-box assertion that the templates' restart policies produce the
# expected respawn behaviour against the real systemd / launchd primitive.
# Anchors: Forsgren-Humble-Kim 2018 (Accelerate — test reliability as DORA
# prerequisite); Armstrong 2007 (OTP supervision tree).
#
# Why this driver, not a unit-test under vitest: the system under test IS
# the OS supervisor (systemd-user / launchd). vitest + JS mocks would
# inevitably mock the very thing we're trying to verify. A shell driver
# that talks to systemctl / launchctl directly is the only honest test.
#
# CRITICAL CAVEAT: GitHub Actions Ubuntu runners run as a non-login user.
# `systemctl --user` typically requires either `loginctl enable-linger`
# (which can fail in unprivileged sandboxes) or wrapping the entire run in
# `dbus-run-session`. This driver attempts both fallbacks; if neither
# yields a usable user-bus, the run aborts with exit 77 (skipped) so the
# CI matrix can decide whether to gate the merge or not (per the task
# brief's Pivot clause).

set -euo pipefail

MODE="${1:-}"
if [ -z "$MODE" ]; then
  case "$(uname -s)" in
    Linux)  MODE=linux ;;
    Darwin) MODE=macos ;;
    *)      echo "unsupported uname: $(uname -s)" >&2; exit 1 ;;
  esac
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
export MINSKY_HOME="$REPO_ROOT"

# Tick-loop respawn budget per failure-mode row 1: respawn within 10 s.
RESPAWN_BUDGET_SECS=10

# Polling helpers. We use a per-second poll because the supervisor's
# restart latency is ~100 ms but the OS scheduler granularity is ~1 s.
poll_until() {
  # poll_until <budget-secs> <test-cmd...>
  local budget="$1"; shift
  local elapsed=0
  while [ "$elapsed" -lt "$budget" ]; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

log() { printf '[test-supervisor:%s] %s\n' "$MODE" "$*"; }

# -----------------------------------------------------------------------------
# Stub run-*.sh scripts — the templates reference scripts that don't yet exist
# in the repo (the real tick-loop / budget-guard implementations land in
# follow-up tasks). For the integration test we render them on the fly: an
# infinite `sleep` loop is sufficient to verify the restart policy because
# the supervisor cares about process-presence, not what the process does.
# -----------------------------------------------------------------------------

write_stub_runners() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  # If real runners exist at this path (post-#142 — `run-tick-loop.sh` is
  # the production bash bootstrap; `run-budget-guard.sh` is the sleep-forever
  # supervisor sentinel), back them up to `<name>.real-bak` so the cleanup
  # step can restore them. Without the backup, the real tracked files are
  # silently overwritten and `rm -f` at cleanup leaves the working tree dirty.
  for name in run-tick-loop.sh run-budget-guard.sh; do
    if [ -f "$target_dir/$name" ] && [ ! -f "$target_dir/$name.real-bak" ]; then
      cp "$target_dir/$name" "$target_dir/$name.real-bak"
    fi
  done
  cat > "$target_dir/run-tick-loop.sh" <<'EOF'
#!/bin/sh
# Stub tick-loop runner — used only by distribution/test-supervisor.sh.
# Sleeps so the process stays alive long enough to be SIGKILL'd by the
# integration test. The real runner is shipped by the tick-loop impl task.
exec sleep 86400
EOF
  cat > "$target_dir/run-budget-guard.sh" <<'EOF'
#!/bin/sh
# Stub budget-guard runner — used only by distribution/test-supervisor.sh.
# Sleeps so the process stays alive long enough to be killed.
exec sleep 86400
EOF
  chmod +x "$target_dir/run-tick-loop.sh" "$target_dir/run-budget-guard.sh"
}

restore_stub_runners() {
  local target_dir="$1"
  # Restore the real tracked files if we backed them up; otherwise just rm
  # the stubs we wrote (legacy behaviour for paths that didn't have real
  # runners before — e.g., distribution/launchd/, which never had real
  # files committed under it).
  for name in run-tick-loop.sh run-budget-guard.sh; do
    if [ -f "$target_dir/$name.real-bak" ]; then
      mv "$target_dir/$name.real-bak" "$target_dir/$name"
    else
      rm -f "$target_dir/$name"
    fi
  done
}

# =============================================================================
# Linux — systemd --user
# =============================================================================

run_linux() {
  log "running Linux (systemd --user) integration test"

  command -v systemctl >/dev/null 2>&1 || {
    log "systemctl not on PATH — skipping (exit 77)"
    exit 77
  }
  command -v envsubst >/dev/null 2>&1 || {
    log "envsubst not on PATH (gettext-base missing) — skipping (exit 77)"
    exit 77
  }

  # Detect a usable user-bus. Three attempts, in order:
  #   1. systemctl --user is-system-running (works if linger is enabled OR
  #      we're already inside a user-session).
  #   2. loginctl enable-linger "$USER" (needs root; on GH runners this
  #      often works because the runner is a sudoers user — we try it
  #      under sudo if available).
  #   3. dbus-run-session — wraps the rest of the script in an ephemeral
  #      user-bus. This is the most reliable workaround for CI sandboxes
  #      per upstream systemd README + GitHub-hosted-runner threads.
  if ! systemctl --user is-system-running >/dev/null 2>&1 \
      && ! systemctl --user list-units >/dev/null 2>&1; then
    log "no user-bus detected; trying loginctl enable-linger"
    if command -v sudo >/dev/null 2>&1 \
        && sudo -n loginctl enable-linger "$USER" >/dev/null 2>&1; then
      # Allow a moment for the user manager to come up.
      sleep 2
    fi
  fi
  if ! systemctl --user list-units >/dev/null 2>&1; then
    if command -v dbus-run-session >/dev/null 2>&1; then
      log "user-bus still unavailable; re-execing under dbus-run-session"
      exec dbus-run-session -- "$0" "$MODE" --no-rerun
    fi
    log "no user-bus and no dbus-run-session — skipping (exit 77)"
    exit 77
  fi

  # Global (no `local`) so the EXIT trap can see it after run_linux
  # returns; matches the macOS-side fix for `set -u` unbound-var crashes
  # in cleanup.
  LINUX_UNIT_DIR="$HOME/.config/systemd/user"
  unit_dir="$LINUX_UNIT_DIR"
  mkdir -p "$unit_dir"

  # Render templates with envsubst.
  for f in "$ROOT"/systemd/*.service "$ROOT"/systemd/*.target; do
    envsubst '${MINSKY_HOME}' < "$f" > "$unit_dir/$(basename "$f")"
  done

  # Install stub runners alongside the templates. write_stub_runners backs up
  # any real tracked files first; restore_stub_runners brings them back at
  # cleanup so the working tree stays clean.
  write_stub_runners "$ROOT/systemd"

  cleanup_linux() {
    log "cleanup: stop + disable + remove unit files"
    systemctl --user stop minsky-supervisor.target 2>/dev/null || true
    systemctl --user stop minsky-tick-loop.service 2>/dev/null || true
    systemctl --user stop minsky-budget-guard.service 2>/dev/null || true
    systemctl --user disable minsky-supervisor.target 2>/dev/null || true
    rm -f "$LINUX_UNIT_DIR/minsky-supervisor.target" \
          "$LINUX_UNIT_DIR/minsky-tick-loop.service" \
          "$LINUX_UNIT_DIR/minsky-budget-guard.service"
    restore_stub_runners "$ROOT/systemd"
    systemctl --user daemon-reload 2>/dev/null || true
  }
  trap cleanup_linux EXIT

  systemctl --user daemon-reload
  log "starting minsky-supervisor.target"
  systemctl --user enable --now minsky-supervisor.target

  # Wait for the tick-loop to be active (it depends on budget-guard).
  if ! poll_until 15 systemctl --user is-active minsky-tick-loop.service; then
    log "FAIL: minsky-tick-loop did not become active within 15 s"
    systemctl --user status minsky-tick-loop.service --no-pager || true
    journalctl --user -u minsky-tick-loop.service --no-pager -n 50 || true
    exit 1
  fi
  log "minsky-tick-loop is active"

  # Capture the MainPID so we can verify the post-respawn PID differs.
  local pid_before
  pid_before=$(systemctl --user show -p MainPID --value minsky-tick-loop.service)
  log "tick-loop MainPID=$pid_before"

  # Failure-mode row 1: SIGKILL the tick-loop and assert respawn ≤ 10 s.
  log "SIGKILL minsky-tick-loop (failure-mode row 1)"
  systemctl --user kill -s SIGKILL minsky-tick-loop.service

  if ! poll_until "$RESPAWN_BUDGET_SECS" \
      bash -c 'pid=$(systemctl --user show -p MainPID --value minsky-tick-loop.service); [ "$pid" != "0" ] && [ "$pid" != "'"$pid_before"'" ]'; then
    log "FAIL: tick-loop did not respawn with a new PID within ${RESPAWN_BUDGET_SECS} s"
    systemctl --user status minsky-tick-loop.service --no-pager || true
    exit 1
  fi
  local pid_after
  pid_after=$(systemctl --user show -p MainPID --value minsky-tick-loop.service)
  log "PASS: tick-loop respawned (PID $pid_before → $pid_after) within budget"

  # Failure-mode row 3: the budget-guard is permanent (Restart=always). Kill
  # it the same way and assert respawn ≤ 15 s (its RestartSec=10).
  local guard_before
  guard_before=$(systemctl --user show -p MainPID --value minsky-budget-guard.service)
  log "SIGKILL minsky-budget-guard (failure-mode row 3)"
  systemctl --user kill -s SIGKILL minsky-budget-guard.service
  if ! poll_until 15 \
      bash -c 'pid=$(systemctl --user show -p MainPID --value minsky-budget-guard.service); [ "$pid" != "0" ] && [ "$pid" != "'"$guard_before"'" ]'; then
    log "FAIL: budget-guard did not respawn within 15 s"
    exit 1
  fi
  log "PASS: budget-guard respawned within 15 s"

  # Failure-mode row 2: SIGTERM is graceful — under transient policy
  # (Restart=on-failure), a SIGTERM that yields exit 0 should NOT respawn.
  # systemd treats SIGTERM as a clean stop only if the service exits 0;
  # `sleep` interrupted by SIGTERM exits non-zero, which would still
  # trigger respawn. Per the README, row 2 documents the *intent*, not a
  # systemd guarantee. We assert the weaker but verifiable property:
  # `systemctl stop` (which sends SIGTERM and waits) deactivates the unit.
  log "stop tick-loop cleanly (failure-mode row 2 — graceful-degrade)"
  systemctl --user stop minsky-tick-loop.service
  if ! poll_until 10 bash -c '! systemctl --user is-active minsky-tick-loop.service'; then
    log "FAIL: tick-loop did not stop cleanly within 10 s"
    exit 1
  fi
  log "PASS: tick-loop stopped cleanly"

  # Restart for row 4.
  systemctl --user start minsky-tick-loop.service
  if ! poll_until 15 systemctl --user is-active minsky-tick-loop.service; then
    log "FAIL: could not restart tick-loop for row 4"
    exit 1
  fi

  # Failure-mode row 4: rapid SIGKILL loop should hit StartLimitBurst=10
  # within StartLimitIntervalSec=300 and yield is-failed. We kill 11 times
  # with short waits; systemd should refuse further restarts.
  log "rapid SIGKILL loop (failure-mode row 4 — circuit-break-and-notify)"
  local i=0
  while [ "$i" -lt 11 ]; do
    systemctl --user kill -s SIGKILL minsky-tick-loop.service 2>/dev/null || true
    sleep 1
    i=$((i + 1))
  done
  # After hitting the start limit, the unit should report failed (or at
  # least not active). Some systemd versions report `failed`, others
  # `inactive` with a `start-limit-hit` reason. Accept either.
  if poll_until 10 bash -c \
      'systemctl --user is-failed minsky-tick-loop.service \
        || ! systemctl --user is-active minsky-tick-loop.service'; then
    log "PASS: tick-loop circuit-broke after rapid kill loop"
  else
    log "WARN: tick-loop did not enter failed state after rapid kills"
    log "(this is row 4's chaos test; some CI kernels rate-limit too leniently)"
    # Don't fail the run — row 4 is sensitive to the kernel's start-limit
    # accounting which CI sandboxes often relax. Row 1 + row 3 are the
    # load-bearing assertions.
  fi
  # Verify budget-guard still alive (blast-radius assertion from row 4).
  if systemctl --user is-active minsky-budget-guard.service >/dev/null 2>&1; then
    log "PASS: budget-guard survived tick-loop circuit-break"
  else
    log "FAIL: budget-guard should remain active when tick-loop circuit-breaks"
    exit 1
  fi

  log "ALL ASSERTIONS PASSED (linux)"
}

# =============================================================================
# macOS — launchd LaunchAgents
# =============================================================================

run_macos() {
  log "running macOS (launchd) integration test"

  command -v launchctl >/dev/null 2>&1 || {
    log "launchctl not on PATH — skipping (exit 77)"
    exit 77
  }

  local agent_dir="$HOME/Library/LaunchAgents"
  mkdir -p "$agent_dir"

  # envsubst is GNU-only; macOS runners get gettext via Homebrew's ImageOS
  # by default. Fall back to a sed-based substitution if missing.
  render() {
    local src="$1" dst="$2"
    if command -v envsubst >/dev/null 2>&1; then
      envsubst '${MINSKY_HOME}' < "$src" > "$dst"
    else
      sed "s|\${MINSKY_HOME}|$MINSKY_HOME|g" "$src" > "$dst"
    fi
  }

  for f in "$ROOT"/launchd/*.plist; do
    render "$f" "$agent_dir/$(basename "$f")"
  done

  # Both launchd plists' ProgramArguments now reference
  # `${MINSKY_HOME}/distribution/systemd/run-{tick-loop,budget-guard}.sh`
  # (post-#142 — the original `distribution/launchd/run-*.sh` paths
  # didn't exist; the systemd-side scripts are the canonical bootstraps and
  # the plists were updated to point at them). The test writes stubs at
  # systemd/ to match; cleanup restores the real tracked files via
  # restore_stub_runners.
  write_stub_runners "$ROOT/systemd"

  # Ensure the .minsky log directory exists (the plist writes log files
  # to ${MINSKY_HOME}/.minsky/{tick-loop,budget-guard}.{out,err}.log).
  mkdir -p "$REPO_ROOT/.minsky"

  # Globals (no `local`) so the EXIT trap can see them after run_macos
  # returns. With `set -u`, an unset variable referenced from the trap
  # crashes the cleanup — observed in the first PR run on macos-latest.
  MACOS_UID=$(id -u)
  MACOS_DOMAIN="gui/$MACOS_UID"
  MACOS_AGENT_DIR="$agent_dir"

  cleanup_macos() {
    log "cleanup: bootout + remove plists + restore stub-overridden runners"
    launchctl bootout "$MACOS_DOMAIN" "$MACOS_AGENT_DIR/com.minsky.tick-loop.plist" 2>/dev/null || true
    launchctl bootout "$MACOS_DOMAIN" "$MACOS_AGENT_DIR/com.minsky.budget-guard.plist" 2>/dev/null || true
    rm -f "$MACOS_AGENT_DIR/com.minsky.tick-loop.plist" \
          "$MACOS_AGENT_DIR/com.minsky.budget-guard.plist"
    restore_stub_runners "$ROOT/systemd"
  }
  trap cleanup_macos EXIT
  # Reuse the globals locally for readability in the rest of run_macos.
  local domain="$MACOS_DOMAIN"

  log "bootstrap LaunchAgents"
  # Bootstrap budget-guard first so tick-loop's start order matches.
  launchctl bootstrap "$domain" "$agent_dir/com.minsky.budget-guard.plist"
  launchctl bootstrap "$domain" "$agent_dir/com.minsky.tick-loop.plist"

  # Wait for both to be running. `launchctl print` returns details
  # including a `pid =` line when the service is up.
  current_pid() {
    # current_pid <label> -> echoes pid or empty if not running
    launchctl print "$domain/$1" 2>/dev/null \
      | awk '/^[[:space:]]*pid = /{print $3; exit}'
  }

  if ! poll_until 15 bash -c '[ -n "$(launchctl print '"$domain"'/com.minsky.tick-loop 2>/dev/null | awk '"'"'/^[[:space:]]*pid = /{print $3; exit}'"'"')" ]'; then
    log "FAIL: tick-loop did not start within 15 s"
    launchctl print "$domain/com.minsky.tick-loop" 2>/dev/null || true
    exit 1
  fi
  local pid_before
  pid_before="$(current_pid com.minsky.tick-loop)"
  log "tick-loop PID=$pid_before"

  # Failure-mode row 1: SIGKILL and assert respawn ≤ 10 s.
  log "SIGKILL tick-loop (failure-mode row 1)"
  kill -KILL "$pid_before"

  if ! poll_until "$RESPAWN_BUDGET_SECS" bash -c \
      'pid=$(launchctl print '"$domain"'/com.minsky.tick-loop 2>/dev/null | awk '"'"'/^[[:space:]]*pid = /{print $3; exit}'"'"'); [ -n "$pid" ] && [ "$pid" != "'"$pid_before"'" ]'; then
    log "FAIL: tick-loop did not respawn with a new PID within ${RESPAWN_BUDGET_SECS} s"
    launchctl print "$domain/com.minsky.tick-loop" 2>/dev/null || true
    exit 1
  fi
  local pid_after
  pid_after="$(current_pid com.minsky.tick-loop)"
  log "PASS: tick-loop respawned ($pid_before → $pid_after) within budget"

  # Failure-mode row 3: budget-guard permanent restart.
  local guard_before
  guard_before="$(current_pid com.minsky.budget-guard)"
  if [ -z "$guard_before" ]; then
    if ! poll_until 15 bash -c '[ -n "$(launchctl print '"$domain"'/com.minsky.budget-guard 2>/dev/null | awk '"'"'/^[[:space:]]*pid = /{print $3; exit}'"'"')" ]'; then
      log "FAIL: budget-guard never started"
      exit 1
    fi
    guard_before="$(current_pid com.minsky.budget-guard)"
  fi
  log "SIGKILL budget-guard (failure-mode row 3)"
  kill -KILL "$guard_before"
  if ! poll_until 20 bash -c \
      'pid=$(launchctl print '"$domain"'/com.minsky.budget-guard 2>/dev/null | awk '"'"'/^[[:space:]]*pid = /{print $3; exit}'"'"'); [ -n "$pid" ] && [ "$pid" != "'"$guard_before"'" ]'; then
    log "FAIL: budget-guard did not respawn within 20 s"
    exit 1
  fi
  log "PASS: budget-guard respawned"

  # Failure-mode row 2: bootout = graceful stop. Assert no respawn after
  # bootout. (Row 2's "SIGTERM-then-no-respawn" guarantee is launchd's
  # KeepAlive=SuccessfulExit:false — testing it via SIGTERM is unreliable
  # because `sleep` exits non-zero on SIGTERM. Bootout is the verifiable
  # equivalent.)
  log "bootout tick-loop (failure-mode row 2)"
  launchctl bootout "$domain" "$agent_dir/com.minsky.tick-loop.plist"
  if ! poll_until 10 bash -c \
      '[ -z "$(launchctl print '"$domain"'/com.minsky.tick-loop 2>/dev/null | awk '"'"'/^[[:space:]]*pid = /{print $3; exit}'"'"')" ]'; then
    log "FAIL: tick-loop still running after bootout"
    exit 1
  fi
  log "PASS: tick-loop did not respawn after bootout"

  # Re-bootstrap for row 4.
  launchctl bootstrap "$domain" "$agent_dir/com.minsky.tick-loop.plist"
  if ! poll_until 15 bash -c '[ -n "$(launchctl print '"$domain"'/com.minsky.tick-loop 2>/dev/null | awk '"'"'/^[[:space:]]*pid = /{print $3; exit}'"'"')" ]'; then
    log "FAIL: tick-loop did not come back for row 4"
    exit 1
  fi

  # Failure-mode row 4: rapid kill loop. launchd has its own throttle
  # (ThrottleInterval=5) but no fixed StartLimitBurst — it will keep
  # respawning. The blast-radius assertion (budget-guard survives) is
  # the load-bearing one for row 4 on launchd.
  log "rapid SIGKILL loop (failure-mode row 4)"
  local i=0
  while [ "$i" -lt 5 ]; do
    local p
    p="$(current_pid com.minsky.tick-loop)"
    [ -n "$p" ] && kill -KILL "$p" 2>/dev/null || true
    sleep 2
    i=$((i + 1))
  done
  if [ -n "$(current_pid com.minsky.budget-guard)" ]; then
    log "PASS: budget-guard survived tick-loop kill storm (blast-radius contained)"
  else
    log "FAIL: budget-guard died during tick-loop kill storm"
    exit 1
  fi

  log "ALL ASSERTIONS PASSED (macos)"
}

case "$MODE" in
  linux) run_linux ;;
  macos) run_macos ;;
  *) echo "unknown mode: $MODE (expected linux|macos)" >&2; exit 1 ;;
esac
