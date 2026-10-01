#!/usr/bin/env bash
# bin/minsky-default-session.sh — point at any repo, get baseline → run →
# report in one invocation.
#
# Vertical slice 3 of `minsky-default-8h-repo-transformation` (TASKS.md
# P0). Composes the four pieces already shipped:
#   1. bin/minsky-bootstrap.sh   (PR #807) — sidecar materialization
#   2. scripts/baseline_metrics.py (PR #812) — captures `.minsky/baseline.json`
#   3. bin/minsky-run.sh         (PR #797…)  — the autonomous tick loop
#   4. scripts/minsky_report.py  (PR #813) — before/after delta
# Plus the MAPE-K Monitor+Analyse+Plan surface inline:
#   5. .minsky/transform-runs.jsonl — append-only per-host session ledger
#      so trends accrue over multiple sessions without recomputation
#      (PR #824, Monitor).
#   6. trend + recommend summary printed at the tail when ledger has
#      ≥2 records — closes the M→A→P chain inline so the operator
#      sees both "what just happened" + "what's trending" + "what
#      to do about it" in one invocation (PR #828, Analyse + Plan).
#
# Path A aligned — no new logic, no new packages. Pure bash orchestration
# of existing tools. Total LOC ≈ 100.
#
# Usage:
#   bin/minsky-default-session.sh <host-dir>
#       Run a default session on a single host repo. The host must
#       either already have a .minsky/ sidecar OR we materialize one
#       via bin/minsky-bootstrap.sh first.
#
#   bin/minsky-default-session.sh <host-dir> --max-hours 2
#       Override the session length (default: 8h via minsky-run.sh's
#       --max-hours flag).
#
#   bin/minsky-default-session.sh <host-dir> --report-only
#       Skip the run; just emit the report against an existing baseline.
#       Useful for "what did the last session produce?" queries.
#
#   bin/minsky-default-session.sh <host-dir> --baseline-only
#       Skip the run + report; just capture a fresh baseline.
#
# Exit codes:
#   0   session completed successfully (any verdict; partial wins count)
#   1   host-dir not found
#   2   bad CLI args
#   75  restart-requested mid-session (propagated from minsky-run.sh)
#
# Anchor: rule #1 (don't reinvent — composes 4 existing pieces); rule
# #6 (let-it-crash-supervisor-restart — every nested invocation runs
# under its own watchdog, this script does NOT wrap them in retry
# logic).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  bin/minsky-default-session.sh <host-dir> [options]

Options:
  --max-hours N         Session length cap (default: 8)
  --report-only         Skip the run; only emit the report
  --baseline-only       Only capture the baseline; no run, no report
  --no-bootstrap        Skip the bootstrap step (use existing .minsky/)
  --json                Emit the report as structured JSON (forwards
                        to scripts/minsky_report.py --json). Useful
                        for piping the delta to other tools.
  --no-summary          Skip the trailing MAPE-K trend + recommend
                        summary. Use when piping --json into a tool
                        that only wants the report shape.
  -h, --help            Print this help and exit

Exit codes:
  0   session completed
  1   host-dir not found
  2   bad CLI args
  75  restart-requested mid-session (propagated from minsky-run.sh)
USAGE
}

# Defaults.
MAX_HOURS=8
REPORT_ONLY=0
BASELINE_ONLY=0
SKIP_BOOTSTRAP=0
EMIT_JSON=0
SKIP_SUMMARY=0
HOST_DIR=""

# Parse args. Single positional + flagged options.
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --max-hours)
      [[ $# -ge 2 ]] || { echo "--max-hours requires a value" >&2; exit 2; }
      MAX_HOURS="$2"; shift 2 ;;
    --report-only)   REPORT_ONLY=1; shift ;;
    --baseline-only) BASELINE_ONLY=1; shift ;;
    --no-bootstrap)  SKIP_BOOTSTRAP=1; shift ;;
    --json)          EMIT_JSON=1; shift ;;
    --no-summary)    SKIP_SUMMARY=1; shift ;;
    --*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$HOST_DIR" ]]; then HOST_DIR="$1"; shift
      else echo "unexpected arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$HOST_DIR" ]]; then
  echo "minsky-default-session: host-dir required" >&2
  usage
  exit 2
fi
if [[ ! -d "$HOST_DIR" ]]; then
  echo "minsky-default-session: host-dir not found: $HOST_DIR" >&2
  exit 1
fi

# Resolve to absolute path so downstream calls are unambiguous.
HOST_DIR="$(cd "$HOST_DIR" && pwd)"

# Step 1 — Bootstrap (if needed). Idempotent — running it on an
# already-bootstrapped repo produces a byte-identical repo.yaml.
if [[ "$SKIP_BOOTSTRAP" != "1" ]] && [[ ! -d "$HOST_DIR/.minsky" ]]; then
  echo "minsky-default-session: bootstrapping $HOST_DIR" >&2
  bash "$SCRIPT_DIR/minsky-bootstrap.sh" "$HOST_DIR"
fi

