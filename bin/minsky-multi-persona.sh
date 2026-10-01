#!/usr/bin/env bash
# bin/minsky-multi-persona.sh — M2 multi-persona A2A pipeline driver.
# ============================================================================
#
# Runs the five-persona pipeline (researcher → planner → developer → QA →
# reviewer) on ONE task. Each persona is an A2A-compliant step: the driver
# builds a persona-specific brief, obtains an A2A task ID from the A2A adapter
# (`@minsky/a2a` → A2AOpenHands.sendMessage — the Task lifecycle IS the
# handoff substrate, rule #1 "don't reinvent"), records the persona's artifact
# at `.minsky/handoffs/<task-id>/<role>.md`, and logs the transition to
# `<host>/.minsky/iterations.jsonl` with `persona=<role>` + the A2A task ID.
#
# The next persona's brief is prepended with the prior persona's artifact via
# `scripts/build_brief.py --persona <role> --prior-artifact <path>`, forming
# the researcher → … → reviewer artifact chain. This is the Pivot envelope
# named in the task body: the handoff payload is Minsky-side, the transport is
# A2A (rule #11 "absorb").
#
# Usage:
#   bin/minsky-multi-persona.sh <task-id> <host-dir> [--dry-run]
#
#   --dry-run   Record artifacts + transitions WITHOUT spawning an agent per
#               persona (default — there is no per-persona agent spawn yet;
#               the contract-pinning slice ships first per the task's Risk
#               mitigation). The pipeline still walks all five personas, logs
#               every transition, and builds the artifact chain.
#
# Exit codes:
#   0 — pipeline walked all five personas, every transition logged
#   1 — a persona step failed (missing artifact / unknown role) — loud halt
#   2 — bad CLI args
#
# Source: TASKS.md `multi-persona-pipeline-via-a2a`; user-stories/008; rule #4
#   (everything visible — every transition is logged); rule #7 (the README's
#   chaos table pins the failure modes this driver must handle).
# Pattern: pipeline / SOP (MetaGPT) over the A2A actor model (Hewitt 1973 —
#   each persona is an actor, the A2A message is the message).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# The five personas in pipeline order — MUST match PIPELINE_PERSONAS in
# scripts/build_brief.py and novel/personas/README.md.
PERSONAS=(researcher planner developer qa reviewer)

usage() {
  echo "usage: minsky-multi-persona.sh <task-id> <host-dir> [--dry-run]" >&2
}

# ── A2A transport seam ───────────────────────────────────────────────────
# Obtain an A2A task ID for a persona transition by calling the A2A adapter's
# sendMessage verb. The adapter (built to novel/adapters/a2a/dist/index.js by
# the `pnpm install` prepare hook) is the dependency seam (rule #2). If the
# dist is absent (fresh checkout before build), degrade gracefully to a
# locally-generated ID so the pipeline still walks + logs — failure mode #3 in
# novel/personas/README.md's chaos table.
a2a_send_message() {
  local role="$1"
  local task_id="$2"
  local a2a_dist="$REPO_DIR/novel/adapters/a2a/dist/index.js"
  if [[ -f "$a2a_dist" ]] && command -v node >/dev/null 2>&1; then
    # shellcheck disable=SC2016 # intentional: this is a JS program, not shell —
    # process.argv is read by node, not expanded by bash. Single quotes are correct.
    node --input-type=module -e '
      const [distUrl, role, taskId] = process.argv.slice(1);
      const { A2AOpenHands } = await import(distUrl);
      const a2a = new A2AOpenHands();
      const now = new Date().toISOString();
      const id = await a2a.sendMessage(role, {
        name: `${taskId}:${role}`,
        description: `multi-persona pipeline step: ${role} for ${taskId}`,
        status: "QUEUED",
        createdAt: now,
        updatedAt: now,
      });
      process.stdout.write(id);
    ' "file://$a2a_dist" "$role" "$task_id" 2>/dev/null && return 0
  fi
  # Graceful fallback (chaos failure mode #3): adapter unavailable.
  printf 'a2a-local-%s-%s' "$role" "$(date +%s%N)"
}

