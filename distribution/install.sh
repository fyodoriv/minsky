#!/usr/bin/env bash
# <!-- scope: human-approved minsky-init-one-command-bootstrap § Pivot — the curl-pipe-sh fallback install path; composes bin/minsky-init, no novel logic -->
# distribution/install.sh — the curl-pipe-sh bootstrap for minsky.
#
# Why this file exists: not every operator has the minsky repo checked
# out. The Pivot of the one-command-bootstrap work is a one-line install
# for that audience:
#
#     curl -fsSL https://raw.githubusercontent.com/fyodoriv/minsky/main/distribution/install.sh | sh
#
# This script is the body that one-liner runs. It locates (or clones) the
# minsky repo, then hands off to `bin/minsky-init`, which does the actual
# bootstrap (toolchain check + pnpm install + per-machine config + doctor).
# It deliberately re-implements nothing — it is the network-fetch shim in
# front of the in-repo entry point (rule #1 — don't reinvent).
#
# Safety (rule #6 stay-alive + the no-sudo / no-rc-mutation discipline):
#   - no `sudo`; clones into a user-writable dir only.
#   - no shell-rc mutation.
#   - the only network action is `git clone` of the pinned repo; the
#     operator can audit this script before piping it to sh.
#   - idempotent: a second run reuses the existing clone (git pull --ff
#     only; never a destructive reset).
#
# Usage:
#   curl -fsSL <raw-url>/distribution/install.sh | sh
#   curl -fsSL <raw-url>/distribution/install.sh | sh -s -- <repo-dir>
#   distribution/install.sh [<repo-dir>]   # also runnable from a checkout
#
# Env:
#   MINSKY_REPO_URL  — override the clone URL (default: the public repo).
#   MINSKY_HOME      — where to clone minsky (default: ~/.minsky-src).
#   MINSKY_INIT_TARGET — the host repo to bootstrap (default: $PWD, or the
#                        first positional arg).
#
# Exit codes mirror bin/minsky-init (0 ok / 1 doctor-red / 2 bad-args-or-
# not-a-repo / 3 toolchain-unmet), plus:
#   4  — git is not installed (can't clone).
#   5  — clone failed (network / auth).
#
# Anchor: rule #1 (npm + git are the universal Node/source distribution
# channels — don't build a bespoke installer); Krug *Don't Make Me Think*
# 2014 (one obvious path).

set -eu

MINSKY_REPO_URL="${MINSKY_REPO_URL:-https://github.com/fyodoriv/minsky.git}"
MINSKY_HOME="${MINSKY_HOME:-$HOME/.minsky-src}"

# Host repo to bootstrap: explicit env wins, then first positional arg,
# then the current working directory.
TARGET="${MINSKY_INIT_TARGET:-${1:-$(pwd)}}"

say()  { printf '%s\n' "$*"; }
oops() { printf '%s\n' "$*" >&2; }

say "minsky install — locating the minsky repo"

# --- find an existing checkout, or clone one --------------------------
# Case 1: we're already running from inside a minsky checkout (the file
# is committed at distribution/install.sh) — use that repo directly.
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
REPO_ROOT=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../bin/minsky-init" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  say "  using local checkout: $REPO_ROOT"
fi

# Case 2: piped via curl (no local checkout) — clone into MINSKY_HOME.
if [ -z "$REPO_ROOT" ]; then
  if ! command -v git >/dev/null 2>&1; then
    oops "minsky install: git is required to clone the repo, but it's not on PATH."
    oops "  install git, then re-run."
    exit 4
  fi
  if [ -d "$MINSKY_HOME/.git" ]; then
    say "  reusing existing clone at $MINSKY_HOME (ff-only pull)"
    # Fast-forward only — never a destructive reset (rule #6 / no data loss).
    git -C "$MINSKY_HOME" pull --ff-only >/dev/null 2>&1 || \
      say "  (pull skipped — offline or diverged; using the checked-out tree)"
    REPO_ROOT="$MINSKY_HOME"
  else
    say "  cloning $MINSKY_REPO_URL → $MINSKY_HOME"
    if git clone --depth 1 "$MINSKY_REPO_URL" "$MINSKY_HOME" >/dev/null 2>&1; then
      REPO_ROOT="$MINSKY_HOME"
    else
      oops "minsky install: git clone failed ($MINSKY_REPO_URL)."
      oops "  check your network / credentials, or set MINSKY_REPO_URL to a reachable mirror."
      exit 5
    fi
  fi
fi

INIT="$REPO_ROOT/bin/minsky-init"
if [ ! -x "$INIT" ]; then
  oops "minsky install: bin/minsky-init not found or not executable at $INIT"
  oops "  the checkout looks incomplete; remove $MINSKY_HOME and re-run."
  exit 1
fi

# --- hand off to the in-repo one-command bootstrap --------------------
say "minsky install — bootstrapping $TARGET"
exec "$INIT" "$TARGET"
