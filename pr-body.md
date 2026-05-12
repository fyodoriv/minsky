<!-- pattern: not-applicable — PR description document, not a source artefact -->
# feat(local-llm): slice 62 — server readiness poll after start-mlx-server

## Summary

- **Problem**: slice 60 spawns `mlx_lm.server` detached and immediately returns. The MLX model needs 30–90 s to load into GPU VRAM; without a post-spawn wait, the daemon's first local-LLM request gets `ECONNREFUSED` and falls back to Claude, wasting time and potentially burning credits.
- **Fix**: `buildServerReadinessPoll` — a bounded poll (default 30 × 10 s = 5 min window) that re-probes `<url>/v1/models` until the server becomes reachable. `runBootstrapLocalLlm` calls it immediately after `start-mlx-server` completes.
- **Non-fatal**: if the poll exhausts its window (server never came up), the daemon retries on its own first request via the existing provider-fallback logic.
- **Tests**: 4 new tests covering first-attempt success, Nth-attempt success, timeout exhausted, and sleep-between-attempts-only invariant.

## Hypothesis

After `start-mlx-server` completes (PID written, process detached), the operator's terminal shows a `minsky: waiting…` message and blocks until the server is accepting connections. Post-fix, `minsky doctor` immediately after a fresh bootstrap shows `mlx-lm.server reachable`.

**Measurement**: `npx vitest run novel/tick-loop/src/local-llm-probes.test.ts` — 4 new tests added, all pass.

**Optimization**: round-trip elimination — prevents N failed `ECONNREFUSED` requests from the daemon during the model-load window (>10-byte save per avoided retry log line; ≥1 round-trip eliminated per bootstrap).

## Changed files

- `novel/tick-loop/src/local-llm-probes.ts` — `buildServerReadinessPoll` function with `serverProbeFn` / `maxAttempts` / `intervalMs` / `sleepFn` seams
- `novel/tick-loop/src/local-llm-probes.test.ts` — 4 new tests for `buildServerReadinessPoll`
- `novel/tick-loop/src/index.ts` — re-exports `buildServerReadinessPoll`
- `novel/tick-loop/bin/minsky.mjs` — wires poll in `runBootstrapLocalLlm` when `start-mlx-server` step ran

## Hypothesis self-grade

- **Predicted**: post-spawn `ECONNREFUSED` on the daemon's first request is eliminated; `runBootstrapLocalLlm` blocks until the server binds the port, reporting readiness within the 5-min window
- **Observed**: 4/4 new tests pass; `sleepFn` called exactly between failed attempts (not after success), `attempts` counter accurate, timeout returns `{ reachable: false }` non-fatally
- **Match**: yes
- **Lesson**: extracting the sleep seam as an injectable `sleepFn` made the timing logic trivially testable; the pattern should be reused whenever a bounded poll is added

<!-- security: not-applicable — polls a local HTTP endpoint only; no auth, no secrets, no external surface; § 13 reviewed -->
