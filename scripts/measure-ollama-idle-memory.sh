#!/usr/bin/env bash
# scripts/measure-ollama-idle-memory.sh — metric source for user-story 020.
#
# Reports the wired-memory cost of the Ollama runner subprocess. The
# success threshold for story 020 is ≤500 MB when the daemon is
# stopped and 10+ minutes have passed since the last LLM call.
#
# Output: a single JSON line with the fields downstream scripts
# (stability-number.mjs, dashboard render) need to compute the
# story-020 success / pivot threshold.
#
# Schema:
#   {
#     "ts": "2026-05-29T13:30:00.000Z",
#     "ollama_runner_rss_mb": 42656,
#     "ollama_serve_rss_mb": 124,
#     "loaded_models": ["qwen3-coder:30b"],
#     "loaded_models_total_vram_mb": 43090,
#     "daemon_running": false,
#     "verdict": "OVER_THRESHOLD"
#   }
#
# `verdict`:
#   - "UNDER_THRESHOLD" — ollama_runner_rss_mb ≤ 500 (success).
#   - "AT_THRESHOLD"    — between 500 and 5000 MB (keep-active floor).
#   - "OVER_THRESHOLD"  — > 5000 MB (pivot trigger if sustained 14d).
#   - "NO_OLLAMA"       — ollama is not running at all (vacuously fine).
#
# Exits 0 always; the JSON line is the load-bearing output for the
# experiment ledger. Non-zero exit would mask the metric from the
# CI dashboard.
#
# Usage:
#   scripts/measure-ollama-idle-memory.sh            # one shot
#   scripts/measure-ollama-idle-memory.sh --json     # JSON only (no human prefix)
#   scripts/measure-ollama-idle-memory.sh --pretty   # multi-line pretty JSON

set -euo pipefail

UNDER_THRESHOLD_MB=500
AT_THRESHOLD_CEIL_MB=5000

MODE="default"
for a in "$@"; do
  case "$a" in
    --json) MODE="json" ;;
    --pretty) MODE="pretty" ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

# RSS of `ollama runner` (the model-host subprocess that holds VRAM).
# macOS `ps -axo rss,command` reports RSS in KB.
runner_kb="$(ps -axo rss,command | awk '/ollama runner / && !/grep/ { sum+=$1 } END { print sum+0 }')"
runner_mb=$(( runner_kb / 1024 ))

# RSS of `ollama serve` (the long-lived parent — survives between
# runner subprocesses).
serve_kb="$(ps -axo rss,command | awk '/ollama serve/ && !/grep/ { sum+=$1 } END { print sum+0 }')"
serve_mb=$(( serve_kb / 1024 ))

# Is a minsky daemon currently iterating? Used by the verdict logic —
# a model being loaded while the daemon is iterating is the expected
# steady state. The verdict only applies to the idle case.
daemon_running="false"
if [[ -f "$HOME/.minsky/daemon.pid" ]]; then
  pid="$(cat "$HOME/.minsky/daemon.pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    daemon_running="true"
  fi
fi

# Loaded models via `/api/ps`. Empty array when ollama is down OR no
# model is currently loaded. Best-effort — uses `curl --max-time 3` so
# this script never hangs.
loaded_models_json="[]"
loaded_vram_mb=0
if command -v curl >/dev/null 2>&1; then
  if ps_payload="$(curl -fsS --max-time 3 http://localhost:11434/api/ps 2>/dev/null)"; then
    if command -v jq >/dev/null 2>&1; then
      loaded_models_json="$(printf '%s' "$ps_payload" | jq -c '[.models[].name]' 2>/dev/null || echo "[]")"
      loaded_vram_bytes="$(printf '%s' "$ps_payload" | jq -r '[.models[].size_vram // 0] | add // 0' 2>/dev/null || echo 0)"
      loaded_vram_mb=$(( loaded_vram_bytes / 1024 / 1024 ))
    fi
  fi
fi

# Verdict. Only meaningful when the daemon is NOT running — otherwise
# the loaded model is expected steady-state.
if [[ "$runner_mb" -eq 0 ]]; then
  verdict="NO_OLLAMA"
elif [[ "$daemon_running" == "true" ]]; then
  # When the daemon is iterating, any RSS is fine — the model is
  # supposed to be loaded. Report DAEMON_RUNNING so the dashboard
  # skips this row from the idle-memory rollup.
  verdict="DAEMON_RUNNING"
elif [[ "$runner_mb" -le "$UNDER_THRESHOLD_MB" ]]; then
  verdict="UNDER_THRESHOLD"
elif [[ "$runner_mb" -le "$AT_THRESHOLD_CEIL_MB" ]]; then
  verdict="AT_THRESHOLD"
else
  verdict="OVER_THRESHOLD"
fi

json="$(jq -nc \
  --arg ts "$ts" \
  --argjson runner_mb "$runner_mb" \
  --argjson serve_mb "$serve_mb" \
  --argjson loaded_vram_mb "$loaded_vram_mb" \
  --argjson loaded_models "$loaded_models_json" \
  --arg daemon_running "$daemon_running" \
  --arg verdict "$verdict" \
  '{ts: $ts, ollama_runner_rss_mb: $runner_mb, ollama_serve_rss_mb: $serve_mb, loaded_models: $loaded_models, loaded_models_total_vram_mb: $loaded_vram_mb, daemon_running: ($daemon_running == "true"), verdict: $verdict}')"

if [[ "$MODE" == "json" ]]; then
  printf '%s\n' "$json"
elif [[ "$MODE" == "pretty" ]]; then
  printf '%s\n' "$json" | jq .
else
  # Default: human-friendly summary above the raw JSON line, so
  # operators see what's happening AND downstream scripts can grep the
  # final line.
  echo "ollama idle-memory check:"
  echo "  runner RSS:   ${runner_mb} MB"
  echo "  serve RSS:    ${serve_mb} MB"
  echo "  loaded VRAM:  ${loaded_vram_mb} MB"
  echo "  daemon:       $daemon_running"
  echo "  verdict:      $verdict (threshold: ≤${UNDER_THRESHOLD_MB} MB under, ≤${AT_THRESHOLD_CEIL_MB} MB at)"
  echo ""
  printf '%s\n' "$json"
fi
