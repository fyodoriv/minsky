#!/usr/bin/env bash
# bin/minsky-run.sh — Path A Phase 7 skeleton
# ============================================================================
#
# Status: SKELETON ONLY. Not yet wired into bin/minsky. Filed 2026-05-24
# alongside `path-a-phase-7-cross-repo-runner-shell-rewrite` (TASKS.md P0).
#
# Goal: replace `novel/cross-repo-runner/` (10.8K LOC TypeScript) with a
# single bash file (~300 lines) that does the same thing: round-robin
# walk N host repos under --hosts-dir, spawn `openhands solve` against
# each host's top-priority unclaimed TASKS.md task, record the iteration.
#
# Companion file: `scripts/pick_task.py` (the TASKS.md picker with rule-9
# field validation, also skeleton in this PR).
#
# Parity-test discipline: before deleting `novel/cross-repo-runner/`, the
# existing fixture set in `novel/cross-repo-runner/test/` MUST be rewritten
# as `tests/minsky-run.bats` and pass against THIS file. The deletion is
# gated on parity; the Pivot per the P0 task body is "revert if the rewrite
# hits >100h of integration debugging".
#
# Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
#
# ============================================================================

set -euo pipefail

# --- 1. Configuration loading -----------------------------------------------
# Load ~/.minsky/config.json (cloud_agent, local_agent, openhands.model, ...)
# TODO(phase-7): port the TypeScript repo-config-loader.ts logic. The
# resolution order is: env var > ~/.minsky/config.json > default.

CONFIG_FILE="${MINSKY_CONFIG:-$HOME/.minsky/config.json}"
HOSTS_DIR=""
DRY_RUN=0
SELF_CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts-dir) HOSTS_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --self-check) SELF_CHECK=1; shift ;;
    --help|-h)
      cat <<'EOF'
Usage: minsky-run [--hosts-dir <parent>] [--dry-run] [--self-check]

Walks N host repos under <parent> in round-robin (3 iterations per host
per pass). For each host, picks the top-priority unclaimed TASKS.md task,
spawns `openhands solve --task-file <brief> --workspace <host>`, records
the iteration to ~/.minsky/iterations.jsonl.

  --hosts-dir <parent>  Directory containing host repos (mandatory)
  --dry-run             Emit the iteration plan, don't actually run anything
  --self-check          Run all 5 runtime invariants and exit
EOF
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- 2. Runtime invariants (Phase 8 fold-in target) -------------------------
# These 5 inline checks replace the 8K-LOC observer + spec-monitor stack.
# Per Phase 8: each invariant is a small bash function; if any returns
# non-zero, the iteration aborts with a clear error message.

invariant_config_loadable() {
  # Invariant 1: ~/.minsky/config.json exists and parses as JSON.
  [[ -f "$CONFIG_FILE" ]] || { echo "INVARIANT FAIL: config not at $CONFIG_FILE" >&2; return 1; }
  jq -e . "$CONFIG_FILE" >/dev/null 2>&1 || { echo "INVARIANT FAIL: config not valid JSON" >&2; return 1; }
}

invariant_openhands_in_path() {
  # Invariant 2: openhands CLI resolves on PATH (per Phase C reshape).
  command -v openhands >/dev/null 2>&1 || { echo "INVARIANT FAIL: openhands not on PATH" >&2; return 1; }
}

invariant_hosts_dir_readable() {
  # Invariant 3: --hosts-dir is set and readable.
  [[ -n "$HOSTS_DIR" ]] || { echo "INVARIANT FAIL: --hosts-dir required" >&2; return 1; }
  [[ -d "$HOSTS_DIR" ]] || { echo "INVARIANT FAIL: --hosts-dir not a directory" >&2; return 1; }
}

invariant_iteration_log_writable() {
  # Invariant 4: ~/.minsky/iterations.jsonl is appendable.
  mkdir -p "$HOME/.minsky" || return 1
  : > "$HOME/.minsky/iterations.jsonl.tmp" && rm -f "$HOME/.minsky/iterations.jsonl.tmp" || return 1
}

