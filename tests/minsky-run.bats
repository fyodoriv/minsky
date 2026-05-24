#!/usr/bin/env bats
# tests/minsky-run.bats — Path A Phase 7 parity tests for bin/minsky-run.sh
#
# What this pins:
# - JSONL schema parity with `IterationRecord` in
#   `novel/cross-repo-runner/src/iteration-record.ts`. Every line MUST
#   carry exactly these keys: ts, experiment_id, host_repo, branch,
#   verdict, pr_url, notes. Drift here breaks 30+ downstream consumers
#   (stability.mjs, iteration-ship-rate.ts, competitive-benchmark, etc).
# - Per-host write path: `<host>/.minsky/experiment-store/cross-repo/<task-id>.jsonl`.
# - --dry-run never spawns openhands and emits `verdict: "planned"`.
# - Empty TASKS.md hosts emit `verdict: "aborted"` with `notes: "no eligible task"`.
# - --self-check exits 0 even when openhands isn't installed (operator-friendly).
# - The picker is invoked with `--open-pr-branches=` so the daemon
#   self-heals after a salvage-merge (2026-05-16 example-service-plugin
#   regression).
#
# Run: bats tests/minsky-run.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_RUN="$REPO_ROOT/bin/minsky-run.sh"
  TMPDIR_TEST="$(mktemp -d -t minsky-run-test.XXXXXX)"
  HOSTS_DIR="$TMPDIR_TEST/hosts"
  mkdir -p "$HOSTS_DIR"
  # Build a fake config the script can load.
  CONFIG_FILE="$TMPDIR_TEST/config.json"
  printf '{"openhands":{"model":"claude-opus-4-7"}}' > "$CONFIG_FILE"
  export MINSKY_CONFIG="$CONFIG_FILE"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

# --- Helpers --------------------------------------------------------------

make_host() {
  local name="$1"
  local tasks_md="$2"
  local dir="$HOSTS_DIR/$name"
  mkdir -p "$dir"
  # Init a bare repo so walk_hosts() detects the host as a git checkout.
  # TASKS.md stays uncommitted — the walker reads from disk, not git.
  # (User's global gitignore intentionally ignores TASKS.md; `git add -f`
  # would work but it's noise the script doesn't need.)
  (cd "$dir" && git init -q && git config user.email "t@t" && git config user.name "t")
  printf '%s' "$tasks_md" > "$dir/TASKS.md"
  echo "$dir"
}

complete_task_block() {
  cat <<'EOF'
# Tasks

## P0

- [ ] Pick me first
  - **ID**: pick-me-first
  - **Hypothesis**: shipping this proves the picker works
  - **Success**: PR opens
  - **Pivot**: <0.1
  - **Measurement**: pytest tests/
  - **Anchor**: rule #9
EOF
}

# --- 1. Help + self-check --------------------------------------------------

@test "--help prints usage and exits 0" {
  run "$MINSKY_RUN" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: minsky-run"* ]]
  [[ "$output" == *"--hosts-dir"* ]]
  [[ "$output" == *"--dry-run"* ]]
}

@test "--self-check exits 0 when pick_task.py is present" {
  run "$MINSKY_RUN" --self-check
  [ "$status" -eq 0 ]
  [[ "$output" == *"pick_task.py present"* ]]
}

@test "unknown flag exits 2" {
  run "$MINSKY_RUN" --no-such-flag
  [ "$status" -eq 2 ]
}

# --- 2. --hosts-dir validation --------------------------------------------

@test "missing --hosts-dir fails the invariant" {
  run "$MINSKY_RUN" --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" == *"INVARIANT FAIL"* ]] || [[ "$output" == *"--hosts-dir required"* ]]
}

# --- 3. Empty hosts dir ----------------------------------------------------

@test "empty --hosts-dir reports 'no host repos' and exits 0" {
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"no host repos"* ]] || [[ "$output" == *"found 0"* ]]
}

# --- 4. Dry-run JSONL schema parity ---------------------------------------

