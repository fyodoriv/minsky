<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
<!-- security: not-applicable — reads only PATH/filesystem probes and the operator's own opencode config; no auth, secrets, PII, or supply-chain surface; § 13 reviewed -->

## feat(minsky-cli): slice 43 — auto-wire opencode config post-bootstrap

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

After the LLM bootstrap plan runs successfully (installs mlx-lm, aider, model, starts server), the operator still had to manually run `minsky setup-opencode` to wire opencode's config. This breaks the "single `minsky` invocation from scratch" UX promise: the daemon is ready but opencode remains unconfigured.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`executePlanWithProductionIo`**: after `executeBootstrapPlan` returns `success: true`, probe `probeOpencodeConfig()` and `whichFn("opencode")` in parallel; if binary is on PATH and config is not yet wired, emit a progress line to stderr and call `runSetupOpencode()`. The pre-check gates the call so machines without opencode see no output and `process.exitCode` stays clean (bare `runSetupOpencode()` sets exitCode=1 on missing binary).

### Optimization

optimization: none-this-iteration: the added probes are already parallel (Promise.all) and only fire on the non-fast-path (plan was non-empty); zero overhead on the idempotent re-run path

### Experiment

**Hypothesis**: After this slice, `minsky bootstrap-local-llm` on a machine with opencode installed but config not wired also runs `minsky setup-opencode` automatically, leaving `minsky doctor | grep "opencode config"` green without a manual step.

**Success threshold**: `minsky doctor 2>&1 | grep "opencode config"` shows `✓ opencode config  local provider wired` after a bootstrap run, with no extra manual `setup-opencode` call.

**Pivot threshold**: if the parallel probes add >50ms to the bootstrap exit path (measured via `time minsky bootstrap-local-llm --dry-run`), extract the opencode wiring into a background fire-and-forget instead of awaited inline.

**Measurement**: `node novel/tick-loop/bin/minsky.mjs bootstrap-local-llm --dry-run && node novel/tick-loop/bin/minsky.mjs doctor 2>/dev/null | grep "opencode config"` — confirm the probe fires (stderr line) when opencode binary is present and config absent.

**Anchor**: operator directive 2026-05-08 ("I expect it to automatically understand that claude is out of tokens and to switch to local modal + install+set it up first if needed"); slice 42 (`runSetupOpencode`) is the wiring function; rule #6 (stay-alive — fully configured opencode is part of the fallback substrate); rule #9 (pre-registered HDD).

## Hypothesis self-grade

- **Predicted**: `minsky bootstrap-local-llm` auto-wires opencode config when binary present and config absent; `minsky doctor` shows `✓ opencode config` without a manual step
- **Observed**: pre-pr-lint all green; `executePlanWithProductionIo` now probes opencode state in parallel post-success and calls `runSetupOpencode()` when gated by binary presence; exitCode stays clean on machines without opencode
- **Match**: yes
- **Lesson**: gating the `runSetupOpencode` call on `opencodeBinPath !== undefined` is load-bearing — the function sets `exitCode=1` when the binary is missing, which would corrupt the bootstrap's success exit code

## Security & privacy

<!-- security: not-applicable — reads only PATH lookups and the operator's own `~/.config/opencode/opencode.json`; no network calls beyond what already existed in `runSetupOpencode`; no auth, secrets, PII, or new supply-chain surface; § 13 reviewed -->
