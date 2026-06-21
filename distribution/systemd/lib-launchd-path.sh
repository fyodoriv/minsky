# shellcheck shell=bash
# launchd inherits BASH_ENV/ENV from the GUI session; sandbox-exec profiles
# (com.minsky.tick-loop.sb) deny ~/.config/dotfiles — unset before any bash
# child or nested source, same as with-endpoint-path.sh.
unset BASH_ENV ENV
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
# dotfiles endpoint-security shims (jq, python3, curl, grep) — leftmost so
# launchd loops never hit /usr/bin/{jq,python3} or bare unsigned uv python
# (CyberArk EPM / tool-shim-public / Publisher: N/A). Do NOT test-execute
# ~/.local/share/uv/python/*/bin/python3.13 here — post-reboot unsigned uv
# binaries trigger EPM before com.dotfiles.adhoc-sign-uv-pythons completes.
for _dotfiles_bin in "${HOME}/apps/tooling/dotfiles/bin" "${HOME}/apps/dotfiles/bin"; do
  if [ -d "${_dotfiles_bin}" ]; then
    PATH="${_dotfiles_bin}:${PATH}"
    break
  fi
done
# Homebrew bin after dotfiles shims (shims stay leftmost; may exec brew).
for _brew_bin in /usr/local/bin /opt/homebrew/bin; do
  [ -d "${_brew_bin}" ] && PATH="${_brew_bin}:${PATH}"
done
if [ -d "${HOME}/.local/bin" ]; then
  PATH="${HOME}/.local/bin:${PATH}"
fi

# Wait for login endpoint-bootstrap (closes post-reboot jq/python shim race).
_endpoint_ready="${HOME}/.local/state/dotfiles/endpoint-ready"
_wait=0
while [ ! -f "${_endpoint_ready}" ] && [ "${_wait}" -lt 120 ]; do
  sleep 1
  _wait=$((_wait + 1))
done
if [ -f "${_endpoint_ready}" ]; then
  export MINSKY_ENDPOINT_READY=1
else
  export MINSKY_ENDPOINT_READY=0
fi

# EPM-safe jq for supervised loops — never bare /usr/bin/jq.
# Inline resolution only: tick-loop's sandbox profile allows dotfiles/bin
# but denies dotfiles/lib, so do not source dotfiles-endpoint-paths.sh here.
_minsky_jq_candidate_usable() {
  local candidate="$1" target=""
  [ -n "$candidate" ] || return 1
  [ -e "$candidate" ] || return 1
  [ -x "$candidate" ] || return 1
  if [ -L "$candidate" ]; then
    target="$(readlink "$candidate" 2>/dev/null || true)"
    [ -n "$target" ] || return 1
    case "$target" in
      /*) ;;
      *) target="$(cd "$(dirname "$candidate")" 2>/dev/null && pwd -P)/$target" ;;
    esac
    [ -x "$target" ] || return 1
  fi
  return 0
}
if [ -z "${MINSKY_JQ:-}" ]; then
  for _jq_candidate in \
    "${HOME}/apps/tooling/dotfiles/bin/jq" \
    "${HOME}/apps/dotfiles/bin/jq" \
    "${HOME}/.local/bin/jq" \
    /opt/homebrew/bin/jq /usr/local/bin/jq; do
    if _minsky_jq_candidate_usable "${_jq_candidate}"; then
      export MINSKY_JQ="${_jq_candidate}"
      break
    fi
  done
fi
unset -f _minsky_jq_candidate_usable
export PATH
unset _minsky_node_path_extras _fnm_dir _nvm_dir _asdf_dir _brew_prefix _claude_dir _gh_dir _opencode_dir _dotfiles_bin _brew_bin _endpoint_ready _wait _jq_candidate
