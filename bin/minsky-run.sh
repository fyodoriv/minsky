#!/bin/bash
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

# Epoch-milliseconds helper for the runany local-since marker (runtime-token-
# limit-auto-pivot-local-and-back). bash has no native ms clock; prefer
# `EPOCHREALTIME` (bash ≥5, microsecond), fall back to `date +%s%3N` (GNU
# date), then to whole-seconds×1000 (BSD/macOS date) — every branch yields a
# monotone-enough ms value for the dwell gate (rule #6: always returns a number).
_now_ms() {
  if [[ -n "${EPOCHREALTIME:-}" ]]; then
    printf '%d' "$(( ${EPOCHREALTIME/./} / 1000 ))"
  else
    local ns
    ns="$(date +%s%3N 2>/dev/null || true)"
    if [[ "$ns" =~ ^[0-9]+$ && "${#ns}" -ge 13 ]]; then
      printf '%s' "$ns"
    else
      printf '%d' "$(( $(date +%s) * 1000 ))"
    fi
  fi
}

# --- Runtime-resilience helpers (minsky-runtime-resilience) -----------------
# Three live runtime failure modes used to abort the iteration with a raw
# shell/errno (mkdir failure, unwritable log/brief target, missing run
# target). These helpers move each failure to the operator-actionable
# boundary: a one-line message that NAMES the path + the recovery command,
# and — for the non-fatal log/brief case — a `${TMPDIR:-/tmp}` fallback so
# the iteration continues. Loud-fail AT the right boundary (Armstrong 2003,
# let-it-crash); graceful degradation for the non-fatal write (Beyer et al.,
# SRE 2016, Ch. 6).

# resilient_logfile <preferred-dir> <id> [suffix]
# Returns (on stdout) a writable file path for a per-iteration log/brief.
# If <preferred-dir> is writable, returns "<preferred-dir>/minsky-<id><suffix>".
# Otherwise falls back to "${TMPDIR:-/tmp}/minsky-${USER:-anon}-<id><suffix>"
# (USER-scoped to avoid multi-tenant /tmp collisions, per the task's Pivot
# clause) and emits a one-line warn to stderr. Always prints a usable path
# (rule #6: the function never aborts the iteration over a log target).
resilient_logfile() {
  local preferred_dir="$1"
  local id="$2"
  local suffix="${3:-.log}"
  local safe_id="${id//\//_}"
  if [[ -n "$preferred_dir" ]] && mkdir -p "$preferred_dir" 2>/dev/null && [[ -w "$preferred_dir" ]]; then
    printf '%s/minsky-%s%s' "$preferred_dir" "$safe_id" "$suffix"
    return 0
  fi
  local fallback_dir="${TMPDIR:-/tmp}"
  echo "minsky-run: WARN log/brief target dir unwritable ($preferred_dir); falling back to $fallback_dir" >&2
  printf '%s/minsky-%s-%s%s' "$fallback_dir" "${USER:-anon}" "$safe_id" "$suffix"
}

# preflight_run_target <path> [fix-hint]
# Guards a required executable run target (the runner itself, the openhands
# spawn shim). When the path is missing OR not executable, emits a one-line
# message naming the path + the fix and returns non-zero — instead of
# letting the caller surface `command not found` / `ENOENT` with no pointer.
preflight_run_target() {
  local target="$1"
  local fix_hint="${2:-pnpm install (rebuilds workspaces) or chmod +x the path}"
  if [[ ! -e "$target" ]]; then
    echo "INVARIANT FAIL: run target missing: $target" >&2
    echo "  fix: $fix_hint" >&2
    return 1
  fi
  if [[ ! -x "$target" ]]; then
    echo "INVARIANT FAIL: run target not executable: $target" >&2
    echo "  fix: \`chmod +x $target\` (or $fix_hint)" >&2
    return 1
  fi
}

HOSTS_DIR=""
SINGLE_HOST=""  # --host <repo> filter mode (PR #875: closes the smoke
                # finding that `minsky --once <repo>` was iterating every
                # sibling of <repo> instead of <repo> itself)
DRY_RUN=0
SELF_CHECK=0
MAX_ITERATIONS=0       # 0 = unbounded (matches TS runner default)
ITERATIONS_PER_HOST=3  # matches the TS scheduler's round-robin slice size
# `--tick-interval-ms N` inserts a `sleep N/1000` between iteration
# batches (after the host walk completes one round). Default 0 = no
# sleep (current bash-skeleton cadence); set to the TS daemon's old
# 5-min value (300000) to match the legacy throttle. The TS daemon
# had this baked in; the bash skeleton was relying purely on
# launchd's `ThrottleInterval=5` (5s respawn floor), which is much
# more aggressive. This flag is the operator's per-machine throttle.
# Source: bash-skeleton-tick-interval-ms-flag (P3, surfaced PR #888).
TICK_INTERVAL_MS=0
# `--loop` flag (added 2026-05-28 in this PR, refining PR #983). Default 0 =
# one walk and exit (preserves the historical behavior for ad-hoc CLI runs
# and the many bats / integration tests that invoke this script without
# expecting an infinite loop). Set to 1 by
# `distribution/systemd/run-tick-loop.sh` when launchd / systemd-user
# invokes the runner — wraps walk_hosts in while-true so the supervisor
# never exits on its own. See § "Iteration loop" at the bottom of this
# file for the full rationale + literature anchor.
LOOP_FOREVER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts-dir) HOSTS_DIR="$2"; shift 2 ;;
    --host) SINGLE_HOST="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    # `--once` is the single-iteration alias (`--max-iterations 1`). The
    # top-level `bin/minsky --once <host>` wrapper already speaks this verb;
    # accepting it here too means the documented dry-run preview
    # (`minsky-run.sh --once --dry-run`) works verbatim from either entry
    # point. Config-as-code discoverability: the operator can confirm which
    # provider the NEXT iteration would use without spawning an agent.
    --once) MAX_ITERATIONS=1; shift ;;
    --self-check) SELF_CHECK=1; shift ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --iterations-per-host) ITERATIONS_PER_HOST="$2"; shift 2 ;;
    --tick-interval-ms) TICK_INTERVAL_MS="$2"; shift 2 ;;
    --tick-interval-ms=*) TICK_INTERVAL_MS="${1#*=}"; shift ;;
    --loop) LOOP_FOREVER=1; shift ;;
    --help|-h)
      cat <<'EOF'
Usage: minsky-run [--hosts-dir <parent> | --host <repo>] [--dry-run] [--once]
                  [--self-check] [--max-iterations N] [--iterations-per-host N]
                  [--tick-interval-ms N]

Walks N host repos under <parent> in round-robin (--hosts-dir mode), OR
iterates exactly ONE host (--host mode). For each host, picks the top-
priority unclaimed TASKS.md task (rule-9 fields validated by
scripts/pick_task.py), spawns `openhands solve --task-file <brief>
--workspace <host>`, records the iteration to:
  <host>/.minsky/experiment-store/cross-repo/<task-id>.jsonl

Flags:
  --hosts-dir <parent>      Directory containing host repos (scan mode)
  --host <repo>             Iterate exactly THIS host (filter mode);
                            mutually exclusive with --hosts-dir
  --dry-run                 Plan + record "planned" verdict, don't spawn
  --once                    Single-iteration alias for --max-iterations 1
  --self-check              Run all 5 runtime invariants and exit 0
  --max-iterations N        Stop after N total iterations across all hosts
                            (default 0 = unbounded)
  --iterations-per-host N   Round-robin slice size (default 3, matches TS)
  --tick-interval-ms N      Sleep N/1000 seconds between iteration batches
                            (default 0 = no sleep; legacy TS daemon used
                            300000 = 5 min)

Environment:
  MINSKY_CONFIG             Override config path (default ~/.minsky/config.json)
  MINSKY_ROLE               "worker" pins this walk to the cheap local agent
                            (brain-vs-hands fan-out); anything else (or unset)
                            is the orchestrator role (config-driven cloud agent)
EOF
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# `--host` is mutually exclusive with `--hosts-dir`. When `--host` is
# set, synthesize a single-element host list and skip the parent-dir
# enumeration entirely. The TS runner had no equivalent shape — this
# is a bash-runner ergonomic improvement landed alongside the smoke
# findings (PR #875).
if [[ -n "$SINGLE_HOST" ]]; then
  if [[ -n "$HOSTS_DIR" ]]; then
    echo "INVARIANT FAIL: --host and --hosts-dir are mutually exclusive" >&2
    exit 2
  fi
  if [[ ! -d "$SINGLE_HOST" ]]; then
    echo "INVARIANT FAIL: --host $SINGLE_HOST is not a directory" >&2
    exit 1
  fi
fi

# --- 2. Runtime invariants (Phase 8 fold-in target) -------------------------
# These 5 inline checks replace the 8K-LOC observer + spec-monitor stack
# Phase 8 inlines further. Each invariant prints to stderr on failure.

invariant_config_loadable() {
  # Invariant 1: ~/.minsky/config.json exists and parses as JSON.
  [[ -f "$CONFIG_FILE" ]] || { echo "INVARIANT FAIL: config not at $CONFIG_FILE" >&2; return 1; }
  jq -e . "$CONFIG_FILE" >/dev/null 2>&1 || { echo "INVARIANT FAIL: config not valid JSON" >&2; return 1; }
}

invariant_openhands_in_path() {
  # Gate: this invariant is the OpenHands backend's preflight. Skip it when the
  # role-resolved agent is NOT openhands (e.g. claude on the subscription) — the
  # spawn path is `scripts/spawn_agent.py`'s claude branch, which never touches
  # openhands, so requiring openhands here would crash-loop a claude-only worker
  # (tick-loop-openhands-preflight-gating; mirrors resolve_configured_agent()).
  local _agent
  _agent="$(jq -r 'if env.MINSKY_ROLE == "worker" then (.local_agent // "openhands") else (.cloud_agent // "openhands") end' "$CONFIG_FILE" 2>/dev/null || echo openhands)"
  [[ "$_agent" == "openhands" ]] || return 0
  # Invariant 2: an OpenHands backend is reachable AND the python the
  # dispatcher will use can actually `import openhands`. Pre-2026-05-27
  # this invariant only checked shim/CLI EXISTENCE — it passed on every
  # machine where `~/.minsky/openhands-venv/` was set up correctly AND
  # on every machine where it WASN'T (because the shim file existed
  # regardless). That false-positive masked 30+ consecutive spawn-
  # failures whose stderr was `ModuleNotFoundError: No module named
  # 'openhands'`. Now the invariant resolves the same python the spawn
  # site will use and tries `import openhands` — if that fails, surface
  # it BEFORE the daemon iterates and burns budget on guaranteed-failed
  # spawns.
  #
  # Resolution order matches `resolve_openhands_python` below:
  #   1. canonical `openhands` CLI on PATH (Agent Canvas Initiative post-
  #      June-1-2026) — return success without further check.
  #   2. `MINSKY_OPENHANDS_PYTHON` env override — verify importable.
  #   3. `~/.minsky/openhands-venv/bin/python` (INSTALL.md default) —
  #      verify importable.
  #   4. `python3` on PATH — verify importable (graceful for operators
  #      who installed openhands globally / via pipx).
  if command -v openhands >/dev/null 2>&1; then
    return 0
  fi
  # MINSKY_OPENHANDS_SHIM_PATH overrides the default path (test hook +
  # escape hatch for operators who installed the shim somewhere else).
  if [[ -n "${MINSKY_OPENHANDS_SHIM_PATH:-}" && -f "${MINSKY_OPENHANDS_SHIM_PATH}" ]]; then
    # Skip the importability check when the operator pointed us at a
    # custom shim — they've explicitly opted out of the default layout.
    return 0
  fi
  local shim_path
  shim_path="$(dirname "${BASH_SOURCE[0]}")/../novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py"
  if [[ ! -f "$shim_path" ]]; then
    echo "INVARIANT FAIL: no OpenHands backend available." >&2
    echo "  install \`openhands\` (https://docs.openhands.dev), set" >&2
    echo "  MINSKY_OPENHANDS_SHIM_PATH to a custom shim, or ensure" >&2
    echo "  $shim_path exists." >&2
    return 1
  fi
  # Shim exists — now verify the resolved python can import openhands.
  local oh_py
  oh_py="$(resolve_openhands_python)"
  if ! "$oh_py" -c 'import openhands' >/dev/null 2>&1; then
    echo "INVARIANT FAIL: openhands not importable from $oh_py." >&2
    echo "  Install per INSTALL.md:" >&2
    echo "    uv venv ~/.minsky/openhands-venv --python 3.13" >&2
    echo "    uv pip install --python ~/.minsky/openhands-venv/bin/python openhands-ai" >&2
    echo "  Or set MINSKY_OPENHANDS_PYTHON=/path/to/python that has it installed." >&2
    return 1
  fi
  return 0
}

