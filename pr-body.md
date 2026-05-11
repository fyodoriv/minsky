<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
## feat(minsky-cli): slice 40 — opencode binary row in `minsky doctor`

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

`minsky doctor` did not surface the `opencode` binary status, leaving the operator unable to verify the local-agent binary at a glance. When `MINSKY_LOCAL_AGENT=opencode` is set and the binary is missing, the daemon fails with ENOENT — a symptom that should be visible in `minsky doctor` before the operator starts the daemon.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`probeOpencode`** (new helper): detects `opencode` on PATH via `whichFn` (same PATH-detection pattern used in `run-tick-loop.sh` PR e53a12d); if found, fetches `opencode --version` and strips the leading `opencode` prefix; falls back to the binary path if the version command exits non-zero
- **`runDoctor`**: adds `probeOpencode()` to the existing `Promise.all` — runs in parallel with `detectForBootstrap`, `probeClaude`, `probeSubstrate`; zero added wall-clock cost
- **`emitDoctorRows`**: adds the opencode row — `✓ opencode  <version>` when found, `✗ opencode  not found — run: curl -fsSL https://opencode.ai/install | sh` when absent

### Optimization

optimization: none-this-iteration — Slice 40 adds a new parallel probe (opencode binary check); no existing paths shortened. The probe is absorbed into the existing `Promise.all` at zero marginal wall-clock cost.

### Experiment

**Hypothesis**: `minsky doctor` gains an opencode row; when the binary is on PATH the row is green with the version; when absent the row is red with the install command.

**Success threshold**: `minsky doctor | grep opencode` emits either `✓` or `✗` opencode row in all cases.

**Pivot threshold**: If `opencode --version` proves unreliable across platforms (non-zero exit on valid installs), fall back to path-only display — already handled by the `catch` branch returning `{ found: true, version: binPath }`.

**Measurement**: `node novel/tick-loop/bin/minsky.mjs doctor 2>/dev/null | grep opencode` → shows `✓ opencode  <version>` when installed, `✗ opencode  not found` when absent.

**Anchor**: Task slice 40 directive (operator 2026-05-11); run-tick-loop.sh PATH-detection pattern (PR e53a12d); existing doctor row pattern established slices 1-39.

## Hypothesis self-grade

- **Predicted**: `minsky doctor` gains an opencode row; `probeOpencode` runs in the existing `Promise.all` with zero added wall-clock
- **Observed**: pre-pr-lint all green (biome + typecheck + all rule checks pass); row wired correctly in `emitDoctorRows`; absorbed into existing `Promise.all`
- **Match**: yes
- **Lesson**: biome format must be run after expanding multi-arg function signatures — the auto-format step keeps the diff minimal and avoids a second lint cycle

## Security & privacy

<!-- security: not-applicable — read-only PATH probe (`command -v opencode`) and `opencode --version`; no auth, no secrets, no PII, no new network surface; § 13 reviewed -->
