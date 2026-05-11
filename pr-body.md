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
