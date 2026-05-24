#!/usr/bin/env bash
# <!-- scope: human-approved 2026-05-24 local-models-stability-gate-90-percent — bash fixture harness for the M1.1 stability gate; one of the task's three deliverables per its spec. -->
# Fixture-based smoke test for `scripts/measure-stability.mjs`.
#
# The unit test (`measure-stability.test.mjs`) exercises every branch via
# I/O-injected fakes. THIS test exercises the real CLI against synthetic
# experiment-store data in a hermetic tmpdir. Both tests are required —
# unit catches logic regressions in <300ms; this catches CLI-wiring
# regressions that only show up when the script actually reads files.
#
# Acceptance § (1) from `local-models-stability-gate-90-percent`: this
# script's exit 0 means all 3 fixture cases produce the right exit code
# AND the right `gate=...` stdout.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/measure-stability.mjs"

if [[ ! -f "${SCRIPT}" ]]; then
  echo "ERROR: ${SCRIPT} not found" >&2
  exit 1
fi

# Hermetic tmpdir — no touches to the operator's real ~/.minsky/
TMPDIR_HOST="$(mktemp -d -t minsky-stability-gate.XXXXXX)"
trap 'rm -rf "${TMPDIR_HOST}"' EXIT

EXPERIMENT_STORE="${TMPDIR_HOST}/.minsky/experiment-store/cross-repo"
mkdir -p "${EXPERIMENT_STORE}"

# Recent timestamp so the 7d window includes the fixture.
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ────────────────────────────────────────────────────────────────
# Helper: emit N validated + M non-validated records.
# stability-number.mjs counts `verdict === "validated"` as successful.
write_fixture() {
  local file="$1"
  local validated="$2"
  local total="$3"
  : > "${file}"
  local i
  for ((i = 0; i < validated; i++)); do
    printf '{"ts":"%s","experiment_id":"t","host_repo":"f/m","branch":"x","verdict":"validated","pr_url":"https://x/%d","notes":""}\n' \
      "${NOW_ISO}" "${i}" >> "${file}"
  done
  local failed=$((total - validated))
  for ((i = 0; i < failed; i++)); do
    printf '{"ts":"%s","experiment_id":"t","host_repo":"f/m","branch":"x","verdict":"scope-leak","pr_url":null,"notes":""}\n' \
      "${NOW_ISO}" >> "${file}"
  done
}

assert_exit_and_gate() {
  local case_name="$1"
  local expected_exit="$2"
  local expected_gate="$3"

  local actual_stdout
  local actual_exit=0
  actual_stdout="$(node "${SCRIPT}" --host-dir="${TMPDIR_HOST}" --no-banner-marker 2>/dev/null)" || actual_exit=$?

  if [[ "${actual_exit}" != "${expected_exit}" ]]; then
    echo "FAIL [${case_name}]: expected exit ${expected_exit}, got ${actual_exit}" >&2
    echo "stdout: ${actual_stdout}" >&2
    exit 1
  fi

  local actual_gate
  actual_gate="$(echo "${actual_stdout}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).gate))')"
  if [[ "${actual_gate}" != "${expected_gate}" ]]; then
    echo "FAIL [${case_name}]: expected gate '${expected_gate}', got '${actual_gate}'" >&2
    echo "stdout: ${actual_stdout}" >&2
    exit 1
  fi

  echo "PASS [${case_name}]: exit=${actual_exit}, gate=${actual_gate}"
}

# ────────────────────────────────────────────────────────────────
# Case 1: 9/10 validated = 90% → gate=lifted, exit 0
write_fixture "${EXPERIMENT_STORE}/fixture-90pct.jsonl" 9 10
assert_exit_and_gate "90% rate" 0 "lifted"
rm -f "${EXPERIMENT_STORE}"/*.jsonl

# Case 2: 89/100 validated = 89% → gate=active, exit 1
write_fixture "${EXPERIMENT_STORE}/fixture-89pct.jsonl" 89 100
assert_exit_and_gate "89% rate" 1 "active"
rm -f "${EXPERIMENT_STORE}"/*.jsonl

# Case 3: 50/100 validated = 50% → gate=pivot-eval-needed, exit 2
write_fixture "${EXPERIMENT_STORE}/fixture-50pct.jsonl" 50 100
assert_exit_and_gate "50% rate" 2 "pivot-eval-needed"
rm -f "${EXPERIMENT_STORE}"/*.jsonl

# Case 4: empty store → gate=not-yet-measured, exit 0 (graceful absence)
assert_exit_and_gate "empty store" 0 "not-yet-measured"

echo ""
echo "All 4 fixture cases pass."
