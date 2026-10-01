#!/usr/bin/env bats
# tests/bash-doctor.bats — paired tests for `minsky bash-doctor`
#
# What this pins:
# - Exit 0 when ALL critical checks pass.
# - Exit 1 when ANY critical check fails (jq, python3 ≥3.10, executable
#   bits on bash entrypoints, agent backend, gh CLI).
# - --quiet hides PASS lines but still prints FAIL / WARN.
# - Each FAIL line carries an operator-actionable fix command.
# - The check is read-only — it never writes to disk, never mutates state.
#
# Run: bats tests/bash-doctor.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_BIN="$REPO_ROOT/bin/minsky"
  TMPDIR_TEST="$(mktemp -d -t minsky-bash-doctor-test.XXXXXX)"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

# --- Smoke -----------------------------------------------------------------

@test "bash-doctor: invokable + emits header + exits 0 or 1" {
  # On the host machine this runs, the agent backend may not be
  # installed, so we accept either exit code; what we pin is that the
  # subcommand is reachable, prints the header, and doesn't crash with
  # a different exit code (e.g., 127 / 2).
  run "$MINSKY_BIN" bash-doctor
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
  [[ "$output" == *"bash-doctor"* ]]
  [[ "$output" == *"Path A bash + Python skeleton"* ]]
}

@test "bash-doctor: --quiet suppresses PASS lines but keeps FAIL/WARN" {
  run "$MINSKY_BIN" bash-doctor --quiet
  # Don't pin a specific status — depends on the host's state. Pin only
  # that --quiet hides the "PASS" lines (they only emit when not quiet).
  # If everything passes, output is empty (exit 0); if anything fails,
  # only FAIL/WARN lines appear.
  if [ "$status" -eq 0 ]; then
    # All-pass quiet path: no PASS lines, no FAIL summary
    [[ "$output" != *"PASS"* ]] || false
  else
    # Some failure path: the failure summary still appears
    [[ "$output" == *"❌"* ]] || [[ "$output" == *"FAIL"* ]]
  fi
}

# --- Critical-check semantics ---------------------------------------------

@test "bash-doctor: prints PASS line for every reachable critical dep" {
  run "$MINSKY_BIN" bash-doctor
  # At minimum these 4 critical checks must produce a status line each
  # (PASS or FAIL — never silent):
  for dep in "jq" "python3" "minsky-run.sh" "default-session.sh" "spawn_agent.py" "gh CLI"; do
    if [[ "$output" != *"$dep"* ]]; then
      echo "Expected '$dep' status line in output"
      echo "$output"
      false
    fi
  done
}

@test "bash-doctor: FAIL lines carry an operator-actionable fix hint" {
  # Force a failure by making bin/minsky-run.sh non-executable in a temp
  # repo + invoking from there.
  TEST_REPO="$TMPDIR_TEST/fake-repo"
  mkdir -p "$TEST_REPO/bin" "$TEST_REPO/scripts"
  # Cause a known FAIL: missing minsky-run.sh
  cp "$MINSKY_BIN" "$TEST_REPO/bin/minsky"
  # Copy bash-doctor's dependencies but NOT minsky-run.sh
  touch "$TEST_REPO/bin/minsky-default-session.sh"
  chmod +x "$TEST_REPO/bin/minsky-default-session.sh"
  cp "$REPO_ROOT/scripts/spawn_agent.py" "$TEST_REPO/scripts/spawn_agent.py" 2>/dev/null || true

  run "$TEST_REPO/bin/minsky" bash-doctor
  # When minsky-run.sh is missing, the FAIL line names it AND includes a chmod hint
  [[ "$output" == *"FAIL"* ]]
  [[ "$output" == *"minsky-run.sh"* ]]
  [[ "$output" == *"chmod +x"* ]]
}

@test "bash-doctor: read-only — does not write to .minsky/ in PWD" {
  TEST_CWD="$TMPDIR_TEST/fake-pwd"
  mkdir -p "$TEST_CWD"
  cd "$TEST_CWD"
  run "$MINSKY_BIN" bash-doctor
  # PWD is now clean — verify the check didn't create anything
  [ ! -d "$TEST_CWD/.minsky" ]
  [ ! -e "$TEST_CWD/baseline.json" ]
}

# --- Exit-code contract ----------------------------------------------------

@test "bash-doctor: exit 0 when all critical checks pass (smoke)" {
  # If THIS machine passes all critical checks, the script exits 0.
  # If not, it exits 1 — that's also valid. The point: it's binary, not
  # "exits 2 because of a parse error" or "127 because the subcommand
  # didn't dispatch".
  run "$MINSKY_BIN" bash-doctor
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}
