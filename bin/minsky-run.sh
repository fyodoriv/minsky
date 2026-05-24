#!/usr/bin/env bash
# bin/minsky-run.sh — Path A Phase 7 host walker
# ============================================================================
#
# Status: WORKING SKELETON. JSONL records emitted on every iteration are
# byte-compatible with `IterationRecord` in
# `novel/cross-repo-runner/src/iteration-record.ts` (the 30+ consumer
# stack — stability.mjs, iteration-ship-rate.ts, competitive-benchmark,
# render-watch-frame.sh, etc — depends on this schema staying stable).
#
# Replaces (when wired into `bin/minsky` in a follow-up):
#   - `novel/cross-repo-runner/src/host-walker.ts` (round-robin)
#   - `novel/cross-repo-runner/src/host-loop.ts` (per-iter outer loop)
#   - `novel/cross-repo-runner/src/iteration-record.ts` (JSONL writer)
# Companion file: `scripts/pick_task.py` (TASKS.md parser + picker —
# parity-tested against task-finder.ts at tests/test_pick_task.py).
#
# Parity-test discipline: `tests/minsky-run.bats` asserts the JSONL line
# shape; deletion of `novel/cross-repo-runner/` (Phase 7b) is gated on
# parity holding end-to-end. Pivot per the P0 task body: "revert if the
# rewrite hits >100h of integration debugging".
#
# Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
#
# ============================================================================

set -euo pipefail

# --- 1. Configuration loading -----------------------------------------------
# Load ~/.minsky/config.json (cloud_agent, local_agent, openhands.model, ...).
# Resolution order: env var > ~/.minsky/config.json > built-in default.

CONFIG_FILE="${MINSKY_CONFIG:-$HOME/.minsky/config.json}"
HOSTS_DIR=""
DRY_RUN=0
SELF_CHECK=0
MAX_ITERATIONS=0       # 0 = unbounded (matches TS runner default)
ITERATIONS_PER_HOST=3  # matches the TS scheduler's round-robin slice size

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts-dir) HOSTS_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --self-check) SELF_CHECK=1; shift ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --iterations-per-host) ITERATIONS_PER_HOST="$2"; shift 2 ;;
    --help|-h)
      cat <<'EOF'
Usage: minsky-run [--hosts-dir <parent>] [--dry-run] [--self-check]
                  [--max-iterations N] [--iterations-per-host N]

Walks N host repos under <parent> in round-robin. For each host, picks
the top-priority unclaimed TASKS.md task (rule-9 fields validated by
scripts/pick_task.py), spawns `openhands solve --task-file <brief>
--workspace <host>`, records the iteration to:
  <host>/.minsky/experiment-store/cross-repo/<task-id>.jsonl

Flags:
  --hosts-dir <parent>      Directory containing host repos (required for run)
  --dry-run                 Plan + record "planned" verdict, don't spawn
  --self-check              Run all 5 runtime invariants and exit 0
  --max-iterations N        Stop after N total iterations across all hosts
                            (default 0 = unbounded)
  --iterations-per-host N   Round-robin slice size (default 3, matches TS)

Environment:
  MINSKY_CONFIG             Override config path (default ~/.minsky/config.json)
EOF
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- 2. Runtime invariants (Phase 8 fold-in target) -------------------------
# These 5 inline checks replace the 8K-LOC observer + spec-monitor stack
# Phase 8 inlines further. Each invariant prints to stderr on failure.

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

invariant_host_experiment_store_writable() {
  # Invariant 4: each host's .minsky/experiment-store/cross-repo/ is creatable.
  local host="$1"
  local dir="$host/.minsky/experiment-store/cross-repo"
  mkdir -p "$dir" || { echo "INVARIANT FAIL: cannot create $dir" >&2; return 1; }
  [[ -w "$dir" ]] || { echo "INVARIANT FAIL: $dir not writable" >&2; return 1; }
}

