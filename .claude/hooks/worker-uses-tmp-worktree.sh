#!/usr/bin/env bash
#
# .claude/hooks/worker-uses-tmp-worktree.sh — PreToolUse Write|Edit|
# MultiEdit hook per `det-worker-uses-tmp-worktree-not-main-checkout`
# (PR #911 cohort).
#
# Per AGENTS.md §"Pipeline-managed repos — dedicated worktree pattern":
#
#   The minsky supervisor launchd, parallel Devin sessions, and the
#   daemon itself git checkout the main repo dir at unpredictable times
#   and wipe your uncommitted edits. Worker agents MUST use a dedicated
#   worktree under /tmp/minsky-<task-id> instead.
#
# This hook detects when a Write|Edit|MultiEdit happens inside the
# MAIN checkout (resolved via `CLAUDE_PROJECT_DIR`) AND the session is
# tagged as a worker session (env var `MINSKY_WORKER_SESSION=1` set by
# the daemon, or the working-dir matches the main checkout AND the
# operator hasn't explicitly set `MINSKY_OPERATOR_SESSION=1`).
#
# Unlock signals:
#   (a) `MINSKY_OPERATOR_SESSION=1` env var — operator is driving
#   (b) `CLAUDE_PROJECT_DIR` is `/tmp/minsky-*` or `/private/tmp/minsky-*`
#       (i.e. we ARE in a worktree, hook passes trivially)
#   (c) `MINSKY_WORKER_SESSION=0` (operator override)

set -eu

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

# Pass trivially if operator session.
if [ "${MINSKY_OPERATOR_SESSION:-0}" = "1" ]; then
  exit 0
fi
if [ "${MINSKY_WORKER_SESSION:-}" = "0" ]; then
  exit 0
fi

# Resolve project dir. If it's already a /tmp/ worktree, pass.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$PROJECT_DIR" in
  /tmp/minsky-* | /private/tmp/minsky-* | /var/folders/*/T/minsky-*)
    exit 0
    ;;
esac

# If MINSKY_WORKER_SESSION isn't set, the daemon didn't tag this as a
# worker session — pass (operator default).
if [ "${MINSKY_WORKER_SESSION:-}" != "1" ]; then
  exit 0
fi

# Worker session in main checkout — block.
cat >&2 <<EOF

worker-uses-tmp-worktree hook: BLOCKED Write/Edit in main checkout

The session is tagged MINSKY_WORKER_SESSION=1 but CLAUDE_PROJECT_DIR is
$PROJECT_DIR — that's the main checkout. Per AGENTS.md §"Pipeline-managed
repos — dedicated worktree pattern", the minsky supervisor will checkout
the main repo dir at unpredictable times and wipe uncommitted edits.

Move to a worktree:
  git worktree add /tmp/minsky-<task-id> -b <branch-name> origin/main
  cd /tmp/minsky-<task-id>

If you ARE the operator running interactively (not a daemon worker),
set MINSKY_OPERATOR_SESSION=1 in your shell to silence this hook.
EOF
exit 2
