#!/usr/bin/env bash
# scripts/capture-failure.sh — snapshot a failed iteration's artifacts
# <!-- scope: human-approved operator-requested observability tooling for 10K-LOC mode pre-flight (2026-05-25); slice 2 of bash-runner observability arc; companion to bin/minsky bash-doctor -->
# into <host>/.minsky/failures/<iso-ts>-<task-id>/ so the operator can
# inspect AFTER the iteration's mktemp files are cleaned up.
#
# Before this script, bin/minsky-run.sh recorded a 100-char tail of
# stdout in the JSONL `notes` field, then `rm -f`'d the brief + the
# stdout log. Result: a `verdict=spawn-failed` row pointed at no
# evidence — the operator had to re-run the iteration in dry-mode +
# eye-bisect what changed. With this script, every non-validated
# verdict produces a self-contained capture dir with:
#
#   brief.md              — the exact brief the agent was given
#   stdout.log            — the full stdout+stderr of the spawn (not just
#                           the 100-char tail)
#   metadata.json         — verdict, exit_code, duration_ms, branch,
#                           pr_url, notes, host, task_id, gh_host, ts,
#                           tool versions (jq, python3, openhands SDK)
#   env.txt               — sanitized env (no *_TOKEN / *_KEY / *_SECRET
#                           values; just the variable names + safe vars
#                           like PATH / SHELL / PWD)
#
# Self-limiting: keeps the most recent 20 failure dirs; deletes older.
# That cap is `MINSKY_FAILURE_RING_SIZE` overridable.
#
# Usage:
#   scripts/capture-failure.sh \
#     --host <dir> --task-id <id> --verdict <s> --exit-code <n> \
#     --duration-ms <n> --brief-file <path> --stdout-log <path> \
#     --branch <s> --pr-url <s> --notes <s> [--gh-host <s>]
#
# Exit codes:
#   0 — capture written (the iteration loop continues regardless)
#   1 — required arg missing (still continues; rule #6 graceful-degrade
#       at the boundary, this is observability not iteration logic)
#
# Conformance:
#   - Rule #2 — Strategy seam: bash runner calls this as one line; the
#     capture is independently testable + replaceable.
#   - Rule #6 — let-it-crash: capture failures don't break iterations.
#     If the .minsky/failures/ write fails (disk full, perms), we exit
#     1 with a stderr message, the caller's `|| true` swallows it.
#   - Rule #7 — graceful-degrade: missing tool versions render as
#     "(unavailable)" not silent.
#
# Source: 2026-05-25 retro — "complete error handling & a way to
# quickly detect issues" requested before the live smoke runs against
# toronto-rentals. This is the "quickly detect" surface for the bash
# skeleton.

set -euo pipefail

# Resolve `find` to a real POSIX find binary. Some operator shells shim
# `find` → `fd` (which has different CLI; doesn't accept -mindepth /
# -maxdepth / -mtime). The ring-pruning logic below needs real find, so
# we pin the resolution explicitly. Prefer /usr/bin/find (macOS, most
# Linux distros), fall back to /bin/find (Alpine, busybox), then PATH
# as last resort.
FIND_BIN="/usr/bin/find"
[[ -x "$FIND_BIN" ]] || FIND_BIN="/bin/find"
[[ -x "$FIND_BIN" ]] || FIND_BIN="find"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/capture-failure.sh \
    --host <dir> --task-id <id> --verdict <s> --exit-code <n> \
    --duration-ms <n> --brief-file <path> --stdout-log <path> \
    --branch <s> --pr-url <s> --notes <s> [--gh-host <s>]
USAGE
}

HOST=""
TASK_ID=""
VERDICT=""
EXIT_CODE=""
DURATION_MS=""
BRIEF_FILE=""
STDOUT_LOG=""
BRANCH=""
PR_URL=""
NOTES=""
GH_HOST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --verdict) VERDICT="$2"; shift 2 ;;
    --exit-code) EXIT_CODE="$2"; shift 2 ;;
    --duration-ms) DURATION_MS="$2"; shift 2 ;;
    --brief-file) BRIEF_FILE="$2"; shift 2 ;;
    --stdout-log) STDOUT_LOG="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --pr-url) PR_URL="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    --gh-host) GH_HOST="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "capture-failure: unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

# Required args.
for var in HOST TASK_ID VERDICT EXIT_CODE; do
  if [[ -z "${!var}" ]]; then
    echo "capture-failure: --${var,,} required" >&2 | tr A-Z a-z
    exit 1
  fi
done

# Sanitize task-id for filesystem use. The picker emits kebab-case but
# defensive: replace any non-[a-zA-Z0-9._-] with `_`.
SAFE_TASK_ID="$(printf '%s' "$TASK_ID" | tr -c 'a-zA-Z0-9._-' '_')"
# Empty task-id falls through to `_no-task` matching record_iteration's
# sentinel pattern.
[[ -z "$SAFE_TASK_ID" ]] && SAFE_TASK_ID="_no-task"

TS="$(date -u +%Y-%m-%dT%H%M%SZ)"
CAPTURE_DIR="$HOST/.minsky/failures/${TS}-${SAFE_TASK_ID}"

mkdir -p "$CAPTURE_DIR"

# Copy brief + stdout if they exist. The bash runner mktemp's them, so
# they may not exist if the spawn-step itself failed before mktemp
# (rare but possible). Graceful-degrade: empty file with a marker.
if [[ -n "$BRIEF_FILE" ]] && [[ -f "$BRIEF_FILE" ]]; then
  cp "$BRIEF_FILE" "$CAPTURE_DIR/brief.md"
else
  echo "(no brief file — capture invoked before brief was written)" > "$CAPTURE_DIR/brief.md"
fi