invariant_pick_task_present() {
  # Invariant 5: scripts/pick_task.py is on disk.
  local pick
  pick="$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py"
  [[ -f "$pick" ]] || { echo "INVARIANT FAIL: $pick missing" >&2; return 1; }
}

if [[ "$SELF_CHECK" == "1" ]]; then
  invariant_config_loadable || true   # may be missing on a fresh machine
  invariant_openhands_in_path || true # may be missing pre-openhands-install
  invariant_pick_task_present
  echo "self-check: pick_task.py present; config + openhands probed (see stderr)"
  exit 0
fi

# --- 3. Open-PR set (filter out tasks with in-flight PRs) -------------------
# Wires through to pick_task.py via --open-pr-branches=<csv>. Without this,
# the daemon re-picks the same task on every iteration after a salvage-
# merge (2026-05-16 oncall-hub-plugin regression).

current_open_pr_branches() {
  # Print a CSV of feat/<id> branches with currently-open PRs in the
  # current repo. Safe-default to empty on `gh` errors (rule #7).
  local host="$1"
  ( cd "$host" && gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null ) \
    | paste -sd, - 2>/dev/null || true
}

# --- 4. Host walker (round-robin) -------------------------------------------
# Replaces novel/cross-repo-runner/src/host-walker.ts. Walks every git
# repo under $HOSTS_DIR (one level deep), gives each host N iterations
# in turn (round-robin fairness), stops at $MAX_ITERATIONS if set.

ITER_COUNT=0