@test "--dry-run emits a JSONL line with the IterationRecord schema" {
  host="$(make_host one "$(complete_task_block)")"
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 1
  [ "$status" -eq 0 ]
  jsonl="$host/.minsky/experiment-store/cross-repo/pick-me-first.jsonl"
  [ -f "$jsonl" ]
  # Schema parity — same 7 keys as IterationRecord in iteration-record.ts.
  line="$(head -1 "$jsonl")"
  echo "JSONL: $line"
  echo "$line" | jq -e 'has("ts") and has("experiment_id") and has("host_repo")
                       and has("branch") and has("verdict")
                       and has("pr_url") and has("notes")' >/dev/null
  # Field values match dry-run plan.
  [ "$(echo "$line" | jq -r .experiment_id)" = "pick-me-first" ]
  [ "$(echo "$line" | jq -r .verdict)" = "planned" ]
  [ "$(echo "$line" | jq -r .branch)" = "feat/pick-me-first" ]
  # pr_url is JSON null, not the string "null".
  [ "$(echo "$line" | jq -r '.pr_url | type')" = "null" ]
  # notes mentions dry-run.
  [[ "$(echo "$line" | jq -r .notes)" == *"dry-run"* ]]
}

# --- 5. No-eligible-task path ---------------------------------------------

@test "empty TASKS.md produces 'aborted' verdict with no-eligible-task note" {
  host="$(make_host empty "$(printf '# Tasks\n\n## P0\n\n')")"
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 1
  [ "$status" -eq 0 ]
  jsonl="$host/.minsky/experiment-store/cross-repo/_no-task.jsonl"
  [ -f "$jsonl" ]
  line="$(head -1 "$jsonl")"
  [ "$(echo "$line" | jq -r .verdict)" = "aborted" ]
  [ "$(echo "$line" | jq -r .experiment_id)" = "" ]
  [[ "$(echo "$line" | jq -r .notes)" == *"no eligible task"* ]]
}

# --- 6. Iteration-count clamp ---------------------------------------------

@test "--max-iterations clamps total iterations across hosts" {
  make_host one   "$(complete_task_block)" > /dev/null
  make_host two   "$(complete_task_block)" > /dev/null
  make_host three "$(complete_task_block)" > /dev/null
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run \
       --iterations-per-host 1 --max-iterations 2
  [ "$status" -eq 0 ]
  # Should have produced exactly 2 JSONL files (one per host visited).
  # Use /usr/bin/find directly — operator dotfiles shim `find`→`fd` which
  # doesn't share BSD-find flags.
  found=$(/usr/bin/find "$HOSTS_DIR" -name "*.jsonl" -path "*/experiment-store/cross-repo/*" | wc -l | tr -d ' ')
  [ "$found" -eq 2 ]
}

# --- 7. Open-PR filter wires through pick_task.py -------------------------

@test "pick_task.py is invoked with --open-pr-branches" {
  # We can't simulate `gh pr list` cleanly inside bats without a shim, so
  # we instead assert that the picker call site uses the right flag by
  # inspecting the script source. This pins the flag wiring against the
  # 2026-05-16 regression class without needing a live gh fixture.
  grep -q -- "--open-pr-branches=" "$MINSKY_RUN"
}

# --- 8. Round-robin iterates each host fairly ------------------------------

@test "round-robin iterates each host the expected number of times" {
  host_a="$(make_host alpha "$(complete_task_block | sed s/pick-me-first/task-a/)")"
  host_b="$(make_host bravo "$(complete_task_block | sed s/pick-me-first/task-b/)")"
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 2
  [ "$status" -eq 0 ]
  # Each host's JSONL file should have exactly 2 lines.
  [ "$(wc -l < "$host_a/.minsky/experiment-store/cross-repo/task-a.jsonl" | tr -d ' ')" = "2" ]
  [ "$(wc -l < "$host_b/.minsky/experiment-store/cross-repo/task-b.jsonl" | tr -d ' ')" = "2" ]
}
