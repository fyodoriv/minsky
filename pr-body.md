# feat(runtime-resilience): wire checkTickLoopBinExists seam in minsky.mjs

Slice 2 of P0 task `minsky-runtime-resilience` — final seam-injection piece.

## Summary

- Replaces `existsSync(TICK_LOOP_BIN)` with `checkTickLoopBinExists({ tickLoopBinPath, existsSyncFn })` in `bin/minsky.mjs` — 5 lines changed.
- All three runtime failure modes from the task spec now go through seam-injectable pure helpers.
- Adds seam-wiring drift test to `tick-loop-bin-existence-check.test.ts` that pins the seam usage in `minsky.mjs` — fails CI if `existsSync(TICK_LOOP_BIN)` reappears (vision.md rule #10).

## What

`novel/tick-loop/src/tick-loop-bin-existence-check.ts` exports `checkTickLoopBinExists`; it was already re-exported from `index.ts` and `formatTickLoopBinMissingMessage` was already imported in `minsky.mjs`. But the existence gate itself still called `existsSync(TICK_LOOP_BIN)` directly — bypassing the injection seam that `ensureWorkersDir` and `pickLogPath` already use.

| Failure mode | Helper | Behaviour |
|---|---|---|
| `bin/tick-loop.mjs` missing | `checkTickLoopBinExists` ← **this PR** | exits 1, names path + recovery |
| `.minsky/workers/` unwritable | `ensureWorkersDir` | exits 1, names errno + recovery hint |
| worker log unwritable | `pickLogPath` | falls back to `/tmp`, warns, daemon starts |

## Hypothesis

**Predicted**: `grep -c "existsSync(TICK_LOOP_BIN)" novel/tick-loop/bin/minsky.mjs` returns 0 post-fix (was 1). All pre-pr-lint checks remain green.

**Success**: grep count = 0; `pnpm pre-pr-lint` green.

**Pivot**: N/A — wire-in with no behaviour change on happy path; seam-wiring drift test locks the pattern in CI.

**Measurement**: `grep -c "existsSync(TICK_LOOP_BIN)" novel/tick-loop/bin/minsky.mjs`

**Anchor**: operator directive 2026-05-08 — rule #8 (pure-decision-over-injection); Beyer et al. (SRE) Ch. 6.

## Hypothesis self-grade

- **Predicted**: `grep -c "existsSync(TICK_LOOP_BIN)" novel/tick-loop/bin/minsky.mjs` returns 0 (was 1)
- **Observed**: 0 — raw existsSync replaced with `checkTickLoopBinExists` seam
- **Match**: yes
- **Lesson**: all three runtime failure modes now follow the pure-helper-over-injection pattern; seam-wiring drift test locks it in CI so no reversion can go undetected

## Security & privacy

<!-- security: not-applicable — internal CLI wiring of an existing existence check; no auth, secrets, network, or PII surface; § 13 reviewed -->

optimization: none-this-iteration: skip-earlier-gate (readLivePid before pre-flights) is covered by the concurrently-open PR #549; this PR completes the seam injection pattern only.
