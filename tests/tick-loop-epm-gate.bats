#!/usr/bin/env bats
# tests/tick-loop-epm-gate.bats — tick-loop must exit 0 (not respawn) when
# endpoint-ready or opt-in sentinel is missing, preventing EPM jq/python hammer.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  RUN_TICK_LOOP="$REPO_ROOT/distribution/systemd/run-tick-loop.sh"
  TMPDIR_TEST="$(mktemp -d -t minsky-tick-gate.XXXXXX)"
  export HOME="$TMPDIR_TEST/home"
  export MINSKY_HOME="$TMPDIR_TEST/minsky"
  mkdir -p "$HOME/.local/state/dotfiles" "$MINSKY_HOME/.minsky"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

@test "run-tick-loop: exits 0 when endpoint-ready missing" {
  run bash "$RUN_TICK_LOOP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"endpoint-ready sentinel missing"* ]]
}

@test "run-tick-loop: exits 0 when endpoint-ready present but not enabled" {
  touch "$HOME/.local/state/dotfiles/endpoint-ready"
  run bash "$RUN_TICK_LOOP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"not enabled"* ]] || [[ "$output" == *"enable-tick-loop"* ]]
}

@test "run-tick-loop: proceeds past gate when enabled sentinel present" {
  touch "$HOME/.local/state/dotfiles/endpoint-ready"
  touch "$MINSKY_HOME/.minsky/tick-loop-enabled"
  # Dry-run path should get past the gate (may fail later on missing host — that's ok).
  run bash "$RUN_TICK_LOOP" 2>&1
  [[ "$output" != *"endpoint-ready sentinel missing"* ]]
  [[ "$output" != *"not enabled"* ]]
}
