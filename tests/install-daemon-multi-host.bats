#!/usr/bin/env bats
# tests/install-daemon-multi-host.bats — paired tests for the multi-host
# launchd plist codegen + the `doctor` multi-host coverage check.
#
# Pins TASKS.md minsky-daemon-plist-multi-host: the auto-generated plist
# must walk EVERY bootstrapped host (`.minsky/repo.yaml`) under the parent
# of default_host via `--hosts-dir` whenever ≥2 such hosts exist, so a
# second bootstrapped sibling (agentbrew alongside minsky) is never
# silently skipped. Single-host operators (0/1 sibling, or MINSKY_MULTI_HOST=0)
# keep the explicit `--host` form. `doctor` warns when a live single-host
# plist coexists with ≥2 bootstrapped hosts.
#
# `--print` writes the plist but skips the launchctl reload, so these
# tests never touch the real running daemon.
#
# Run: bats tests/install-daemon-multi-host.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_BIN="$REPO_ROOT/bin/minsky"
  TMPDIR_TEST="$(mktemp -d -t minsky-mh-test.XXXXXX)"
  PARENT="$TMPDIR_TEST/apps"
  FAKE_HOME="$TMPDIR_TEST/home"
  PLIST="$FAKE_HOME/Library/LaunchAgents/com.minsky.daemon.plist"
  mkdir -p "$FAKE_HOME/.minsky"
  # Two bootstrapped hosts under PARENT (each: .git + .minsky/repo.yaml).
  _bootstrap_host "minsky"
  _bootstrap_host "agentbrew"
  printf '{\n  "default_host": "%s"\n}\n' "$PARENT/minsky" > "$FAKE_HOME/.minsky/config.json"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

_bootstrap_host() {
  local name="$1"
  mkdir -p "$PARENT/$name/.git" "$PARENT/$name/.minsky"
  echo "repo: $name" > "$PARENT/$name/.minsky/repo.yaml"
}

_install() {
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" \
    run "$MINSKY_BIN" install-daemon --print "$@"
}

_program_args() {
  sed -n '/ProgramArguments/,/\/array>/p' "$PLIST"
}

# --- codegen: bash runner (default path) -----------------------------------

@test "install-daemon: 2 bootstrapped hosts → plist uses --hosts-dir <parent>" {
  _install
  [ "$status" -eq 0 ]
  [ -f "$PLIST" ]
  run _program_args
  [[ "$output" == *"--hosts-dir"* ]]
  [[ "$output" == *"$PARENT"* ]]
  # Must NOT pin a single host via --host when walking all hosts.
  [[ "$output" != *"<string>--host</string>"* ]]
}

@test "install-daemon: MINSKY_MULTI_HOST=0 forces single-host --host even with 2 hosts" {
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" MINSKY_MULTI_HOST=0 \
    run "$MINSKY_BIN" install-daemon --print
  [ "$status" -eq 0 ]
  run _program_args
  [[ "$output" == *"<string>--host</string>"* ]]
  [[ "$output" == *"$PARENT/minsky"* ]]
  [[ "$output" != *"--hosts-dir"* ]]
}

@test "install-daemon: single bootstrapped host → bash path still scans the parent (--hosts-dir)" {
  # The bash runner always walks via --hosts-dir <parent>; with one host
  # the walker simply round-robins over a single repo. The single-host
  # narrowing applies to the Node path (next test) and the MINSKY_MULTI_HOST=0
  # escape hatch (above) — not to the default bash scan.
  rm -rf "$PARENT/agentbrew"
  _install
  [ "$status" -eq 0 ]
  run _program_args
  [[ "$output" == *"--hosts-dir"* ]]
}

# --- codegen: node runner path (the original bug) --------------------------

_stage_node_repo() {
  # Stage a fake repo whose node runner exists so the Node path is taken.
  NODE_REPO="$TMPDIR_TEST/fake-repo"
  mkdir -p "$NODE_REPO/bin" "$NODE_REPO/novel/cross-repo-runner/bin"
  cp "$MINSKY_BIN" "$NODE_REPO/bin/minsky"
  cp "$REPO_ROOT/bin/minsky-run.sh" "$NODE_REPO/bin/minsky-run.sh"
  echo '// fake node runner' > "$NODE_REPO/novel/cross-repo-runner/bin/minsky-run.mjs"
}

@test "install-daemon: node-runner path emits --hosts-dir for 2 hosts (the original bug fix)" {
  _stage_node_repo
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" MINSKY_INSTALL_DAEMON_NODE=1 \
    run "$NODE_REPO/bin/minsky" install-daemon --print
  [ "$status" -eq 0 ]
  run _program_args
  [[ "$output" == *"--hosts-dir"* ]]
  [[ "$output" == *"--loop"* ]]
  [[ "$output" != *"<string>--host</string>"* ]]
}

@test "install-daemon: node-runner path keeps explicit --host for a single bootstrapped host" {
  rm -rf "$PARENT/agentbrew"
  _stage_node_repo
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" MINSKY_INSTALL_DAEMON_NODE=1 \
    run "$NODE_REPO/bin/minsky" install-daemon --print
  [ "$status" -eq 0 ]
  run _program_args
  [[ "$output" == *"<string>--host</string>"* ]]
  [[ "$output" != *"--hosts-dir"* ]]
}

# --- dry-run contract ------------------------------------------------------

@test "install-daemon --print: writes plist + reports dry-run, no launchctl reload" {
  _install
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run"* ]]
  [[ "$output" == *"launchctl reload skipped"* ]]
  [ -f "$PLIST" ]
}

# --- doctor: multi-host coverage check -------------------------------------

@test "doctor: single-host plist + 2 bootstrapped hosts → WARN multi-host" {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<plist><dict><key>ProgramArguments</key><array>
<string>/bin/bash</string><string>/x/minsky-run.sh</string><string>--host</string><string>$PARENT/minsky</string>
</array></dict></plist>
EOF
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" run "$MINSKY_BIN" doctor
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"multi-host"* ]]
  [[ "$output" == *"minsky install-daemon"* ]]
}

@test "doctor: multi-host plist (--hosts-dir) + 2 hosts → PASS multi-host" {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<plist><dict><key>ProgramArguments</key><array>
<string>/bin/bash</string><string>/x/minsky-run.sh</string><string>--hosts-dir</string><string>$PARENT</string>
</array></dict></plist>
EOF
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" run "$MINSKY_BIN" doctor
  [[ "$output" == *"multi-host"* ]]
  [[ "$output" != *"WARN  multi-host"* ]]
}

@test "doctor: only one bootstrapped host → no multi-host warning" {
  rm -rf "$PARENT/agentbrew"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<plist><dict><key>ProgramArguments</key><array>
<string>/bin/bash</string><string>/x/minsky-run.sh</string><string>--host</string><string>$PARENT/minsky</string>
</array></dict></plist>
EOF
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" run "$MINSKY_BIN" doctor
  [[ "$output" != *"multi-host"* ]]
}

@test "doctor: read-only — multi-host check never mutates the plist" {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<plist><dict><key>ProgramArguments</key><array>
<string>/bin/bash</string><string>/x/minsky-run.sh</string><string>--host</string><string>$PARENT/minsky</string>
</array></dict></plist>
EOF
  local before
  before="$(cat "$PLIST")"
  HOME="$FAKE_HOME" MINSKY_STATE_DIR="$FAKE_HOME/.minsky" run "$MINSKY_BIN" doctor
  [ "$(cat "$PLIST")" = "$before" ]
}