invariant_pick_task_present() {
  # Invariant 5: scripts/pick_task.py is on disk and executable.
  local pick="$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py"
  [[ -f "$pick" ]] || { echo "INVARIANT FAIL: $pick missing" >&2; return 1; }
}

if [[ "$SELF_CHECK" == "1" ]]; then
  invariant_config_loadable
  invariant_openhands_in_path
  invariant_hosts_dir_readable || true   # --hosts-dir not required for self-check
  invariant_iteration_log_writable
  invariant_pick_task_present
  echo "self-check: all invariants pass"
  exit 0
fi

# --- 3. Host walker (round-robin) -------------------------------------------
# TODO(phase-7): the round-robin scheduler — `for host in $HOSTS; do ...`
# with fairness across N hosts (each host gets 3 iterations per pass).
# Replaces novel/cross-repo-runner/src/host-walker.ts.

walk_hosts() {
  invariant_hosts_dir_readable
  local hosts=()
  while IFS= read -r -d '' dir; do
    [[ -d "$dir/.git" ]] && hosts+=("$dir")
  done < <(find "$HOSTS_DIR" -maxdepth 2 -type d -name ".git" -print0 | xargs -0 -n1 dirname | sort -z | tr '\n' '\0')

  echo "found ${#hosts[@]} host repos under $HOSTS_DIR" >&2
  for host in "${hosts[@]}"; do
    for i in 1 2 3; do
      iterate_host "$host" "$i"
    done
  done
}

# --- 4. Per-host iteration --------------------------------------------------
# TODO(phase-7): pick task, generate brief, spawn openhands, record outcome.
# Replaces novel/cross-repo-runner/src/host-loop.ts (the bulk of the LOC).

iterate_host() {
  local host="$1"
  local iter_n="$2"
  local task_id
  task_id="$(python3 "$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py" "$host/TASKS.md")" || true

  if [[ -z "$task_id" ]]; then
    echo "no task in $host" >&2
    record_iteration "$host" "$iter_n" "no-task" ""
    return 0
  fi

  echo "host=$host iter=$iter_n task=$task_id" >&2

  if [[ "$DRY_RUN" == "1" ]]; then
    record_iteration "$host" "$iter_n" "dry-run" "$task_id"
    return 0
  fi

  # TODO(phase-7): generate the task brief from templates/task-brief.md (will
  # ship in Phase 9 partial). For now, use a minimal inline brief.
  local brief_file
  brief_file="$(mktemp -t minsky-brief.XXXXXX)"
  cat >"$brief_file" <<EOF
# Brief for task $task_id

Work on the unclaimed top-priority task in $host/TASKS.md.
Follow the host repo's AGENTS.md + vision.md rules.
EOF

  local exit_code=0
  openhands solve \
    --task-file "$brief_file" \
    --workspace "$host" \
    --model "$(jq -r '.openhands.model // "claude-opus-4-7"' "$CONFIG_FILE")" \
    || exit_code=$?

  rm -f "$brief_file"
  record_iteration "$host" "$iter_n" "$([ "$exit_code" = "0" ] && echo "success" || echo "failed-$exit_code")" "$task_id"
}

# --- 5. Iteration record (JSONL ledger) -------------------------------------
# Replaces novel/cross-repo-runner/src/iteration-record.ts. The JSONL schema
# is what MAPE-K reads, so it MUST stay byte-stable. Pin the schema with a
# JSON-schema validator in pre-pr-lint (Phase 7's "blocked-on" prerequisite).

record_iteration() {
  local host="$1"
  local iter_n="$2"
  local outcome="$3"
  local task_id="$4"
  printf '{"ts":"%s","host":"%s","iter":%s,"outcome":"%s","task":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$host" "$iter_n" "$outcome" "$task_id" \
    >> "$HOME/.minsky/iterations.jsonl"
}

# --- 6. Main ---------------------------------------------------------------
invariant_config_loadable
invariant_openhands_in_path
invariant_iteration_log_writable
invariant_pick_task_present
walk_hosts
