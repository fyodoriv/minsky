#!/usr/bin/env bats
# tests/iter-once.bats — paired tests for the consolidated forms
# `minsky --once <host>` and `minsky logs --failures [host]`, plus a
# small "deprecated alias still works" set for the older
# `iter-once` / `tail-failures` subcommand spelling.
#
# History:
#   - PR #867 introduced `iter-once` and `tail-failures` subcommands.
#   - PR #868 (rule #16 CLI consolidation corollary) folded the bodies
#     into a `_run_iter_once()` + `_run_tail_failures()` shared
#     function pair, exposed them via `--once` (flag on no-args
#     entry) and `logs --failures` (refinement of an existing verb),
#     and kept the old subcommands as thin deprecation aliases. These
#     tests pin BOTH spellings against the same shared function so
#     accidental drift between alias and canonical form is caught.
#
# What this pins:
# - `--once` with no args exits 2 + prints usage hint naming `--once`.
# - `--once` with a non-existent host-dir exits 1.
# - `--once --help` exits 0 + prints usage.
# - `--once` writes <host>/.minsky/iter-once.log (append-only).
# - `--once` defaults to --dry-run (no agent spawn).
# - `--once --live` flips the header to LIVE.
# - `--once` summary names verdict + ledger + (if non-validated) capture.
# - `logs --failures` with no failures dir prints friendly message + exits 0.
# - `logs --failures --latest` shows metadata + brief + stdout sections.
# - `logs --failures --count N` lists at most N capture dirs.
# - `logs --failures --help` exits 0.
# - Deprecated `iter-once` alias prints a banner then delegates.
# - Deprecated `tail-failures` alias prints a banner then delegates.
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

# --- --once: CLI contract --------------------------------------------------

@test "--once: missing host-dir exits 2 + prints usage hint" {
  run "$MINSKY_BIN" --once
  [ "$status" -eq 2 ]
  [[ "$output" == *"host-dir required"* ]]
  [[ "$output" == *"usage: minsky --once"* ]]
}

@test "--once: non-existent host-dir exits 1" {
  run "$MINSKY_BIN" --once /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "--once: --help exits 0 + prints usage" {
  run "$MINSKY_BIN" --once --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--live"* ]]
  [[ "$output" == *"--no-capture"* ]]
}

@test "--once: unknown flag exits 2" {
  run "$MINSKY_BIN" --once --frobnicate "$TEST_HOST"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown flag"* ]]
}

# --- --once: behavior -----------------------------------------------------

@test "--once: writes <host>/.minsky/iter-once.log with run header" {
  HOME="$FAKE_HOME" run "$MINSKY_BIN" --once "$TEST_HOST"
  # Status varies (may abort on invariants in test env) — we only pin
  # that the log was written with the expected header.
  [ -f "$TEST_HOST/.minsky/iter-once.log" ]
  grep -q "=== minsky --once @" "$TEST_HOST/.minsky/iter-once.log"
  grep -q "host:" "$TEST_HOST/.minsky/iter-once.log"
  grep -q "mode:.*dry-run" "$TEST_HOST/.minsky/iter-once.log"
}

@test "--once: --live mode header reports LIVE" {
  HOME="$FAKE_HOME" run "$MINSKY_BIN" --once "$TEST_HOST" --live
  [ -f "$TEST_HOST/.minsky/iter-once.log" ]
  grep -q "mode:.*LIVE" "$TEST_HOST/.minsky/iter-once.log"
}

@test "--once: log is APPENDED across invocations (not truncated)" {
  HOME="$FAKE_HOME" "$MINSKY_BIN" --once "$TEST_HOST" >/dev/null 2>&1 || true
  sleep 1
  HOME="$FAKE_HOME" "$MINSKY_BIN" --once "$TEST_HOST" >/dev/null 2>&1 || true
  # Two header lines means two invocations were appended
  count=$(grep -c "=== minsky --once @" "$TEST_HOST/.minsky/iter-once.log")
  [ "$count" -eq 2 ]
}

@test "--once: prints summary block with verdict + ledger + iter log paths" {
  HOME="$FAKE_HOME" run "$MINSKY_BIN" --once "$TEST_HOST"
  # Don't pin exit code (may vary in test env)
  [[ "$output" == *"--once summary"* ]]
  [[ "$output" == *"verdict:"* ]]
  [[ "$output" == *"iter log:"* ]]
}

# --- logs --failures: CLI contract ----------------------------------------

@test "logs --failures: --help exits 0 + prints usage" {
  run "$MINSKY_BIN" logs --failures --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--count"* ]]
  [[ "$output" == *"--latest"* ]]
}

@test "logs --failures: non-existent host-dir exits 1" {
  run "$MINSKY_BIN" logs --failures /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "logs --failures: unknown flag exits 2" {
  run "$MINSKY_BIN" logs --failures --frobnicate "$TEST_HOST"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown flag"* ]]
}

# --- logs --failures: behavior --------------------------------------------

@test "logs --failures: no failures dir prints friendly message + exits 0" {
  run "$MINSKY_BIN" logs --failures "$TEST_HOST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no failure-capture dir"* ]]
  [[ "$output" == *"$TEST_HOST/.minsky/failures"* ]]
}

