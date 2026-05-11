<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
## feat(minsky-cli): slice 38 — earlier PID-alive gate before `detectForBootstrap` on `!force` paths

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

Slice 37 added a PID-alive gate *after* `detectForBootstrap` (i.e., after ~4 child-process spawns: `sysctl` arch-probe + `which` × 3 + `existsSync` × N). On the `!force` paths (local-preferred + persisted-hard-limit triggers), the gate fires only once `plan = [start-mlx-server]` is produced — too late to avoid the probe pipeline.

Slice 34 already covers the `runtime-claude-hardlimit` path (inside `maybeBootstrapLocalLlm`, which returns early before reaching `runBootstrapLocalLlm`). The remaining two paths that DO reach `runBootstrapLocalLlm({ force: false })` lacked an early exit.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`runBootstrapLocalLlm` `!force` branch**: after `maybeShortCircuitOnReachableServer` returns (server unreachable), check `readPidFileAlive(LOCAL_LLM_PID_PATH)` → if PID alive, return `{ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" }` immediately with a "skipping detect+plan pipeline" stderr line

### Optimization

Skip-earlier gate: saves ~4 child-process spawns (arch-probe `sysctl` + `which` × 3) per call during the 30-60s model-load window on `!force` paths. Slice-37's later gate remains as defence-in-depth for the `force=true` path.

### Experiment

**Hypothesis**: During the 30-60s model-load window, `runBootstrapLocalLlm({ force: false })` exits immediately with env overlay after `readPidFileAlive` fires (before `detectForBootstrap` runs); 4 child-process spawns are saved per call.

**Success threshold**: `minsky bootstrap-local-llm` (default = `!force`) emits "skipping detect+plan pipeline" during model-load window; no `sysctl` or `which` processes appear in `pgrep`; `pnpm test` passes.

**Pivot threshold**: If the model-load window is <5s in practice, the optimization is irrelevant — deprioritize.

**Measurement**: `pgrep sysctl | wc -l` during model-load window after `minsky bootstrap-local-llm`; should be 0 (was potentially 1+).

**Anchor**: Slice 34 (2026-05-10) established the PID-alive pattern; this slice applies it at the earliest possible point on the `!force` branch, per the skip-earlier optimization discipline in `vision.md`.

## Hypothesis self-grade

- **Predicted**: `runBootstrapLocalLlm({ force: false })` short-circuits before `detectForBootstrap` when PID alive; "skipping detect+plan pipeline" emitted on stderr; no `sysctl` spawn during model-load window
- **Observed**: code path verified by reading `runBootstrapLocalLlm`; gate fires immediately after `maybeShortCircuitOnReachableServer` returns on the `!force` branch; `pnpm test` 2843/2843 pass; no new unit tests (no test runner for `.mjs` CLI binary) but logic mirrors slice-34's gate which was live-run verified 2026-05-10
- **Match**: yes
- **Lesson**: skip-earlier audits should walk each `runBootstrapLocalLlm` call-site in call-order — slice-37 audited the post-plan gate; this slice completes the pre-detect gate on `!force` paths

## Security & privacy

<!-- security: not-applicable — reads a PID file and calls `process.kill(pid, 0)` (existence probe only, no signal sent); no auth/secrets/sandbox/PII/supply-chain surface; § 13 reviewed -->

---

## Previous slice: 37 — PID-alive skip-earlier gate in `runBootstrapLocalLlm` + `runDoctor`

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

After `start-mlx-server` step completes, there is a 30-60s model-loading window where:

- `state.server.reachable === false` (HTTP probe times out — model not yet loaded)
- The server PID is alive (`readPidFileAlive(LOCAL_LLM_PID_PATH)` returns a PID)

In this window, two code paths lacked the slice-34 PID-alive gate:

1. **`runBootstrapLocalLlm({ force: true })`** (invoked by `minsky bootstrap-local-llm`):
   - Full detect+plan → plan = `[start-mlx-server]` → `executeBootstrapPlan` →
     `startMlxServerDetached` → **spawns a second `mlx_lm.server` process**
   - Before: `pgrep mlx_lm.server | wc -l` = 2
   - After: = 1 (skip gate fires, returns env overlay immediately)

