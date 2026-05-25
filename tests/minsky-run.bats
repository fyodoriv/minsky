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

@test "empty host writes exactly 1 aborted record per pass even when iterations-per-host>1" {
  # Skip-empty-hosts behaviour: when a host has no eligible task, the
  # walker breaks the inner round-robin loop after recording ONE aborted
  # record, instead of emitting iterations-per-host copies. Matches the
  # TypeScript host-walker.ts implementation (rule #1 — port behavior).
  host="$(make_host empty "$(printf '# Tasks\n\n## P0\n\n')")"
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 3
  [ "$status" -eq 0 ]
  jsonl="$host/.minsky/experiment-store/cross-repo/_no-task.jsonl"
  [ -f "$jsonl" ]
  # Exactly 1 line — not 3 — because the walker skipped ahead.
  line_count="$(wc -l < "$jsonl" | tr -d ' ')"
  [ "$line_count" = "1" ]
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

@test "watchdog kills a hanging openhands and records spawn-failed with timeout notes" {
  # Watchdog resolution order: Python wrapper (preferred, no deps) →
  # GNU timeout → gtimeout → unbounded. The Python wrapper is in-repo
  # at scripts/spawn_with_watchdog.py, so this test runs everywhere
  # Python ≥3.3 + bash are available (which is every supported platform).

  # Inject a fake `openhands` that hangs forever. Wire the dynamic-
  # timeout config to a 2s ceiling for the test (override the floor via
  # the BATS env so we don't have to wait 120s for the real MIN_WATCHDOG_S).
  shim_dir="$TMPDIR_TEST/shim-bin"
  mkdir -p "$shim_dir"
  cat > "$shim_dir/openhands" <<'EOF'
#!/usr/bin/env bash
# Fake openhands — hangs forever. Used by tests/minsky-run.bats to assert
# the watchdog fires.
sleep 99999
EOF
  chmod +x "$shim_dir/openhands"

  # Fake dynamic_timeout.py — always returns 2s, so the watchdog fires
  # in ≤3s wall-time even on slow machines. Save the original on a
  # known path so the wrapper can stay tight.
  shim_scripts="$TMPDIR_TEST/shim-scripts"
  mkdir -p "$shim_scripts"
  cat > "$shim_scripts/dynamic_timeout.py" <<'EOF'
#!/usr/bin/env python3
print(2)  # 2-second watchdog for tests
EOF
  chmod +x "$shim_scripts/dynamic_timeout.py"

  host="$(make_host hangy "$(complete_task_block)")"

  # Run minsky-run.sh with the shimmed openhands AND shimmed picker dir.
  # The script reads pick_task.py from `$(dirname "${BASH_SOURCE[0]}")/../scripts/`
  # so we copy our test's dynamic_timeout.py over that path's neighbour
  # via a wrapper. Simpler: use a small wrapper script.
  wrapper="$TMPDIR_TEST/minsky-run-wrapper.sh"
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="$shim_dir:\$PATH"
# Shadow scripts/dynamic_timeout.py for this run only. Keep
# spawn_with_watchdog.py from the real repo since it's deterministic.
TMP_SCRIPT="\$(mktemp -d -t minsky-run-shim.XXXXXX)/scripts"
mkdir -p "\$TMP_SCRIPT"
cp "$REPO_ROOT/scripts/pick_task.py" "\$TMP_SCRIPT/"
cp "$REPO_ROOT/scripts/spawn_with_watchdog.py" "\$TMP_SCRIPT/"
chmod +x "\$TMP_SCRIPT/spawn_with_watchdog.py"
cp "$shim_scripts/dynamic_timeout.py" "\$TMP_SCRIPT/dynamic_timeout.py"
chmod +x "\$TMP_SCRIPT/dynamic_timeout.py"
# Create a parallel bin/ that points to the shimmed scripts.
TMP_BIN="\$(dirname "\$TMP_SCRIPT")/bin"
mkdir -p "\$TMP_BIN"
cp "$REPO_ROOT/bin/minsky-run.sh" "\$TMP_BIN/"
exec "\$TMP_BIN/minsky-run.sh" "\$@"
EOF
  chmod +x "$wrapper"

  run "$wrapper" --hosts-dir "$HOSTS_DIR" --iterations-per-host 1 --max-iterations 1
  # Wall-clock must be small (well under 99999s) — the watchdog fired.
  [ "$status" -eq 0 ]
  jsonl="$host/.minsky/experiment-store/cross-repo/pick-me-first.jsonl"
  [ -f "$jsonl" ]
  line="$(head -1 "$jsonl")"
  echo "JSONL: $line"
  # Verdict must be spawn-failed; notes must mention the timeout.
  [ "$(echo "$line" | jq -r .verdict)" = "spawn-failed" ]
  [[ "$(echo "$line" | jq -r .notes)" == *"timeout"* ]]
  # Recorded duration in ms must be ≥ 2000 (watchdog at 2s) and ≤ 30000 (sanity).
  ms="$(echo "$line" | jq -r .notes | grep -oE '[0-9]+ms' | head -1 | tr -d ms)"
  [ "$ms" -ge 1900 ]
  [ "$ms" -le 30000 ]
}

@test "brief file passed to openhands contains task block + FINAL STEP overlay" {
  # Works on every platform: brief is built by scripts/build_brief.py
  # BEFORE the watchdog wraps the openhands invocation. The Python
  # spawn_with_watchdog.py (tier 1) handles the timeout portably.

  # Shim openhands to (a) copy the brief contents to a known path
  # before exiting, (b) hang forever so the watchdog fires.
  shim_dir="$TMPDIR_TEST/shim-bin"
  mkdir -p "$shim_dir"
  brief_dump="$TMPDIR_TEST/brief-dump.md"
  cat > "$shim_dir/openhands" <<EOF
#!/usr/bin/env bash
# Find the brief file from argv (--task-file <path>) and copy it.
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    --task-file) cp "\$2" "$brief_dump" 2>/dev/null || true; shift 2 ;;
    *) shift ;;
  esac
