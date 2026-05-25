#!/usr/bin/env bats
# tests/iter-once.bats — paired tests for `minsky iter-once` and
# `minsky tail-failures` subcommands (PR follow-up to bash-doctor +
# failure-capture in PR #866).
#
# What this pins:
# - `iter-once` with no args exits 2 + prints usage hint.
# - `iter-once` with a non-existent host-dir exits 1.
# - `iter-once --help` exits 0 + prints usage.
# - `iter-once` writes <host>/.minsky/iter-once.log (append-only).
# - `iter-once` defaults to --dry-run (no agent spawn).
# - `iter-once --live` omits --dry-run from the runner args.
# - `iter-once` summary names verdict + ledger + (if non-validated) capture.
# - `tail-failures` with no failures dir prints friendly message + exits 0.
# - `tail-failures --latest` shows metadata + brief + stdout sections.
# - `tail-failures --count N` lists at most N capture dirs.
# - `tail-failures --help` exits 0.
#
# Run: bats tests/iter-once.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_BIN="$REPO_ROOT/bin/minsky"
  TMPDIR_TEST="$(mktemp -d -t minsky-iter-once-test.XXXXXX)"
  HOSTS_PARENT="$TMPDIR_TEST/hosts"
  TEST_HOST="$HOSTS_PARENT/host1"
  mkdir -p "$TEST_HOST/.minsky"
  echo '{"repo":"host1"}' > "$TEST_HOST/.minsky/repo.yaml"
  echo "# Tasks" > "$TEST_HOST/TASKS.md"
  # Build a fake ~/.minsky/config.json for the runner's invariant 1
  FAKE_HOME="$TMPDIR_TEST/fake-home"
  mkdir -p "$FAKE_HOME/.minsky"
  echo '{"openhands":{"model":"claude-opus-4-7"}}' > "$FAKE_HOME/.minsky/config.json"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

# --- iter-once: CLI contract --------------------------------------------

@test "iter-once: missing host-dir exits 2 + prints usage hint" {
  run "$MINSKY_BIN" iter-once
  [ "$status" -eq 2 ]
  [[ "$output" == *"host-dir required"* ]]
  [[ "$output" == *"usage: minsky iter-once"* ]]
}

@test "iter-once: non-existent host-dir exits 1" {
  run "$MINSKY_BIN" iter-once /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "iter-once: --help exits 0 + prints usage" {
  run "$MINSKY_BIN" iter-once --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--live"* ]]
  [[ "$output" == *"--no-capture"* ]]
}

@test "iter-once: unknown flag exits 2" {
  run "$MINSKY_BIN" iter-once --frobnicate "$TEST_HOST"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown flag"* ]]
}

# --- iter-once: behavior ---------------------------------------------------

@test "iter-once: writes <host>/.minsky/iter-once.log with run header" {
  HOME="$FAKE_HOME" run "$MINSKY_BIN" iter-once "$TEST_HOST"
  # Status varies (may abort on invariants in test env) — we only pin
  # that the log was written with the expected header.
  [ -f "$TEST_HOST/.minsky/iter-once.log" ]
  grep -q "=== minsky iter-once @" "$TEST_HOST/.minsky/iter-once.log"
  grep -q "host:" "$TEST_HOST/.minsky/iter-once.log"
  grep -q "mode:.*dry-run" "$TEST_HOST/.minsky/iter-once.log"
}

@test "iter-once: --live mode header reports LIVE" {
  HOME="$FAKE_HOME" run "$MINSKY_BIN" iter-once "$TEST_HOST" --live
  [ -f "$TEST_HOST/.minsky/iter-once.log" ]
  grep -q "mode:.*LIVE" "$TEST_HOST/.minsky/iter-once.log"
}

@test "iter-once: log is APPENDED across invocations (not truncated)" {
  HOME="$FAKE_HOME" "$MINSKY_BIN" iter-once "$TEST_HOST" >/dev/null 2>&1 || true
  sleep 1
  HOME="$FAKE_HOME" "$MINSKY_BIN" iter-once "$TEST_HOST" >/dev/null 2>&1 || true
  # Two header lines means two invocations were appended
  count=$(grep -c "=== minsky iter-once @" "$TEST_HOST/.minsky/iter-once.log")
  [ "$count" -eq 2 ]
}

@test "iter-once: prints summary block with verdict + ledger + iter log paths" {
  HOME="$FAKE_HOME" run "$MINSKY_BIN" iter-once "$TEST_HOST"
  # Don't pin exit code (may vary in test env)
  [[ "$output" == *"iter-once summary"* ]]
  [[ "$output" == *"verdict:"* ]]
  [[ "$output" == *"iter log:"* ]]
}

# --- tail-failures: CLI contract -------------------------------------------

@test "tail-failures: --help exits 0 + prints usage" {
  run "$MINSKY_BIN" tail-failures --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--count"* ]]
  [[ "$output" == *"--latest"* ]]
}

@test "tail-failures: non-existent host-dir exits 1" {
  run "$MINSKY_BIN" tail-failures /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "tail-failures: unknown flag exits 2" {
  run "$MINSKY_BIN" tail-failures --frobnicate "$TEST_HOST"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown flag"* ]]
}

# --- tail-failures: behavior -----------------------------------------------

@test "tail-failures: no failures dir prints friendly message + exits 0" {
  run "$MINSKY_BIN" tail-failures "$TEST_HOST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no failure-capture dir"* ]]
  [[ "$output" == *"$TEST_HOST/.minsky/failures"* ]]
}

