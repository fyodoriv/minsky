#!/usr/bin/env bash
#
# .claude/hooks/block-vision-md-edit.sh — PreToolUse Write|Edit|MultiEdit
# hook per `det-vision-md-protected-from-non-mape-k-edits` (PR #911 cohort).
#
# vision.md is the constitution. Edits should happen as part of a
# MAPE-K (Monitor-Analyse-Plan-Execute-Knowledge) feedback loop with
# operator awareness, NOT as a casual agent edit in the middle of a
# feature PR. This hook enforces that operator-awareness by requiring
# an explicit unlock signal:
#
#   (1) an env var `MINSKY_VISION_EDIT_REASON=<reason ≥3 chars>` for
#       the session, OR
#   (2) a marker file `~/.minsky/vision-edit-token` (operator-created), OR
#   (3) the operator's commit-staging mode: `git diff --cached --name-only`
#       already includes vision.md (operator already approved this edit
#       in a prior turn).
#
# If none of those are present, exit 2 and tell the agent how to unlock.
#
# Source: vision rule #10 (constitution protection); AGENTS.md §"What this
# file is not" → vision.md (the constitution). The MAPE-K name is from
# Kephart & Chess 2003, "The Vision of Autonomic Computing" (IBM RC22781).

set -eu

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null || echo "")
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire on vision.md (case-sensitive — the cardinal filename).
case "$FILE_PATH" in
  */vision.md | vision.md) ;;
  *) exit 0 ;;
esac

# Unlock signal #1: env var with a real reason.
REASON_VAR="${MINSKY_VISION_EDIT_REASON:-}"
if [ -n "$REASON_VAR" ] && [ ${#REASON_VAR} -ge 3 ]; then
  exit 0
fi

# Unlock signal #2: operator-created token file.
TOKEN_FILE="${MINSKY_HOME:-$HOME/.minsky}/vision-edit-token"
if [ -f "$TOKEN_FILE" ]; then
  exit 0
fi

# Unlock signal #3: vision.md already in the staged set (operator
# approved this turn).
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" 2>/dev/null || true
if git diff --cached --name-only 2>/dev/null | grep -qx "vision.md"; then
  exit 0
fi

# No unlock — block.
cat >&2 <<EOF

block-vision-md-edit hook: BLOCKED Edit to vision.md

vision.md is the constitution — the 18 non-negotiable rules every PR
must honour. Edits should be part of an explicit operator-aware MAPE-K
feedback-loop turn, not a casual agent edit.

To unlock this Edit:
  (a) Operator: \`export MINSKY_VISION_EDIT_REASON="<reason for this edit>"\`
      in the agent's session (≥3-char reason required).
  (b) Operator: \`touch ~/.minsky/vision-edit-token\` to grant a session
      unlock (delete the file when done).
  (c) Operator: \`git add vision.md\` in a prior turn (already-approved
      diff carries through subsequent Edits in the same session).

If you are the agent and you think vision.md needs to change, propose
the change in your turn's text instead — let the operator decide
whether to unlock.
EOF
exit 2