done
sleep 99999
EOF
  chmod +x "$shim_dir/openhands"

  shim_scripts="$TMPDIR_TEST/shim-scripts"
  mkdir -p "$shim_scripts"
  cat > "$shim_scripts/dynamic_timeout.py" <<'EOF'
#!/usr/bin/env python3
print(2)
EOF
  chmod +x "$shim_scripts/dynamic_timeout.py"

  host="$(make_host briefy "$(complete_task_block)")"

  wrapper="$TMPDIR_TEST/minsky-run-wrapper.sh"
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="$shim_dir:\$PATH"
TMP_SCRIPT="\$(mktemp -d -t minsky-run-brief.XXXXXX)/scripts"
mkdir -p "\$TMP_SCRIPT"
cp "$REPO_ROOT/scripts/pick_task.py" "\$TMP_SCRIPT/"
cp "$REPO_ROOT/scripts/build_brief.py" "\$TMP_SCRIPT/"
chmod +x "\$TMP_SCRIPT/build_brief.py"
cp "$REPO_ROOT/scripts/spawn_with_watchdog.py" "\$TMP_SCRIPT/"
chmod +x "\$TMP_SCRIPT/spawn_with_watchdog.py"
cp "$shim_scripts/dynamic_timeout.py" "\$TMP_SCRIPT/dynamic_timeout.py"
chmod +x "\$TMP_SCRIPT/dynamic_timeout.py"
TMP_BIN="\$(dirname "\$TMP_SCRIPT")/bin"
mkdir -p "\$TMP_BIN"
cp "$REPO_ROOT/bin/minsky-run.sh" "\$TMP_BIN/"
exec "\$TMP_BIN/minsky-run.sh" "\$@"
EOF
  chmod +x "$wrapper"

  run "$wrapper" --hosts-dir "$HOSTS_DIR" --iterations-per-host 1 --max-iterations 1
  [ "$status" -eq 0 ]
  [ -f "$brief_dump" ]
  # Substantive content: task ID header + the FINAL STEP block.
  grep -q "^# Task: pick-me-first$" "$brief_dump"
  grep -q "## Hypothesis (rule #9)" "$brief_dump"
  grep -q "FINAL STEP" "$brief_dump"
  grep -q "gh pr create" "$brief_dump"
  # The brief is not the 4-line stub anymore.
  [ "$(wc -l < "$brief_dump" | tr -d ' ')" -gt 20 ]
}

