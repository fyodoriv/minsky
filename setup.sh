#!/usr/bin/env bash
# Minsky bootstrap — v0
# This script does what shell can do. The full bootstrap (per ARCHITECTURE.md
# § "Bootstrap") is tracked as P1 task `supervisor-setup` in TASKS.md.

set -euo pipefail

cd "$(dirname "$0")"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
dim()  { printf "\033[2m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$*"; }

bold "Minsky setup — v0"
echo

# --- Prerequisites check ---
bold "Checking prerequisites…"
command -v git >/dev/null  || { warn "git not found — install before continuing"; exit 1; }
command -v node >/dev/null || warn "node not found — install Node.js to use tasks.md CLI"
command -v npx >/dev/null  || warn "npx not found — install Node.js to use tasks.md CLI"
command -v claude >/dev/null || warn "claude (Claude Code CLI) not found — install it: https://docs.claude.com/en/docs/claude-code/overview"
ok "prerequisite scan done"
echo

# --- Git init ---
bold "Initializing git…"
if [ ! -d .git ]; then
  git init -q
  ok "git initialized"
else
  ok "git already initialized"
fi
echo

# --- tasks.md /next-task command ---
bold "Installing /next-task command for Claude Code…"
if command -v npx >/dev/null 2>&1; then
  npx -y @tasks-md/cli install || warn "tasks.md install failed — run manually later: npx @tasks-md/cli install"
  ok "/next-task installed"
else
  warn "skipped — install Node.js, then run: npx @tasks-md/cli install"
fi
echo

# --- Next steps ---
bold "Next steps (run inside Claude Code from this directory):"
cat <<'EOF'

  1. Install OMC (Oh My Claude Code):
     /plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
     /plugin install oh-my-claudecode
     /omc-setup

  2. Install official ralph-wiggum plugin (Anthropic):
     /plugin install ralph-wiggum

  3. Read AGENTS.md, then start working through TASKS.md:
     /next-task

EOF

dim "Full bootstrap (Tailscale, ntfy, OTEL, supervisor units) is tracked as P1 in TASKS.md."
