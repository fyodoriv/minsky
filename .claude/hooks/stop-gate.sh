#!/usr/bin/env bash
#
# .claude/hooks/stop-gate.sh — Tier 1 Stop hook (per
# `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse`).
#
# Fires on every Stop event (when Claude tries to end its turn). Runs the
# `pnpm pre-pr-lint --stage=stop-gate` subset — the cheap file-format
# checks that should pass before the agent stops working on a turn.
#
# If the gate fails AND `stop_hook_active` is false (first-pass attempt),
# exit 2 — Claude continues the conversation with our stderr as the next
# instruction. This is the "tighten the loop" mechanism from
# Sitnik 2026 (Evil Martians "Stop writing rules in AGENTS.md").
#
# If `stop_hook_active` is true (Claude is already in a forced-continuation
# loop on a previous Stop block), run the gate ADVISORY ONLY — exit 0
# regardless. This prevents the infinite retry-burn-tokens loop that the
# Evil Martians article and AgentPatterns.ai "Stop hook hits the block cap"
# warning both call out.
#
# Latency budget: ≤5s p95. The `--stage=stop-gate` manifest is curated to
# stay there (no typecheck, no vitest, no diff-context lints).

set -eu

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  echo "stop-gate.sh: empty stdin — Claude Code didn't pass hook input JSON" >&2
  # Fail-open: an empty hook input is a Claude Code bug, not an agent
  # violation. Let the turn end and surface the bug via the warning.
  exit 0
fi

# Parse stop_hook_active. If jq is missing or the field is absent, default
# to FALSE (first-pass behavior) — strict gating.
ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Parse transcript_path so the tool-call-discipline check below can read it.
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

if [ "$ACTIVE" = "true" ]; then
  # Already in forced-continuation loop — run advisory, never block.
  # The agent has seen the error once and either (a) is genuinely stuck
  # on an issue it can't fix from the lint output, or (b) is making
  # progress toward a fix. Either way, blocking again would be
  # counter-productive.
  pnpm pre-pr-lint --stage=stop-gate 2>&1 || true
  exit 0
fi

# Sub-check #1 — tool-call-discipline (cheap, fast, transcript-walking).
# Catches the "Let me examine X" prose-without-tool-call failure mode
# documented in AGENTS.md §"Tool-call discipline". Runs BEFORE the
# heavier pre-pr-lint subset because (a) it's faster, (b) if it fires
# the agent's next turn needs to ATTACH a tool call, not fix a lint —
# better to surface that first.
if [ -n "$TRANSCRIPT_PATH" ]; then
  if ! node scripts/check-tool-call-discipline.mjs --transcript="$TRANSCRIPT_PATH" >&2; then
    cat >&2 <<'EOF'

stop-gate hook blocked: tool-call-discipline violation.

The last assistant turn contains prose like "Let me examine X" / "Now I'll
do Y" with NO attached tool call. Per AGENTS.md §"Tool-call discipline",
every reply must include a tool call (terminal, file_editor, task_tracker,
or finish). Many agent frameworks (OpenHands SDK, qwen-coder bindings)
treat a prose-only reply as the conversation-end signal and terminate
the turn — producing zero commits / zero PRs / zero pushes.

Use the `think` tool if you only need to deliberate. Use `Bash` /
`Read` / `Edit` / `Write` to actually do something. If the work is
genuinely complete, end with a terminal signal (PR URL, "task complete",
"shipped").
EOF
    exit 2
  fi
fi

# First-pass: run the gate. Block on failure.
if pnpm pre-pr-lint --stage=stop-gate >&2; then
  exit 0
fi

# Gate failed. Emit a directive Claude can act on.
cat >&2 <<'EOF'

stop-gate hook blocked: the `pnpm pre-pr-lint --stage=stop-gate` subset
failed. Read the errors above and fix them before ending this turn.

You may also need to run targeted commands depending on which check
failed:
  - biome:           pnpm biome check --write <file>
  - markdownlint:    pnpm exec markdownlint-cli2 --fix <file>
  - tasks-md/lint:   npx -y @tasks-md/lint --fix TASKS.md
  - rule-9 fields:   add Hypothesis/Success/Pivot/Measurement/Anchor lines
  - rule-17 healing: every observed-error must produce a commit OR a TASKS.md filing
EOF
exit 2
