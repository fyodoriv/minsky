#!/usr/bin/env bash
# <!-- scope: human-approved TASKS.md tasks reused-worktree-refresh-to-base + restore-timeout-stash-on-reuse (host-run stability cohort, #1293) -->
# worktree-prepare.sh — ready a task worktree before the agent starts.
#
# 1. A clean worktree with no commits of its own moves to origin/<base>, so the
#    agent starts from the current base, not from the base of an earlier
#    iteration (task reused-worktree-refresh-to-base).
# 2. On a watchdog timeout, scripts/spawn_with_watchdog.py stashes the worker's
#    edits as `minsky-timeout-stash`. Pop the newest one for this branch back
#    into the clean worktree, so the next worker continues them (task
#    restore-timeout-stash-on-reuse). The refresh is skipped when the stash and
#    the base changed the same file, so the pop cannot conflict.
#
# Usage: worktree-prepare.sh <host> <worktree> <branch> [<base>]
# Prints one line per action to stderr. Always exits 0: preparing a worktree
# must never block a spawn (rule #6).
set -uo pipefail

host="$1"
worktree="$2"
branch="$3"
base="${4:-main}"

if [[ -n "$(git -C "$worktree" status --porcelain 2>/dev/null)" ]]; then
  exit 0 # busy: the agent's own edits stay as they are
fi

stash_ref="$(git -C "$host" stash list --format='%gd %s' 2>/dev/null |
  awk -v want="On ${branch}: minsky-timeout-stash" 'index($0, want) { print $1; exit }')"

ahead="$(git -C "$worktree" rev-list --count "origin/${base}..HEAD" 2>/dev/null || echo 1)"
if [[ "$ahead" == "0" ]]; then
  overlap=""
  if [[ -n "$stash_ref" ]]; then
    overlap="$(comm -12 \
      <(git -C "$worktree" stash show --name-only --include-untracked "$stash_ref" 2>/dev/null | sort -u) \
      <(git -C "$worktree" diff --name-only HEAD "origin/${base}" 2>/dev/null | sort -u))"
  fi
  before="$(git -C "$worktree" rev-parse HEAD 2>/dev/null)"
  if [[ -z "$overlap" ]] && git -C "$worktree" merge -q --ff-only "origin/${base}" >/dev/null 2>&1 &&
    [[ "$(git -C "$worktree" rev-parse HEAD 2>/dev/null)" != "$before" ]]; then
    echo "worktree-prepare: ${worktree} moved to origin/${base}" >&2
  fi
fi

if [[ -n "$stash_ref" ]]; then
  if git -C "$worktree" stash pop -q "$stash_ref" >/dev/null 2>&1; then
    echo "worktree-prepare: restored ${stash_ref} (minsky-timeout-stash) into ${worktree}" >&2
  else
    echo "worktree-prepare: could not restore ${stash_ref}; it stays in \`git stash list\`" >&2
  fi
fi
exit 0
