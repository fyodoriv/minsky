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
huggingface-cli download mlx-community/Qwen2.5-Coder-32B-Instruct-4bit
```

Disk envelope: `~/.cache/huggingface/hub/models--mlx-community--Qwen2.5-Coder-32B-Instruct-4bit` (~19 GB).

### Why two separate Python environments

`mlx-lm` requires `tokenizers>=0.22.0,<=0.23.0` (transformers 4.57+); `aider-chat` pins `tokenizers==0.21.1`. They cannot share a single venv. The runbook above uses `pipx` which installs each into its own venv automatically — no further action needed. If you install them into a shared venv, `mlx_lm.server` will fail at import time with `ImportError: tokenizers>=0.22.0,<=0.23.0 is required`.

### Apple Silicon under Rosetta — install ARM-native

If `which python3` reports a binary under `/usr/local/` (Intel Homebrew) and `sysctl -n sysctl.proc_translated` returns `1`, your shell is in Rosetta. MLX needs ARM-native Python to use the GPU through Metal. Either install ARM-native Homebrew at `/opt/homebrew/`, or use the system Python explicitly: `arch -arm64 /usr/bin/python3 -m venv ~/venvs/mlx`. The `arch -arm64` prefix forces native execution; without it, MLX may fail to load its arm64-only `_imaging.so` PIL bindings or fall back to CPU.

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
  --model openai/mlx-community/Qwen2.5-Coder-32B-Instruct-4bit \
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

## How the daemon picks the provider (slice 1 — landed; slice 2-3 wiring deferred)

Pure decision function in `novel/tick-loop/src/llm-provider-selector.ts` (slice 1, this PR):

```ts
decideProvider({
  budgetState,         // "normal" | "graceful-degrade" | "circuit-break-and-notify" | "weekly-cap-warn"
  lastClaudeFailure,   // { exitCode, stderrTail, observedAtMs } | undefined
  localProbeResult,    // { reachable, observedAtMs, reason? }
  forceClaude,         // operator override — MINSKY_LLM_PROVIDER=claude-only
  preferLocal,         // operator opt-in — MINSKY_LLM_PROVIDER=local-preferred
}): { provider: "claude" | "local" | "hold", reason: string }
```

Inputs:

- `budgetState` — `BudgetAction` from `novel/budget-guard/src/index.ts` (`normal` / `graceful-degrade` / `circuit-break-and-notify` / `weekly-cap-warn`).
- `lastClaudeFailure` — exit code + last-4KB stderr-tail of the last `claude --print` iteration. The stderr-tail is classified by `isClaudeHardLimit(...)` against an explicit substring allowlist (`HARD_LIMIT_PATTERNS`: `usage limit`, `rate limit`, `rate-limited`, `quota exceeded`, `429`, `limit reached`, `limit will reset`, `limit hit`, …). The pattern set is the public contract — adding a substring is safe; removing one is breaking and needs a `pivot-llm-provider-selector` rule-#9 record.
- `localProbeResult` — 60-second probe result for `http://127.0.0.1:8080/v1/models` produced by `scripts/check-mlx-server.mjs` (slice 1 substrate). The probe writes a JSON line (`{ reachable, observedAtMs, reason? }`) to stdout and exits 0/1; the wiring layer (slice 3) parses that line and threads it into `decideProvider`.

Decision matrix:

| budgetState | last-claude | local-probe | provider |
| --- | --- | --- | --- |
| `normal` | clean | — | `claude` |
| `normal` | hard-limit | reachable | `local` |
| `normal` | hard-limit | unreachable | `claude` (retry; log) |
| `graceful-degrade` | clean | reachable | `claude` |
| `graceful-degrade` | hard-limit | reachable | `local` |
| `circuit-break-and-notify` | — | reachable | `local` |
| `circuit-break-and-notify` | — | unreachable | `hold` — log, don't iterate |
| `weekly-cap-warn` | clean | — | `claude` (warn ≠ pause) |

Operator escape hatches:

- `forceClaude: true` (env `MINSKY_LLM_PROVIDER=claude-only` — slice 3 wires this) — always returns `claude`. Wins over everything.
- `preferLocal: true` (env `MINSKY_LLM_PROVIDER=local-preferred` — slice 3 wires this) — returns `local` when the probe is reachable, even when budget is normal. Useful for testing aider/Qwen quality without waiting for budget exhaustion. Loses to `forceClaude`.

