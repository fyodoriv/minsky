#!/usr/bin/env bash
#
# .claude/hooks/block-dangerous-bash.sh — Tier 1 PreToolUse Bash gate (per
# `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse`).
#
# Fires on every PreToolUse: Bash event. Reads the JSON hook input, extracts
# `tool_input.command`, and blocks the call (exit 2) if it matches any
# pattern from the forbidden list.
#
# This is the "safety net, not a configuration" pattern from Tuszynski 2026
# ("The Five Hooks That Change How You Ship With Claude Code"). The agent
# already knows not to do these things — this hook catches the case where
# it almost did anyway.
#
# Composes with the user-global ~/.claude/settings.json which already has
# the broad `Exec(rm -rf /)*` deny rules. This hook adds Minsky-specific
# patterns the user-global doesn't (e.g. `git checkout` outside worktree,
# `--no-verify` per AGENTS.md §"Git Safety (Multi-Agent)").
#
# Patterns blocked (each blocks a documented failure class):
#  - rm -rf outside /tmp/                  (data-loss)
#  - rm -rf $HOME / ~ / etc.               (catastrophic)
#  - git push --force / -f to main/master  (history-rewrite on protected)
#  - git push --force-with-lease to main   (same — protected is protected)
#  - git reset --hard                      (wipes other agents' uncommitted)
#  - git checkout .  /  git checkout --    (reverts other agents' edits)
#  - git clean -fd                         (deletes untracked across agents)
#  - git commit --no-verify                (bypasses pre-commit per AGENTS.md)
#  - git commit -n                         (same in short form)
#  - git -c core.hooksPath=... commit      (subtle hook-bypass)
#  - gh pr merge --admin                   (bypasses branch protection)
#  - gh repo delete                        (catastrophic)
#  - npm publish (use the release flow)
#
# Each match emits a precise corrective message naming (a) what was blocked
# and (b) the canonical safe alternative.

set -eu

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  # Empty stdin — Claude Code bug. Fail-open to avoid blocking every
  # bash call on a hook bug.
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
if [ -z "$COMMAND" ]; then
  exit 0
fi

emit_block() {
  local label="$1"
  local guidance="$2"
  cat >&2 <<EOF

block-dangerous-bash hook: BLOCKED "$label"
Command: $COMMAND

$guidance
EOF
  exit 2
}

# --- rm -rf outside /tmp/ -------------------------------------------------
# Matches: rm -rf <path>, rm -fr <path>, rm -Rrf <path>, etc.
# Allows:  rm -rf /tmp/foo, rm -rf $TMPDIR/foo
if echo "$COMMAND" | grep -qE '\brm[[:space:]]+(-[rRf]+|--recursive[[:space:]]+--force)\b'; then
  # Extract the target path candidates (everything after the flags).
  # If ANY candidate is not under /tmp/ or a relative path that's safe,
  # block. Conservative: any rm -rf not clearly /tmp/-scoped is blocked.
  if ! echo "$COMMAND" | grep -qE '\brm[[:space:]]+(-[rRf]+|--recursive[[:space:]]+--force)[[:space:]]+(/tmp/|/var/folders/[a-zA-Z0-9_/]+/T/|\$\{?TMPDIR\}?/|\.minsky/[a-zA-Z0-9_/.-]+/?$|node_modules/?$|dist/?$|coverage/?$|build/?$)'; then
    emit_block "rm -rf outside /tmp/" \
      "Use a scoped path: \`rm -rf /tmp/minsky-<short-name>\`, \`rm -rf node_modules\`, or similar. If you genuinely need to remove files in the project tree, use \`git rm\` (tracked) or remove individual files (\`rm file1 file2\`)."
  fi
fi

# --- git push --force to main/master --------------------------------------
if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+push\b.*(--force|-f|--force-with-lease)\b.*\b(main|master)\b'; then
  emit_block "git push --force to main/master" \
    "Protected branches reject force-push. If you need to amend a PR commit, use \`git push --force-with-lease origin <feature-branch>\` against the feature branch only, never main/master."