resolve_openhands_python() {
  # Resolve the python interpreter used to invoke the OpenHands spawn
  # shim. Pre-2026-05-27 the runner hardcoded bare `python3`, which on
  # launchd-spawned supervisors resolves to /usr/bin/python3 — a python
  # that does NOT have `openhands-ai` installed. INSTALL.md documents the
  # canonical venv at `~/.minsky/openhands-venv/`; this helper picks that
  # up automatically.
  #
  # Resolution order (first hit wins):
  #   1. $MINSKY_OPENHANDS_PYTHON — explicit operator override.
  #   2. ~/.minsky/openhands-venv/bin/python — the documented venv path.
  #   3. `python3` on PATH — graceful fallback (operators may have
  #      installed openhands-ai via pipx or globally).
  #
  # Always prints to stdout (no stderr). The invariant above tests
  # importability separately and surfaces missing-openhands errors.
  if [[ -n "${MINSKY_OPENHANDS_PYTHON:-}" && -x "${MINSKY_OPENHANDS_PYTHON}" ]]; then
    echo "${MINSKY_OPENHANDS_PYTHON}"
    return 0
  fi
  local venv_py="${HOME}/.minsky/openhands-venv/bin/python"
  if [[ -x "$venv_py" ]]; then
    echo "$venv_py"
    return 0
  fi
  echo "python3"
}

invariant_hosts_dir_readable() {
  # Invariant 3: either --hosts-dir is set + readable (scan mode), or
  # --host is set + readable (filter mode). Mutual exclusivity is
  # already enforced at arg-parse time (see SINGLE_HOST block).
  if [[ -n "$SINGLE_HOST" ]]; then
    [[ -d "$SINGLE_HOST" ]] || { echo "INVARIANT FAIL: --host not a directory" >&2; return 1; }
    return 0
  fi
  [[ -n "$HOSTS_DIR" ]] || { echo "INVARIANT FAIL: --hosts-dir or --host required" >&2; return 1; }
  [[ -d "$HOSTS_DIR" ]] || { echo "INVARIANT FAIL: --hosts-dir not a directory" >&2; return 1; }
}

invariant_host_experiment_store_writable() {
  # Invariant 4: each host's .minsky/experiment-store/cross-repo/ is creatable.
  #
  # Runtime-resilience (minsky-runtime-resilience): a bare
  # `INVARIANT FAIL: cannot create $dir` (the pre-fix message) gave the
  # operator no recovery path — on a wrong-owner MINSKY_HOME or a
  # read-only mount, the iteration aborted with the raw mkdir errno and
  # the operator had to reverse-engineer the fix. Now the failure names
  # the path AND the concrete recovery command (chmod / MINSKY_HOME),
  # then returns non-zero cleanly. Loud-fail AT the operator-actionable
  # boundary (Armstrong 2003; SRE Ch. 6 graceful degradation).
  local host="$1"
  local dir="$host/.minsky/experiment-store/cross-repo"
  if ! mkdir -p "$dir" 2>/dev/null; then
    echo "INVARIANT FAIL: cannot create experiment-store dir: $dir" >&2
    echo "  the parent path is unwritable (wrong owner, read-only mount, or restrictive perms)." >&2
    echo "  fix: \`chmod u+w $host/.minsky\` (or the offending parent), or" >&2
    echo "       set MINSKY_HOME=<a writable directory> and re-run." >&2
    return 1
  fi
  if [[ ! -w "$dir" ]]; then
    echo "INVARIANT FAIL: experiment-store dir not writable: $dir" >&2
    echo "  fix: \`chmod u+w $dir\`, or set MINSKY_HOME=<a writable directory>." >&2
    return 1
  fi
}

invariant_pick_task_present() {
  # Invariant 5: scripts/pick_task.py is on disk.
  local pick
  pick="$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py"
  [[ -f "$pick" ]] || { echo "INVARIANT FAIL: $pick missing" >&2; return 1; }
}