# ── transition log ───────────────────────────────────────────────────────
# Append one JSONL line per persona transition to <host>/.minsky/iterations.jsonl.
# The line carries the literal substring `persona=<role>` (the
# `transition` field) so the task's measurement
# `grep -c "persona=" .minsky/iterations.jsonl` counts one per persona.
log_transition() {
  local host="$1"
  local task_id="$2"
  local role="$3"
  local a2a_task_id="$4"
  local artifact="$5"
  local jsonl="$host/.minsky/iterations.jsonl"
  mkdir -p "$host/.minsky"
  local line
  line="$(jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --arg task_id "$task_id" \
    --arg role "$role" \
    --arg a2a_task_id "$a2a_task_id" \
    --arg transition "persona=$role" \
    --arg artifact "$artifact" \
    '{ts: $ts, task_id: $task_id, role: $role, a2a_task_id: $a2a_task_id, transition: $transition, artifact: $artifact}')"
  printf '%s\n' "$line" >> "$jsonl"
}

main() {
  if [[ $# -lt 2 ]]; then
    usage
    return 2
  fi
  local task_id="$1"
  local host="$2"
  shift 2
  local dry_run=1  # default: no per-persona spawn yet (contract-pinning slice)
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) dry_run=1; shift ;;
      --live) dry_run=0; shift ;;
      -h|--help) usage; return 0 ;;
      *) echo "minsky-multi-persona: unknown arg: $1" >&2; usage; return 2 ;;
    esac
  done

  if [[ ! -d "$host" ]]; then
    echo "minsky-multi-persona: host-dir not found: $host" >&2
    return 1
  fi
  host="$(cd "$host" && pwd)"
  if [[ ! -f "$host/TASKS.md" ]]; then
    echo "minsky-multi-persona: $host/TASKS.md not found" >&2
    return 1
  fi

  local handoff_dir="$host/.minsky/handoffs/$task_id"
  mkdir -p "$handoff_dir"

  echo "minsky-multi-persona: pipeline for task '$task_id' on $host (dry-run=$dry_run)" >&2

  local prev_artifact=""
  local role
  for role in "${PERSONAS[@]}"; do
    local artifact="$handoff_dir/$role.md"

    # Build the persona brief, chaining the prior persona's artifact.
    local brief_args=("$task_id" "$host" --persona "$role")
    if [[ -n "$prev_artifact" && -f "$prev_artifact" ]]; then
      brief_args+=(--prior-artifact "$prev_artifact")
    fi
    local brief
    if ! brief="$(python3 "$SCRIPT_DIR/../scripts/build_brief.py" "${brief_args[@]}" 2>&1)"; then
      echo "minsky-multi-persona: build_brief failed for persona '$role':" >&2
      printf '%s\n' "$brief" >&2
      return 1
    fi

    # Obtain the A2A task ID for this transition (the handoff substrate).
    local a2a_task_id
    a2a_task_id="$(a2a_send_message "$role" "$task_id")"

    # Record the persona's artifact. In dry-run the artifact is the rendered
    # persona brief (the input the persona received); a live run would replace
    # this with the persona agent's actual output. Either way the file is the
    # contract the next persona consumes.
    {
      echo "<!-- persona=$role task=$task_id a2a_task_id=$a2a_task_id -->"
      printf '%s\n' "$brief"
    } > "$artifact"

    log_transition "$host" "$task_id" "$role" "$a2a_task_id" "$artifact"
    echo "minsky-multi-persona: $role done (a2a=$a2a_task_id, artifact=$artifact)" >&2

    prev_artifact="$artifact"
  done

  echo "minsky-multi-persona: pipeline complete — 5 personas, artifacts under $handoff_dir" >&2
  return 0
}

main "$@"
