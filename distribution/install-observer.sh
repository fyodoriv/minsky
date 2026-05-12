#!/bin/bash
# <!-- pattern: not-applicable — idempotent symlink installer; the observer plugin itself is covered by the EXPERIMENT.yaml anchor section + README § "Observer layer"; this script is pure operator-side wiring (Perrow 1984 observer-as-safety-layer is the architectural anchor, applied via the skill + shim, not this installer). -->
# install-observer.sh — Wire the Minsky observer plugin into the
# operator's agent ecosystem (PATH shim + slash commands + skill).
#
# Pattern: idempotent setup script (Beyer SRE 2016 §"Idempotency" —
#   re-running the installer must produce the same state, never
#   duplicate-install or break existing wiring).
# Source: minsky-observer-plugin-via-agentbrew task block in TASKS.md.
# Conformance: full — no business logic, only wiring.
#
# Usage:
#   ~/apps/tooling/minsky/distribution/install-observer.sh
#
# What it does:
#   1. Symlinks `$REPO/bin/minsky` into `$HOME/.local/bin/minsky` (or
#      `$HOME/bin/minsky`, whichever exists on PATH).
#   2. Copies slash commands into `$HOME/.config/agentbrew/commands/`
#      (creates the dir if missing). Agentbrew then syncs them to each
#      agent's commandsDir on the next `agentbrew sync`.
#   3. Reminds the operator to run `agentbrew sync --agentfile
#      $REPO/Agentfile.yaml` to deploy the `minsky` skill.
#
# Failure modes (rule #7):
#   - No writable PATH dir: loud-crash with a hint to create ~/.local/bin.
#   - agentbrew not installed: warning (not an error) + manual
#     fallback instructions. The PATH shim still works.
#   - Re-run on an already-installed host: every step verifies before
#     mutating; zero changes if already wired.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTBREW_COMMANDS="$HOME/.config/agentbrew/commands"

# ── Pick a PATH-accessible bin dir for the shim ────────────────
pick_bin_dir() {
  # Prefer ~/.local/bin (XDG convention) if it exists on PATH.
  # Fall back to ~/bin if that's on PATH. Otherwise fail loudly.
  if echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin" && [ -d "$HOME/.local/bin" ]; then
    echo "$HOME/.local/bin"
    return 0
  fi
  if echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/bin" && [ -d "$HOME/bin" ]; then
    echo "$HOME/bin"
    return 0
  fi
  return 1
}

install_bin_shim() {
  local bin_dir
  if ! bin_dir="$(pick_bin_dir)"; then
    echo "install-observer: no writable PATH dir found." >&2
    echo "  Create \$HOME/.local/bin and add it to PATH, then re-run:" >&2
    echo "    mkdir -p \$HOME/.local/bin" >&2
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> \$HOME/.zshrc" >&2
    echo "    source \$HOME/.zshrc" >&2
    return 1
  fi
  local target="$bin_dir/minsky"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$REPO_DIR/bin/minsky" ]; then
    echo "  ✓ $target already symlinked to $REPO_DIR/bin/minsky (no-op)"
    return 0
  fi
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "  ⚠ $target exists and is not a symlink; backing up to $target.backup.$(date +%s)"
    mv "$target" "$target.backup.$(date +%s)"
  fi
  ln -sf "$REPO_DIR/bin/minsky" "$target"
  echo "  ✓ $target → $REPO_DIR/bin/minsky"
}

install_slash_commands() {
  mkdir -p "$AGENTBREW_COMMANDS"
  local changed=0
  for cmd in minsky minsky-status minsky-stop; do
    local src="$REPO_DIR/commands/$cmd.md"
    local dst="$AGENTBREW_COMMANDS/$cmd.md"
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
      echo "  ✓ $dst already symlinked (no-op)"
      continue
    fi
    if [ -e "$dst" ] && [ ! -L "$dst" ]; then
      echo "  ⚠ $dst exists and is not a symlink; backing up"
      mv "$dst" "$dst.backup.$(date +%s)"
    fi
    ln -sf "$src" "$dst"
    echo "  ✓ $dst → $src"
    changed=1
  done
  return $changed
}

echo "Installing Minsky observer plugin from: $REPO_DIR"
echo ""
echo "[1/3] PATH shim (bin/minsky)"
install_bin_shim

echo ""
echo "[2/3] Slash commands (commands/)"
install_slash_commands || true   # non-zero on "at least one file changed"

echo ""
echo "[3/3] Skill (skill-plugins/observer)"
if command -v agentbrew >/dev/null 2>&1; then
  echo "  Run:"
  echo "    agentbrew sync --agentfile $REPO_DIR/Agentfile.yaml"
  echo "  to deploy the 'minsky' skill to every detected agent's skillsDir."
else
  echo "  ⚠ agentbrew is not on PATH. Install agentbrew first:"
  echo "    npm install -g @cbrwizard/agentbrew"
  echo "  then:"
  echo "    agentbrew sync --agentfile $REPO_DIR/Agentfile.yaml"
fi

echo ""
echo "✓ Done. Try: cd ~/any/repo && minsky --help"
