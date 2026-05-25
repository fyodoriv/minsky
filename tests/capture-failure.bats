#!/usr/bin/env bats
# tests/capture-failure.bats — paired tests for scripts/capture-failure.sh
#
# What this pins:
# - Creates <host>/.minsky/failures/<iso-ts>-<task-id>/ on every invocation.
# - The dir contains: brief.md, stdout.log, metadata.json, env.txt.
# - Secrets in env (vars matching *_TOKEN / *_KEY / *_SECRET / *_PASSWORD)
#   have values redacted; var names + lengths are preserved.
# - metadata.json is valid JSON with the expected fields.
# - Missing brief / stdout files don't crash — placeholders are written.
# - Self-limiting: with MINSKY_FAILURE_RING_SIZE=2, the 3rd capture
#   deletes the oldest.
# - --help / -h exits 0.
# - Missing required arg exits 1.
#
# Run: bats tests/capture-failure.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  CAPTURE_SH="$REPO_ROOT/scripts/capture-failure.sh"
  TMPDIR_TEST="$(mktemp -d -t minsky-capture-test.XXXXXX)"
  HOST_DIR="$TMPDIR_TEST/fake-host"
  mkdir -p "$HOST_DIR/.minsky"
  BRIEF_FILE="$TMPDIR_TEST/brief.md"
  STDOUT_LOG="$TMPDIR_TEST/stdout.log"
  echo "test brief content" > "$BRIEF_FILE"
  echo "test stdout content" > "$STDOUT_LOG"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

# --- Happy path ------------------------------------------------------------

@test "capture-failure: creates expected dir + 4 artifacts" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "agent/task-foo" --pr-url "" --notes "test failure"
  [ "$status" -eq 0 ]
  # Locate the capture dir (exactly 1 dir under failures/)
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  [ -n "$capture_dir" ]
  [ -f "$capture_dir/brief.md" ]
  [ -f "$capture_dir/stdout.log" ]
  [ -f "$capture_dir/env.txt" ]
  [ -f "$capture_dir/metadata.json" ]
}

@test "capture-failure: brief.md + stdout.log match the input contents" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "agent/task-foo" --pr-url "" --notes "test failure"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  grep -q "test brief content" "$capture_dir/brief.md"
  grep -q "test stdout content" "$capture_dir/stdout.log"
}

@test "capture-failure: metadata.json is valid JSON with all required fields" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "60000" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "agent/task-foo" --pr-url "https://github.com/owner/repo/pull/1" --notes "a note"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  jq -e '.ts' "$capture_dir/metadata.json"
  jq -e '.host' "$capture_dir/metadata.json"
  jq -e '.task_id == "task-foo"' "$capture_dir/metadata.json"
  jq -e '.verdict == "spawn-failed"' "$capture_dir/metadata.json"
  jq -e '.exit_code == 1' "$capture_dir/metadata.json"
  jq -e '.duration_ms == 60000' "$capture_dir/metadata.json"
  jq -e '.branch == "agent/task-foo"' "$capture_dir/metadata.json"
  jq -e '.pr_url == "https://github.com/owner/repo/pull/1"' "$capture_dir/metadata.json"
  jq -e '.tools.jq' "$capture_dir/metadata.json"
  jq -e '.tools.python3' "$capture_dir/metadata.json"
}

@test "capture-failure: empty pr_url renders as JSON null (not empty string)" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "agent/task-foo" --pr-url "" --notes "n"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  jq -e '.pr_url == null' "$capture_dir/metadata.json"
}

# --- Secret sanitization (load-bearing for safety) -------------------------

@test "capture-failure: redacts *_TOKEN / *_KEY / *_SECRET values in env.txt" {
  export TEST_FAKE_API_TOKEN="abcdef-secret-value"
  export TEST_FAKE_KEY="another-secret"
  export TEST_FAKE_SECRET="and-another"
  export TEST_FAKE_PASSWORD="password123"
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "b" --pr-url "" --notes "n"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)

  # The var NAMES appear in env.txt
  grep -q "^TEST_FAKE_API_TOKEN=" "$capture_dir/env.txt"
  grep -q "^TEST_FAKE_KEY=" "$capture_dir/env.txt"
  grep -q "^TEST_FAKE_SECRET=" "$capture_dir/env.txt"
  grep -q "^TEST_FAKE_PASSWORD=" "$capture_dir/env.txt"

  # The values do NOT appear in env.txt (anywhere)
  ! grep -q "abcdef-secret-value" "$capture_dir/env.txt"
  ! grep -q "another-secret" "$capture_dir/env.txt"
  ! grep -q "and-another" "$capture_dir/env.txt"
  ! grep -q "password123" "$capture_dir/env.txt"

  # Redaction marker IS present
  grep -q "redacted-length-" "$capture_dir/env.txt"

  unset TEST_FAKE_API_TOKEN TEST_FAKE_KEY TEST_FAKE_SECRET TEST_FAKE_PASSWORD
}

@test "capture-failure: keeps non-secret env vars (PATH, SHELL, PWD)" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "b" --pr-url "" --notes "n"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  # PATH should be present and not redacted (may be truncated for length)
  grep -q "^PATH=" "$capture_dir/env.txt"
}

# --- Graceful-degrade ------------------------------------------------------

@test "capture-failure: missing brief-file produces placeholder, not crash" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "/nonexistent/brief" --stdout-log "$STDOUT_LOG" \
    --branch "b" --pr-url "" --notes "n"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  grep -q "no brief file" "$capture_dir/brief.md"
}

@test "capture-failure: missing stdout-log produces placeholder, not crash" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "/nonexistent/stdout" \
    --branch "b" --pr-url "" --notes "n"
  [ "$status" -eq 0 ]
  capture_dir=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | head -1)
  grep -q "no stdout log" "$capture_dir/stdout.log"
}

# --- Self-limiting ring ----------------------------------------------------

@test "capture-failure: MINSKY_FAILURE_RING_SIZE=2 caps the dir count" {
  export MINSKY_FAILURE_RING_SIZE=2
  for i in 1 2 3; do
    "$CAPTURE_SH" \
      --host "$HOST_DIR" --task-id "task-$i" --verdict "spawn-failed" \
      --exit-code "1" --duration-ms "100" \
      --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
      --branch "b" --pr-url "" --notes "n" >/dev/null
    sleep 1  # ensure distinct timestamps
  done
  count=$(/usr/bin/find "$HOST_DIR/.minsky/failures" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  [ "$count" -eq 2 ]
  unset MINSKY_FAILURE_RING_SIZE
}

# --- CLI contract ----------------------------------------------------------

@test "capture-failure: --help exits 0 and prints usage" {
  run "$CAPTURE_SH" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "capture-failure: missing --host exits 1" {
  run "$CAPTURE_SH" \
    --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1"
  [ "$status" -eq 1 ]
}

@test "capture-failure: emits capture-dir path on stdout" {
  run "$CAPTURE_SH" \
    --host "$HOST_DIR" --task-id "task-foo" --verdict "spawn-failed" \
    --exit-code "1" --duration-ms "100" \
    --brief-file "$BRIEF_FILE" --stdout-log "$STDOUT_LOG" \
    --branch "b" --pr-url "" --notes "n"
  [ "$status" -eq 0 ]
  # stdout should contain a path under $HOST_DIR/.minsky/failures/
  [[ "$output" == *".minsky/failures/"* ]]
}
