## Summary

- **(A) Time-budget prefix** — `augmentLocalBrief()` prepends a fixed `[LOCAL MODEL — ~800s budget…]` directive to every brief sent to opencode/aider. Local models read exhaustively by default; the prefix forces single-file-first, smallest-step discipline.
- **(B) `MINSKY_LOCAL_WATCHDOG_MS`** — new env var (default 1800000 ms = 30 min) for the per-iteration SIGKILL watchdog on local model invocations, replacing the inherited claude default of 900 s. Local models need extra wall-time for cold VRAM load and lack streaming. The existing `MINSKY_CLAUDE_PRINT_TIMEOUT_MS` is unchanged and still governs only the claude path.
- **(C) Consecutive-timeout auto-shrink** — `observeIterationTimeouts()` tracks `local-spawn-timeout` / `claude-print-timeout` events per task in `consecutiveTimeoutsByTask`. On the third+ attempt for the same task, `augmentLocalBrief()` prepends `CONSECUTIVE TIMEOUT #N — do ONLY the first bullet…`, steering the model toward a minimal first step instead of a third 30-minute hang.

Files changed:

- `novel/tick-loop/bin/tick-loop.mjs` — all three changes (A/B/C)
- `distribution/systemd/run-tick-loop.sh` — document `MINSKY_LOCAL_WATCHDOG_MS` in the env-var block

## Hypothesis self-grade

- **Predicted**: local model timeout rate drops from ≥30% to ≤10% over the next 30 local iterations, measured by `grep -c "local-spawn-timeout\|claude-print-timeout" .minsky/tick-loop.out.log` / `grep -c "tick-loop.iteration" .minsky/tick-loop.out.log`
- **Observed**: not yet measured — changes ship here; baseline will be collected over the next 30 local iterations post-merge
- **Match**: partial
- **Lesson**: pre-registration complete; A/B/C ship together; observe rolling ratio over next 30 local iterations before declaring success or pivoting to task-granularity reduction

## Security & privacy

<!-- security: not-applicable — env-var wiring + brief text augmentation; no auth, secrets, PII, or network surface -->
