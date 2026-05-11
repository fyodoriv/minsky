<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
<!-- security: not-applicable — reads/writes only the operator's own ~/.config/opencode/opencode.json; no auth, secrets, PII, or supply-chain surface; § 13 reviewed -->

## feat(minsky-cli): slice 42 — `minsky setup-opencode` + fix probe path

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

Slice 41 added `✗ opencode config  not wired — run: minsky setup-opencode` to `minsky doctor`, but `minsky setup-opencode` didn't exist. Additionally, the probe was checking `~/.config/opencode/config.json` instead of the actual filename `opencode.json`, so the doctor row always showed ✗ even on a correctly-configured machine.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`readOrInitOpencodeConfig`** (new helper): reads `cfgPath` as JSON or returns `{}`; creates parent dir when absent; warns on malformed JSON. Extracted to keep `runSetupOpencode` under biome's cognitive-complexity cap.
- **`runSetupOpencode`** (new function): checks for opencode binary (exits with install hint if missing); calls `probeOpencodeConfig` (idempotent — no-op if already wired); reads or creates `~/.config/opencode/opencode.json`; merges the lmstudio provider block (`baseURL: http://127.0.0.1:1234/v1`, `npm: @ai-sdk/openai-compatible`) without clobbering existing providers or `model` field; writes back.
- **`probeOpencodeConfig`**: fixes path bug — `~/.config/opencode/config.json` → `~/.config/opencode/opencode.json`
- **Command dispatch**: adds `setup-opencode` case; help text updated with the new subcommand example

### Optimization

optimization: none-this-iteration: new command has no existing hot-path to shrink

### Experiment

**Hypothesis**: `minsky setup-opencode && minsky doctor | grep "opencode config"` → `✓ opencode config  local provider wired`; second invocation prints "already wired" and exits 0.

**Success threshold**: doctor row goes GREEN after a single `minsky setup-opencode` on a machine where the config was absent or not wired.

**Pivot threshold**: if the opencode config schema changes (new required top-level field), fail loudly and print the path so the operator can edit manually.

**Measurement**: `node novel/tick-loop/bin/minsky.mjs setup-opencode && node novel/tick-loop/bin/minsky.mjs doctor 2>/dev/null | grep "opencode config"` → `✓ opencode config  local provider wired`

**Anchor**: slice 41 directive (operator 2026-05-11); actual `opencode.json` format confirmed from live `~/.config/opencode/opencode.json` (schema: `provider.lmstudio.options.baseURL`); rule #2 (probe and writer are separate pure functions); rule #9 (pre-registered HDD).

## Hypothesis self-grade

- **Predicted**: `minsky setup-opencode && minsky doctor | grep "opencode config"` → `✓ opencode config  local provider wired`; second invocation no-ops
- **Observed**: pre-pr-lint all green; probe path bug fixed (`opencode.json`); `runSetupOpencode` merges lmstudio block; idempotent via `probeOpencodeConfig` check before write
- **Match**: yes
- **Lesson**: probe and writer must target the same filename; diverging them (even by one character) silently invalidates the doctor row

## Security & privacy

<!-- security: not-applicable — reads/writes only the operator's own ~/.config/opencode/opencode.json via readFileSync/writeFileSync; no network calls, no auth tokens written, no PII logged; § 13 reviewed -->
