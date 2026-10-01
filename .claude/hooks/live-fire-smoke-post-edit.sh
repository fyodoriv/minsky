#!/usr/bin/env bash
#
# .claude/hooks/live-fire-smoke-post-edit.sh — PostToolUse Write|Edit|
# MultiEdit hook per `det-live-fire-smoke-after-launch-script-edit-
# posttooluse-hook` (PR #911 cohort).
#
# Per `.claude/skills/live-fire-smoke/SKILL.md`: after editing any
# `distribution/{systemd,launchd}/*.sh` or any `.plist` / `.service` file,
# run the supervisor's launch script under a launchd-equivalent stripped
# env (minimal PATH, no user shell rc) to catch bugs the integration tests
# skip — the four-bug live-fire pattern of 2026-05-26.
#
# Runs ONLY if a known smoke script exists at one of the canonical paths:
#   - distribution/test-supervisor.sh (the canonical entry per the skill)
#   - scripts/live-fire-smoke.sh (legacy)
#
# If neither exists, no-op (preparation-PR shape — the smoke script
# can land separately).
#
# Exit code policy:
#   exit 0 → smoke pass OR no smoke script available
#   exit 2 → smoke failed; emit fix instructions to agent

set -eu

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null || echo "")
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only fire on launchd/systemd unit + run-* scripts.
case "$FILE_PATH" in
  */distribution/systemd/*.sh | */distribution/launchd/*.sh \
    | */distribution/systemd/*.service | */distribution/systemd/*.timer \
    | */distribution/launchd/*.plist) ;;
  *) exit 0 ;;
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# Find the smoke script.
SMOKE=""
if [ -x "distribution/test-supervisor.sh" ]; then
  SMOKE="distribution/test-supervisor.sh"
elif [ -x "scripts/live-fire-smoke.sh" ]; then
  SMOKE="scripts/live-fire-smoke.sh"
fi

if [ -z "$SMOKE" ]; then
  # Preparation-PR shape — smoke script not yet present. No-op.
  exit 0
fi

# Run the smoke under launchd-equivalent stripped env: minimal PATH,
# no user shell rc.
if env -i \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="${HOME}" \
    MINSKY_HOME="${MINSKY_HOME:-$HOME/.minsky}" \
    bash "$SMOKE" >&2; then
  exit 0
fi

cat >&2 <<EOF

live-fire-smoke hook: BLOCKED — smoke script failed after $FILE_PATH edit

Per .claude/skills/live-fire-smoke/SKILL.md, edits to distribution/
units must pass the stripped-env smoke before being committed. The
edit you just made broke the smoke run — read the output above for
the specific failure.

Common causes:
  - bare \`node\` / \`python3\` / \`gh\` not resolvable in launchd PATH
    (fix: source distribution/systemd/lib-launchd-path.sh first)
  - missing \`set -euo pipefail\` discipline
  - typo in env-var reference (\`\${VAR:-default}\` shape)
  - script-relative path resolution that breaks under launchd's cwd

If the smoke is itself broken (not the script you edited), file a
TASKS.md item to fix the smoke and proceed with
\`MINSKY_SKIP_LIVE_FIRE_SMOKE=<reason ≥3 chars>\` set — but never silently.
EOF
exit 2