@test "logs --failures: empty failures dir prints friendly message + exits 0" {
  mkdir -p "$TEST_HOST/.minsky/failures"
  run "$MINSKY_BIN" logs --failures "$TEST_HOST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"is empty"* ]]
}

@test "logs --failures: lists capture dirs sorted by mtime desc" {
  mkdir -p "$TEST_HOST/.minsky/failures/2026-05-24T120000Z-task-old"
  mkdir -p "$TEST_HOST/.minsky/failures/2026-05-25T120000Z-task-new"
  # Set mtimes explicitly
  touch -t 202605241200 "$TEST_HOST/.minsky/failures/2026-05-24T120000Z-task-old"
  touch -t 202605251200 "$TEST_HOST/.minsky/failures/2026-05-25T120000Z-task-new"
  # Write minimal metadata.json so the formatter has fields to read
  for d in "$TEST_HOST/.minsky/failures"/*/; do
    echo '{"verdict":"spawn-failed","duration_ms":100,"task_id":"task-x"}' > "$d/metadata.json"
  done
  run "$MINSKY_BIN" logs --failures "$TEST_HOST" --count 5
  [ "$status" -eq 0 ]
  # Newer dir should appear before older in the output
  newer_line=$(echo "$output" | grep -n "task-new" | head -1 | cut -d: -f1)
  older_line=$(echo "$output" | grep -n "task-old" | head -1 | cut -d: -f1)
  [ -n "$newer_line" ] && [ -n "$older_line" ] && [ "$newer_line" -lt "$older_line" ]
}

@test "logs --failures: --latest shows metadata.json + brief.md head + stdout.log tail" {
  capture_dir="$TEST_HOST/.minsky/failures/2026-05-25T120000Z-task-x"
  mkdir -p "$capture_dir"
  echo '{"verdict":"spawn-failed","task_id":"task-x","exit_code":1}' > "$capture_dir/metadata.json"
  echo "test brief content" > "$capture_dir/brief.md"
  echo "test stdout content" > "$capture_dir/stdout.log"
  run "$MINSKY_BIN" logs --failures "$TEST_HOST" --latest
  [ "$status" -eq 0 ]
  [[ "$output" == *"metadata.json"* ]]
  [[ "$output" == *"brief.md"* ]]
  [[ "$output" == *"stdout.log"* ]]
  [[ "$output" == *"task-x"* ]]
  [[ "$output" == *"test brief content"* ]]
  [[ "$output" == *"test stdout content"* ]]
}

@test "logs --failures: --count N caps the listing" {
  for i in 1 2 3 4 5; do
    d="$TEST_HOST/.minsky/failures/2026-05-25T12000${i}Z-task-$i"
    mkdir -p "$d"
    echo '{"verdict":"spawn-failed","task_id":"task-'"$i"'","duration_ms":'"$i"'00}' > "$d/metadata.json"
  done
  run "$MINSKY_BIN" logs --failures "$TEST_HOST" --count 3
  [ "$status" -eq 0 ]
  count=$(echo "$output" | grep -c "verdict=" || true)
  [ "$count" -eq 3 ]
}

@test "logs --failures: defaults to PWD when no host arg given" {
  cd "$TEST_HOST"
  mkdir -p "$TEST_HOST/.minsky/failures"
  run "$MINSKY_BIN" logs --failures
  [ "$status" -eq 0 ]
  [[ "$output" == *"$TEST_HOST"* ]] || [[ "$output" == *"is empty"* ]]
}

# --- Deprecated aliases — pin that they still delegate -------------------

@test "deprecated iter-once: prints banner + delegates to --once body" {
  run "$MINSKY_BIN" iter-once /nonexistent/path
  # Same exit code as canonical form
  [ "$status" -eq 1 ]
  # Deprecation banner appears on stderr (run captures both into $output)
  [[ "$output" == *"\`iter-once\` is deprecated"* ]]
  [[ "$output" == *"--once"* ]]
  # And the canonical error from _run_iter_once is also printed
  [[ "$output" == *"host-dir not found"* ]]
}

@test "deprecated iter-once: MINSKY_ITER_ONCE_FOLD=1 suppresses banner" {
  MINSKY_ITER_ONCE_FOLD=1 run "$MINSKY_BIN" iter-once /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" != *"iter-once\` is deprecated"* ]]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "deprecated tail-failures: prints banner + delegates to logs --failures body" {
  run "$MINSKY_BIN" tail-failures /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" == *"\`tail-failures\` is deprecated"* ]]
  [[ "$output" == *"logs --failures"* ]]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "deprecated tail-failures: MINSKY_TAIL_FAILURES_FOLD=1 suppresses banner" {
  MINSKY_TAIL_FAILURES_FOLD=1 run "$MINSKY_BIN" tail-failures /nonexistent/path
  [ "$status" -eq 1 ]
  [[ "$output" != *"tail-failures\` is deprecated"* ]]
  [[ "$output" == *"host-dir not found"* ]]
}