walk_hosts() {
  invariant_hosts_dir_readable
  local hosts=()
  # Pure-bash globbing — portable everywhere (`find` is shimmed to `fd`
  # on some operator machines, and `fd` doesn't accept the same args).
  # One level deep: $HOSTS_DIR/*/.git → host = ${d%/.git}.
  shopt -s nullglob
  local d
  for d in "$HOSTS_DIR"/*/; do
    [[ -d "${d}.git" ]] && hosts+=("${d%/}")
  done
  shopt -u nullglob
  # Deterministic order so round-robin tests are reproducible.
  if [[ ${#hosts[@]} -gt 0 ]]; then
    IFS=$'\n' read -r -d '' -a hosts < <(printf '%s\n' "${hosts[@]}" | LC_ALL=C sort && printf '\0') || true
  fi

  echo "found ${#hosts[@]} host repos under $HOSTS_DIR" >&2
  if [[ ${#hosts[@]} -eq 0 ]]; then
    echo "no host repos found — nothing to do" >&2
    return 0
  fi

  for host in "${hosts[@]}"; do
    local n
    for ((n=1; n <= ITERATIONS_PER_HOST; n++)); do
      [[ "$MAX_ITERATIONS" -gt 0 && "$ITER_COUNT" -ge "$MAX_ITERATIONS" ]] && return 0
      # Break the inner loop when the host has no eligible task — no
      # point burning N round-robin slots emitting "aborted" records;
      # move to the next host. Matches host-walker.ts behaviour.
      iterate_host "$host" "$n" || { ITER_COUNT=$((ITER_COUNT + 1)); break; }
      ITER_COUNT=$((ITER_COUNT + 1))
    done
  done
}

# --- 5. Per-host iteration --------------------------------------------------
# Replaces novel/cross-repo-runner/src/host-loop.ts (the bulk of the LOC).
# One iteration = (a) pick a task, (b) cut a branch, (c) spawn openhands,
# (d) record the verdict in the host's experiment-store JSONL.

iterate_host() {
  local host="$1"
  local iter_n="$2"
  local script_dir
  script_dir="$(dirname "${BASH_SOURCE[0]}")"
  invariant_host_experiment_store_writable "$host"

  # Tasks with open PRs are skipped (matches host-loop.ts behaviour added
  # for the 2026-05-16 oncall-hub-plugin regression).
  local open_branches
  open_branches="$(current_open_pr_branches "$host")"
  local task_id
  task_id="$(python3 "$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py" \
    "$host/TASKS.md" \
    "--open-pr-branches=${open_branches}" \
    2>/dev/null || true)"

  if [[ -z "$task_id" ]]; then
    record_iteration "$host" "$iter_n" "" "" "aborted" "" "no eligible task"
    echo "no eligible task in $host" >&2
    # Return non-zero so walk_hosts() breaks the inner loop and moves
    # to the next host instead of burning N round-robin slots emitting
    # repeated "aborted" records (matches host-walker.ts).
    return 1
  fi

  local branch="feat/${task_id}"
  echo "host=$host iter=$iter_n task=$task_id branch=$branch" >&2

  if [[ "$DRY_RUN" == "1" ]]; then
    record_iteration "$host" "$iter_n" "$task_id" "$branch" "planned" "" "dry-run; no spawn"
    return 0
  fi

  # Build the brief via scripts/build_brief.py — full TS-parity brief
  # with the task block + system-prompt overlay (constitution + FINAL
  # STEP block). Replaces the 4-line stub. Falls back to a minimal
  # stub if the builder errors out (rule #6 — let it crash AT the
  # right boundary; an iteration with a bad brief is better than one
  # with no brief).
  local brief_file
  brief_file="$(mktemp -t minsky-brief.XXXXXX)"
  if ! python3 "$script_dir/../scripts/build_brief.py" \
       "$task_id" "$host" > "$brief_file" 2>/dev/null; then
    echo "WARN: build_brief.py failed for $task_id; falling back to stub" >&2
    cat >"$brief_file" <<EOF
# Brief for task ${task_id}

Work on the unclaimed top-priority task in $host/TASKS.md.
Follow the host repo's AGENTS.md + vision.md rules.
EOF
  fi

  local model
  model="$(jq -r '.openhands.model // "claude-opus-4-7"' "$CONFIG_FILE" 2>/dev/null || echo "claude-opus-4-7")"
  local exit_code=0
  local stdout_log
  stdout_log="$(mktemp -t minsky-stdout.XXXXXX)"

  # Dynamic watchdog — p95×1.5 of recent successful iterations, with a
  # conservative 1200s (20min) fallback when history is thin. Mirrors the
  # TS `dynamic-timeouts.ts` algorithm (rule #1 — port, don't reinvent).
  # Exit code 124 means the watchdog fired (matches GNU `timeout(1)`).
  local watchdog_s
  watchdog_s="$(python3 "$script_dir/../scripts/dynamic_timeout.py" "$host")"
  local start_ms
  start_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"

  # Watchdog binary resolution order (rule #1 — prefer existing solutions):
  #   1. Python wrapper at scripts/spawn_with_watchdog.py — POSIX-portable,
  #      handles process-group SIGTERM/SIGKILL, no external deps.
  #   2. GNU `timeout` (Linux default; Ubuntu CI runners).
  #   3. `gtimeout` (macOS with `brew install coreutils`).
  #   4. No wrapper — graceful degrade (rule #6); a hung openhands hangs
  #      the daemon. Logged at warn-level so operators know.
  local spawn_wrapper="$script_dir/../scripts/spawn_with_watchdog.py"
  if [[ -x "$spawn_wrapper" ]]; then
    python3 "$spawn_wrapper" "$watchdog_s" openhands solve \
      --task-file "$brief_file" \
      --workspace "$host" \
      --model "$model" \
      >"$stdout_log" 2>&1 || exit_code=$?
  elif command -v timeout >/dev/null 2>&1; then
    timeout "${watchdog_s}s" openhands solve \
      --task-file "$brief_file" \
      --workspace "$host" \
      --model "$model" \
      >"$stdout_log" 2>&1 || exit_code=$?
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${watchdog_s}s" openhands solve \
      --task-file "$brief_file" \
      --workspace "$host" \
      --model "$model" \
      >"$stdout_log" 2>&1 || exit_code=$?
  else
    echo "WARN: no watchdog available — running unbounded openhands" >&2
    openhands solve \
      --task-file "$brief_file" \
      --workspace "$host" \
      --model "$model" \
      >"$stdout_log" 2>&1 || exit_code=$?
  fi
  local end_ms
  end_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  local duration_ms=$((end_ms - start_ms))

  local verdict notes pr_url
  if [[ "$exit_code" -eq 0 ]]; then
    verdict="validated"
    pr_url="$(grep -oE 'https://github\.com/[^[:space:]]+/pull/[0-9]+' "$stdout_log" | head -1 || true)"
    notes="openhands exited 0; ${duration_ms}ms"
  elif [[ "$exit_code" -eq 124 ]]; then
    # GNU timeout(1) exits 124 when the watchdog fires.
    verdict="spawn-failed"
    pr_url=""
    notes="timeout (${watchdog_s}s); ${duration_ms}ms"
  else
    verdict="spawn-failed"
    pr_url=""
    notes="openhands exited $exit_code; ${duration_ms}ms; tail: $(tail -1 "$stdout_log" | tr -d '"' | cut -c1-100)"
  fi

  rm -f "$brief_file" "$stdout_log"
  record_iteration "$host" "$iter_n" "$task_id" "$branch" "$verdict" "$pr_url" "$notes"
}

# --- 6. Iteration record (JSONL ledger) -------------------------------------
# Replaces novel/cross-repo-runner/src/iteration-record.ts. Schema MUST
# match `IterationRecord` because 30+ consumers depend on it (see grep
# of `experiment_id\|host_repo\|verdict` against the tree).
#
# Path: $host/.minsky/experiment-store/cross-repo/<task-id>.jsonl
# Per-host append-only, per-task file (matches host-loop.ts writePath).

record_iteration() {
  local host="$1"
  local iter_n="$2"     # not in the schema; kept as a stderr breadcrumb
  local task_id="$3"
  local branch="$4"
  local verdict="$5"
  local pr_url="$6"
  local notes="$7"
  local store_dir="$host/.minsky/experiment-store/cross-repo"
  mkdir -p "$store_dir"
  local out
  # When no task was found, write to a sentinel file so the no-eligible-
  # task event is still observable (matches host-loop.ts's empty-host run).
  local file_id="${task_id:-_no-task}"
  local path="$store_dir/${file_id}.jsonl"

  # The host_repo field is the operator-friendly form: `<basename>` if
  # the path is unambiguous, otherwise the full path. The TypeScript
  # version uses `<owner>/<repo>` from `gh repo view`; we degrade
  # gracefully to the basename when `gh` isn't available. (Explicit
  # if/else avoids the SC2015 "A && B || C" ambiguity.)
  local host_repo
  if host_repo="$( cd "$host" && gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null )" \
     && [[ -n "$host_repo" ]]; then
    :
  else
    host_repo="$(basename "$host")"
  fi

  # The pr_url field is JSON null when empty (not the string "null").
  local pr_url_json
  if [[ -z "$pr_url" ]]; then
    pr_url_json="null"
  else
    pr_url_json="$(jq -n --arg u "$pr_url" '$u')"
  fi

  out="$(jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --arg experiment_id "$task_id" \
    --arg host_repo "$host_repo" \
    --arg branch "$branch" \
    --arg verdict "$verdict" \
    --argjson pr_url "$pr_url_json" \
    --arg notes "$notes" \
    '{ts: $ts, experiment_id: $experiment_id, host_repo: $host_repo, branch: $branch, verdict: $verdict, pr_url: $pr_url, notes: $notes}')"
  printf '%s\n' "$out" >> "$path"
}

# --- 7. Main ---------------------------------------------------------------
# Skip openhands invariant when --dry-run is set (no spawn). The other
# four are hard requirements.
invariant_config_loadable
[[ "$DRY_RUN" == "1" ]] || invariant_openhands_in_path
invariant_pick_task_present
walk_hosts
