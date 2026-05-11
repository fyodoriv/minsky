## Summary

Slice 33 of P0 task `minsky-cli-auto-bootstrap-local-llm`. Fixes a
correctness gap: the `start-mlx-server` bootstrap step was routed through
`spawnFn` which waits for process-close — a long-running server never
closes, so `minsky bootstrap-local-llm` would hang forever on a fresh machine.

Three coupled changes:

1. **Executor seam** (`local-llm-bootstrap-executor.ts`): adds `StartServerFn`
   type + optional `startServerFn?` field to `ExecuteOpts`. `runOneStep`
   routes `start-mlx-server` through the new seam when provided; falls back
   to `spawnFn` when absent (test environments where the fake returns
   immediately). Extracted `runStartServerStep` helper to keep
   cognitive complexity ≤ biome's cap of 10.

2. **Production wiring** (`bin/minsky.mjs`): `startMlxServerDetached` does
   a `detached: true` spawn + `child.unref()`, writes the server PID to
   `.minsky/local-llm.pid`, and logs a "server is loading the model (~30–60 s)"
   line. Returns immediately — the next `minsky` invocation's slice-26
   `buildServerProbe` detects reachability without re-running bootstrap.

3. **Docs** (`docs/local-llm-fallback.md`): `## Install` section now leads
   with the `minsky` auto-bootstrap UX (sample terminal session, `--dry-run`,
   `bootstrap-local-llm`, `doctor`). Manual install steps moved to a
   `<details>` collapsed section as the fallback recipe.

## Optimization

`optimization: none-this-iteration: slice 33 is a correctness gap (start-mlx-server dispatch hung forever without the detached seam); optimization budget was exhausted in slices 26–32 which eliminated 5+ fetch /v1/models round-trips per fast-path invocation`

## Hypothesis self-grade

- **Predicted**: adding `StartServerFn` seam + `startMlxServerDetached` wiring makes `start-mlx-server` steps non-blocking and writes `.minsky/local-llm.pid`; 3 new tests pin routing/fallback/rejection-capture; pre-pr-lint all green
- **Observed**: `pnpm pre-pr-lint` 12/12 checks green; all 163 existing test files pass; 3 new executor tests green (routes through seam when provided, falls back to spawnFn when absent, captures rejection as failed step)
- **Match**: yes
- **Lesson**: cognitive-complexity caps are a real forcing function — the initial inline try/catch pushed `runOneStep` complexity from 10 to 15; extracting `runStartServerStep` (4 lines) brought it back within budget with zero logic change

<!-- security: not-applicable — no auth/secrets/sandbox/PII/supply-chain surface; slice 33 wires a spawn + writeFileSync for a local background process already approved by the operator's explicit confirm prompt -->
<!-- pattern: not-applicable — pr-body.md is a transient PR description artefact, not a permanent codebase module; no pattern conformance row required -->
