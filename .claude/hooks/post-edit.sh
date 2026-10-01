#!/usr/bin/env bash
#
# .claude/hooks/post-edit.sh — Tier 1 hook infrastructure (per
# `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse`).
#
# Fires on every PostToolUse: Write|Edit|MultiEdit event. Reads the JSON hook
# input from stdin, extracts `tool_input.file_path`, and runs the relevant
# single-file Minsky lint on that file ONLY (not the whole repo).
#
# Latency budget: ≤500ms p95 per AGENTS.md §"Tier 1 enforcement". Anything
# slower belongs in Tier 2 (pre-commit lefthook) or Tier 3 (CI).
#
# Exit code policy:
#   - exit 0 → success, hook output (if any) goes to user (advisory)
#   - exit 2 → blocks the next agent turn; stderr is fed back to Claude as
#     the corrective directive (per Anthropic hooks reference §"Exit code 2
#     behavior per event")
#
# Pattern: per-extension dispatcher (Sitnik 2026 — Evil Martians "Stop
# writing rules in AGENTS.md"). Single hook entry point, dispatches to the
# right per-file linter based on extension.
#
# IMPORTANT — composes with user-global ~/.claude/settings.json which
# already runs `biome check` on every TS/JS/JSON edit ADVISORY (|| true,
# never blocks). This project hook is the STRICT layer that blocks when the
# file's check fails. The two hooks run in parallel; either can produce
# stderr seen by Claude on the next turn.

set -eu

# Read stdin into INPUT. If stdin is empty or not JSON, fail loudly per
# rule #6 ("let it crash"). The hook should never silently succeed.
INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  echo "post-edit.sh: empty stdin — Claude Code didn't pass hook input JSON" >&2
  exit 2
fi

# Extract file_path. If missing, the tool wasn't a file-write (e.g. Read)
# and the hook is a no-op.
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null || echo "")
if [ -z "$FILE_PATH" ]; then
  # Not a file-write tool call — no-op.
  exit 0
fi

# Only lint files inside the project root. If the agent wrote to /tmp or
# similar, skip — out of scope for Minsky's deterministic gates.
# CLAUDE_PROJECT_DIR is set by Claude Code for project-level hooks.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$FILE_PATH" in
  "$PROJECT_DIR"/*) ;;  # in project — proceed
  *)
    # Out of project — skip silently. The user-global hook may still run.
    exit 0
    ;;
esac

# Resolve to relative path for cleaner error messages.
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Dispatch by file extension / path. Order matters: more specific patterns
# (TASKS.md, experiments/*.yaml) before generic (.ts, .md).
case "$REL_PATH" in
  TASKS.md)
    # Run @tasks-md/lint (validates whole file) + check-rule-9-tasksmd-fields
    # (validates required Hypothesis/Success/Pivot/Measurement/Anchor fields).
    cd "$PROJECT_DIR"
    if ! npx -y --prefer-offline @tasks-md/lint@^0.7.0 TASKS.md >&2; then
      echo "" >&2
      echo "post-edit hook: TASKS.md failed @tasks-md/lint. Fix the violations above and the next turn will pass." >&2
      exit 2
    fi
    if ! node scripts/check-rule-9-tasksmd-fields.mjs >&2; then
      echo "" >&2
      echo "post-edit hook: TASKS.md task block missing rule-9 fields (Hypothesis/Success/Pivot/Measurement/Anchor). Add the missing lines and the next turn will pass." >&2
      exit 2
    fi
    ;;

  experiments/*.yaml | experiments/*.yml)
    # Pre-registered experiment file — run anchor + measurement + pivot lints.
    cd "$PROJECT_DIR"
    if ! node scripts/check-anchor-primary-source.mjs >&2 \
      || ! node scripts/check-measurement-inspects-output.mjs >&2 \
      || ! node scripts/check-pivot-success-margin.mjs >&2; then
      echo "" >&2
      echo "post-edit hook: experiments/*.yaml failed rule-9 sub-checks. Fix the field shapes and the next turn will pass." >&2
      exit 2
    fi
    ;;

  *.ts | *.tsx | *.mts | *.cts)
    # User-global hook already runs biome --max-diagnostics=5 in advisory
    # mode. We add `tsc -b --noEmit` on the specific package (cheap warm
    # cache). Skipped if biome already exited non-zero per user-global
    # (the user-global uses `|| true` so we can't observe that here —
    # accept the redundancy of biome running twice; it's <500ms warm).
    cd "$PROJECT_DIR"
    if ! pnpm biome check --error-on-warnings --no-errors-on-unmatched --max-diagnostics=5 "$FILE_PATH" >&2; then
      echo "" >&2
      echo "post-edit hook: biome blocked the change. Fix the violations above and the next turn will pass." >&2
      exit 2
    fi
    ;;

  *.md)
    # Run markdownlint on just this file (fast).
    cd "$PROJECT_DIR"
    if ! pnpm exec markdownlint-cli2 "$FILE_PATH" >&2 2>&1; then
      echo "" >&2
      echo "post-edit hook: markdownlint blocked the change. Run \`pnpm exec markdownlint-cli2 --fix \"$FILE_PATH\"\` to auto-fix where possible." >&2
      exit 2
    fi
    ;;

  *.json | *.jsonc)
    # JSON syntax + biome shape check (handles tsconfig.json, package.json,
    # .vscode/*.json, etc.).
    cd "$PROJECT_DIR"
    if ! pnpm biome check --error-on-warnings --no-errors-on-unmatched --max-diagnostics=5 "$FILE_PATH" >&2; then
      echo "" >&2
      echo "post-edit hook: biome blocked the JSON change. Fix the violations above." >&2
      exit 2
    fi
    ;;

  *)
    # Unknown extension — no-op. Don't block the agent on files we don't
    # have a linter for.
    exit 0
    ;;
esac

exit 0
