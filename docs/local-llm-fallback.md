# Local LLM fallback runbook

When Claude's weekly budget exhausts, Minsky's daemon switches from `claude --print` to a local agentic harness backed by an Apple Silicon native model. This document is the operator-facing install, smoke-test, and verification runbook for the local stack on this machine.

## Stack

- **Inference**: [`mlx-lm`](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm) — Apple's native ML framework wrapped as an OpenAI-compatible HTTP server. Runs at ~12–20 tok/s on M1 Max with the 32B-4bit weights below; ~5–8 tok/s with `llama.cpp` for the same model.
- **Model**: [`mlx-community/Qwen2.5-Coder-32B-Instruct-4bit`](https://huggingface.co/mlx-community/Qwen2.5-Coder-32B-Instruct-4bit) — strongest open agentic-coder in the 4-bit-quantizable class (per Qwen team's own coder benchmarks; Aider's polyglot leaderboard 2026 Q1). ~19 GB resident; fits 32 GB unified memory with headroom for a single Claude worker plus macOS itself.
- **Harness**: [`aider`](https://aider.chat) — agentic CLI with `--message` for one-shot prompts, `--yes` for non-interactive, automatic git commits, and `--openai-api-base` for pointing at the local server. Closest semantic match to `claude --print`.

## Install

```bash
# Apple Silicon native ML server
pipx install mlx-lm
# Aider — must be on python 3.12 or 3.13; 3.14 has numpy build issues
pipx install --python /opt/homebrew/bin/python3.12 aider-chat
# Pull the model (~19 GB; ~10–15 min on a 1 Gbps link)
hf download mlx-community/Qwen2.5-Coder-32B-Instruct-4bit
```

Disk envelope: `~/.cache/huggingface/hub/models--mlx-community--Qwen2.5-Coder-32B-Instruct-4bit` (~19 GB).

## Smoke test

In one terminal:

```bash
mlx_lm.server \
  --model mlx-community/Qwen2.5-Coder-32B-Instruct-4bit \
  --host 127.0.0.1 --port 8080
```

In a second terminal (against a throwaway worktree — never the live repo):

```bash
git worktree add /tmp/local-llm-smoke -B local-llm-smoke main
cd /tmp/local-llm-smoke
aider \
  --model openai/qwen2.5-coder-32b-instruct-4bit \
  --openai-api-base http://127.0.0.1:8080/v1 \
  --openai-api-key dummy \
  --yes \
  --no-show-model-warnings \
  --message "Add a top-level file SMOKE.md with one paragraph explaining what Minsky is, sourced from the README. Commit it."
```

**Pass criteria**: aider produces a single commit on `local-llm-smoke` containing `SMOKE.md` within ≤15 minutes wall-clock; the commit message is non-empty; the file content is plausibly drawn from the README (not hallucinated).

**Cleanup**:

```bash
git worktree remove --force /tmp/local-llm-smoke
git branch -D local-llm-smoke
```

### Verified — 2026-05-07 (M1 Max 32 GB)

The smoke test was run end-to-end on this machine on 2026-05-07. Recorded numbers:

- Cold-start `mlx_lm.server` boot to `GET /v1/models` 200 OK: ~45 s (one-time model load into Metal).
- Single 47-token prompt, 31-token completion: 6 s wall-clock (includes warm-up).
- Steady-state 47-token prompt, 124-token completion: 8.8 s wall-clock → ~14 tok/s.
- Aider one-shot edit (7.6k prompt tokens — full repo-map + README — 72 completion tokens, single SEARCH/REPLACE block applied to `SMOKE.md`): under 30 s wall-clock end-to-end.
- Output quality: `SMOKE.md` content is grounded in README (not hallucinated), one paragraph, three sentences. No stray edits to other files.

Pass criteria met. The 14 tok/s steady-state matches the MLX-on-M1-Max literature for 32B-4bit and is the baseline against which slice 1's `decideProvider` will be judged.

## How the daemon picks the provider (slice 1+ — not yet wired)

Pure decision function in `novel/tick-loop/src/llm-provider-selector.ts`:

```text
decideProvider({ budgetState, lastClaudeFailure, localProbeResult })
  → "claude" | "local"
```

Inputs:

- `budgetState` — `proceed` / `graceful-degrade` / `circuit-break-and-notify` from `novel/budget-guard/src/index.ts`.
- `lastClaudeFailure` — exit code + stderr-tail of the last claude iteration (signals like 429, 401, hard-limit text from anthropic CLI).
- `localProbeResult` — 60-second probe result for `http://127.0.0.1:8080/v1/models`.

Decision matrix:

| budgetState | last-claude | local-probe | provider |
| --- | --- | --- | --- |
| `proceed` | clean | — | `claude` |
| `proceed` | hard-limit | reachable | `local` |
| `graceful-degrade` | clean | reachable | `claude` |
| `graceful-degrade` | hard-limit | reachable | `local` |
| `circuit-break-and-notify` | — | reachable | `local` |
| `circuit-break-and-notify` | — | unreachable | (hold — log, don't iterate) |

Switchback: when `provider === "local"` and `budgetState` returns to `proceed`, the next 3 iterations run a "claude probe" (clean exit + non-empty stdout) before fully committing back. This avoids flap when the budget reset is partial.

## Throughput baseline (post-slice-3 measurement)

Once slice 3 ships, `node scripts/llm-provider-throughput.mjs --since=$(date -v-7d -u +%Y-%m-%d) --json` returns:

```json
{
  "claude": {"prs": 42, "iterations": 187},
  "local":  {"prs":  3, "iterations":  47},
  "switches": 4
}
```

Acceptance threshold (rolling 7d, when `circuit-break-and-notify` was active for ≥6 cumulative hours): `local.prs ≥ 1 per 24 h per worker`. Below that, the local model isn't capable enough for Minsky's brief shape and the pivot is to "queue tasks, write timestamped TASKS.md notes about what would have been picked, wait for credits" mode.

## Failure modes & chaos verification

Steady-state hypothesis: the daemon's PR-merge rate stays >0 across budget-paused windows. Blast radius: a single worker iteration. Operator escape hatch: `MINSKY_LLM_PROVIDER=claude-only` env override forces the Claude path regardless of budget signal, so the operator can opt out of local fallback for a specific run.

| Failure mode | Trigger | Expected behavior | Chaos test |
| --- | --- | --- | --- |
| local server unreachable during fallback | `mlx_lm.server` crashed | iteration logs the probe failure, returns `status: "local-unreachable"`, no PR opened — not a destructive failure | `pkill -f mlx_lm.server` mid-iteration, assert no PR opened, no force-push, no destructive commit |
| local model produces a destructive PR | aider auto-commits `rm -rf node_modules` or similar | `daemon-fix-own-pr-on-ci-failure` catches via CI red; after 3 retries, labels `daemon-stuck` and stops | run synthetic brief that asks for a destructive change; assert it lands as a PR with `daemon-stuck` label, not as a force-push |
| switchback flap | budget oscillates near 85 % | 3-iteration claude-probe gates the return; flap suppressed | synthetic budget-state oscillation, assert provider transitions ≤2 in 24 h |
| memory pressure | local model resident + 3 claude workers running | invariant: only one provider resident at a time per machine; daemon holds before spawning local while any claude child still alive | assert `pgrep claude` returns empty before `mlx_lm.server` is spawned |

## Anchors

- `novel/budget-guard/src/index.ts` — the existing `circuit-break-and-notify` signal this fallback hooks into.
- `novel/tick-loop/src/spawn-strategy.ts:175` — the single spawn point that slice 2 extends.
- `vision.md` rule #6 (stay alive — silence is failure).
- `vision.md` rule #1 (don't reinvent — adopt MLX-LM, Qwen, aider as industry-standard).
- `vision.md` rule #9 (pre-registered HDD — the 7-day provider-throughput query is the canonical metric).
- Forsgren, Humble, Kim, *Accelerate* (2018) — DORA's deployment frequency stays >0 under fallback.
- Saltzer & Schroeder (1975) — fail-safe defaults: degraded throughput beats hanging at zero.
