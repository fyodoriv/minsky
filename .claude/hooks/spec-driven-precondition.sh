#!/usr/bin/env bash
#
# .claude/hooks/spec-driven-precondition.sh — PreToolUse Write|Edit|
# MultiEdit hook per `det-spec-driven-development-precondition-on-large-
# edits` (PR #911 cohort).
#
# Per `.claude/skills/spec-driven-development/SKILL.md` and AGENTS.md §3
# (acceptance-scenario gate): before writing a NEW `novel/**/src/**/*.ts`
# file, a Given/When/Then spec must exist in `.minsky/specs/<task-id>.md`
# OR `user-stories/<id>.md`. Otherwise the test ends up orphaned — it can
# pass for the wrong reason and can't be falsified against original intent.
#
# This hook enforces the precondition: refuse to Write to a NEW file in
# `novel/**/src/` unless EITHER:
#   (a) a `.minsky/specs/*.md` was modified in the last 1h (operator just
#       wrote the spec), OR
#   (b) a `user-stories/*.md` was modified in the last 1h, OR
#   (c) the file's tool_input.content contains a heading-comment naming
#       the spec file (e.g. `// Spec: .minsky/specs/foo.md`), OR
#   (d) env var `MINSKY_SKIP_SPEC_PRECONDITION=<reason ≥3 chars>` is set.
#
# Per rule #3a (acceptance-scenario gate): a test without a traceable
# GWT scenario is orphaned. The Write target most likely to need a spec
# is a brand-new source file in novel/*/src/.

set -eu

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null || echo "")
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null || echo "")

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire on NEW writes (the `Write` tool, not `Edit` — Edit operates
# on existing files which already have an established spec context).
if [ "$TOOL_NAME" != "Write" ]; then
  exit 0
fi

# Only fire on novel/*/src/ TS files.
case "$FILE_PATH" in
  */novel/*/src/*.ts | */novel/*/src/*.tsx) ;;
  *) exit 0 ;;
esac

# Skip test files — those reference an existing spec via their assertions.
case "$FILE_PATH" in
  *.test.ts | *.spec.ts | *.test.tsx | *.spec.tsx) exit 0 ;;
esac

# Resolve project root.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Unlock #1: env var.
SKIP_REASON="${MINSKY_SKIP_SPEC_PRECONDITION:-}"
if [ -n "$SKIP_REASON" ] && [ ${#SKIP_REASON} -ge 3 ]; then
  exit 0
fi

# Unlock #2: a spec or user-story was modified recently.
# Use `find -newermt` (BSD/GNU compatible) to check last 1h.
if [ -d "$PROJECT_DIR/.minsky/specs" ]; then
  RECENT=$(/usr/bin/find "$PROJECT_DIR/.minsky/specs" -type f -name "*.md" -mmin -60 2>/dev/null | head -1)
  if [ -n "$RECENT" ]; then
    exit 0
  fi
fi
if [ -d "$PROJECT_DIR/user-stories" ]; then
  RECENT=$(/usr/bin/find "$PROJECT_DIR/user-stories" -type f -name "*.md" -mmin -60 2>/dev/null | head -1)
  if [ -n "$RECENT" ]; then
    exit 0
  fi
fi

# Unlock #3: the file's content references a spec.
if echo "$NEW_CONTENT" | head -10 | grep -qE '(?:Spec|spec|GWT|Given/When/Then):\s+\.?\/?(\.minsky/specs/|user-stories/)[a-zA-Z0-9_-]+\.md'; then
  exit 0
fi

cat >&2 <<EOF

spec-driven-precondition hook: BLOCKED new Write to $FILE_PATH

Per .claude/skills/spec-driven-development/SKILL.md + AGENTS.md §3
(acceptance-scenario gate), every NEW novel/*/src/ file must have an
associated Given/When/Then spec in either:
  - .minsky/specs/<task-id>.md, OR
  - user-stories/<id>.md

To unlock this Write:
  (a) Author the spec first: \`touch .minsky/specs/<task-id>.md\` and add
      the GWT scenarios (use the /task-spec skill).
  (b) Reference an existing spec in the file's first 10 lines via a
      header comment, e.g. \`// Spec: user-stories/015-local-models.md\`.
  (c) Operator-only unlock: \`export MINSKY_SKIP_SPEC_PRECONDITION="<reason>"\`
      (≥3-char reason; for refactor-only / type-only files).

Without a traceable spec, your tests can't be falsified against original
intent — they pass for the wrong reason and become orphaned.
EOF
exit 2
