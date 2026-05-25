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
#   openhands-sdk        → exit 0 if `import openhands` succeeds, prints version
#   openhands-cli        → exit 0 if `openhands` is on PATH, prints version
#   syntax <path>        → exit 0 if python3 -m py_compile <path> succeeds
#
# Source: 2026-05-25 retro — observability arc slice 1; rule #2
# (Strategy seam — python3 probing is the dependency, this helper
# is the boundary).

set -euo pipefail

PROBE="${1:-}"
ARG="${2:-}"

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
    if ! command -v python3 >/dev/null 2>&1; then
      exit 1
    fi
    if python3 -c "import openhands" 2>/dev/null; then
      ver=$(python3 -c "import openhands; print(getattr(openhands, '__version__', 'unknown'))" 2>/dev/null || echo "unknown")
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
  *)
    echo "bash-doctor-probes: unknown probe '$PROBE'" >&2
    echo "valid: python-version, openhands-sdk, openhands-cli, syntax" >&2
    exit 2
    ;;
esac