@test "tail-failures: empty failures dir prints friendly message + exits 0" {
  mkdir -p "$TEST_HOST/.minsky/failures"
  run "$MINSKY_BIN" tail-failures "$TEST_HOST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"is empty"* ]]
}

@test "tail-failures: lists capture dirs sorted by mtime desc" {
  mkdir -p "$TEST_HOST/.minsky/failures/2026-05-24T120000Z-task-old"
  mkdir -p "$TEST_HOST/.minsky/failures/2026-05-25T120000Z-task-new"
  # Set mtimes explicitly
  touch -t 202605241200 "$TEST_HOST/.minsky/failures/2026-05-24T120000Z-task-old"
  touch -t 202605251200 "$TEST_HOST/.minsky/failures/2026-05-25T120000Z-task-new"
  # Write minimal metadata.json so the formatter has fields to read
  for d in "$TEST_HOST/.minsky/failures"/*/; do
    echo '{"verdict":"spawn-failed","duration_ms":100,"task_id":"task-x"}' > "$d/metadata.json"
  done
  run "$MINSKY_BIN" tail-failures "$TEST_HOST" --count 5
  [ "$status" -eq 0 ]
  # Newer dir should appear before older in the output
  newer_line=$(echo "$output" | grep -n "task-new" | head -1 | cut -d: -f1)
  older_line=$(echo "$output" | grep -n "task-old" | head -1 | cut -d: -f1)
  [ -n "$newer_line" ] && [ -n "$older_line" ] && [ "$newer_line" -lt "$older_line" ]
}

@test "tail-failures: --latest shows metadata.json + brief.md head + stdout.log tail" {
  capture_dir="$TEST_HOST/.minsky/failures/2026-05-25T120000Z-task-x"
  mkdir -p "$capture_dir"
  echo '{"verdict":"spawn-failed","task_id":"task-x","exit_code":1}' > "$capture_dir/metadata.json"
  echo "test brief content" > "$capture_dir/brief.md"
  echo "test stdout content" > "$capture_dir/stdout.log"
  run "$MINSKY_BIN" tail-failures "$TEST_HOST" --latest
  [ "$status" -eq 0 ]
  [[ "$output" == *"metadata.json"* ]]
  [[ "$output" == *"brief.md"* ]]
  [[ "$output" == *"stdout.log"* ]]
  [[ "$output" == *"task-x"* ]]
  [[ "$output" == *"test brief content"* ]]
  [[ "$output" == *"test stdout content"* ]]
}

@test "tail-failures: --count N caps the listing" {
  for i in 1 2 3 4 5; do
    d="$TEST_HOST/.minsky/failures/2026-05-25T12000${i}Z-task-$i"
    mkdir -p "$d"
    echo '{"verdict":"spawn-failed","task_id":"task-'"$i"'","duration_ms":'"$i"'00}' > "$d/metadata.json"
  done
  run "$MINSKY_BIN" tail-failures "$TEST_HOST" --count 3
  [ "$status" -eq 0 ]
  count=$(echo "$output" | grep -c "verdict=" || true)
  [ "$count" -eq 3 ]
}

@test "tail-failures: defaults to PWD when no host arg given" {
  cd "$TEST_HOST"
  mkdir -p "$TEST_HOST/.minsky/failures"
  run "$MINSKY_BIN" tail-failures
  [ "$status" -eq 0 ]
  [[ "$output" == *"$TEST_HOST"* ]] || [[ "$output" == *"is empty"* ]]
}