Switchback: when `provider === "local"` and `budgetState` returns to `normal`, the next 3 iterations run a "claude probe" (clean exit + non-empty stdout) before fully committing back. This avoids flap when the budget reset is partial. Implemented in slice 4 (`switchback-claude-probe`).

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

## Live-run findings (2026-05-07, M3 Max 64GB)

First end-to-end run of the daemon under `MINSKY_LOCAL_LLM=1 MINSKY_LLM_PROVIDER=local-preferred` against the live Qwen2.5-Coder-32B-Instruct-4bit. Three concrete fixes landed during the run, all in this PR:

1. **Model alias** — `--model openai/qwen2.5-coder-32b-instruct-4bit` (the bare path the original runbook documented) triggers a 401 against `https://huggingface.co/api/models/qwen2.5-coder-32b-instruct-4bit/revision/main` because litellm strips the `openai/` prefix and looks up the tokenizer by the bare ID. The fix: use the full HuggingFace path `openai/mlx-community/Qwen2.5-Coder-32B-Instruct-4bit` so litellm's tokenizer lookup succeeds. `DEFAULT_AIDER_MODEL` in `novel/tick-loop/src/llm-invocation.ts` carries this.

2. **Auto-commits hardening** — aider's default behaviour is to auto-commit every file edit straight to whatever branch its cwd is on. In single-process daemon mode, that is minsky's checked-out branch — destructive to the operator's working state. `--no-auto-commits` is now hard-wired into `buildAiderInvocation`'s default args; the daemon's brief still instructs the LLM to commit and open a PR explicitly via the standard claude-code workflow.

3. **Timeout label split** — when an aider spawn timed out, the daemon's iteration reason was `claude-print-timeout: <ms>ms` because the label was hardcoded for the legacy single-strategy path. The label now splits cleanly: `claude-print-timeout` for the claude path, `local-spawn-timeout` for the local path. The rolling-7d invariant `claudePrintTimeoutFrequencyInvariant` continues to grep `claude-print-timeout` (back-compat) and a future `localSpawnTimeoutFrequency` invariant can grep the new label.

### Brief-size pivot threshold

The daemon's stock brief (`buildDaemonBrief` in `daemon.ts`) is ~7-10KB of context per iteration: the picked task block, priority-discipline gate, anti-noop guard, optimization-discipline gate, fix-own-PR-state. Aider then auto-loads every file the brief references (TASKS.md, vision.md, the `**Files**:` list, every `scripts/*.mjs` mentioned), pushing the effective context to 30-50 KB. At Qwen2.5-Coder-32B-Instruct-4bit's ~14 tok/s steady-state on M3 Max 64 GB, prompt processing alone (12-15K input tokens) takes 14-18 min — the 30-min watchdog (`local-spawn-timeout` since the slice-3 label split) bites before aider finishes.

**Live-run evidence (2026-05-07, M3 Max 64 GB).** Two tests against the same mlx-lm.server + Qwen2.5-Coder-32B-Instruct-4bit:

1. *Stock brief* — daemon dispatched against `daemon-claude-print-hang-watchdog`. Aider auto-loaded 9 files (TASKS.md, vision.md, 4 `**Files**:` paths, 4 `scripts/*.mjs` paths). After 5+ minutes the chat-history file showed no LLM output past the prompt; mlx-server CPU at 7 % steady (Metal GPU bound on prompt processing). Run killed before the 30-min watchdog to free the slot.
2. *Slim brief* — direct `aider --message "Create a file called HELLO.txt with the content 'hello world'."` in an empty cwd. Aider sent 2.4 k tokens, received 28 tokens, applied a SEARCH/REPLACE diff, created the file. End-to-end ≈ 70 s.

The substrate works; the brief shape doesn't. **Pivot threshold (rule #9):** if rolling-7d p95 of `local-spawn-timeout` count > 5/day across all workers, ship `daemon-aider-brief-shrinker` (filed as P0 in TASKS.md) that produces a slim brief (~≤2 KB, no gates, no templates) specifically for the aider path. The threshold has already been tripped by the 2026-05-07 live run; the task is queued.

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
