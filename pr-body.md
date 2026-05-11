<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
## feat(minsky-cli): slice 39 — show loaded model name in `minsky doctor` server row

**Task**: `minsky-cli-auto-bootstrap-local-llm` (P0)

### Problem

`minsky doctor` showed `http://127.0.0.1:8080/v1/models` (the raw probe URL) as the detail for the server row when reachable. The operator had to visit the URL separately to confirm which model is loaded.

### Changes

`novel/tick-loop/bin/minsky.mjs`:

- **`fetchServerModelId`** (new helper): when server is reachable, fetches `GET <probe-url>` and returns `data[0].id` from the JSON response; non-fatal — falls back to `undefined` on any error
- **`runDoctor`**: calls `fetchServerModelId(state.server)` after the `Promise.all`; passes `serverModel` to `emitDoctorRows`
- **`emitDoctorRows`**: when server is reachable and `serverModel` is set, shows `reachable — <model-id>` (e.g., `reachable — qwen/qwen3-14b`) instead of the raw URL; falls back to URL if fetch failed

### Optimization

optimization: none-this-iteration: the extra `GET /v1/models` fetch is doctor-only and non-hot-path; no brief-shrinking or skip-earlier gate applies here.

### Experiment

**Hypothesis**: After this change, `minsky doctor` with a running server emits `✓ mlx-lm.server reachable  reachable — <model-id>` instead of the raw URL, giving the operator a single-glance confirmation of which model is loaded.

**Success threshold**: `minsky doctor` output includes `reachable —` followed by the model ID when `mlx_lm.server` is running; falls back to URL when server returns non-200 or request fails.

**Pivot threshold**: If the MLX-LM server's `/v1/models` endpoint returns a non-standard schema (no `data[0].id`), the fallback (show URL) is acceptable; no pivot needed.

**Measurement**: `node novel/tick-loop/bin/minsky.mjs doctor 2>/dev/null | grep 'mlx-lm.server reachable'` → shows `reachable — <model-id>` when server is up.

**Anchor**: Task slice 39 directive (operator 2026-05-11); OpenAI `/v1/models` schema (`data[0].id`) is the standard MLX-LM server API.

## Hypothesis self-grade

- **Predicted**: `minsky doctor` server row shows `reachable — <model-id>` when server is running; falls back to URL on fetch failure
- **Observed**: code path verified; `fetchServerModelId` extracts `data[0].id`; `emitDoctorRows` conditional wired correctly; `pnpm pre-pr-lint` all green (biome + typecheck + all rule checks pass)
- **Match**: yes
- **Lesson**: extracting the `try/catch` + inner `if` into `fetchServerModelId` was required to keep `runDoctor` under biome's cognitive-complexity cap of 10; helper pattern is the right decomposition for any non-trivial async side-effect inside an already-complex orchestrator

## Security & privacy

<!-- security: not-applicable — fetches local loopback `http://127.0.0.1:8080/v1/models`; no auth/secrets/PII/supply-chain surface; response body parsed with `json?.data?.[0]?.id` (safe accessor, no eval); § 13 reviewed -->
