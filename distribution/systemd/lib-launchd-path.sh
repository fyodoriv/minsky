# shellcheck shell=bash
# <!-- scope: human-approved task runany-self-restart-bounded-timelimit — rule #1 dedup of the launchd PATH block for the task's supervising wrapper (Touches: distribution/launchd/**); operator 2026-05-16 directive -->
# <!-- pattern: not-applicable — sourced PATH-resolution helper (no process, no pattern surface); the Supervisor restart pattern (Armstrong 2007) is declared at vision.md § "Pattern conformance index" for the supervisor unit-files this helper supports. -->
# `lib-launchd-path.sh` — sourced helper: prepend operator-local node /
# gh / claude / opencode install dirs onto PATH.
#
# launchd (and systemd-user) run with a minimal PATH (often just
# /usr/bin:/bin) that excludes operator-installed node managers (fnm,
# nvm, asdf, Homebrew) and the Claude Code / gh / opencode CLIs. A
# supervised conductor that `exec node`s — or spawns `gh` / `claude`
# inside a tick — then dies with ENOENT and the supervisor respawns it
# in a tight loop at ThrottleInterval cadence. Surfaced live 2026-05-04
# during the post-#158 dogfood restart (see run-tick-loop.sh history).
#
# This is the single source of truth for that resolution (rule #1 —
# compose, don't duplicate). Source it, don't exec it:
#   . "${MINSKY_HOME}/distribution/systemd/lib-launchd-path.sh"
#
# The first match wins; if the binary is already on PATH (operator
# pre-set it in the unit file), the original PATH stays first and this
# is a no-op for resolution. ${HOME} is always set under launchd /
# systemd-user. Pattern: thin runner / process-launcher boundary
# (Martin, *Clean Architecture*, 2017 — I/O at the edge).

# Search strategy: glob fnm + nvm + asdf install dirs (operator-local),
# plus Homebrew (system-installed), plus /usr/local/bin (manual). Highest
# match per manager wins to avoid pinning a stale version.
_minsky_node_path_extras=""
for _fnm_dir in "${HOME}"/.local/share/fnm/node-versions/*/installation/bin; do
  [ -x "${_fnm_dir}/node" ] && _minsky_node_path_extras="${_fnm_dir}:${_minsky_node_path_extras}"
done
for _nvm_dir in "${HOME}"/.nvm/versions/node/*/bin; do
  [ -x "${_nvm_dir}/node" ] && _minsky_node_path_extras="${_nvm_dir}:${_minsky_node_path_extras}"
done
for _asdf_dir in "${HOME}"/.asdf/installs/nodejs/*/bin; do
  [ -x "${_asdf_dir}/node" ] && _minsky_node_path_extras="${_asdf_dir}:${_minsky_node_path_extras}"
done
for _brew_prefix in /opt/homebrew/bin /usr/local/bin; do
  [ -x "${_brew_prefix}/node" ] && _minsky_node_path_extras="${_brew_prefix}:${_minsky_node_path_extras}"
done
PATH="${_minsky_node_path_extras}${PATH:-/usr/bin:/bin}"

# `claude` (headless Claude Code CLI) — installer default is
# ~/.local/bin/claude; also npm-global + Homebrew.
for _claude_dir in "${HOME}"/.local/bin "${HOME}"/.npm-global/bin /opt/homebrew/bin /usr/local/bin; do
  [ -x "${_claude_dir}/claude" ] && PATH="${_claude_dir}:${PATH}" && break
done
# `gh` (GitHub CLI) — used by the merge sweep / collision check.
for _gh_dir in /opt/homebrew/bin /usr/local/bin "${HOME}"/.local/bin; do
  [ -x "${_gh_dir}/gh" ] && PATH="${_gh_dir}:${PATH}" && break
done
# `opencode` (local-LLM spawn target on fallback) — default install is
# ~/.opencode/bin/opencode.
for _opencode_dir in "${HOME}"/.opencode/bin "${HOME}"/.local/bin "${HOME}"/.npm-global/bin /opt/homebrew/bin /usr/local/bin; do
  [ -x "${_opencode_dir}/opencode" ] && PATH="${_opencode_dir}:${PATH}" && break
done
export PATH
unset _minsky_node_path_extras _fnm_dir _nvm_dir _asdf_dir _brew_prefix _claude_dir _gh_dir _opencode_dir