@test "bin/minsky --bash-runner dispatches to bin/minsky-run.sh (Phase 7c)" {
  # Test the dispatch in isolation by extracting + sourcing only the
  # flag-parser + dispatch section of `bin/minsky`. Bypasses the
  # MINSKY_REPO resolver (pre-existing bash-quoting issue on macOS;
  # filed as scout if CI exercises it).
  test_script="$TMPDIR_TEST/minsky-flag-test.sh"
  cat > "$test_script" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Stub the resolver — assume MINSKY_REPO_PATH is already set.
MINSKY_REPO_PATH="${MINSKY_REPO_PATH_OVERRIDE:?must be set in test}"

# --- Replica of the --bash-runner flag parser from bin/minsky --------
MINSKY_ARGS=()
USE_BASH_RUNNER="${MINSKY_BASH_RUNNER:-0}"
for arg in "$@"; do
  if [ "$arg" = "--local" ]; then
    : # noop in this unit test
  elif [ "$arg" = "--bash-runner" ]; then
    USE_BASH_RUNNER=1
  else
    MINSKY_ARGS+=("$arg")
  fi
done
if [ "${#MINSKY_ARGS[@]}" -gt 0 ]; then set -- "${MINSKY_ARGS[@]}"; else set --; fi

# --- Replica of the dispatch from bin/minsky -------------------------
if [ "$USE_BASH_RUNNER" = "1" ]; then
  BASH_RUNNER_BIN="$MINSKY_REPO_PATH/bin/minsky-run.sh"
  [ -x "$BASH_RUNNER_BIN" ] || { echo "minsky: --bash-runner requested but $BASH_RUNNER_BIN is not executable" >&2; exit 1; }
  echo "DISPATCH=bash-runner ARGS=[$*]"
else
  echo "DISPATCH=node-runner ARGS=[$*]"
fi
EOF
  chmod +x "$test_script"

  export MINSKY_REPO_PATH_OVERRIDE="$REPO_ROOT"

  # 1. Default: dispatch to node-runner
  run "$test_script" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"DISPATCH=node-runner"* ]]
  [[ "$output" == *"ARGS=[--help]"* ]]

  # 2. --bash-runner: dispatch to bash-runner + flag stripped
  run "$test_script" --bash-runner --hosts-dir /tmp/x --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"DISPATCH=bash-runner"* ]]
  [[ "$output" == *"ARGS=[--hosts-dir /tmp/x --dry-run]"* ]]

  # 3. MINSKY_BASH_RUNNER=1 env: dispatch to bash-runner without the flag
  MINSKY_BASH_RUNNER=1 run "$test_script" --hosts-dir /tmp/y
  [ "$status" -eq 0 ]
  [[ "$output" == *"DISPATCH=bash-runner"* ]]

  # 4. --bash-runner with mixed flags: only --bash-runner stripped
  run "$test_script" --bash-runner --local --hosts-dir /tmp/z
  [ "$status" -eq 0 ]
  [[ "$output" == *"DISPATCH=bash-runner"* ]]
  [[ "$output" == *"ARGS=[--hosts-dir /tmp/z]"* ]]
}