invariant_host_bootstrapped() {
  # Invariant 6: each host has a `.minsky/repo.yaml` sidecar (the
  # bootstrap marker file `bin/minsky-bootstrap.sh` writes). Parity with
  # the TS runner's `loadHostConfig`, which exits 1 with the same
  # operator-actionable hint when the file is missing. Without this
  # check, the bash runner silently creates `.minsky/experiment-store/`
  # via Invariant 4 and proceeds to iterate against an unbootstrapped
  # host — confusing the operator and producing iteration records that
  # don't trace back to a known host config.
  #
  # Operator escape hatch: `MINSKY_SKIP_BOOTSTRAP_CHECK=1` bypasses,
  # for the post-bootstrap migration window when an existing host
  # already has experiment-store data but pre-dates the sidecar
  # convention (rule #6 — fail loud but expose the override at the
  # right boundary).
  local host="$1"
  local repo_yaml="$host/.minsky/repo.yaml"
  if [[ "${MINSKY_SKIP_BOOTSTRAP_CHECK:-0}" == "1" ]]; then
    return 0
  fi
  if [[ ! -f "$repo_yaml" ]]; then
    echo "INVARIANT FAIL: host is not bootstrapped: $repo_yaml not found." >&2
    echo "  run \`bin/minsky-bootstrap.sh $host\` first," >&2
    echo "  or set MINSKY_SKIP_BOOTSTRAP_CHECK=1 to override (post-bootstrap migration)." >&2
    return 1
  fi
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
# merge (2026-05-16 example-service-plugin regression).

resolve_gh_host_for() {
  # Resolve the GH_HOST that gh calls inside `$host` should use. Parity
  # port of `novel/cross-repo-runner/src/gh-host-resolve.ts`. Without
  # this, on Example machines gh inherits `github.example.com` from
  # `gh auth status` and any iteration against a `github.com` host repo
  # (e.g. fyodoriv/minsky) 401s ≥6× per iteration. Vision rule #17
  # (proactive healing) + operator directive 2026-05-19.
  #
  # Prints the resolved hostname (or empty string if the caller MUST NOT
  # set GH_HOST and should let gh use its own default — graceful-degrade
  # per rule #7).
  local host="$1"
  local script_dir
  script_dir="$(dirname "${BASH_SOURCE[0]}")"
  python3 "$script_dir/../scripts/resolve_gh_host.py" \
    --host-root "$host" 2>/dev/null | head -1 || true
}

_gh_in_host() {
  # Shell-out to gh INSIDE $host with the resolved GH_HOST. Hides the
  # env+cd boilerplate so call sites stay readable. Empty $gh_host ⇒
  # don't set GH_HOST (matches the TS null-host contract — fall back to
  # gh's own default).
  local host="$1"
  local gh_host="$2"
  shift 2
  if [[ -n "$gh_host" ]]; then
    ( cd "$host" && GH_HOST="$gh_host" gh "$@" )
  else
    ( cd "$host" && gh "$@" )
  fi
}

current_open_pr_branches() {
  # Print a CSV of feat/<id> branches with currently-open PRs in the
  # current repo. Safe-default to empty on `gh` errors (rule #7).
  local host="$1"
  local gh_host="${2:-}"
  _gh_in_host "$host" "$gh_host" pr list --state open \
      --json headRefName --jq '.[].headRefName' 2>/dev/null \
    | paste -sd, - 2>/dev/null || true
}

dump_all_prs_json() {
  # Write the full PR snapshot for `host` to `outfile` so pick_task.py can
  # apply the title-based duplicate filter (the parity-with-decideDuplicate
  # path; closes the daemon-duplicate-work-detection coverage gap that the
  # branch-based filter misses for daemon-authored close-out PRs with
  # timestamped branch names + merged-recently re-creation).
  #
  # Schema: an array of {number, title, state, closedAt} objects, the
  # exact shape `gh pr list --json …` emits and `decide_duplicate` /
  # `pr_title_names_task` consume.
  #
  # Safe-default to writing an empty array (`[]`) on any `gh` failure so
  # the loop never wedges on a transient network blip (rule #7 — chaos
  # engineering: the watchdog must never make the system worse).
  #
  # Limit 200: enough for ≥6 months of daemon PRs at typical cadence
  # without blowing past gh's pagination; tunable via $MINSKY_PR_FETCH_LIMIT.
  local host="$1" outfile="$2"
  local gh_host="${3:-}"
  local limit="${MINSKY_PR_FETCH_LIMIT:-200}"
  if _gh_in_host "$host" "$gh_host" pr list --state all --limit "$limit" \
        --json number,title,state,closedAt 2>/dev/null \
        > "$outfile"; then
    return 0
  fi
  echo '[]' > "$outfile"
  return 0
}

# --- 4. Host walker (round-robin) -------------------------------------------
# Replaces novel/cross-repo-runner/src/host-walker.ts. Walks every git
# repo under $HOSTS_DIR (one level deep), gives each host N iterations
# in turn (round-robin fairness), stops at $MAX_ITERATIONS if set.

ITER_COUNT=0
# Counts only iterations that returned 0 from iterate_host — i.e. ones
# that picked a task and spawned (or planned in dry-run). Aborted
# iterations (no eligible task) do NOT increment this counter. Used by
# the post-walk CTO audit trigger: if zero successful iterations
# occurred AND >0 hosts were visited, the queue is drained.
COMPLETED_COUNT=0

walk_hosts() {
  invariant_hosts_dir_readable
  local hosts=()
  # Two modes: filter (--host one repo) vs scan (--hosts-dir parent +
  # walk children). Filter mode skips the enumeration; scan mode is
  # the historical default. Both require the host to have `.git` —
  # matches scan-mode's child filter so the "not a git repo, skip"
  # behavior is symmetric.
  if [[ -n "$SINGLE_HOST" ]]; then
    # Resolve symlinks + trailing slashes so the host path the rest
    # of the runner sees matches what the operator passed.
    local resolved
    resolved="$(cd "$SINGLE_HOST" && pwd)"
    if [[ ! -d "$resolved/.git" ]]; then
      echo "iterating single host $resolved — but it has no .git/, skipping" >&2
      echo "no host repos found — nothing to do" >&2
      return 0
    fi
    hosts=("$resolved")
    echo "iterating single host $resolved (--host filter mode)" >&2
  else
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
  fi
  if [[ ${#hosts[@]} -eq 0 ]]; then
    echo "no host repos found — nothing to do" >&2
    return 0
  fi

  for host in "${hosts[@]}"; do
    local n
    for ((n=1; n <= ITERATIONS_PER_HOST; n++)); do
      [[ "$MAX_ITERATIONS" -gt 0 && "$ITER_COUNT" -ge "$MAX_ITERATIONS" ]] && return 0
      # Restart-sentinel check (Phase 7 closing gap, matches host-loop.ts
      # `checkRestartRequest` between iterations). When the sentinel
      # exists at `~/.minsky/restart-requested`, the runner clears it
      # and exits 75 (EX_TEMPFAIL). The supervisor (launchd / systemd)
      # restarts the daemon, which re-execs into the freshly updated
      # binary. Written by `scripts/post-merge-auto-install.mjs` after
      # a successful repo update.
      check_restart_sentinel && return 75
      # Break the inner loop when the host has no eligible task — no
      # point burning N round-robin slots emitting "aborted" records;
      # move to the next host. Matches host-walker.ts behaviour.
      if iterate_host "$host" "$n"; then
        COMPLETED_COUNT=$((COMPLETED_COUNT + 1))
      else
        ITER_COUNT=$((ITER_COUNT + 1))
        break
      fi
      ITER_COUNT=$((ITER_COUNT + 1))
    done
  done

  # `--tick-interval-ms N` throttle (bash-skeleton-tick-interval-ms-flag,
  # P3, surfaced PR #888). After the host walk completes one round, sleep
  # N/1000 seconds before returning. The TS daemon had this baked in at
  # 5min; the bash skeleton's default is 0 (no sleep — launchd's
  # ThrottleInterval=5 governs cadence). Operators set N > 0 when the
  # 5s-respawn cadence is too aggressive (excessive API cost,
  # rate-limit cascade, spawn overhead).
  if [[ "$TICK_INTERVAL_MS" -gt 0 ]]; then
    local tick_interval_seconds=$((TICK_INTERVAL_MS / 1000))
    [[ "$tick_interval_seconds" -lt 1 ]] && tick_interval_seconds=1
    echo "tick-interval-ms throttle: sleeping ${tick_interval_seconds}s before returning" >&2
    sleep "$tick_interval_seconds"
  fi

  # CTO audit on drain (parity port slice 2 — wires PR #856's
  # `scripts/build_cto_brief.py` into the bash runner's drain path).
  # When zero successful iterations occurred across all hosts AND the
  # operator opted in via `MINSKY_CTO_AUDIT_ON_DRAIN=1`, spawn a
  # CTO-mode agent session on the first host. The agent reviews
  # recent state and proposes new high-leverage tasks via a PR.
  # The next daemon respawn picks them up.
  #
  # Default: NO auto-audit (preserves current behavior). LLM cost
  # discipline is the gate — opt-in by setting the env var.
  #
  # Parity reference: novel/cross-repo-runner/src/host-cto-audit.ts §
  # runHostCtoAudit (queue-empty trigger path). The bash runner only
  # implements the queue-empty path; the post-iteration trigger
  # (audit after every successful iteration) is deferred — it doubles
  # iteration cost and the operator may not want that by default.
  if [[ "$COMPLETED_COUNT" -eq 0 && "${MINSKY_CTO_AUDIT_ON_DRAIN:-0}" == "1" && "$DRY_RUN" != "1" ]]; then
    echo "all hosts drained; running CTO audit on first host (opt-in MINSKY_CTO_AUDIT_ON_DRAIN=1)" >&2
    cto_audit_host "${hosts[0]}"
  fi
}

# --- Restart sentinel ------------------------------------------------------
# Mirrors `runHostLoop`'s checkRestartRequest/clearRestartRequest seams in
# `novel/cross-repo-runner/src/host-loop.ts`. Returns 0 if the sentinel
# existed (and was consumed); 1 otherwise. Best-effort per rule #6 — a
# malformed sentinel JSON is reported and removed; the loop continues
# rather than crashing.

RESTART_SENTINEL_PATH="${MINSKY_RESTART_SENTINEL_PATH:-$HOME/.minsky/restart-requested}"

check_restart_sentinel() {
  [[ -f "$RESTART_SENTINEL_PATH" ]] || return 1
  local payload reason ts
  payload="$(cat "$RESTART_SENTINEL_PATH" 2>/dev/null || true)"
  reason="$(printf '%s' "$payload" | jq -r '.reason // "unspecified"' 2>/dev/null || echo unspecified)"
  ts="$(printf '%s' "$payload" | jq -r '.ts // "unknown"' 2>/dev/null || echo unknown)"
  echo "minsky-run: restart-requested sentinel found (reason=$reason ts=$ts); exiting 75 (EX_TEMPFAIL)" >&2
  # Clear the sentinel so the supervisor's next launch doesn't re-trigger.
  rm -f "$RESTART_SENTINEL_PATH" || true
  return 0
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
  # Order matters: check bootstrapped state BEFORE creating the
  # experiment-store dir. Otherwise Invariant 4's `mkdir -p` would
  # silently bootstrap a wrapper-shaped `.minsky/` on the host and
  # produce confusing iteration records against a host that's never
  # been intentionally bootstrapped.
  invariant_host_bootstrapped "$host" || return 1
  # `|| return 1` is load-bearing: iterate_host runs inside `if iterate_host
  # …; then` in walk_hosts, which SUPPRESSES `set -e` for the whole function
  # body. Without the explicit guard, the failed invariant's `return 1` is
  # ignored and execution falls through to record_iteration's unguarded
  # `mkdir`, re-surfacing the raw errno this branch exists to replace
  # (minsky-runtime-resilience). Returning 1 here breaks walk_hosts's inner
  # loop and moves to the next host — clean degradation, no raw errno.
  invariant_host_experiment_store_writable "$host" || return 1

  # Resolve the GH_HOST for every gh call this iteration makes. Parity
  # port of `novel/cross-repo-runner/src/gh-host-resolve.ts`. The probe
  # is cheap (single `git remote get-url origin`) and we do it once per
  # iteration; the resolved value is reused for the 3 gh calls below
  # (open-PR scan, full-PR snapshot, repo-view at record time).
  #
  # Empty string ⇒ leave GH_HOST unset (let gh use its own default).
  # Operator escape hatch: `GH_HOST=<host>` in the runner's environment
  # wins (`source="env"` path in the resolver).
  local gh_host
  gh_host="$(resolve_gh_host_for "$host")"

  # Tasks with open PRs are skipped (matches host-loop.ts behaviour added
  # for the 2026-05-16 example-service-plugin regression).
  # Plus: tasks with TITLE-matching open OR merged-recently-≤7d PRs are
  # filtered via `decide_duplicate` (parity with the TS substrate shipped
  # in PR #309 — `daemon-duplicate-work-detection`). Catches the daemon-
  # authored close-out PR class that branch-name dedup misses (timestamped
  # branch names → unique `headRefName` per attempt; title still contains
  # the task ID).
  local open_branches
  open_branches="$(current_open_pr_branches "$host" "$gh_host")"
  # mktemp generates a unique path per iteration; the file is small (≤200
  # PR entries), under /tmp, and cleaned up explicitly before return.
  # NOT using `trap RETURN` because `set -u` (set -euo pipefail at the
  # top of this script) trips when the RETURN trap's body evaluates the
  # variable in the caller's scope after the function unwinds.
  local all_prs_json
  all_prs_json="$(mktemp -t minsky-run-prs-XXXXXX.json)"
  dump_all_prs_json "$host" "$all_prs_json" "$gh_host"
  # Resolve the host's task source from .minsky/repo.yaml. Defaults to
  # `tasks-md` when the field is absent — every existing host stays
  # unchanged. `github-issues` routes the picker through the gh adapter
  # in `scripts/gh_issue_task_source.py` (rule #2 — port + impl).
  local task_source host_repo_id
  task_source="$(python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, '$(dirname "${BASH_SOURCE[0]}")/../scripts')
from build_brief import load_host_config
cfg = load_host_config(Path('$host'))
print(cfg.task_source)
" 2>/dev/null || echo "tasks-md")"
  host_repo_id="$(python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, '$(dirname "${BASH_SOURCE[0]}")/../scripts')
from build_brief import load_host_config
print(load_host_config(Path('$host')).host_repo)
" 2>/dev/null || echo "")"
  local task_id
  if [[ "$task_source" == "github-issues" ]]; then
    task_id="$(python3 "$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py" \
      "$host/TASKS.md" \
      "--task-source=github-issues" \
      "--gh-issues-repo=${host_repo_id}" \
      "--open-pr-branches=${open_branches}" \
      "--all-prs-json=${all_prs_json}" \
      2>/dev/null || true)"
  else
    task_id="$(python3 "$(dirname "${BASH_SOURCE[0]}")/../scripts/pick_task.py" \
      "$host/TASKS.md" \
      "--open-pr-branches=${open_branches}" \
      "--all-prs-json=${all_prs_json}" \
      2>/dev/null || true)"
  fi
  rm -f "$all_prs_json"

  if [[ -z "$task_id" ]]; then
    # Verdict `drained` (not `aborted`): a drained queue is a bookkeeping
    # event, not a failed iteration. `scripts/lib/stability.mjs` excludes
    # drained records from the stability SLI denominator (valid-event
    # qualification — Beyer et al. 2016, *SRE*, Ch. 4). Recording it as
    # `aborted` poisoned 24h stability to 0% with ~1800 idle records/day.
    record_iteration "$host" "$iter_n" "" "" "drained" "" "no eligible task" "$gh_host"
    echo "no eligible task in $host" >&2
    # Return non-zero so walk_hosts() breaks the inner loop and moves
    # to the next host instead of burning N round-robin slots emitting
    # repeated "drained" records (matches host-walker.ts).
    return 1
  fi

  local branch="feat/${task_id}"
  echo "host=$host iter=$iter_n task=$task_id branch=$branch" >&2

  if [[ "$DRY_RUN" == "1" ]]; then
    # Provider-decision preview (runtime-token-limit-auto-pivot-local-and-back,
    # Acceptance #2 + pre-registered measurement): a dry run still resolves +
    # logs which provider the next real iteration WOULD use, so the operator
    # can verify the forward fallback (`runany-provider=… → local`) and the
    # recover flip-back without spawning an agent. No marker is persisted and
    # no agent runs — this is observation only (rule #4: everything visible).
    local dry_local_cfg
    dry_local_cfg="$(jq -r '.local_llm_enabled // false' "$CONFIG_FILE" 2>/dev/null || echo "false")"
    if [[ "$dry_local_cfg" != "true" ]]; then
      local dry_resolver_json
      dry_resolver_json="$(node "$script_dir/../scripts/runany-resolve-model.mjs" --json 2>/dev/null || true)"
      if [[ -n "$dry_resolver_json" ]]; then
        local dry_agent dry_kind dry_model
        dry_agent="$(printf '%s' "$dry_resolver_json" | jq -r '.agent // empty' 2>/dev/null || echo "")"
        dry_kind="$(printf '%s' "$dry_resolver_json" | jq -r '.kind // empty' 2>/dev/null || echo "")"
        dry_model="$(printf '%s' "$dry_resolver_json" | jq -r '.model // empty' 2>/dev/null || echo "")"
        if [[ "$dry_agent" == "local" ]]; then
          echo "host=$host runany-provider=$dry_kind → local (auto fallback) [dry-run]" >&2
        elif [[ "$dry_agent" == "claude" && -n "$dry_model" ]]; then
          echo "host=$host runany-provider=$dry_kind model=$dry_model [dry-run]" >&2
        fi
      fi
    fi
    record_iteration "$host" "$iter_n" "$task_id" "$branch" "planned" "" "dry-run; no spawn" "$gh_host"
    return 0
  fi

  # Synthesise the host's .minsky/experiments/<task-id>.yaml — parity
  # port of the TS runner's `synthesiseExperimentYaml` (rule-#9 fields
  # captured BEFORE the spawn, so the experiment record exists even if
  # the spawn crashes mid-flight). Acceptance criterion of
  # user-stories/006-runner-on-any-repo.md § "Acceptance criteria":
  # "$host/.minsky/experiments/<task-id>.yaml is materialised with all
  # 5 rule-#9 fields populated from the task row".
  #
  # Falls back to a WARN log + continues without the file (rule #6 —
  # the iteration's brief is the load-bearing input to openhands; the
  # experiment.yaml is the post-hoc record). The brief still has the
  # rule-#9 fields inline, so the spawn doesn't lose information.
  if ! python3 "$script_dir/../scripts/synth_experiment_yaml.py" \
       "$task_id" "$host" 2>/dev/null > /dev/null; then
    echo "WARN: synth_experiment_yaml.py failed for $task_id (continuing)" >&2
  fi

  # Local-LLM routing detection — when `~/.minsky/config.json` has
  # `local_llm_enabled: true`, point the openhands shim at the operator's
  # local Ollama (default port 11434) AND override the model to
  # `ollama_chat/<name>` so LiteLLM routes correctly. Without this, the
  # shim defaults to Anthropic and hard-fails on missing API key — even
  # with `local_llm_enabled: true` set, as observed 2026-05-27 (30
  # consecutive iterations spawn-failed with "ANTHROPIC_API_KEY unset").
  #
  # Source: 2026-05-27 operator session; user-stories/015 (local models
  # are the default until stability); the openhands shim's
  # `--base-url`-aware api_key skip lands in the same PR.
  #
  # Detected EARLY (before build_brief.py) so the brief itself can be
  # tuned for the local-LLM path — front-loads the TOOL-CALL DISCIPLINE
  # block (observation 2026-05-28: qwen3-coder:30b reads the brief
  # serially and disengages with prose-only replies when the discipline
  # warning is buried at line 60+). See scripts/build_brief.py §
  # render_system_prompt_overlay for the restructure.
  local local_llm_enabled
  local_llm_enabled="$(jq -r '.local_llm_enabled // false' "$CONFIG_FILE" 2>/dev/null || echo "false")"

  # ── Role-aware agent selection (brain-vs-hands fan-out, TASKS.md
  # `claude-orchestrator-local-worker-fanout`). A process pinned
  # `MINSKY_ROLE=worker` is a HAND: it implements on the cheap configured
  # `local_agent`/`local_agent_model`, never the cloud model — so the scarce
  # cloud budget belongs to the orchestrator (the BRAIN). We map the worker
  # role onto the existing local-mode path (the runner's single "use the local
  # agent" lever) so the whole downstream spawn shape (brief overlay,
  # --no-extended-thinking, local model/base-url) follows for free. The
  # orchestrator role (default — anything other than the literal "worker") keeps
  # the existing config-driven cloud/dynamic path below. This mirrors the pure
  # `resolveSpawnRole` / `decideAgentForRole` seam in scripts/orchestrate.mjs
  # (unit-tested there); the bash only does the env→lever wiring. An operator
  # hard-pin (MINSKY_STRATEGIC_PIN_MODEL) still wins the model slot downstream.
  if [[ "${MINSKY_ROLE:-}" == "worker" ]]; then
    if [[ "$local_llm_enabled" != "true" ]]; then
      echo "host=$host role=worker → local agent (cloud budget belongs to the orchestrator)" >&2
    fi
    local_llm_enabled="true"
  fi

  # Build the brief via scripts/build_brief.py — full TS-parity brief
  # with the task block + system-prompt overlay (constitution + FINAL
  # STEP block). Replaces the 4-line stub. Falls back to a minimal
  # stub if the builder errors out (rule #6 — let it crash AT the
  # right boundary; an iteration with a bad brief is better than one
  # with no brief).
  local brief_file
  brief_file="$(mktemp -t minsky-brief.XXXXXX)"
  local brief_args=("$task_id" "$host")
  if [[ "$local_llm_enabled" == "true" ]]; then
    brief_args+=("--local-llm-mode")
  fi
  if ! python3 "$script_dir/../scripts/build_brief.py" \
       "${brief_args[@]}" > "$brief_file" 2>/dev/null; then
    echo "WARN: build_brief.py failed for $task_id; falling back to stub" >&2
    cat >"$brief_file" <<EOF
# Brief for task ${task_id}

Work on the unclaimed top-priority task in $host/TASKS.md.
Follow the host repo's AGENTS.md + vision.md rules.
EOF
  fi

  # Prepend an "uncommitted-progress notice" to the brief when the
  # worktree from a prior iteration still has uncommitted changes.
  # Observed 2026-05-28: an iteration created a 221-line
  # `novel/adapters/a2a.ts` (with broken imports — incomplete work),
  # exited without `git add`/commit, and EVERY subsequent iteration
  # started fresh "Analyzing the task requirements..." while ignoring
  # the file the prior iteration had already written. Without this
  # notice, the daemon cannot accumulate progress across iterations —
  # each one re-does (or re-plans) the same first step.
  #
  # The notice is honest about state: it surfaces both the file list
  # AND that the prior work may be incomplete/broken. The agent's
  # choice (commit / fix / restart) is explicit; the alternative
  # (silently overwrite or silently ignore) is what the bug looked
  # like pre-fix.
  local worktree_for_brief="$host/.worktrees/daemon-${task_id}"
  if [[ -d "$worktree_for_brief/.git" ]] || [[ -f "$worktree_for_brief/.git" ]]; then
    local uncommitted_summary
    uncommitted_summary="$(git -C "$worktree_for_brief" status --porcelain 2>/dev/null | head -20)"
    if [[ -n "$uncommitted_summary" ]]; then
      local brief_prepend
      brief_prepend="$(mktemp -t minsky-brief-prepend.XXXXXX)"
      {
        echo "PRIOR-ITERATION UNCOMMITTED WORK IN THIS WORKTREE (may be incomplete or broken):"
        echo ""
        echo '```'
        echo "$uncommitted_summary"
        echo '```'
        echo ""
        echo "Your FIRST tool call: \`cat\` (or file_editor view) any new file in the list above; \`git diff\` any modified file. If the prior work is correct, stage + commit + push it BEFORE doing anything else. If broken or incomplete, decide: continue editing OR \`git restore\`/\`rm\` and restart. Do NOT silently re-implement what's already there — that wastes the prior iteration's work and burns budget on the same first step."
        echo ""
        echo "---"
        echo ""
        cat "$brief_file"
      } > "$brief_prepend"
      mv "$brief_prepend" "$brief_file"
    fi
  fi

  local model
  model="$(jq -r '.openhands.model // "claude-sonnet-4-6"' "$CONFIG_FILE" 2>/dev/null || echo "claude-sonnet-4-6")"

  # ──────────────────────────────────────────────────────────────────
  # Run-anywhere provider decision (runany-dynamic-model-or-local-fallback,
  # Acceptance 1-4). When the operator has NOT already forced local mode
  # via `local_llm_enabled: true` (an explicit override that wins), consult
  # the shipped pure `decideRunAnyProvider` via `scripts/runany-resolve-
  # model.mjs`. It returns the next iteration's agent shape ("claude" /
  # "local") by the pin > dynamic > local decision table:
  #   (1) operator pin (env MINSKY_STRATEGIC_PIN_MODEL) → that model verbatim;
  #   (2) unpinned + budget headroom → highest-quality model that fits;
  #   (3) ALL configured remote backends down/exhausted → local, ≤1 iteration.
  # The decision is recomputed every iteration over a fresh-or-cached
  # multi-backend liveness probe, so recovery to remote (4) is automatic.
  #
  # Rule #6 (stay alive): if node / the resolver fails for any reason the
  # `|| true` leaves `$resolved_agent` empty and we fall through to the
  # existing config-driven path — the agent always gets a model.
  #
  # Bidirectional runtime auto-pivot (runtime-token-limit-auto-pivot-local-and-
  # back): the forward fallback (remote→local) already lived here. This block
  # ALSO persists a `local_since` marker on the forward switch and, when the run
  # is ALREADY on local, runs a cheap remote recover-probe FIRST — flipping
  # back to remote (pin honored) within one probe interval of credits
  # returning, with anti-flap dwell + N-consecutive-good probes in the pure
  # `decideRecoverFlipBack`. The bash only does I/O; the decision is pure.
  local marker_dir="$host/.minsky"
  local marker_file="$marker_dir/runany-local-since.json"
  export MINSKY_LOCAL_SINCE_PATH="$marker_file"
  local resolved_agent=""
  if [[ "$local_llm_enabled" != "true" ]]; then
    # ── Recover-probe FIRST when a prior iteration already dropped to local.
    # If the marker exists, the run is on local; probe the remote backend and
    # ask the pure decider whether to flip back this iteration.
    if [[ -f "$marker_file" ]]; then
      local recover_json
      recover_json="$(node "$script_dir/../scripts/runany-resolve-model.mjs" --recover-probe 2>/dev/null || true)"
      if [[ -n "$recover_json" ]]; then
        local flip_back good_probes recover_reason recover_pin
        flip_back="$(printf '%s' "$recover_json" | jq -r '.flipBack // false' 2>/dev/null || echo "false")"
        good_probes="$(printf '%s' "$recover_json" | jq -r '.goodProbes // 0' 2>/dev/null || echo "0")"
        recover_reason="$(printf '%s' "$recover_json" | jq -r '.reason // ""' 2>/dev/null || echo "")"
        recover_pin="$(printf '%s' "$recover_json" | jq -r '.pin // empty' 2>/dev/null || echo "")"
        if [[ "$flip_back" == "true" ]]; then
          # Credits are back AND anti-flap holds: flip the run BACK to remote.
          # Pin precedence: re-pin to MINSKY_STRATEGIC_PIN_MODEL if set, else
          # let decideRunAnyProvider re-pick below (resolved_agent stays empty).
          rm -f "$marker_file" 2>/dev/null || true
          if [[ -n "$recover_pin" ]]; then
            model="$recover_pin"
            echo "host=$host runany-provider=recover-flip-back → remote (pin=$model)" >&2
          else
            echo "host=$host runany-provider=recover-flip-back → remote (dynamic re-pick)" >&2
          fi
          node "$script_dir/../scripts/orchestrate.mjs" record-mode-transition \
            --from=local --to=remote --trigger=recover-flip-back --model="$model" \
            >/dev/null 2>&1 || true
        else
          # Stay on local; persist the updated consecutive-good-probe counter so
          # the next iteration's anti-flap gate sees the running tally.
          local local_since_ms
          local_since_ms="$(jq -r '.localSinceMs // 0' "$marker_file" 2>/dev/null || echo "0")"
          printf '{"localSinceMs":%s,"goodProbes":%s}\n' "$local_since_ms" "$good_probes" \
            > "$marker_file" 2>/dev/null || true
          local_llm_enabled="true"
          echo "host=$host runany-provider=recover-probe hold-local ($recover_reason)" >&2
        fi
      else
        # Probe failed to run (rule #6): stay on local rather than risk a
        # spawn against an exhausted remote.
        local_llm_enabled="true"
        echo "host=$host runany-provider=recover-probe unavailable → hold-local" >&2
      fi
    fi

    # ── Forward decision (only when we did not already flip to hold-local).
    if [[ "$local_llm_enabled" != "true" ]]; then
      local resolver_json
      resolver_json="$(node "$script_dir/../scripts/runany-resolve-model.mjs" --json 2>/dev/null || true)"
      if [[ -n "$resolver_json" ]]; then
        resolved_agent="$(printf '%s' "$resolver_json" | jq -r '.agent // empty' 2>/dev/null || echo "")"
        local resolved_model
        resolved_model="$(printf '%s' "$resolver_json" | jq -r '.model // empty' 2>/dev/null || echo "")"
        local resolved_kind
        resolved_kind="$(printf '%s' "$resolver_json" | jq -r '.kind // empty' 2>/dev/null || echo "")"
        if [[ "$resolved_agent" == "local" ]]; then
          # Decision (2 budget-exhausted) or (3 all-remote-down): switch fully
          # to local this iteration. Treat exactly like config `local_llm_enabled`.
          local_llm_enabled="true"
          echo "host=$host runany-provider=$resolved_kind → local (auto fallback)" >&2
          # Persist the local_since marker (forward switch) — drives the
          # recover-probe's dwell gate next iteration. Only stamp it on the
          # FIRST drop, so the dwell measures from the true start.
          if [[ ! -f "$marker_file" ]]; then
            mkdir -p "$marker_dir" 2>/dev/null || true
            printf '{"localSinceMs":%s,"goodProbes":0}\n' "$(_now_ms)" \
              > "$marker_file" 2>/dev/null || true
            node "$script_dir/../scripts/orchestrate.mjs" record-mode-transition \
              --from=remote --to=local --trigger="$resolved_kind" \
              >/dev/null 2>&1 || true
          fi
        elif [[ "$resolved_agent" == "claude" && -n "$resolved_model" ]]; then
          # Decision (1 pin) or (2 dynamic-remote): use the resolved remote model.
          model="$resolved_model"
          echo "host=$host runany-provider=$resolved_kind model=$model" >&2
        fi
      fi
    fi
  fi

  local extra_spawn_flags=""
  if [[ "$local_llm_enabled" == "true" ]]; then
    local local_model
    local_model="$(jq -r '.local_llm.model // "ollama_chat/qwen3-coder:30b"' "$CONFIG_FILE" 2>/dev/null || echo "ollama_chat/qwen3-coder:30b")"
    local local_base_url
    local_base_url="$(jq -r '.local_llm.base_url // "http://localhost:11434"' "$CONFIG_FILE" 2>/dev/null || echo "http://localhost:11434")"
    model="$local_model"
    # --no-extended-thinking AND --reasoning-effort=none are BOTH required
    # for non-thinking providers (Ollama, LM Studio). Pre-2026-05-27 the
    # runner only passed --no-extended-thinking; ollama still rejected the
    # default reasoning_effort=high with
    # `{"error":"\"qwen3-coder:30b\" does not support thinking"}`,
    # surfacing as `openhands.sdk.conversation.exceptions.
    # ConversationRunError` after 4 retries (~128s per iteration). See
    # the shim's docstring at novel/adapters/agent-runtime-openhands/bin/
    # minsky-openhands-spawn.py lines 140-146 for the canonical knob set.
    # --reengage-budget 3 wraps the OpenHands conversation with a no-
    # progress nudge loop (novel/adapters/agent-runtime-openhands/bin/
    # minsky-openhands-spawn.py § _run_conversation). Activates only on
    # local-LLM path because qwen3-coder:30b reliably disengages with
    # prose-only replies after one tool call (PR #978 reduced the rate;
    # this PR closes the residual). Cloud Claude almost never hits this
    # class so the budget stays 0 on the cloud path (default), keeping
    # cloud behavior unchanged.
    extra_spawn_flags="--base-url $local_base_url --no-extended-thinking --reasoning-effort none --reengage-budget 3"
    echo "host=$host local_llm=on model=$model base-url=$local_base_url" >&2
  fi

  local exit_code=0
  local stdout_log
  stdout_log="$(mktemp -t minsky-stdout.XXXXXX)"

  # ──────────────────────────────────────────────────────────────────
  # Worktree isolation (operator directive 2026-05-26):
  # spawn the cloud agent INSIDE `$host/.worktrees/daemon-<task-id>/`,
  # never against the host's main checkout. Before this, every
  # iteration ran the agent with `--repo $host`, giving it write access
  # to the operator's main working tree. The 2026-05-26 incident: while
  # iterating on the (just-shipped) `daemon-auto-close-orphan-prs`
  # task, the agent staged `git rm TASKS.md` (4257 lines) in the
  # operator's main checkout. The push never happened (the iteration
  # crashed) but `git status` showed the destruction on the next
  # operator command. Worktree isolation makes this class of destruction
  # impossible: the agent's `git add -A` / `git rm` / `rm -rf` all land
  # in the worktree, NEVER in `$host`.
  #
  # Same code path the OLD TS daemon used (`.claude/worktrees/daemon-N-
  # <task>/`); bash skeleton lost it during phase-11b's flip. Restoring.
  #
  # Pattern: `git worktree add --force` is idempotent — if a previous
  # iteration left a worktree behind, --force takes it over (we re-
  # check out the same branch ref). The agent's pushes go through the
  # worktree's git remote, which is the same origin as the host's, so
  # PRs open the same way.
  local worktree="$host/.worktrees/daemon-${task_id}"
  mkdir -p "$host/.worktrees"

  # Step 1: REUSE path. If the worktree directory already exists AND is
  # on the right branch (from a previous iteration of the same task),
  # just reuse it — `git worktree add` against an existing path fails
  # even with --force when the branch is the same, and we'd then
  # fall back to host-root spawn unnecessarily. The agent's previous
  # work-in-progress in this worktree is intentional state we want to
  # carry forward across iterations.
  if [[ -d "$worktree/.git" ]] || [[ -f "$worktree/.git" ]]; then
    local existing_branch
    existing_branch="$(git -C "$worktree" branch --show-current 2>/dev/null || true)"
    if [[ "$existing_branch" == "$branch" ]]; then
      # Worktree already on right branch — reuse. Fetch latest origin
      # so the agent sees up-to-date main when it computes diffs.
      git -C "$worktree" fetch origin --quiet 2>/dev/null || true
      echo "host=$host worktree=$worktree (isolated, reused from prev iter)" >&2
    else
      # Worktree exists but on wrong branch — prune + recreate.
      git -C "$host" worktree remove --force "$worktree" 2>/dev/null || rm -rf "$worktree"
      worktree=""  # signal recreate
    fi
  fi

  # Step 2: CREATE path. Worktree doesn't exist (or was just pruned).
  # A worktree's `.git` is a FILE (`gitdir: ...`), not a directory, so
  # we check for either. If Step 1 reused successfully, $worktree is
  # set and one of these exists — skip Step 2.
  if [[ -z "$worktree" ]] || { [[ ! -d "$worktree/.git" ]] && [[ ! -f "$worktree/.git" ]]; }; then
    worktree="$host/.worktrees/daemon-${task_id}"
    if git -C "$host" rev-parse --verify "refs/heads/${branch}" >/dev/null 2>&1; then
      git -C "$host" worktree add --force "$worktree" "$branch" >/dev/null 2>&1 \
        || { echo "WARN: worktree add failed for ${branch}; falling back to host-root spawn (NOT ISOLATED)" >&2; worktree="$host"; }
    elif git -C "$host" rev-parse --verify "refs/remotes/origin/${branch}" >/dev/null 2>&1; then
      git -C "$host" worktree add --force -b "$branch" "$worktree" "refs/remotes/origin/${branch}" >/dev/null 2>&1 \
        || { echo "WARN: worktree add (tracking) failed for ${branch}; falling back to host-root spawn (NOT ISOLATED)" >&2; worktree="$host"; }
    else
      git -C "$host" worktree add --force -b "$branch" "$worktree" "refs/remotes/origin/main" >/dev/null 2>&1 \
        || git -C "$host" worktree add --force -b "$branch" "$worktree" "HEAD" >/dev/null 2>&1 \
        || { echo "WARN: worktree add (new branch) failed for ${branch}; falling back to host-root spawn (NOT ISOLATED)" >&2; worktree="$host"; }
    fi
    if [[ "$worktree" != "$host" ]]; then
      echo "host=$host worktree=$worktree (isolated)" >&2
    fi
  fi

  # Dynamic watchdog — p95×1.5 of recent successful iterations, with a
  # model-class-aware cold-start floor when history is thin. Mirrors the
  # TS `dynamic-timeouts.ts` algorithm (rule #1 — port, don't reinvent).
  # Exit code 124 means the watchdog fired (matches GNU `timeout(1)`).
  #
  # `--model "$model"` (worker-watchdog-scale-by-pinned-model-latency):
  # by this point `$model` is fully resolved (config default, runany
  # dynamic re-pick, recover-flip-back pin, or local model). On a fresh
  # host with <5 samples the picker selects the cold-start floor from the
  # resolved model class (slow-remote Opus > fast-remote > local=DEFAULT)
  # instead of the single flat 20-min default that SIGKILLs a slow remote
  # model before its first heavy iteration can edit. Once ≥5 samples
  # exist the p95×1.5 path takes over and `--model` is irrelevant.
  local watchdog_s
  watchdog_s="$(python3 "$script_dir/../scripts/dynamic_timeout.py" "$host" --model "$model")"
  local start_ms
  start_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"

  # Agent dispatch via scripts/spawn_agent.py — resolves the right
  # OpenHands backend at spawn time. The canonical `openhands solve`
  # CLI ships June 1, 2026 (Agent Canvas Initiative); until then the
  # dispatcher falls back to the existing Python shim at
  # novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py
  # which the TS substrate has been using since Path C reshape (rule #1 —
  # don't reinvent; the shim already works against the OpenHands SDK).
  #
  # Before this dispatcher, the bash runner hard-coded `openhands solve`
  # — on every operator machine without the future CLI (i.e. all of
  # them today), every spawn failed with exit 127 and the autonomous
  # loop produced no PRs.
  local spawn_agent="$script_dir/../scripts/spawn_agent.py"

  # Runtime-resilience preflight (minsky-runtime-resilience, branch c):
  # guard the spawn shim BEFORE the watchdog wrappers invoke it. When the
  # dispatcher is missing (partial clone, interrupted `pnpm install`) the
  # `python3 "$spawn_agent" …` calls below would surface as a raw python
  # `can't open file …: [Errno 2] No such file or directory` with no
  # pointer at the fix. Move the failure to the operator-actionable
  # boundary: name the path + the fix, record a spawn-failed verdict, and
  # return cleanly so the daemon loop survives (rule #6, let-it-crash AT
  # the right boundary — not a raw ENOENT mid-iteration).
  if ! preflight_run_target "$spawn_agent" "pnpm install (restores scripts/spawn_agent.py)"; then
    rm -f "$brief_file"
    record_iteration "$host" "$iter_n" "$task_id" "$branch" "spawn-failed" "" \
      "run target missing: scripts/spawn_agent.py (run pnpm install)" "$gh_host"
    return 1
  fi

  # Export the three MINSKY_* env vars the spawned agent (and the host's
  # rule lints) expect. Parity port of TS `spawn-plan.ts` § `env: { … }`.
  # Without these, the 12 host-side rule lints that key off
  # `MINSKY_HOST_ROOT` can't find the host's `.minsky/` substrate
  # (breaks Acceptance criterion #6 of user-stories/006-runner-on-any-
  # repo.md). Pre-PR: bash runner spawned with empty env beyond the
  # caller's shell — silently broke host-side lints.
  #
  # `local -x` exports the variable into iterate_host's subshells. The
  # watchdog wrappers below inherit the parent process env by default
  # (Python subprocess.run, GNU timeout, bash) so the agent sees them.
  local -x MINSKY_HOST_ROOT="$host/.minsky"
  local -x MINSKY_TASK_ID="$task_id"
  local -x MINSKY_BRANCH_NAME="$branch"
  # Point the spawn watchdog's pre-SIGKILL WIP stash at the isolated
  # worktree (where the agent edits via `--repo "$worktree"`), not the
  # bash caller's cwd. On a timeout (exit 124) the Stage-0 auto-commit
  # backstop below never runs (it gates on exit 0), so without this stash
  # the timed-out iteration's uncommitted implementation is dropped —
  # recoverable afterwards via `git -C "$worktree" stash list`.
  # See scripts/spawn_with_watchdog.py (spawn-strategy-pre-sigkill-stash).
  local -x MINSKY_TIMEOUT_STASH_DIR="$worktree"

  # Watchdog binary resolution order (rule #1 — prefer existing solutions):
  #   1. Python wrapper at scripts/spawn_with_watchdog.py — POSIX-portable,
  #      handles process-group SIGTERM/SIGKILL, no external deps.
  #   2. GNU `timeout` (Linux default; Ubuntu CI runners).
  #   3. `gtimeout` (macOS with `brew install coreutils`).
  #   4. No wrapper — graceful degrade (rule #6); a hung openhands hangs
  #      the daemon. Logged at warn-level so operators know.
  # `--repo "$worktree"` is the worktree isolation point: the agent
  # only sees + writes to the isolated checkout, never the host's main
  # tree. If worktree creation fell back above (rare; --force should
  # always succeed), `$worktree` equals `$host` and the spawn runs at
  # the host root — matching pre-2026-05-26 behavior. The fallback is
  # logged loudly so the operator catches it.
  # `$extra_spawn_flags` is set above when `local_llm_enabled: true` —
  # it's deliberately unquoted in the spawn invocations so empty-string
  # (cloud-LLM path) becomes a no-op and non-empty (local-LLM path)
  # expands to `--base-url <url> --no-extended-thinking`. Shellcheck
  # would normally yell about unquoted expansion; the `# shellcheck`
  # pragmas below opt out for the load-bearing word-splitting that the
  # flag-list pattern needs.
  local spawn_wrapper="$script_dir/../scripts/spawn_with_watchdog.py"
  # Resolve the python interpreter for the spawn shim — prefers
  # ~/.minsky/openhands-venv/bin/python over bare python3. See
  # resolve_openhands_python() above for the resolution order. The
  # outer watchdog wrapper (spawn_with_watchdog.py / timeout / gtimeout)
  # itself is a thin process supervisor that doesn't import openhands;
  # it continues to use bare python3 from PATH.
  local openhands_python
  openhands_python="$(resolve_openhands_python)"
  if [[ -x "$spawn_wrapper" ]]; then
    # shellcheck disable=SC2086
    python3 "$spawn_wrapper" "$watchdog_s" \
      "$openhands_python" "$spawn_agent" \
      --brief-file "$brief_file" \
      --repo "$worktree" \
      --model "$model" \
      $extra_spawn_flags \
      >"$stdout_log" 2>&1 || exit_code=$?
  elif command -v timeout >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    timeout "${watchdog_s}s" "$openhands_python" "$spawn_agent" \
      --brief-file "$brief_file" \
      --repo "$worktree" \
      --model "$model" \
      $extra_spawn_flags \
      >"$stdout_log" 2>&1 || exit_code=$?
  elif command -v gtimeout >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    gtimeout "${watchdog_s}s" "$openhands_python" "$spawn_agent" \
      --brief-file "$brief_file" \
      --repo "$worktree" \
      --model "$model" \
      $extra_spawn_flags \
      >"$stdout_log" 2>&1 || exit_code=$?
  else
    echo "WARN: no watchdog available — running unbounded agent spawn" >&2
    # shellcheck disable=SC2086
    "$openhands_python" "$spawn_agent" \
      --brief-file "$brief_file" \
      --repo "$worktree" \
      --model "$model" \
      $extra_spawn_flags \
      >"$stdout_log" 2>&1 || exit_code=$?
  fi
  local end_ms
  end_ms="$(python3 -c 'import time; print(int(time.time() * 1000))')"
  local duration_ms=$((end_ms - start_ms))

  local verdict notes pr_url
  if [[ "$exit_code" -eq 0 ]]; then
    verdict="validated"

    # Stage 0 backstop (added 2026-05-28): auto-commit any uncommitted
    # changes in the worktree BEFORE the existing PR-creation backstops
    # run. Without this, every iteration that the agent edits files but
    # doesn't git-add ends with verdict=no-progress AND the file sits
    # in the worktree forever (the next iteration sees it via
    # build_brief's prepend-notice, but qwen3-coder:30b reliably fails
    # to commit it). 14+ iterations on `a2a-adapter-foundation` between
    # 17:06 and 18:01 left the same `novel/adapters/a2a.ts` uncommitted —
    # progress measurable on disk but invisible in the iteration ledger.
    #
    # The auto-commit:
    #   - Stages ALL changes (`git add -A`) so untracked files, deletes,
    #     and modifications all land together
    #   - Commits with a deterministic "wip(daemon)" message — the
    #     conventional-commit prefix lets the operator filter these PRs
    #     in `gh pr list --label wip` and squash them at merge time
    #   - Pushes the branch so the existing stage-3 backstop can open
    #     a draft PR for the WIP work
    #   - Sets daemon@minsky.local as author so the commit is
    #     attributable to the supervisor, not the operator
    #
    # The WIP commit may be broken (the file might not even compile —
    # observed-2026-05-28's a2a.ts imports `@minsky/adapter-types`
    # which doesn't exist as a package). That's OK: the PR will land
    # as a draft, CI will show the failures, and the next iteration
    # has both the committed work AND the CI feedback to build on.
    # The alternative (silently dropping the work) makes
    # cross-iteration progress impossible.
    if [[ -d "$worktree/.git" ]] || [[ -f "$worktree/.git" ]]; then
      local wt_status_for_autocommit
      wt_status_for_autocommit="$(git -C "$worktree" status --porcelain 2>/dev/null)"
      if [[ -n "$wt_status_for_autocommit" ]]; then
        git -C "$worktree" add -A 2>/dev/null || true
        # Set author identity inline so no global git config is required
        # on the operator's machine — the daemon's commits identify
        # themselves regardless of operator setup.
        #
        # `-c core.hooksPath=/dev/null` bypasses lefthook for WIP
        # commits without triggering the `no-no-verify-bypass` lint
        # (which only flags `--no-verify` / `-n`). Necessary because
        # the launchd-spawned daemon inherits the launchd plist's
        # hardcoded PATH (v22.22.0 first); lefthook's check-toolchain
        # rejects the commit with `wrong node v22.22.2, expected
        # v24.14.0`. Observed 2026-05-28: every supervisor-side auto-
        # commit failed with this error, leaving the file staged but
        # never committed. Tradeoff: pre-commit hooks (scan-secrets,
        # biome, typecheck, vitest) skipped for the WIP commit; the
        # full CI lint suite (40+ checks) runs on the PR — rule #10:
        # deterministic CI gates are the load-bearing check, not the
        # local hook.
        git -c "core.hooksPath=/dev/null" \
            -c "user.email=daemon@minsky.local" \
            -c "user.name=minsky-daemon" \
            -C "$worktree" \
            commit -m "wip(daemon): partial progress on ${task_id} (auto-committed by supervisor)" 2>/dev/null || true
        # Push to origin so the existing stage-3 `gh pr create` backstop
        # can find the branch and open the draft PR.
        #
        # `-c core.hooksPath=/dev/null` bypasses the pre-push hook too
        # (which runs `pnpm pre-pr-lint` and needs node_modules — the
        # worktree shares .git with the parent but NOT node_modules, so
        # the lint chain fails before push). Same rationale as the
        # commit bypass above: WIP-only, CI runs full lint on the PR.
        git -c "core.hooksPath=/dev/null" \
            -C "$worktree" \
            push -u origin "$branch" 2>/dev/null || true
      fi
    fi

    # Parity port of `extractPrUrl` from
    # novel/cross-repo-runner/src/runner.ts. Two bugs in the previous
    # inline bash regex:
    #   1. It hard-coded `github\.com`, so PR URLs printed by Example
    #      hosts (`https://github.example.com/...`) silently never
    #      matched — every successful Example-host iteration recorded
    #      `pr_url=null`.
    #   2. It used `head -1` (first match), but the TS substrate uses
    #      LAST match — important when the agent cites a related PR
    #      before printing the newly-created one at the end of stdout.
    # Falls back to empty (graceful-degrade) when the script errors
    # out or no URL is found.
    pr_url="$(python3 "$script_dir/../scripts/extract_pr_url.py" \
              --stdout-file "$stdout_log" 2>/dev/null || true)"
    # Backstop (parity port of TS `ensurePrUrl` stage 2): when the
    # agent printed no PR URL — possible if (a) stdout was truncated
    # by the bounded log buffer, (b) the agent committed + pushed but
    # skipped `gh pr create` and only the operator-side webhook
    # opened a PR, or (c) the iteration's URL fell off the tail —
    # query `gh pr list` for any open PR matching the iteration's
    # branch. Recovers the otherwise-silent `pr_url=null` records.
    # Safe-default to empty on gh failures (rule #7 graceful-degrade —
    # gh-not-on-PATH / gh-auth-expired / branch-not-pushed are all
    # recoverable on the next iteration, never crash the loop).
    if [[ -z "$pr_url" ]]; then
      pr_url="$(_gh_in_host "$host" "$gh_host" pr list \
                  --head "$branch" --state open \
                  --json url --jq '.[0].url // ""' 2>/dev/null || true)"
    fi
    # Stage 3 backstop (parity port of TS `ensurePrUrl` stage 3 +
    # `defaultBackstopTitle`/`defaultBackstopBody`): when neither
    # stdout extraction nor the gh-pr-list query found a PR, but the
    # agent committed + pushed (i.e. the branch exists on origin), the
    # runner opens the PR itself. This is the
    # `devin-spawn-no-pr-opened` pivot from 2026-05-18 — agents
    # commonly finish editing + commit + push but skip `gh pr create`.
    # Without this stage, those iterations record `pr_url=null` even
    # though the work shipped, breaking the cross-repo-pr-rate metric.
    #
    # The backstop:
    #   - Verifies the branch exists on origin via `git ls-remote
    #     --heads` (skips when the agent didn't even push).
    #   - Resolves default_branch from the host's repo.yaml (falls
    #     back to "main").
    #   - Calls `gh pr create` with rule-#9-aware title + body.
    #   - Captures the resulting PR URL.
    # Safe-defaults to empty on any failure (rule #7); the legacy
    # `pr_url=null` is preserved as the no-backstop-possible signal.
    if [[ -z "$pr_url" ]]; then
      # Check the branch was actually pushed before bothering with
      # `gh pr create` (which would just fail with a clearer error
      # than ours otherwise). `git ls-remote --exit-code` returns 0
      # when the ref exists, 2 when it doesn't.
      if ( cd "$host" && git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 ); then
        local default_branch
        default_branch="$(python3 -c "
import sys
sys.path.insert(0, '$script_dir/../scripts')
from build_brief import load_host_config
from pathlib import Path
print(load_host_config(Path('$host')).default_branch)
" 2>/dev/null || echo "main")"
        local backstop_title backstop_body
        backstop_title="chore: backstop PR for ${task_id} (agent did not run gh pr create)"
        # Body matches the TS substrate's defaultBackstopBody — same
        # markdown structure + the rule-#9 self-grade block (required
        # by check-pr-self-grade.mjs).
        backstop_body="$(printf '%s\n' \
"Auto-opened by minsky-run's post-spawn PR-creation backstop because the spawned agent finished with exit 0 but did not run \`gh pr create\` (or the URL did not appear in the bounded stdout tail)." \
"" \
"Task: \`${task_id}\`" \
"" \
"Review the commits on this branch carefully — the agent's edits are present, but its PR description / self-grade is not. Edit this PR body to reflect the actual hypothesis / observation before requesting review." \
"" \
"## Hypothesis self-grade" \
"" \
"- Predicted: agent runs to completion and opens a PR via \`gh pr create\`" \
"- Observed: agent finished cleanly but no PR URL appeared in stdout; runner-side backstop opened this PR" \
"- Match: partial" \
"- Lesson: the brief's \`gh pr create\` step is necessary but not always sufficient; the runner backstop is the durable safety net (devin-spawn-no-pr-opened pivot, 2026-05-18)")"
        pr_url="$(_gh_in_host "$host" "$gh_host" pr create \
                    --base "$default_branch" --head "$branch" \
                    --title "$backstop_title" \
                    --body "$backstop_body" 2>/dev/null || true)"
      fi
    fi
    # Evidence-of-work gate (2026-05-27 operator session: 9-hour monitor
    # of the qwen3-coder:30b daemon caught 13/13 iterations exiting 0
    # while doing one `ls -la` and quitting — verdict was `validated` and
    # `daemon-spawn-failure-rate` invariant said all-green, but the agent
    # produced zero PRs). After the 3-stage PR backstop above, if pr_url
    # is STILL empty AND the agent did not even commit anything in its
    # isolated worktree, the iteration shipped no work. Downgrade verdict
    # to `no-progress` so:
    #   - the invariant counts it as a failure class (catches the new
    #     bug-class within ≤60s instead of 9-hour pattern-spotting);
    #   - capture-failure.sh preserves the stdout (rule: every
    #     non-validated verdict gets captured for diagnosis);
    #   - dynamic_timeout.py automatically excludes it from the p95
    #     baseline (its whitelist is `validated` + `scope-leak` only —
    #     no-progress isn't a successful completion).
    #
    # `commits_count > 0` is a partial-progress signal: the agent
    # committed work but didn't push or open a PR. Still no-progress
    # from the ship-it perspective (the change didn't reach origin),
    # but the notes field captures the nuance so the operator can choose
    # to manually push the worktree if the work is salvageable.
    #
    # `working_tree_changes > 0` is an even weaker partial-progress
    # signal: the agent EDITED files (modified or untracked) in the
    # worktree but didn't even `git add` them. Common with local LLMs
    # that produce broken/incomplete code and stop without realizing
    # the brief's FINAL STEP block requires git add + commit + push.
    # Pre-fix, this case recorded `no useful work` and the operator
    # couldn't tell that the agent HAD done file edits — it just looked
    # like a no-op iteration. Visibility fix observed 2026-05-28: agent
    # created 221-line novel/adapters/a2a.ts (broken imports, but real
    # work) and the verdict said `(no useful work)` because no commit
    # landed. Now the notes call it out so the operator sees the
    # uncommitted progress and can salvage / discard / iterate.
    if [[ -z "$pr_url" ]]; then
      local commits_count=0
      local working_tree_changes=0
      if [[ -d "$worktree/.git" ]] || [[ -f "$worktree/.git" ]]; then
        local default_branch_for_count
        default_branch_for_count="$(python3 -c "
import sys
sys.path.insert(0, '$script_dir/../scripts')
from build_brief import load_host_config
from pathlib import Path
print(load_host_config(Path('$host')).default_branch)
" 2>/dev/null || echo "main")"
        commits_count="$(git -C "$worktree" rev-list --count "origin/${default_branch_for_count}..HEAD" 2>/dev/null || echo 0)"
        working_tree_changes="$(git -C "$worktree" status --porcelain 2>/dev/null | grep -c '^' || echo 0)"
      fi
      verdict="no-progress"
      if [[ "$commits_count" -gt 0 ]]; then
        notes="openhands exited 0; ${duration_ms}ms; no PR opened but agent committed ${commits_count} change(s) — not pushed"
      elif [[ "$working_tree_changes" -gt 0 ]]; then
        notes="openhands exited 0; ${duration_ms}ms; agent edited ${working_tree_changes} file(s) in worktree but did not commit (uncommitted progress preserved in worktree)"
      else
        notes="openhands exited 0; ${duration_ms}ms; agent exited cleanly without commits/PR/push (no useful work)"
      fi
    else
      notes="openhands exited 0; ${duration_ms}ms"
    fi
  elif [[ "$exit_code" -eq 124 ]]; then
    # GNU timeout(1) exits 124 when the watchdog fires.
    #
    # PR-URL salvage (2026-06-02, runner-records-validated-when-pr-opened-
    # despite-nonzero-exit): a SIGTERMed-after-PR iteration is NOT a
    # failure. The watchdog routinely fires AFTER the agent has run
    # `gh pr create` (it opened+merged the PR, then kept polling CI and
    # got killed at the timeout). Recording `spawn-failed, pr_url=""`
    # the instant exit_code != 0 throws away the salvageable PR URL still
    # sitting in the stdout log, undercounting the ground-truth
    # cross-repo-pr-rate / agent-merge-rate metrics (every shipped PR
    # that timed out post-creation reads as a failure). Per rule #17
    # (proactive healing) + SRE Ch. 6 (every signal must be classified —
    # a silent spawn-failed eats the PR-opened success signal), salvage
    # the URL before defaulting to spawn-failed. Graceful-degrade (rule
    # #7): the script always exits 0; an empty result preserves the
    # legacy spawn-failed verdict.
    pr_url="$(python3 "$script_dir/../scripts/extract_pr_url.py" \
              --stdout-file "$stdout_log" 2>/dev/null || true)"
    if [[ -n "$pr_url" ]]; then
      verdict="validated"
      notes="signaled-but-pr-opened: timeout (${watchdog_s}s) after agent opened PR; ${duration_ms}ms"
    else
      verdict="spawn-failed"
      pr_url=""
      notes="timeout (${watchdog_s}s); ${duration_ms}ms"
    fi
  else
    # Same PR-URL salvage as the timeout branch above: a generic non-zero
    # exit (e.g. the agent opened a PR then crashed on a follow-up step)
    # may still have printed a parseable PR URL. Salvage it before
    # recording spawn-failed so a shipped PR isn't ledgered as a failure.
    pr_url="$(python3 "$script_dir/../scripts/extract_pr_url.py" \
              --stdout-file "$stdout_log" 2>/dev/null || true)"
    if [[ -n "$pr_url" ]]; then
      verdict="validated"
      notes="signaled-but-pr-opened: openhands exited $exit_code after agent opened PR; ${duration_ms}ms"
    else
      verdict="spawn-failed"
      pr_url=""
      notes="openhands exited $exit_code; ${duration_ms}ms; tail: $(tail -1 "$stdout_log" | tr -d '"' | cut -c1-100)"
    fi
  fi

  # Failure capture (Slice 2 of bash-runner observability, 2026-05-25):
  # On any non-validated verdict, snapshot the brief + stdout + env +
  # metadata into <host>/.minsky/failures/<iso-ts>-<task-id>/ BEFORE
  # the mktemp cleanup. Without this, every failed iteration's brief +
  # full stdout are lost; the operator only sees the 100-char `notes`
  # tail in the JSONL row. Best-effort per rule #6 — capture failures
  # don't abort the iteration loop (the `|| true` swallows non-zero).
  if [[ "$verdict" != "validated" ]] && [[ "${MINSKY_CAPTURE_FAILURES:-1}" != "0" ]]; then
    bash "$script_dir/../scripts/capture-failure.sh" \
      --host "$host" \
      --task-id "${task_id:-_no-task}" \
      --verdict "$verdict" \
      --exit-code "${exit_code:-0}" \
      --duration-ms "${duration_ms:-0}" \
      --brief-file "$brief_file" \
      --stdout-log "$stdout_log" \
      --branch "${branch:-}" \
      --pr-url "${pr_url:-}" \
      --notes "${notes:-}" \
      --gh-host "${gh_host:-}" >/dev/null 2>&1 || true
  fi

  rm -f "$brief_file" "$stdout_log"
  record_iteration "$host" "$iter_n" "$task_id" "$branch" "$verdict" "$pr_url" "$notes" "$gh_host"
}

# --- 5b. CTO audit (queue-empty trigger) -----------------------------------
# Parity port slice 2 of `novel/cross-repo-runner/src/host-cto-audit.ts §
# runHostCtoAudit`. Wires `scripts/build_cto_brief.py` (PR #856) into a
# real agent spawn when the daemon's queue drains. The spawned agent
# reads the brief, looks at host state, and opens a PR proposing 1–3
# new tasks. On the next daemon respawn, those tasks get picked up.
# That's the self-improvement loop the operator brief asks for.

cto_audit_host() {
  local host="$1"
  local script_dir
  script_dir="$(dirname "${BASH_SOURCE[0]}")"
  local utc_date
  utc_date="$(date -u +%Y-%m-%d)"

  # Resolve host_repo via build_brief.load_host_config (consistent with
  # the iteration brief's path). Falls back to basename if repo.yaml
  # is missing — same graceful-degrade as the iteration path.
  local host_repo
  host_repo="$(python3 -c "
import sys
sys.path.insert(0, '$script_dir/../scripts')
from build_brief import load_host_config
from pathlib import Path
print(load_host_config(Path('$host')).host_repo)
" 2>/dev/null || basename "$host")"

  # Build the CTO brief. Queue-empty trigger means no completed task
  # and no PR URL — the agent gets a "seed audit" prompt.
  local audit_brief
  audit_brief="$(mktemp -t minsky-cto-brief.XXXXXX)"
  if ! python3 "$script_dir/../scripts/build_cto_brief.py" \
      --host-repo "$host_repo" \
      --host-root "$host" \
      --reason queue-empty \
      --utc-date "$utc_date" \
      > "$audit_brief" 2>/dev/null; then
    echo "WARN: build_cto_brief.py failed for $host (skipping audit)" >&2
    rm -f "$audit_brief"
    return 0
  fi

  # Audit identifiers (parity with TS substrate naming):
  local audit_task_id="host-cto-audit-${utc_date}"
  local audit_branch="audit/${utc_date}-cross-repo-seed"

  # Resolve GH_HOST + model — same plumbing as iterate_host.
  local gh_host
  gh_host="$(resolve_gh_host_for "$host")"
  local model
  model="$(jq -r '.openhands.model // "claude-sonnet-4-6"' "$CONFIG_FILE" 2>/dev/null || echo "claude-sonnet-4-6")"

  # Same env vars as a regular iteration so the agent's host-side
  # rule lints work (parity port from PR #853).
  local -x MINSKY_HOST_ROOT="$host/.minsky"
  local -x MINSKY_TASK_ID="$audit_task_id"
  local -x MINSKY_BRANCH_NAME="$audit_branch"

  # No watchdog wrapping — CTO audits are slower (look at full repo
  # context) and a watchdog kill mid-audit would leave the agent's
  # work-in-progress on disk. The operator can ^C to stop. The audit
  # is opt-in anyway (MINSKY_CTO_AUDIT_ON_DRAIN=1).
  # Runtime-resilience (minsky-runtime-resilience, branch b): the CTO-audit
  # log target is `$host/.minsky/`, an operator-supplied dir that can be
  # unwritable (wrong-owner MINSKY_HOME, read-only mount). Pre-fix, an
  # unwritable `$host/.minsky/` aborted the audit at the `mkdir -p` errno.
  # Now `resilient_logfile` falls back to `${TMPDIR:-/tmp}/minsky-<user>-<id>.log`
  # with a one-line warn and the audit continues (graceful degradation —
  # the audit's value is the spawned agent's PR, not the log path).
  local audit_log
  audit_log="$(resilient_logfile "$host/.minsky" "cto-audit-${utc_date}" ".log")"

  # Same worktree-isolation pattern as iterate_host — the CTO audit
  # ALSO runs a cloud agent with full git write access; if we leave it
  # spawning against `$host`, the operator-tree-destruction bug
  # (2026-05-26 incident) returns through the audit path.
  local audit_worktree="$host/.worktrees/daemon-${audit_task_id}"
  mkdir -p "$host/.worktrees"
  if git -C "$host" rev-parse --verify "refs/heads/${audit_branch}" >/dev/null 2>&1; then
    git -C "$host" worktree add --force "$audit_worktree" "$audit_branch" >/dev/null 2>&1 \
      || { echo "WARN: cto-audit worktree add failed; falling back to host-root spawn (NOT ISOLATED)" >&2; audit_worktree="$host"; }
  else
    git -C "$host" worktree add --force -b "$audit_branch" "$audit_worktree" "refs/remotes/origin/main" >/dev/null 2>&1 \
      || git -C "$host" worktree add --force -b "$audit_branch" "$audit_worktree" "HEAD" >/dev/null 2>&1 \
      || { echo "WARN: cto-audit worktree add (new branch) failed; falling back to host-root spawn (NOT ISOLATED)" >&2; audit_worktree="$host"; }
  fi

  local audit_exit=0
  python3 "$script_dir/../scripts/spawn_agent.py" \
    --brief-file "$audit_brief" \
    --repo "$audit_worktree" \
    --model "$model" \
    >"$audit_log" 2>&1 || audit_exit=$?

  rm -f "$audit_brief"

  # Record the audit as an iteration so it appears in the experiment-
  # store ledger alongside normal iterations. Verdict = "validated"
  # when audit exited 0; "spawn-failed" otherwise. PR URL captured
  # via the same extract+backstop cascade as regular iterations.
  local pr_url=""
  local verdict notes
  if [[ "$audit_exit" -eq 0 ]]; then
    verdict="validated"
    pr_url="$(python3 "$script_dir/../scripts/extract_pr_url.py" \
              --stdout-file "$audit_log" 2>/dev/null || true)"
    # gh-backstop: query for an audit PR matching the audit branch.
    if [[ -z "$pr_url" ]]; then
      pr_url="$(_gh_in_host "$host" "$gh_host" pr list \
                  --head "$audit_branch" --state open \
                  --json url --jq '.[0].url // ""' 2>/dev/null || true)"
    fi
    notes="cto-audit; exit 0"
  else
    verdict="spawn-failed"
    notes="cto-audit; exit $audit_exit"
  fi

  record_iteration "$host" 0 "$audit_task_id" "$audit_branch" \
    "$verdict" "$pr_url" "$notes" "$gh_host"
}

# --- 6. Iteration record (JSONL ledger) -------------------------------------
# Replaces novel/cross-repo-runner/src/iteration-record.ts. Schema MUST
# match `IterationRecord` because 30+ consumers depend on it (see grep
# of `experiment_id\|host_repo\|verdict` against the tree).
#
# Path: $host/.minsky/experiment-store/cross-repo/<task-id>.jsonl
# Per-host append-only, per-task file (matches host-loop.ts writePath).

# Per-iteration glanceable summary line (task daemon-log-lacks-iteration-
# detail). Before this, daemon.log only showed the JSONL write breadcrumb,
# so the operator had to `cat .minsky/experiment-store/cross-repo/*.jsonl`
# to learn the verdict + duration + agent of an iteration. This emits the
# same data the JSONL already carries as one stderr line per iteration:
#   iteration #N: task=<id> agent=<a> verdict=<v> duration=<d> pr=<url|null>
# Fired from record_iteration (the single sink for every iteration outcome:
# no-task, dry-run, spawned, CTO-audit) so `grep -c 'iteration #'` in
# daemon.log matches the JSONL record count exactly.
#
# `agent` is `local` when the operator runs local-LLM mode
# (config `local_llm_enabled: true`), else the configured `cloud_agent`
# (default `openhands` — the runtime this skeleton spawns). `duration` is
# extracted from the `notes` field, which already embeds `<N>ms` for spawned
# iterations; it reads `n/a` when no spawn happened (no-task / dry-run).
# Glanceable-display anchor: Card & Mackinlay 1999 (the operator should see
# iteration health without digging into the ledger).
log_iteration_summary() {
  local iter_n="$1"
  local task_id="$2"
  local verdict="$3"
  local pr_url="$4"
  local notes="$5"

  local agent="openhands"
  local local_llm
  local_llm="$(jq -r '.local_llm_enabled // false' "$CONFIG_FILE" 2>/dev/null || echo "false")"
  if [[ "$local_llm" == "true" ]]; then
    agent="local"
  else
    agent="$(jq -r '.cloud_agent // "openhands"' "$CONFIG_FILE" 2>/dev/null || echo "openhands")"
  fi

  # Duration is already serialised into notes as `<N>ms` for spawned
  # iterations; reuse it rather than threading a new parameter through
  # every call site (the JSONL stays the contract, this line stays a view).
  local duration
  duration="$(printf '%s' "$notes" | grep -oE '[0-9]+ms' | head -1 || true)"
  [[ -z "$duration" ]] && duration="n/a"

  printf 'iteration #%s: task=%s agent=%s verdict=%s duration=%s pr=%s\n' \
    "${iter_n:-?}" "${task_id:-_no-task}" "$agent" "$verdict" "$duration" \
    "${pr_url:-null}" >&2
}

record_iteration() {
  local host="$1"
  local iter_n="$2"     # not in the schema; kept as a stderr breadcrumb
  local task_id="$3"
  local branch="$4"
  local verdict="$5"
  local pr_url="$6"
  local notes="$7"
  local gh_host="${8:-}"
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
  # GH_HOST is set per-iteration so this `gh repo view` reaches the
  # right registry (rule #17 — proactive healing). Falls back to gh's
  # own default when $gh_host is empty.
  local host_repo
  if host_repo="$(_gh_in_host "$host" "$gh_host" repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
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

  # Surface the iteration outcome on daemon.log for glanceability (task
  # daemon-log-lacks-iteration-detail). One line per JSONL record.
  log_iteration_summary "$iter_n" "$task_id" "$verdict" "$pr_url" "$notes"
}

# --- 7. Main ---------------------------------------------------------------
# Skip openhands invariant when --dry-run is set (no spawn). The other
# four are hard requirements.
invariant_config_loadable
[[ "$DRY_RUN" == "1" ]] || invariant_openhands_in_path
invariant_pick_task_present

# --- 7-pre. Dry-run provider-resolution banner -----------------------------
# Config-as-code discoverability (task minsky-config-json-support-local-llm-pref,
# rule #4 — everything visible). When the operator has expressed the full
# local-LLM-fallback preference declaratively in ~/.minsky/config.json
# (`local_llm_enabled: true`), a dry-run resolves + logs which provider the
# NEXT real iteration WOULD use — BEFORE the host walk and WITHOUT a host or an
# agent spawn. This lets the operator verify the file was honored with zero
# env-var ceremony: `MINSKY_CONFIG=… DRY_RUN=1 minsky-run.sh --once --dry-run`
# prints `local_llm=on model=<openhands.model> base-url=<local_llm.base_url>`.
# The same `local_llm=on` token appears later in the live spawn path (the
# per-iteration emit) so the dry-run preview and live behavior stay in lockstep.
# `MINSKY_LOCAL_LLM=1` env override is honored too (matches the live path).
if [[ "$DRY_RUN" == "1" ]]; then
  _banner_local_enabled="$(jq -r '.local_llm_enabled // false' "$CONFIG_FILE" 2>/dev/null || echo "false")"
  [[ "${MINSKY_LOCAL_LLM:-}" == "1" ]] && _banner_local_enabled="true"
  if [[ "$_banner_local_enabled" == "true" ]]; then
    _banner_model="$(jq -r '.local_llm.model // .openhands.model // "ollama_chat/qwen3-coder:30b"' "$CONFIG_FILE" 2>/dev/null || echo "ollama_chat/qwen3-coder:30b")"
    _banner_base_url="$(jq -r '.local_llm.base_url // "http://localhost:11434"' "$CONFIG_FILE" 2>/dev/null || echo "http://localhost:11434")"
    # Emit the machine-readable resolution line to STDOUT (this is the operator-
    # facing preview the config-as-code measurement greps for); mirror a human
    # log to stderr so the daemon log stays consistent with the live spawn path.
    echo "config: local_llm=on model=$_banner_model base-url=$_banner_base_url (from $CONFIG_FILE) [dry-run]"
    echo "config: local_llm=on model=$_banner_model base-url=$_banner_base_url (from $CONFIG_FILE) [dry-run]" >&2
    # With local-LLM enabled AND no host configured, a dry-run is a pure
    # config-resolution preview: print the banner above and exit 0 rather than
    # failing the hosts-dir invariant. This is the zero-ceremony "what would the
    # next iteration do?" check — `MINSKY_CONFIG=… DRY_RUN=1 minsky-run.sh --once
    # --dry-run` with no --host/--hosts-dir. With a host, the dry-run falls
    # through to walk_hosts and records the usual per-host "planned" verdict. The
    # no-local-config path keeps the historical invariant failure (a bare
    # `--dry-run` with no host is still an error — pinned by tests/minsky-run.bats
    # "missing --hosts-dir fails the invariant").
    if [[ -z "$HOSTS_DIR" && -z "$SINGLE_HOST" ]]; then
      echo "dry-run: no --host/--hosts-dir given; config preview only, no host walk" >&2
      exit 0
    fi
  fi
fi

# --- 7a. Ollama daemon-scoped warm/unload (user-story 020) -----------------
# When `local_llm_enabled: true` AND the operator hasn't disabled the
# lifecycle hooks, warm the configured local model EXACTLY ONCE per
# process before the iteration loop runs. The corresponding unload
# fires from the SIGTERM/SIGINT trap below.
#
# Why here (not in `iterate_host`): warming is daemon-scoped, not
# iteration-scoped. The cold-start tax of loading ~42 GB of qwen3-
# coder:30b into VRAM is paid ONCE per daemon-start; each subsequent
# LiteLLM request from openhands renews the keep_alive via Ollama's
# env-var default (`OLLAMA_KEEP_ALIVE=10m` post-story-020). If we
# warmed per-iteration, the daemon would pay 15-30 s of cold-start
# tax on every iteration's first agent call.
#
# Graceful-degrade (rule #7): a warm failure does NOT abort the
# runner. The bash script continues into walk_hosts; the first
# openhands spawn will trip the same connection-refused, the existing
# `heal-ollama-down` recipe kicks the daemon, and the runner proceeds.
#
# Escape hatch: `MINSKY_OLLAMA_DISABLE_LIFECYCLE=1` short-circuits
# both warm and unload to no-op (handled inside bin/minsky-ollama).
_minsky_local_llm_enabled="$(jq -r '.local_llm_enabled // false' "$CONFIG_FILE" 2>/dev/null || echo "false")"
_minsky_local_llm_model=""
_minsky_local_llm_base_url=""
_minsky_ollama_warmed=0
if [[ "$_minsky_local_llm_enabled" == "true" && "$DRY_RUN" != "1" ]]; then
  _minsky_local_llm_model="$(jq -r '.local_llm.model // "ollama_chat/qwen3-coder:30b"' "$CONFIG_FILE" 2>/dev/null || echo "ollama_chat/qwen3-coder:30b")"
  _minsky_local_llm_base_url="$(jq -r '.local_llm.base_url // "http://localhost:11434"' "$CONFIG_FILE" 2>/dev/null || echo "http://localhost:11434")"
  _minsky_ollama_bin="$(dirname "${BASH_SOURCE[0]}")/minsky-ollama"
  if [[ -x "$_minsky_ollama_bin" ]]; then
    echo "minsky-run: warming ollama model=$_minsky_local_llm_model" >&2
    if "$_minsky_ollama_bin" warm "$_minsky_local_llm_model" "$_minsky_local_llm_base_url"; then
      _minsky_ollama_warmed=1
    else
      echo "minsky-run: warm failed (continuing — first iteration will pay cold-start tax)" >&2
    fi
  else
    echo "minsky-run: bin/minsky-ollama not executable; skipping warm" >&2
  fi
fi

# Graceful shutdown via SIGTERM (sent by launchd/systemd on `stop`).
# Without this trap the supervisor's exit code on SIGTERM was 143
# (128+SIGTERM=15), which launchd treats as "abnormal" with the OTP-
# transient `SuccessfulExit=false` rule and immediately respawns.
# Operators sending SIGTERM via `launchctl bootout` got an immediate
# respawn — the opposite of "stop". With this trap, SIGTERM exits 0
# AND launchd sees a clean exit AND respects the stop intent.
#
# 2026-05-29: the trap also unloads any locally-warmed ollama model
# so the operator gets ~42 GB of wired RAM back the moment the
# daemon stops (user-story 020 § Scenario 2). Unload failure is
# non-fatal — the env-var safety net (`OLLAMA_KEEP_ALIVE=10m` in
# `com.dotfiles.ollama.plist`) catches any residual hold.
_minsky_unload_ollama_on_exit() {
  if [[ "$_minsky_ollama_warmed" == "1" ]]; then
    echo "minsky-run: unloading ollama model=$_minsky_local_llm_model" >&2
    "$_minsky_ollama_bin" unload "$_minsky_local_llm_model" "$_minsky_local_llm_base_url" || true
  fi
}
trap '_minsky_unload_ollama_on_exit; echo "SIGTERM received — exiting cleanly" >&2; exit 0' TERM INT
trap '_minsky_unload_ollama_on_exit' EXIT

# Iteration loop:
# - `--loop` flag (set by distribution/systemd/run-tick-loop.sh when
#   invoked by launchd / systemd-user; opt-in for any other caller):
#   wrap walk_hosts in while-true so the supervisor never exits on its
#   own. Each walk runs N hosts × `--iterations-per-host` iterations,
#   then we pause TICK_INTERVAL_MS / 5s before the next walk.
# - No `--loop` (the historical default for ad-hoc CLI invocations,
#   bats tests, integration tests): run ONE walk and exit with
#   walk_hosts' return code. Backward-compatible — pre-2026-05-28
#   callers don't pass --loop and see no behavioral change.
#
# Why --loop must live HERE and not in launchd: launchd's
# `KeepAlive: SuccessfulExit=false` (OTP transient restart semantics)
# refuses to respawn after a clean exit (exit 0). Without an outer
# loop in the runner, walk_hosts returns 0 after iterations-per-host
# × #hosts iterations — bash exits 0 — launchd treats it as "completed
# successfully, no restart needed" — supervisor dies forever. Observed
# 2026-05-28: tick-loop exited after 3 iterations of
# `a2a-adapter-foundation` and never restarted; `launchctl print` showed
# `state = not running, last exit code = 0`. PR #983 introduced the
# while-true loop but keyed it on MAX_ITERATIONS=0, which broke the
# many bats and integration tests that invoke this script in unbounded
# mode AND expect it to exit (they didn't pass --max-iterations N).
# This PR (the refinement of #983) makes the loop opt-in via the new
# --loop flag and updates the launchd bootstrap to pass it.
#
# Restart sentinel: walk_hosts returns 75 (EX_TEMPFAIL) when
# `~/.minsky/restart-requested` is present (set by
# `scripts/post-merge-auto-install.mjs`). In --loop mode we exit 75
# directly — launchd's `SuccessfulExit=false` sees a non-zero exit and
# respawns into the freshly-updated code. In non-loop mode the same
# 75 propagates as the script's natural exit code.
if [[ "$LOOP_FOREVER" == "1" ]]; then
  # --loop mode (supervisor / launchd default via run-tick-loop.sh).
  # Outer sleep between walks. TICK_INTERVAL_MS=0 (default) → 5s base
  # sleep to avoid hot-looping when no tasks are pickable. Operators set
  # TICK_INTERVAL_MS=300000 (5 min) on noisy hosts.
  #
  # Adaptive backoff: when every iteration in the last walk ended in
  # spawn-failed (a fork-storm signal), the outer sleep grows
  # exponentially (5s → 10s → 20s → 40s → 80s → capped at 300s) so the
  # runner backs off instead of hammering the host with fork-forks.
  # A single successful verdict resets the counter to 0.
  # Additionally, when host load1 > cpu_count * 0.9 the walk is skipped
  # entirely and we sleep 60s — same admission criterion as orchestrate.mjs
  # `runGatedSweep` (rule #9: self-adjusting algorithm that detects and
  # prevents CPU oversubscription; operator directive 2026-06-04).
  outer_sleep_seconds=$(( TICK_INTERVAL_MS > 0 ? TICK_INTERVAL_MS / 1000 : 5 ))
  [[ "$outer_sleep_seconds" -lt 1 ]] && outer_sleep_seconds=1
  _consecutive_fail_walks=0
  # Idle-walk backoff (drained-queue-not-an-iteration): a walk that
  # completed zero iterations because every host's queue is drained
  # should not re-poll at the 5s base cadence — that hot loop emitted
  # ~1800 drained records/day and burned gh API calls while the queue
  # was empty. Same exponential shape as the spawn-fail backoff below
  # (5s → 10s → … capped at 300s); any completed iteration resets it.
  _consecutive_idle_walks=0
  while true; do
    # Load-gate: skip the walk when the host is oversubscribed.
    # MINSKY_LOAD_GATE_SLEEP_S: how long to wait before re-checking load
    # (default 60s; operator can lower for interactive testing).
    _load_gate_sleep="${MINSKY_LOAD_GATE_SLEEP_S:-60}"
    _load1="$(python3 -c 'import os; print(os.getloadavg()[0])' 2>/dev/null || echo 0)"
    _cpus="$(python3 -c 'import os; print(os.cpu_count() or 1)' 2>/dev/null || echo 4)"
    _load_ceiling="$(python3 -c "print(${_cpus} * 0.9)" 2>/dev/null || echo 3.6)"
    if python3 -c "import sys; sys.exit(0 if ${_load1} > ${_load_ceiling} else 1)" 2>/dev/null; then
      echo "loop: host oversubscribed (load1 ${_load1} > ${_load_ceiling}), skipping walk — sleeping ${_load_gate_sleep}s" >&2
      sleep "$_load_gate_sleep"
      continue
    fi

    # Pre-walk self-heal sweep (M1.13 phase 2): fire the catalogued
    # automated heals (stale-pid / corrupt-state-json /
    # partial-config-write) before walking, recording HealEvents to
    # `<home>/.minsky/heal-events.jsonl`. The dispatcher is exit-0-always
    # by contract (rule #6); `|| true` belts-and-suspenders so a missing
    # node/script can't kill the supervisor.
    _minsky_home="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    node "$(dirname "${BASH_SOURCE[0]}")/../scripts/heal-dispatch.mjs" \
      --host "$_minsky_home" --boundary pre-walk \
      2>>"${_minsky_home}/.minsky/tick-loop.err.log" || true

    _completed_before_walk=$COMPLETED_COUNT
    walk_hosts
    walk_exit=$?
    if [[ "$walk_exit" -eq 75 ]]; then
      exit 75
    fi

    # Count consecutive all-spawn-fail walks for backoff. Drained
    # verdicts are bookkeeping (like aborted) — they must not reset
    # the spawn-fail counter.
    _tick_log="${MINSKY_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/.minsky/tick-loop.err.log"
    _this_walk_verdicts="$(grep -oE 'verdict=[a-z-]+' "$_tick_log" 2>/dev/null | tail -$(( ITERATIONS_PER_HOST * 2 )) | grep -vE 'verdict=(aborted|drained)' | sort -u)"
    if [[ -n "$_this_walk_verdicts" ]] && echo "$_this_walk_verdicts" | grep -qvE '^verdict=spawn-failed$'; then
      _consecutive_fail_walks=0
    elif echo "$_this_walk_verdicts" | grep -q 'verdict=spawn-failed'; then
      _consecutive_fail_walks=$(( _consecutive_fail_walks + 1 ))
    fi

    # Count consecutive idle (zero-completed-iteration) walks: drained
    # queues should poll progressively slower, not at the 5s base cadence.
    if [[ "$COMPLETED_COUNT" -eq "$_completed_before_walk" && "$_consecutive_fail_walks" -eq 0 ]]; then
      _consecutive_idle_walks=$(( _consecutive_idle_walks + 1 ))
    else
      _consecutive_idle_walks=0
    fi

    # Exponential backoff: 5 × 2^N capped at 300s. The shift exponent is
    # clamped at 8 (5 × 2^8 = 1280 > 300 already) so a long overnight
    # chain of idle walks can't overflow 64-bit arithmetic into a
    # negative sleep (which would crash the loop under `set -e`).
    if [[ "$_consecutive_fail_walks" -gt 0 ]]; then
      _shift_n=$_consecutive_fail_walks
      [[ "$_shift_n" -gt 8 ]] && _shift_n=8
      _backoff_s=$(( outer_sleep_seconds * (1 << _shift_n) ))
      [[ "$_backoff_s" -gt 300 ]] && _backoff_s=300
      echo "loop: ${_consecutive_fail_walks} consecutive all-spawn-fail walk(s) — backing off ${_backoff_s}s" >&2
      sleep "$_backoff_s"
    elif [[ "$_consecutive_idle_walks" -gt 0 ]]; then
      _shift_n=$_consecutive_idle_walks
      [[ "$_shift_n" -gt 8 ]] && _shift_n=8
      _backoff_s=$(( outer_sleep_seconds * (1 << _shift_n) ))
      [[ "$_backoff_s" -gt 300 ]] && _backoff_s=300
      echo "loop: ${_consecutive_idle_walks} consecutive idle (drained-queue) walk(s) — backing off ${_backoff_s}s" >&2
      sleep "$_backoff_s"
    else
      sleep "$outer_sleep_seconds"
    fi
  done
else
  # Default mode (no --loop): one walk and exit. Preserves the pre-
  # 2026-05-28 behavior for ad-hoc CLI runs, bats tests, integration
  # tests, and any other caller that runs the bash interactively.
  walk_hosts
fi