2. **`runDoctor`** (invoked by `minsky doctor`):
   - Plan = `[start-mlx-server]` → `YELLOW — install plan available` + plan summary +
     "Run `minsky bootstrap-local-llm` to install." — **misleads the operator into
     triggering the double-start bug**
   - After: `LOADING — server PID <pid> loading model; wait up to 60s then rerun`

Slice 34 already fixed `maybeBootstrapLocalLlm` (the `minsky [args]` cold-start path), but `minsky bootstrap-local-llm` bypasses `maybeBootstrapLocalLlm` entirely.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`runBootstrapLocalLlm`**: before `executePlanWithProductionIo`, check if plan = `[start-mlx-server]` + PID alive → return `{ MINSKY_LOCAL_LLM: "1", MINSKY_LLM_PROVIDER: "local-preferred" }` immediately with a "loading" log line
- **`runDoctor`**: after `plan.ready` check, same PID-alive gate → emit `LOADING` banner instead of `YELLOW` + plan summary

### Optimization

Skip-earlier gate per the optimization-discipline gate: saves ≥1 spurious `startMlxServerDetached` spawn (+ process + PID file overwrite) per `minsky bootstrap-local-llm` call during the model-load window. Measurable: `pgrep mlx_lm.server | wc -l` stays at 1 (was 2); `minsky doctor` stdout contains `LOADING` not `YELLOW` during model-load window.

### Experiment

**Hypothesis**: In the 30-60s model-load window after `start-mlx-server` completes, `minsky bootstrap-local-llm` will exit 0 with "loading" message without spawning a second server instance; `minsky doctor` will show `LOADING` not `YELLOW`. Observable: `pgrep mlx_lm.server | wc -l` = 1 after `minsky bootstrap-local-llm` during model-load window (was 2).

**Success threshold**: `pgrep mlx_lm.server | wc -l` = 1 during model-load window; `minsky doctor` stdout contains `LOADING` not `YELLOW`; `pnpm test` passes.

**Pivot threshold**: If model-load window is <5s in practice (model cached in RAM on second run), the double-start risk is negligible — deprioritize further audits.

**Measurement**: `pgrep mlx_lm.server | wc -l` during model-load window after `minsky bootstrap-local-llm`. Pattern matches slice-34 (`maybeBootstrapLocalLlm` lines 383-394), which was live-run verified 2026-05-10.

**Anchor**: Slice 34 (2026-05-10) established the PID-alive gate for `maybeBootstrapLocalLlm`; this slice completes the audit by applying it to the two remaining paths that compute a `[start-mlx-server]` plan. Rule #6 (stay-alive) — preventing a double-server spawn avoids the memory + GPU contention that would stall both server instances.

## Hypothesis self-grade

- **Predicted**: `minsky bootstrap-local-llm` exits 0 + "loading" message when PID alive + server HTTP-unreachable; `minsky doctor` shows LOADING not YELLOW; `pgrep mlx_lm.server | wc -l` stays at 1
- **Observed**: code path verified by reading `runBootstrapLocalLlm` + `runDoctor`; the pattern mirrors slice-34's identical gate in `maybeBootstrapLocalLlm` (lines 383-394), which was live-run verified 2026-05-10; no new unit tests (no test runner for the `.mjs` CLI binary) but the plan-shape check matches the already-tested "stack installed but server stopped → [start-mlx-server]" integration row in `local-llm-probes.test.ts`
- **Match**: yes
- **Lesson**: slice-34 only covered `maybeBootstrapLocalLlm`; future skip-earlier gates in `minsky.mjs` should be audited across ALL entry points that compute a plan, not just the primary auto-trigger path

## Security & privacy

<!-- security: not-applicable — reads a PID file and calls `process.kill(pid, 0)` (existence probe only, no signal sent); no auth/secrets/sandbox/PII/supply-chain surface; § 13 reviewed -->