# Step 2 — Baseline. Captures a fresh baseline.json UNLESS --report-only
# is set (in which case the operator's intent is "diff against whatever
# baseline already exists"). The script-default behavior — every full
# session starts with a fresh capture — matches the parent P0 task spec
# ("snapshot NOW vs session-end").
BASELINE_FILE="$HOST_DIR/.minsky/baseline.json"
if [[ "$REPORT_ONLY" == "1" ]]; then
  if [[ ! -f "$BASELINE_FILE" ]]; then
    echo "minsky-default-session: --report-only requires existing $BASELINE_FILE" >&2
    echo "  run without --report-only first to capture one." >&2
    exit 1
  fi
  echo "minsky-default-session: --report-only; using existing $BASELINE_FILE" >&2
else
  echo "minsky-default-session: capturing baseline at $BASELINE_FILE" >&2
  python3 "$REPO_ROOT/scripts/baseline_metrics.py" \
    --repo "$HOST_DIR" \
    --output "$BASELINE_FILE"
fi

if [[ "$BASELINE_ONLY" == "1" ]]; then
  echo "minsky-default-session: baseline-only mode; exiting" >&2
  exit 0
fi

# Step 3 — Run (unless --report-only). The minsky-run.sh script
# expects --hosts-dir <parent>, so we point it at the host's parent
# and let it walk to discover just this host. --max-iterations is
# converted from max-hours via a rough 1h/iteration heuristic that
# minsky-run.sh itself honors via its own watchdog. The 8h default
# becomes 8 iterations, which is the floor; the watchdog kills each
# at its dynamic p95×1.5 timeout.
if [[ "$REPORT_ONLY" != "1" ]]; then
  HOSTS_PARENT="$(dirname "$HOST_DIR")"
  echo "minsky-default-session: starting $MAX_HOURS-iteration run" >&2
  # Run via the bash runner explicitly (Phase 7 canonical entry point).
  # set +e + capture exit code so a non-zero verdict doesn't kill the
  # outer report step.
  set +e
  bash "$SCRIPT_DIR/minsky-run.sh" \
    --hosts-dir "$HOSTS_PARENT" \
    --iterations-per-host "$MAX_HOURS" \
    --max-iterations "$MAX_HOURS"
  RUN_EXIT=$?
  set -e
  if [[ "$RUN_EXIT" == "75" ]]; then
    echo "minsky-default-session: restart-requested mid-session; propagating exit 75" >&2
    exit 75
  fi
  echo "minsky-default-session: run finished with exit $RUN_EXIT" >&2
fi

# Step 4 — Report. Always runs (even after --report-only — that's the
# whole point of that flag). The --json forward emits structured JSON
# on stdout instead of the human-readable text — useful for piping the
# delta to other tools or CI gates.
report_args=(--repo "$HOST_DIR" --baseline "$BASELINE_FILE")
if [[ "$EMIT_JSON" == "1" ]]; then
  report_args+=(--json)
  echo "minsky-default-session: rendering report (JSON)" >&2
else
  echo "minsky-default-session: rendering report" >&2
fi
python3 "$REPO_ROOT/scripts/minsky_report.py" "${report_args[@]}"

# Step 5 — Append report to .minsky/transform-runs.jsonl ledger.
# MAPE-K Monitor surface: every session's delta accrues here so the
# operator can see trends over time without recomputing each session
# in isolation. The ledger is local-only (per-host); never pushed to
# any remote. Best-effort per rule #6 — a failed append doesn't kill
# the session.
LEDGER_FILE="$HOST_DIR/.minsky/transform-runs.jsonl"
if delta_json="$(python3 "$REPO_ROOT/scripts/minsky_report.py" --repo "$HOST_DIR" --baseline "$BASELINE_FILE" --json 2>/dev/null)"; then
  # jq -c flattens to one line — JSONL invariant.
  printf '%s\n' "$delta_json" | jq -c '.' >> "$LEDGER_FILE" 2>/dev/null || \
    printf '%s\n' "$delta_json" >> "$LEDGER_FILE"
  echo "minsky-default-session: report appended to $LEDGER_FILE" >&2
fi

# Step 6 — MAPE-K self-summary: trend + recommend.
# After the report renders + appends, if the ledger has ≥2 records
# AND --no-summary was not set AND --json was not set (json mode
# is for downstream tools that want a clean JSON payload, not a
# trailing summary), surface trends + interventions inline. Each
# subprocess is best-effort per rule #6 — a failed summary doesn't
# kill the session. Closes the M→A→P chain at the moment the
# operator cares most: end of session.
if [[ "$SKIP_SUMMARY" != "1" ]] && [[ "$EMIT_JSON" != "1" ]] && [[ -f "$LEDGER_FILE" ]]; then
  ledger_lines=$(wc -l < "$LEDGER_FILE" 2>/dev/null | tr -d ' ' || echo 0)
  if [[ "$ledger_lines" -ge "2" ]]; then
    echo "" >&2
    echo "─── trend (last 10 sessions) ───" >&2
    python3 "$REPO_ROOT/scripts/transform_trend.py" \
      --repo "$HOST_DIR" --window 10 2>&1 || true
    echo "" >&2
    echo "─── recommendations ───" >&2
    python3 "$REPO_ROOT/scripts/transform_recommend.py" \
      --repo "$HOST_DIR" --window 3 2>&1 || true
  fi
fi

exit 0
