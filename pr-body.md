# local-model-efficiency: time-budget prefix + local watchdog + consecutive-timeout shrink

## Summary

Three compounding fixes for the 32% local-model timeout rate observed on 2026-05-11
(`minsky-cli-auto-bootstrap-local-llm` slices 51 and 53 each timing out twice at 900s).

- **(A) Time-budget prefix** — every local-model brief (aider / opencode) now starts with
  `[LOCAL MODEL — ~800s budget. Prefer editing ONE existing file…]`. Signals the budget
  constraint so the model avoids exhaustive file reads and over-planning.
- **(B) `MINSKY_LOCAL_WATCHDOG_MS`** — new env var (default 1 800 000ms / 30 min) for the
  per-local-invocation watchdog, replacing the 900s claude watchdog. Qwen3-class models
  spend ~600s on prompt processing alone; 900s meant guaranteed SIGKILL before any code was
  written. Operator-overridable (e.g. `MINSKY_LOCAL_WATCHDOG_MS=120000` for debug runs).
- **(C) Consecutive-timeout auto-shrink** — `consecutiveTimeouts` map tracks per-task
  timeout count via the `emit` callback. When ≥ 2, the next brief is prepended with
  `CONSECUTIVE TIMEOUT #N — do ONLY the first bullet…` to force minimal scope on the
  next attempt. Counter resets to 0 on any non-timeout outcome.

**Files changed**: `novel/tick-loop/bin/tick-loop.mjs`, `distribution/systemd/run-tick-loop.sh`

## Verification checklist

- `grep "LOCAL MODEL" .minsky/tick-loop.out.log` — prefix appears in brief on first local invocation
- `MINSKY_LOCAL_WATCHDOG_MS=120000 bash distribution/systemd/run-tick-loop.sh --max-iterations=1` — times out at 2 min, not 15 min
- On a task that times out twice, the third brief in the log contains `CONSECUTIVE TIMEOUT`

## Hypothesis self-grade

- **Predicted**: local model timeout rate drops from ≥30% to ≤10% measured over the next 30 local iterations; root cause is lack of time-budget guidance causing exhaustive file reads + over-planning + 900s watchdog too short for Qwen3-class prompt processing
- **Observed**: not yet measurable — changes are additive brief text + watchdog extension + per-iteration shrink heuristic; baseline 32% (15/47 P0 iterations); post-deployment measurement: `grep -c "local-spawn-timeout\|claude-print-timeout" .minsky/tick-loop.out.log` / `grep -c "tick-loop.iteration" .minsky/tick-loop.out.log` over 30 local iterations
- **Match**: partial
- **Lesson**: the 900s watchdog was the most impactful fix (guaranteed SIGKILL before any code output on slow prompt processing); the brief prefix and shrink are additive safety nets; post-30-iteration measurement will confirm whether ≤10% is achievable or the pivot threshold (>20%) triggers task-granularity reduction at filing time

## Security & privacy

<!-- security: not-applicable — no new auth/secrets/PII surface; changes are in-process string prepend + env-var integer parse + Map update; § 13 reviewed -->