if [[ -n "$STDOUT_LOG" ]] && [[ -f "$STDOUT_LOG" ]]; then
  cp "$STDOUT_LOG" "$CAPTURE_DIR/stdout.log"
else
  echo "(no stdout log — capture invoked before spawn produced output)" > "$CAPTURE_DIR/stdout.log"
fi

# Sanitized env. We allowlist known-safe variable names rather than
# blocklist patterns (allowlist > blocklist for secret handling per
# rule #6). Any var matching *_TOKEN / *_KEY / *_SECRET / *_PASSWORD
# has its VALUE replaced with `<redacted-length-N>` but the NAME is
# preserved so the operator knows which vars were set.
{
  echo "# Sanitized env at iteration time."
  echo "# Tokens / keys / secrets have values redacted; only var names + lengths shown."
  echo ""
  env | sort | while IFS='=' read -r name value; do
    case "$name" in
      *_TOKEN|*_KEY|*_SECRET|*_PASSWORD|*_PASS|*_CREDENTIAL|*_CREDENTIALS)
        echo "${name}=<redacted-length-${#value}>"
        ;;
      *)
        # Truncate long values (e.g. PATH on macOS can be 1KB+).
        if [[ "${#value}" -gt 200 ]]; then
          echo "${name}=$(printf '%s' "$value" | head -c 200)<truncated-from-${#value}>"
        else
          echo "${name}=${value}"
        fi
        ;;
    esac
  done
} > "$CAPTURE_DIR/env.txt"

# Tool versions — anchor to what was actually present when this failed.
# (unavailable) for missing tools (rule #7 graceful-degrade).
JQ_VERSION="(unavailable)"
if command -v jq >/dev/null 2>&1; then
  JQ_VERSION="$(jq --version 2>/dev/null | sed 's/^jq-//')"
fi
PYTHON_VERSION="(unavailable)"
if command -v python3 >/dev/null 2>&1; then
  PYTHON_VERSION="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || echo "(unavailable)")"
fi
OPENHANDS_SDK_VERSION="(not-installed)"
if python3 -c "import openhands" 2>/dev/null; then
  OPENHANDS_SDK_VERSION="$(python3 -c "import openhands; print(getattr(openhands, '__version__', 'unknown'))" 2>/dev/null || echo "unknown")"
fi
GH_VERSION="(unavailable)"
if command -v gh >/dev/null 2>&1; then
  GH_VERSION="$(gh --version 2>/dev/null | head -1 | sed 's/^gh version //')"
fi

# metadata.json — single source of truth for the failure. Use jq so the
# escaping is correct (free-text notes can carry quotes, newlines).
if command -v jq >/dev/null 2>&1; then
  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --arg host "$HOST" \
    --arg task_id "$TASK_ID" \
    --arg verdict "$VERDICT" \
    --arg exit_code "$EXIT_CODE" \
    --arg duration_ms "$DURATION_MS" \
    --arg branch "$BRANCH" \
    --arg pr_url "$PR_URL" \
    --arg notes "$NOTES" \
    --arg gh_host "$GH_HOST" \
    --arg jq_version "$JQ_VERSION" \
    --arg python_version "$PYTHON_VERSION" \
    --arg openhands_sdk_version "$OPENHANDS_SDK_VERSION" \
    --arg gh_version "$GH_VERSION" \
    '{
      ts: $ts,
      host: $host,
      task_id: $task_id,
      verdict: $verdict,
      exit_code: ($exit_code | tonumber? // $exit_code),
      duration_ms: ($duration_ms | tonumber? // $duration_ms),
      branch: $branch,
      pr_url: (if $pr_url == "" then null else $pr_url end),
      notes: $notes,
      gh_host: $gh_host,
      tools: {
        jq: $jq_version,
        python3: $python_version,
        openhands_sdk: $openhands_sdk_version,
        gh: $gh_version
      }
    }' > "$CAPTURE_DIR/metadata.json"
else
  # No jq — fall back to a minimal manual JSON. The capture is degraded
  # but still produces an artifact.
  cat > "$CAPTURE_DIR/metadata.json" <<EOF
{
  "ts": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "host": "$HOST",
  "task_id": "$TASK_ID",
  "verdict": "$VERDICT",
  "exit_code": "$EXIT_CODE",
  "duration_ms": "$DURATION_MS",
  "_warning": "jq unavailable — metadata not fully escaped, may not parse"
}
EOF
fi

# Self-limit: keep at most $MINSKY_FAILURE_RING_SIZE most recent capture
# dirs. Default 20 — enough to debug a session, small enough not to
# accumulate forever.
RING_SIZE="${MINSKY_FAILURE_RING_SIZE:-20}"
FAILURES_DIR="$HOST/.minsky/failures"
if [[ -d "$FAILURES_DIR" ]]; then
  # ls -1t sorts newest first; tail +N drops the N most recent and
  # leaves the rest to delete. Use find piped to xargs for safety on
  # paths with spaces (none expected but defensive).
  COUNT=$("$FIND_BIN" "$FAILURES_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  if [[ "$COUNT" -gt "$RING_SIZE" ]]; then
    # Sort by mtime desc; keep top $RING_SIZE; delete the rest.
    "$FIND_BIN" "$FAILURES_DIR" -mindepth 1 -maxdepth 1 -type d -print0 \
      | xargs -0 ls -dt 2>/dev/null \
      | tail -n +$((RING_SIZE + 1)) \
      | while read -r old_dir; do
          [[ -n "$old_dir" ]] && rm -rf "$old_dir"
        done
  fi
fi

# Emit a one-line summary on stdout — the caller can capture it for
# the JSONL note or just echo it for the operator.
echo "captured failure: $CAPTURE_DIR" >&2
echo "$CAPTURE_DIR"