fi

# --- git reset --hard -----------------------------------------------------
if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+reset[[:space:]]+--hard\b'; then
  emit_block "git reset --hard" \
    "\`git reset --hard\` wipes uncommitted changes from ALL agents on this checkout. Use \`git restore <specific-files>\` to revert specific files, or \`git stash\` to save changes temporarily. See AGENTS.md §\"Git Safety (Multi-Agent)\"."
fi

# --- git checkout .  /  git checkout -- . --------------------------------
# Matches: `git checkout .`, `git checkout -- .`, `git checkout -- <path>`
# Allows:  `git checkout <branch>`, `git checkout -b <branch>`
if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+checkout[[:space:]]+(--[[:space:]]+)?\.[[:space:]]*$'; then
  emit_block "git checkout . (wholesale revert)" \
    "Use \`git restore <specific-files>\` to revert only the files you intend to touch. \`git checkout .\` reverts EVERY uncommitted change including other agents' work-in-progress."
fi

# --- git clean -fd --------------------------------------------------------
if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+clean\b.*(-[fdxX]*f|-[fdxX]*d).*-?\s*$' \
  || echo "$COMMAND" | grep -qE '\bgit[[:space:]]+clean[[:space:]]+(-[fdxX]+)'; then
  emit_block "git clean -fd" \
    "\`git clean -fd\` deletes untracked files across ALL agents' work on this checkout. If you need to remove specific files, use \`rm <file>\`. If you need a fresh state, work in a worktree (\`git worktree add /tmp/minsky-<task>\`)."
fi

# --- git commit --no-verify  /  -n  /  hooks-bypass -----------------------
# Per `det-no-no-verify-bypass-pre-commit-hooks` task, this whole class is
# blocked because Anthropic claude-code #40117 documented Claude bypassing
# hooks via these patterns across six consecutive commits.
if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+(commit|push)\b.*(--no-verify|[^a-zA-Z]-n\b|--no-verify=true)'; then
  emit_block "git --no-verify (hook bypass)" \
    "lefthook pre-commit/pre-push exists to catch regressions BEFORE they land. Run \`pnpm pre-pr-lint --stage=fast\` and fix the failures, then \`git commit\` (without --no-verify). If a hook itself is genuinely broken, file a TASKS.md entry for it and use \`MINSKY_INTERACTIVE=1\` to escape (operator-only)."
fi

if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+-c[[:space:]]+core\.hooksPath='; then
  emit_block "git -c core.hooksPath= (hook bypass)" \
    "Overriding \`core.hooksPath\` from the command line bypasses lefthook the same way --no-verify does. See the --no-verify error message for the canonical fix."
fi

# --- gh pr merge --admin --------------------------------------------------
if echo "$COMMAND" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+merge\b.*--admin\b'; then
  emit_block "gh pr merge --admin" \
    "Bypassing branch protection on merge defeats the entire purpose of the CI gate stack. Wait for the gates to pass, OR if a gate is genuinely broken, fix the gate (rule #17 proactive healing) instead of bypassing."
fi

# --- gh repo delete -------------------------------------------------------
if echo "$COMMAND" | grep -qE '\bgh[[:space:]]+repo[[:space:]]+delete\b'; then
  emit_block "gh repo delete" \
    "Deleting a GitHub repository is irreversible and almost never the right move from an agent loop. If you genuinely need to delete a fork or scratch repo, do it from the web UI with operator confirmation."
fi

# --- npm publish ----------------------------------------------------------
if echo "$COMMAND" | grep -qE '\bnpm[[:space:]]+publish\b'; then
  emit_block "npm publish (use release flow)" \
    "The canonical release path is the \`release\` workflow in .github/workflows/release.yml — triggered by a tag. Direct \`npm publish\` from an agent bypasses the SBOM + SLSA provenance gates (vision rule #13 supply-chain hardening)."
fi

# All checks passed — allow the bash command to run.
exit 0