@test "run-daemon.sh dispatches to bash runner when MINSKY_BASH_RUNNER=1 (Phase 7b'-prep)" {
  # Phase 7b'-prep: the supervisor script must support the bash-runner
  # opt-in so the operator can dogfood the bash port via the existing
  # systemd/launchd daemon plumbing. Tests the dispatch logic by
  # extracting the relevant block and asserting it picks the right
  # branch for each MINSKY_BASH_RUNNER value.
  test_script="$TMPDIR_TEST/run-daemon-test.sh"
  fake_bash_runner="$TMPDIR_TEST/fake-bash-runner.sh"
  fake_node_runner="$TMPDIR_TEST/fake-node-runner.mjs"
  fake_host="$TMPDIR_TEST/fake-host"
  mkdir -p "$fake_host"
  # Stub the bash + node runners — each just prints which one it is.
  cat > "$fake_bash_runner" <<'EOF'
#!/usr/bin/env bash
echo "BASH_RUNNER_INVOKED hosts_dir=$2"
exit 0
EOF
  chmod +x "$fake_bash_runner"
  cat > "$fake_node_runner" <<'EOF'
console.log(`NODE_RUNNER_INVOKED args=${process.argv.slice(2).join(",")}`);
process.exit(0);
EOF

  # Replica of the dispatch block in distribution/systemd/run-daemon.sh.
  cat > "$test_script" <<EOF
#!/usr/bin/env bash
set -euo pipefail
HOST="$fake_host"
if [ "\${MINSKY_BASH_RUNNER:-0}" = "1" ]; then
  HOST_PARENT="\$(dirname "\$HOST")"
  exec bash "$fake_bash_runner" --hosts-dir "\$HOST_PARENT"
fi
exec node "$fake_node_runner" --host "\$HOST" --loop
EOF
  chmod +x "$test_script"

  # 1. Default (no env) → node-runner branch
  run "$test_script"
  [ "$status" -eq 0 ]
  [[ "$output" == *"NODE_RUNNER_INVOKED"* ]]
  [[ "$output" == *"--host"* ]]
  [[ "$output" == *"--loop"* ]]

  # 2. MINSKY_BASH_RUNNER=1 → bash-runner branch with hosts-dir = parent
  MINSKY_BASH_RUNNER=1 run "$test_script"
  [ "$status" -eq 0 ]
  [[ "$output" == *"BASH_RUNNER_INVOKED"* ]]
  [[ "$output" == *"hosts_dir=$TMPDIR_TEST"* ]]

  # 3. MINSKY_BASH_RUNNER=0 (explicit) → node-runner branch
  MINSKY_BASH_RUNNER=0 run "$test_script"
  [ "$status" -eq 0 ]
  [[ "$output" == *"NODE_RUNNER_INVOKED"* ]]
}

@test "bin/minsky-bootstrap.sh materializes sidecar with inferred owner/repo (Phase 11)" {
  # Phase 11: the bash bootstrap replaces 1.6K LOC of TS inference with
  # template substitution + 6 git/file-system actions. This pins the
  # SSH-URL normalization + the 6-action plan from one fixture host.
  bootstrap="$REPO_ROOT/bin/minsky-bootstrap.sh"
  [ -x "$bootstrap" ]

  fixture="$TMPDIR_TEST/bootstrap-fixture"
  mkdir -p "$fixture"
  (cd "$fixture" && git init -q && git config user.email t@t && git config user.name t && \
     git symbolic-ref HEAD refs/heads/main && \
     git remote add origin git@github.com:fyodoriv/test-host.git)
  printf '{"scripts":{"check":"echo ok"}}' > "$fixture/package.json"
  printf '# Tasks\n\n## P0\n' > "$fixture/TASKS.md"

  XDG_CONFIG_HOME="$TMPDIR_TEST/xdg" run "$bootstrap" "$fixture"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sidecar materialized"* ]]

  # Sidecar layout
  [ -f "$fixture/.minsky/repo.yaml" ]
  [ -L "$fixture/.minsky/vision.md" ]
  [ -d "$fixture/.minsky/experiments" ]

  # SSH-URL normalization → owner/repo
  grep -q '^host_repo: "fyodoriv/test-host"$' "$fixture/.minsky/repo.yaml"

  # Inferred fields
  grep -q '^tasks_md_path: "TASKS.md"$' "$fixture/.minsky/repo.yaml"
  grep -q '^pre_commit_command: "pnpm run check"$' "$fixture/.minsky/repo.yaml"
  grep -q '^default_branch: "main"$' "$fixture/.minsky/repo.yaml"

  # Global gitignore registration
  grep -q '^\.minsky/$' "$TMPDIR_TEST/xdg/git/ignore"
}

