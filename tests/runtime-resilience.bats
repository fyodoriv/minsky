#!/usr/bin/env bats
# tests/runtime-resilience.bats — minsky-runtime-resilience
#
# Pins the three live runtime failure modes that used to abort
# bin/minsky-run.sh with a raw shell/errno instead of an operator-
# actionable message, plus the doctor state-dir probe:
#
#   (a) unwritable experiment-store dir → one-line path + recovery hint
#       (chmod u+w / MINSKY_HOME), clean non-zero exit — not a raw mkdir errno.
#   (b) unwritable log/brief target dir → ${TMPDIR:-/tmp} fallback + warn,
#       the resilient_logfile helper still returns a usable path.
#   (c) missing run target (spawn shim) → actionable one-line message
#       naming the path + the fix — not a raw python ENOENT.
#   (d) `bash-doctor-probes.sh state-dir-writable` + the `minsky doctor`
#       row classify the state dir's writability.
#
# Anchor: SRE 2016 Ch. 6 (graceful degradation); Armstrong 2003
# (let-it-crash AT the operator-actionable boundary).
#
# Run: bats tests/runtime-resilience.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_RUN="$REPO_ROOT/bin/minsky-run.sh"
  MINSKY_BIN="$REPO_ROOT/bin/minsky"
  PROBES="$REPO_ROOT/scripts/bash-doctor-probes.sh"
  TMPDIR_TEST="$(mktemp -d -t minsky-resilience-test.XXXXXX)"
  HOSTS_DIR="$TMPDIR_TEST/hosts"
  mkdir -p "$HOSTS_DIR"
  CONFIG_FILE="$TMPDIR_TEST/config.json"
  printf '{"openhands":{"model":"claude-opus-4-7"}}' > "$CONFIG_FILE"
  export MINSKY_CONFIG="$CONFIG_FILE"
}

teardown() {
  # Restore any perms we tightened so rm -rf can clean up.
  chmod -R u+w "$TMPDIR_TEST" 2>/dev/null || true
  rm -rf "$TMPDIR_TEST"
}

# --- Helper: bootstrapped host with one pickable task ---------------------

make_host() {
  local name="$1"
  local dir="$HOSTS_DIR/$name"
  mkdir -p "$dir"
  (cd "$dir" && git init -q && git config user.email "t@t" && git config user.name "t")
  cat > "$dir/TASKS.md" <<'EOF'
# Tasks

## P0

- [ ] Pick me first
  - **ID**: pick-me-first
  - **Hypothesis**: shipping this proves the picker works
  - **Success**: PR opens
  - **Pivot**: <0.1
  - **Measurement**: pytest tests/
  - **Anchor**: rule #9
EOF
  mkdir -p "$dir/.minsky"
  cat > "$dir/.minsky/repo.yaml" <<EOF
host_repo: "test/$name"
default_branch: "main"
tasks_md_path: "TASKS.md"
EOF
  echo "$dir"
}

# Skip perm-based tests when running as root (root bypasses the -w bit).
skip_if_root() {
  if [ "$(id -u)" -eq 0 ]; then
    skip "running as root — the write-permission bit is bypassed"
  fi
}

# --- (a) Unwritable experiment-store dir ----------------------------------

@test "(a) unwritable experiment-store → path + recovery hint, clean non-zero exit" {
  skip_if_root
  host="$(make_host one)"
  # Make .minsky read-only so the experiment-store mkdir -p fails.
  chmod a-w "$host/.minsky"

  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 1
  # Restore immediately so a later assertion failure still cleans up.
  chmod u+w "$host/.minsky"

  # walk_hosts breaks the inner loop on the failed iteration but exits 0
  # for the round; the per-iteration failure surfaces the actionable line.
  [[ "$output" == *"INVARIANT FAIL"* ]]
  [[ "$output" == *"experiment-store"* ]]
  [[ "$output" == *"$host/.minsky/experiment-store/cross-repo"* ]]
  # Recovery hint names BOTH escape hatches the task mandates.
  [[ "$output" == *"chmod u+w"* ]]
  [[ "$output" == *"MINSKY_HOME"* ]]
  # It is NOT a raw mkdir errno — the message is the actionable line.
  [[ "$output" != *"mkdir: "* ]]
}

# --- (b) Unwritable log/brief target → /tmp fallback ----------------------

