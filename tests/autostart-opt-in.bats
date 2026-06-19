#!/usr/bin/env bats
# tests/autostart-opt-in.bats — all com.minsky.* LaunchAgents dormant by default.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_BIN="$REPO_ROOT/bin/minsky"
  TMPDIR_TEST="$(mktemp -d -t minsky-autostart.XXXXXX)"
  export HOME="$TMPDIR_TEST/home"
  export MINSKY_STATE_DIR="$HOME/.minsky"
  export MINSKY_HOME="$TMPDIR_TEST/minsky"
  mkdir -p "$HOME/.local/state/dotfiles" "$HOME/Library/LaunchAgents" "$MINSKY_HOME/.minsky" "$MINSKY_STATE_DIR"
  touch "$HOME/.local/state/dotfiles/endpoint-ready"
  # Fake EPM-safe jq for enable-autostart gate.
  mkdir -p "$HOME/apps/tooling/dotfiles/bin"
  printf '#!/bin/sh\nexit 0\n' > "$HOME/apps/tooling/dotfiles/bin/jq"
  chmod +x "$HOME/apps/tooling/dotfiles/bin/jq"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

@test "distribution plists: Disabled=true by default" {
  for f in "$REPO_ROOT"/distribution/launchd/com.minsky.*.plist; do
    run plutil -extract Disabled raw "$f"
    [ "$status" -eq 0 ]
    [ "$output" = "1" ] || [ "$output" = "true" ]
  done
}

@test "disable-autostart: bootouts and sets Disabled on deployed plists" {
  cat > "$HOME/Library/LaunchAgents/com.minsky.watchdog.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.minsky.watchdog</string>
  <key>Disabled</key><false/>
</dict></plist>
EOF
  touch "$MINSKY_STATE_DIR/autostart-enabled"
  run "$MINSKY_BIN" disable-autostart
  [ "$status" -eq 0 ]
  [[ "$output" == *"autostart disabled"* ]]
  run plutil -extract Disabled raw "$HOME/Library/LaunchAgents/com.minsky.watchdog.plist"
  [ "$output" = "1" ] || [ "$output" = "true" ]
  [ ! -f "$MINSKY_STATE_DIR/autostart-enabled" ]
}

@test "disable-autostart: writes the autostart-disabled hard-off sentinel" {
  [ ! -f "$MINSKY_STATE_DIR/autostart-disabled" ]
  run "$MINSKY_BIN" disable-autostart
  [ "$status" -eq 0 ]
  [[ "$output" == *"hard-off"* ]]
  [ -f "$MINSKY_STATE_DIR/autostart-disabled" ]
}

@test "enable-autostart: refuses while hard-off sentinel present" {
  touch "$MINSKY_STATE_DIR/autostart-disabled"
  run "$MINSKY_BIN" enable-autostart
  [ "$status" -ne 0 ]
  [[ "$output" == *"hard-disabled"* ]]
  # The block stays put — refusing must not clear it.
  [ -f "$MINSKY_STATE_DIR/autostart-disabled" ]
}