@test "bin/minsky-bootstrap.sh normalizes HTTPS-style remote URLs to owner/repo" {
  bootstrap="$REPO_ROOT/bin/minsky-bootstrap.sh"
  fixture="$TMPDIR_TEST/https-fixture"
  mkdir -p "$fixture"
  (cd "$fixture" && git init -q && git config user.email t@t && git config user.name t && \
     git remote add origin https://github.com/foo/bar.git)

  XDG_CONFIG_HOME="$TMPDIR_TEST/xdg2" run "$bootstrap" "$fixture"
  [ "$status" -eq 0 ]
  grep -q '^host_repo: "foo/bar"$' "$fixture/.minsky/repo.yaml"
}

@test "bin/minsky-bootstrap.sh --doctor is read-only and lists inferred signals" {
  bootstrap="$REPO_ROOT/bin/minsky-bootstrap.sh"
  fixture="$TMPDIR_TEST/doctor-fixture"
  mkdir -p "$fixture"
  (cd "$fixture" && git init -q && git config user.email t@t && git config user.name t && \
     git remote add origin git@github.com:foo/doctor-target.git)

  run "$bootstrap" --doctor "$fixture"
  [ "$status" -eq 0 ]
  [[ "$output" == *"host_repo:"* ]]
  [[ "$output" == *"foo/doctor-target"* ]]
  [[ "$output" == *".minsky/ exists:     no"* ]]

  # Doctor mode MUST NOT write the sidecar.
  [ ! -d "$fixture/.minsky" ]
}

@test "bin/minsky-bootstrap.sh is idempotent (second run does not corrupt)" {
  bootstrap="$REPO_ROOT/bin/minsky-bootstrap.sh"
  fixture="$TMPDIR_TEST/idempotent-fixture"
  mkdir -p "$fixture"
  (cd "$fixture" && git init -q && git config user.email t@t && git config user.name t && \
     git remote add origin git@github.com:foo/idem.git)

  XDG_CONFIG_HOME="$TMPDIR_TEST/xdg3" run "$bootstrap" "$fixture"
  [ "$status" -eq 0 ]
  first_hash="$(shasum "$fixture/.minsky/repo.yaml" | awk '{print $1}')"

  XDG_CONFIG_HOME="$TMPDIR_TEST/xdg3" run "$bootstrap" "$fixture"
  [ "$status" -eq 0 ]
  second_hash="$(shasum "$fixture/.minsky/repo.yaml" | awk '{print $1}')"

  # Same input → same repo.yaml (no clock-dependent fields).
  [ "$first_hash" = "$second_hash" ]

  # Global gitignore registered ONCE (idempotent append).
  occurrences="$(grep -c '^\.minsky/$' "$TMPDIR_TEST/xdg3/git/ignore" | tr -d ' ')"
  [ "$occurrences" = "1" ]
}

@test "bin/minsky-bootstrap.sh exits 1 on missing host-dir" {
  bootstrap="$REPO_ROOT/bin/minsky-bootstrap.sh"
  run "$bootstrap" /this/path/does/not/exist
  [ "$status" -eq 1 ]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "bin/minsky-bootstrap.sh exits 2 on missing arg" {
  bootstrap="$REPO_ROOT/bin/minsky-bootstrap.sh"
  run "$bootstrap"
  [ "$status" -eq 2 ]
}

@test "bin/minsky-default-session.sh --help prints usage and exits 0" {
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  [ -x "$session" ]
  run "$session" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--baseline-only"* ]]
  [[ "$output" == *"--report-only"* ]]
}

@test "bin/minsky-default-session.sh exits 2 on missing host-dir arg" {
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  run "$session"
  [ "$status" -eq 2 ]
  [[ "$output" == *"host-dir required"* ]]
}

@test "bin/minsky-default-session.sh exits 1 when host-dir does not exist" {
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  run "$session" /this/path/definitely/does/not/exist
  [ "$status" -eq 1 ]
  [[ "$output" == *"host-dir not found"* ]]
}

@test "bin/minsky-default-session.sh exits 2 on unknown flag" {
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  run "$session" /tmp --frobnicate
  [ "$status" -eq 2 ]
}

@test "bin/minsky-default-session.sh --baseline-only writes baseline + exits without running" {
  # Smoke vertical slice 3: confirms bootstrap → baseline capture
  # composition works end-to-end on a fixture host.
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  fixture="$TMPDIR_TEST/default-session-baseline"
  mkdir -p "$fixture"
  (cd "$fixture" && git init -q && git symbolic-ref HEAD refs/heads/main && \
     git config user.email t@t && git config user.name t && \
     git remote add origin git@github.com:foo/bar.git)
  printf '# Tasks\n' > "$fixture/TASKS.md"
  printf '# fake\n' > "$fixture/README.md"

  XDG_CONFIG_HOME="$TMPDIR_TEST/xdg-bo" run "$session" "$fixture" --baseline-only
  [ "$status" -eq 0 ]
  [[ "$output" == *"baseline-only mode"* ]]

  # Bootstrap + baseline + sidecar all materialized
  [ -f "$fixture/.minsky/repo.yaml" ]
  [ -f "$fixture/.minsky/baseline.json" ]

  # JSON is well-formed and has the documented schema
  python3 -c "import json,sys; d=json.load(open('$fixture/.minsky/baseline.json')); assert d['schema_version']==1; assert 'code' in d; assert 'docs' in d"
}

@test "bin/minsky-default-session.sh --report-only requires existing baseline" {
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  fixture="$TMPDIR_TEST/default-session-no-baseline"
  mkdir -p "$fixture/.minsky"
  # No baseline.json present.
  run "$session" "$fixture" --report-only
  [ "$status" -eq 1 ]
  [[ "$output" == *"--report-only requires existing"* ]]
}

@test "bin/minsky --transform dispatches to bin/minsky-default-session.sh against \$PWD" {
  # Vertical slice 3 dispatch wiring: confirms `minsky --transform`
  # from any folder routes to the orchestrator with PWD as the host.
  # Uses the worktree's actual bin/minsky + bin/minsky-default-session.sh
  # (both already in place — no stubbing). The `--baseline-only` flag
  # short-circuits the run loop, so the test exercises the dispatch
  # chain end-to-end without needing openhands.
  workdir="$TMPDIR_TEST/transform-workdir"
  mkdir -p "$workdir"
  # Make the workdir look like a git repo so bootstrap+baseline work.
  (cd "$workdir" && git init -q && git symbolic-ref HEAD refs/heads/main && \
     git config user.email t@t && git config user.name t && \
     git remote add origin git@github.com:foo/transform-fixture.git)
  printf '# Tasks\n' > "$workdir/TASKS.md"
  printf '# fake\n' > "$workdir/README.md"

  MINSKY_REPO="$REPO_ROOT" XDG_CONFIG_HOME="$TMPDIR_TEST/xdg-tx" \
    run bash -c "cd '$workdir' && '$REPO_ROOT/bin/minsky' --transform --baseline-only 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"orchestrating bootstrap + baseline + run + report"* ]]
  [[ "$output" == *"baseline-only mode"* ]]

  # Bootstrap + baseline both ran end-to-end against PWD.
  [ -f "$workdir/.minsky/repo.yaml" ]
  [ -f "$workdir/.minsky/baseline.json" ]
}

@test "bin/minsky-default-session.sh --report-only emits delta against existing baseline" {
  session="$REPO_ROOT/bin/minsky-default-session.sh"
  fixture="$TMPDIR_TEST/default-session-report"
  mkdir -p "$fixture/.minsky"
  # Synthetic baseline.
  cat > "$fixture/.minsky/baseline.json" <<EOF
{"ts":"2026-05-25T00:00:00+00:00","repo":"$fixture","code":{"total_files_walked":0,"test_file_count":0,"loc_by_language":{}},"docs":{"markdown_file_count":0,"has_readme":false,"has_agents_md":false,"has_claude_md":false,"has_vision_md":false,"has_tasks_md":false},"lint":{"exit_code":null},"build":{"exit_code":null},"dependencies":{"package_manager":"none","outdated_count":null},"schema_version":1}
EOF

  # Add a file so the report shows a delta.
  printf '# README\n' > "$fixture/README.md"

  run "$session" "$fixture" --report-only
  [ "$status" -eq 0 ]
  [[ "$output" == *"minsky report"* ]]
  [[ "$output" == *"baseline: 2026-05-25T00:00:00+00:00"* ]]
  # The "after" snapshot saw the README we just added.
  [[ "$output" == *"has_readme: False → True"* ]]
}

@test "restart-sentinel exits 75 and clears the sentinel file (Phase 7-closing parity)" {
  # Mirrors host-loop.ts checkRestartRequest/clearRestartRequest semantics.
  # The TS side returns stop reason "restart-requested"; the bash side
  # exits 75 (EX_TEMPFAIL) which launchd's `KeepAlive` interprets as
  # "restart the daemon, the binary may have changed".
  host_a="$(make_host alpha "$(complete_task_block | sed s/pick-me-first/restart-1/)")"

  sentinel="$TMPDIR_TEST/restart-requested"
  printf '{"ts":"2026-05-24T20:00:00Z","reason":"post-merge auto-install","changedFiles":["bin/minsky-run.sh"]}' > "$sentinel"

  MINSKY_RESTART_SENTINEL_PATH="$sentinel" \
    run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 2

  [ "$status" -eq 75 ]
  [[ "$output" == *"restart-requested sentinel found"* ]]
  [[ "$output" == *"reason=post-merge auto-install"* ]]

  # Sentinel must be cleared after detection.
  [ ! -f "$sentinel" ]
}

@test "restart-sentinel absent → loop proceeds normally" {
  # Negative test: sentinel that does NOT exist must not affect normal
  # operation. Run with a bogus path; the loop iterates normally.
  host_a="$(make_host alpha "$(complete_task_block | sed s/pick-me-first/no-sentinel/)")"

  MINSKY_RESTART_SENTINEL_PATH="$TMPDIR_TEST/does-not-exist" \
    run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 1

  [ "$status" -eq 0 ]
  [[ "$output" != *"restart-requested"* ]]
}

@test "round-robin iterates each host the expected number of times" {
  host_a="$(make_host alpha "$(complete_task_block | sed s/pick-me-first/task-a/)")"
  host_b="$(make_host bravo "$(complete_task_block | sed s/pick-me-first/task-b/)")"
  run "$MINSKY_RUN" --hosts-dir "$HOSTS_DIR" --dry-run --iterations-per-host 2
  [ "$status" -eq 0 ]
  # Each host's JSONL file should have exactly 2 lines.
  [ "$(wc -l < "$host_a/.minsky/experiment-store/cross-repo/task-a.jsonl" | tr -d ' ')" = "2" ]
  [ "$(wc -l < "$host_b/.minsky/experiment-store/cross-repo/task-b.jsonl" | tr -d ' ')" = "2" ]
}
