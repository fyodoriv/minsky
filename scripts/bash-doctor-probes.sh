#!/usr/bin/env bash
# scripts/bash-doctor-probes.sh — helper for `minsky bash-doctor`.
# <!-- scope: human-approved operator-requested observability tooling for 10K-LOC mode pre-flight (2026-05-25); helper for bin/minsky bash-doctor (rule against python3 -c in bin/minsky) -->
#
# Why this exists: `bin/minsky` has a hard rule (enforced by the
# `bin/minsky uses portable shell helpers, not python3` test in
# test/integration/m1-red-green.test.ts) that forbids `python3 -c`
# in bin/minsky itself. The reason: corporate Python wrappers can
# take 30+ seconds to bootstrap a uv cache on a fresh HOME, which
# would dominate the runtime of every `minsky` invocation.
#
# The Path A bash-doctor pre-flight legitimately needs to probe
# python3 (version, SDK importability). So we route those probes
# through this helper — paid only when bash-doctor runs, not on
# every `minsky` invocation.
#
# Probes:
#   python-version       → prints "X.Y" (e.g. "3.13"); exit 0 if ≥3.10, else 1
#   openhands-sdk        → exit 0 if resolved python can `import openhands`, prints version
#   openhands-cli        → exit 0 if `openhands` is on PATH, prints version
#   syntax <path>        → exit 0 if python3 -m py_compile <path> succeeds
#   state-dir-writable [dir] → exit 0 if the minsky state dir is writable
#                          (creating it if needed); prints the resolved path.
#                          Defaults to ${MINSKY_HOME:-${MINSKY_STATE_DIR:-$HOME/.minsky}}.
#                          Surfaces the minsky-runtime-resilience failure
#                          mode (unwritable state dir) as a doctor row
#                          BEFORE an iteration aborts on it at runtime.
#
# Source: 2026-05-25 retro — observability arc slice 1; rule #2
# (Strategy seam — python3 probing is the dependency, this helper
# is the boundary).

set -euo pipefail

PROBE="${1:-}"
ARG="${2:-}"

resolve_openhands_python() {
  if [ -n "${MINSKY_OPENHANDS_PYTHON:-}" ] && [ -x "$MINSKY_OPENHANDS_PYTHON" ]; then
    echo "$MINSKY_OPENHANDS_PYTHON"
    return 0
  fi
  venv_py="$HOME/.minsky/openhands-venv/bin/python"
  if [ -x "$venv_py" ]; then
    echo "$venv_py"
    return 0
  fi
  command -v python3 >/dev/null 2>&1 || return 1
  command -v python3
}

case "$PROBE" in
  python-version)
    if ! command -v python3 >/dev/null 2>&1; then
      exit 1
    fi
    if ! ver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null); then
      exit 1
    fi
    echo "$ver"
    major=$(echo "$ver" | cut -d. -f1)
    minor=$(echo "$ver" | cut -d. -f2)
    if [ "$major" -ge 3 ] 2>/dev/null && [ "$minor" -ge 10 ] 2>/dev/null; then
      exit 0
    else
      exit 1
    fi
    ;;
  openhands-sdk)
    if ! py=$(resolve_openhands_python); then
      exit 1
    fi
    if "$py" -c "import openhands" 2>/dev/null; then
      ver=$("$py" -c "import openhands; print(getattr(openhands, '__version__', 'unknown'))" 2>/dev/null || echo "unknown")
      echo "$ver"
      exit 0
    fi
    exit 1
    ;;
  openhands-cli)
    if ! command -v openhands >/dev/null 2>&1; then
      exit 1
    fi
    openhands --version 2>/dev/null | head -1 || echo "(version unavailable)"
    exit 0
    ;;
  syntax)
    if [ -z "$ARG" ]; then
      echo "bash-doctor-probes: 'syntax' requires a path arg" >&2
      exit 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
      exit 1
    fi
    python3 -m py_compile "$ARG" 2>/dev/null
    ;;
  state-dir-writable)
    # minsky-runtime-resilience: surface an unwritable state dir as a
    # doctor row, BEFORE an iteration aborts on the experiment-store
    # mkdir at runtime. Resolves the same dir the runner uses, tries to
    # create it (mkdir -p is idempotent for an existing dir), and checks
    # the -w bit. Pure read-after-create probe; the dir is the operator's
    # own state dir, so creating it is benign (matches what the first
    # `minsky` run does anyway). Anchor: SRE 2016 Ch. 6 — detect a
    # degraded-resource condition before it surfaces as a runtime failure.
    state_dir="${ARG:-${MINSKY_HOME:-${MINSKY_STATE_DIR:-$HOME/.minsky}}}"
    if ! mkdir -p "$state_dir" 2>/dev/null; then
      echo "$state_dir (cannot create — chmod u+w the parent, or set MINSKY_HOME=<writable>)"
      exit 1
    fi
    if [ ! -w "$state_dir" ]; then
      echo "$state_dir (not writable — chmod u+w it, or set MINSKY_HOME=<writable>)"
      exit 1
    fi
    echo "$state_dir"
    exit 0
    ;;
  *)
    echo "bash-doctor-probes: unknown probe '$PROBE'" >&2
    echo "valid: python-version, openhands-sdk, openhands-cli, syntax, state-dir-writable" >&2
    exit 2
    ;;
esac