@test "(b) resilient_logfile falls back to TMPDIR + warns when target unwritable" {
  skip_if_root
  unwritable="$TMPDIR_TEST/ro"
  mkdir -p "$unwritable"
  chmod a-w "$unwritable"

  # Source just the helper region (everything before the arg parser, which
  # is where HOSTS_DIR="" begins). This avoids running the whole runner.
  helper_src="$TMPDIR_TEST/helpers.sh"
  sed -n '1,/^HOSTS_DIR=""/p' "$MINSKY_RUN" | sed '/^HOSTS_DIR=""/d' > "$helper_src"

  run bash -c "
    set -uo pipefail
    source '$helper_src'
    out=\$(resilient_logfile '$unwritable' 'abc123' '.log')
    echo \"PATH=\$out\"
  "
  chmod u+w "$unwritable"

  [ "$status" -eq 0 ]
  # Warn line names the unwritable dir.
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"$unwritable"* ]]
  # Returned path is under TMPDIR/tmp, USER-scoped, and carries the id.
  resolved="$(printf '%s\n' "$output" | sed -n 's/^PATH=//p')"
  [[ "$resolved" == "${TMPDIR:-/tmp}"* ]] || [[ "$resolved" == /tmp/* ]]
  [[ "$resolved" == *"abc123.log" ]]
}

@test "(b) resilient_logfile returns in-place path when target IS writable" {
  writable="$TMPDIR_TEST/rw"
  helper_src="$TMPDIR_TEST/helpers.sh"
  sed -n '1,/^HOSTS_DIR=""/p' "$MINSKY_RUN" | sed '/^HOSTS_DIR=""/d' > "$helper_src"

  run bash -c "
    set -uo pipefail
    source '$helper_src'
    resilient_logfile '$writable' 'xyz' '.log'
  "
  [ "$status" -eq 0 ]
  [[ "$output" == "$writable/minsky-xyz.log" ]]
  [[ "$output" != *"WARN"* ]]
}

# --- (c) Missing run target (spawn shim) ----------------------------------

@test "(c) preflight_run_target names a missing path + the fix" {
  helper_src="$TMPDIR_TEST/helpers.sh"
  sed -n '1,/^HOSTS_DIR=""/p' "$MINSKY_RUN" | sed '/^HOSTS_DIR=""/d' > "$helper_src"

  run bash -c "
    set -uo pipefail
    source '$helper_src'
    preflight_run_target '$TMPDIR_TEST/does-not-exist.py' 'pnpm install'
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"INVARIANT FAIL"* ]]
  [[ "$output" == *"run target missing"* ]]
  [[ "$output" == *"does-not-exist.py"* ]]
  [[ "$output" == *"pnpm install"* ]]
}

@test "(c) preflight_run_target names a non-executable path + chmod fix" {
  skip_if_root
  target="$TMPDIR_TEST/not-exec.py"
  printf 'print(1)\n' > "$target"
  chmod a-x "$target"

  helper_src="$TMPDIR_TEST/helpers.sh"
  sed -n '1,/^HOSTS_DIR=""/p' "$MINSKY_RUN" | sed '/^HOSTS_DIR=""/d' > "$helper_src"

  run bash -c "
    set -uo pipefail
    source '$helper_src'
    preflight_run_target '$target'
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"not executable"* ]]
  [[ "$output" == *"chmod +x"* ]]
}

@test "(c) preflight_run_target passes for an executable path" {
  target="$TMPDIR_TEST/ok.py"
  printf 'print(1)\n' > "$target"
  chmod +x "$target"

  helper_src="$TMPDIR_TEST/helpers.sh"
  sed -n '1,/^HOSTS_DIR=""/p' "$MINSKY_RUN" | sed '/^HOSTS_DIR=""/d' > "$helper_src"

  run bash -c "
    set -uo pipefail
    source '$helper_src'
    preflight_run_target '$target'
  "
  [ "$status" -eq 0 ]
}

# --- (d) doctor probe: state-dir-writable ----------------------------------

@test "(d) probe state-dir-writable PASSes for a writable dir + prints path" {
  dir="$TMPDIR_TEST/state-ok"
  run bash "$PROBES" state-dir-writable "$dir"
  [ "$status" -eq 0 ]
  [[ "$output" == *"$dir"* ]]
  # Idempotent: the probe creates the dir if absent.
  [ -d "$dir" ]
}

@test "(d) probe state-dir-writable FAILs with a recovery hint for an unwritable dir" {
  skip_if_root
  parent="$TMPDIR_TEST/state-ro"
  mkdir -p "$parent"
  chmod a-w "$parent"
  # A child under the read-only parent cannot be created.
  run bash "$PROBES" state-dir-writable "$parent/child"
  chmod u+w "$parent"

  [ "$status" -eq 1 ]
  [[ "$output" == *"chmod u+w"* ]] || [[ "$output" == *"MINSKY_HOME"* ]]
}

@test "(d) unknown probe lists state-dir-writable among valid probes" {
  run bash "$PROBES" no-such-probe
  [ "$status" -eq 2 ]
  [[ "$output" == *"state-dir-writable"* ]]
}

# --- (d) doctor row wiring -------------------------------------------------

@test "(d) minsky doctor emits a state-dir row" {
  # Point the state dir at a known-writable tmp path so the row is PASS
  # regardless of the host's ~/.minsky state. Non-quiet so the PASS line
  # is visible (--quiet suppresses PASS lines by design).
  run env MINSKY_STATE_DIR="$TMPDIR_TEST/doctor-state" "$MINSKY_BIN" doctor
  # Exit code depends on the host's critical deps; pin only that the row
  # appears (state-dir is OPTIONAL/WARN-only, never crit-fails the machine).
  [[ "$output" == *"state-dir"* ]]
}
