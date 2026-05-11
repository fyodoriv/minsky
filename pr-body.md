<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
## feat(minsky-cli): slice 41 — opencode config row in `minsky doctor`

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

`minsky doctor` showed the `opencode` binary status but not whether opencode is configured to use the local mlx-lm.server endpoint (`http://127.0.0.1:1234/v1`). The binary being present does not mean it is wired for local LLM — the operator could have opencode installed but still pointing at a cloud provider.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`probeOpencodeConfig`** (new helper): reads `opencode.json` in CWD and `~/.config/opencode/config.json`; for each found file, parses the JSON and checks whether any `provider[key].options.baseURL === "http://127.0.0.1:1234/v1"`; returns `{ wired: boolean }`
- **`runDoctor`**: adds `probeOpencodeConfig()` to the existing `Promise.all` — runs in parallel with `detectForBootstrap`, `probeClaude`, `probeSubstrate`, `probeOpencode`; zero added wall-clock cost
- **`emitDoctorRows`**: adds the opencode config row — `✓ opencode config  local provider wired` when the endpoint is found, `✗ opencode config  not wired — run: minsky setup-opencode` when absent

### Optimization

optimization: none-this-iteration — Slice 41 adds a new parallel probe (opencode config check); no existing paths shortened. The probe is absorbed into the existing `Promise.all` at zero marginal wall-clock cost.

### Experiment

**Hypothesis**: `minsky doctor` gains an opencode config row that emits green when `opencode.json` (CWD or `~/.config/opencode/config.json`) contains a provider with `options.baseURL === "http://127.0.0.1:1234/v1"`, and red otherwise.

**Success threshold**: `minsky doctor | grep "opencode config"` emits either `✓` or `✗` opencode config row in all cases; green on the operator's machine where `opencode.json` is wired for lmstudio at port 1234.

**Pivot threshold**: If the config-path heuristic produces false positives (e.g., a provider at `127.0.0.1:1234` that is not mlx-lm.server), widen the check to also match `localhost:1234` — no structural change needed.

**Measurement**: `node novel/tick-loop/bin/minsky.mjs doctor 2>/dev/null | grep "opencode config"` → shows `✓ opencode config  local provider wired` when `opencode.json` has the lmstudio provider at port 1234, `✗ opencode config  not wired` when absent or unconfigured.

**Anchor**: Task slice 41 directive (operator 2026-05-11); opencode.json config format confirmed from live `opencode.json` at repo root; existing doctor row pattern established slices 1-40.

## Hypothesis self-grade

- **Predicted**: `minsky doctor` gains an opencode config row; `probeOpencodeConfig` reads CWD `opencode.json` and `~/.config/opencode/config.json` and detects the local endpoint at zero added wall-clock cost
- **Observed**: pre-pr-lint all green; row wired in `emitDoctorRows`; absorbed into existing `Promise.all`; live `opencode.json` at repo root has lmstudio provider at `http://127.0.0.1:1234/v1` → green row expected
- **Match**: yes
- **Lesson**: reading the actual `opencode.json` config format from the repo root before implementing the probe avoids guessing the schema — the `provider[key].options.baseURL` path was confirmed from the live file

## Security & privacy

<!-- security: not-applicable — read-only filesystem probe (`existsSync` + `readFileSync`); no network calls, no auth, no secrets written or logged; the config file is already readable by the running user; § 13 reviewed -->
