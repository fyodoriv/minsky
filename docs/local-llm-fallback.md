# Local LLM fallback runbook

When Claude's weekly budget exhausts, Minsky's daemon switches from `claude --print` to a local agentic harness backed by an Apple Silicon native model. This document is the operator-facing install, smoke-test, and verification runbook for the local stack on this machine.

## Stack

- **Inference**: [`mlx-lm`](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm) — Apple's native ML framework wrapped as an OpenAI-compatible HTTP server. MoE-aware on M-series; with the model below it skips ~90 % of params per token, so the effective generation rate on M1 Max is ~25–40 tok/s (a dense 32B for comparison runs ~14 tok/s).
- **Model**: [`mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit`](https://huggingface.co/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit) — Qwen3-Coder-30B-A3B-Instruct (Jul 2025) is the strongest local coder in the 4-bit-quantizable, fits-on-32-GB-unified-memory class. MoE 30B / 3B active per token; ~17.2 GB resident (smaller than the dense Qwen2.5-Coder-32B-Instruct it supersedes); 60.9 % on Aider Polyglot per third-party testing — rivals Claude Sonnet-4 and GPT-4.1; purpose-built for coding agents (matches Minsky's brief shape). The 480B variant scores 61.8 % but is too large for any practical M1 Max quant.
- **Harness**: [`aider`](https://aider.chat) — agentic CLI with `--message` for one-shot prompts, `--yes` for non-interactive, automatic git commits, and `--openai-api-base` for pointing at the local server. Closest semantic match to `claude --print`.

## Install

```bash
# Apple Silicon native ML server
pipx install mlx-lm
# Aider — must be on python 3.12 or 3.13; 3.14 has numpy build issues
pipx install --python /opt/homebrew/bin/python3.12 aider-chat
# Pull the model (~17.2 GB; ~8–12 min on a 1 Gbps link)
hf download mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit
```

Disk envelope: `~/.cache/huggingface/hub/models--mlx-community--Qwen3-Coder-30B-A3B-Instruct-4bit` (~17.2 GB).

After installing, run `pnpm minsky doctor` to verify the full stack. The doctor command now shows **4 install-time substrate rows** (node_modules / pnpm-lock.yaml / dist/index.js / pnpm-on-PATH) in addition to the local-LLM stack rows (mlx_lm.server / aider / model weights / etc.). Any substrate row RED → banner is RED and exits 1 — fix the substrate before debugging the LLM stack. See [`novel/tick-loop/README.md`](../novel/tick-loop/README.md) (slice 1 of `minsky-fresh-clone-health-checks`) for details. The doctor output also shows **3 git config sanity rows** (`core.hooksPath` / `core.attributesfile` / `core.excludesfile`): YELLOW/⚠ when a dotfile-managed git config key points at a path that doesn't exist on this machine, with a copy-paste-able `git config --<scope> --unset <key>` recovery command per row. This is the multi-machine pattern from PRs #394/#395: if your dotfiles set these keys to absolute paths with your other machine's username, they will be wrong here. See [`novel/tick-loop/README.md`](../novel/tick-loop/README.md) (slice 3 of `minsky-cross-machine-dotfile-checks`) for the full breakdown. If `MINSKY_HOME` points at a path the current user cannot write (common on multi-machine dotfile sync where the hardcoded path uses a different username), the daemon falls back to `/tmp` for worker logs and emits a one-line warning instead of crashing — see slice 2 of `minsky-runtime-resilience` in the same README for the full graceful-degrade behaviour.

### Why two separate Python environments

`mlx-lm` requires `tokenizers>=0.22.0,<=0.23.0` (transformers 4.57+); `aider-chat` pins `tokenizers==0.21.1`. They cannot share a single venv. The runbook above uses `pipx` which installs each into its own venv automatically — no further action needed. If you install them into a shared venv, `mlx_lm.server` will fail at import time with `ImportError: tokenizers>=0.22.0,<=0.23.0 is required`.

### Apple Silicon under Rosetta — install ARM-native

If `which python3` reports a binary under `/usr/local/` (Intel Homebrew) and `sysctl -n sysctl.proc_translated` returns `1`, your shell is in Rosetta. MLX needs ARM-native Python to use the GPU through Metal. Either install ARM-native Homebrew at `/opt/homebrew/`, or use the system Python explicitly: `arch -arm64 /usr/bin/python3 -m venv ~/venvs/mlx`. The `arch -arm64` prefix forces native execution; without it, MLX may fail to load its arm64-only `_imaging.so` PIL bindings or fall back to CPU.

### Auto-bootstrap recovery paths (slices 6–7)

Since slice 6 (`minsky-cli-arch-detection`), the `minsky` CLI auto-detects the Rosetta + missing-`/opt/homebrew/` case and includes an `install-arm-homebrew` step as step 1 of the generated plan. The installer is wrapped with `arch -arm64 /bin/bash -c "NONINTERACTIVE=1 $(curl ... install.sh)"` so `mkdir /opt/homebrew/` lands in arm64 mode even when the parent shell is in Rosetta.

Slice 7 hardened three remaining edge cases:

- **H0 (pipx probe):** the pipx probe now checks `/opt/homebrew/bin/pipx` explicitly on Apple Silicon instead of `which pipx`. This prevents the planner from skipping `install-pipx` when Intel brew's pipx exists but the plan references the arm64 path. `minsky doctor` now correctly shows `✗ pipx  /opt/homebrew/bin/pipx does not exist` on a dual-brew machine.
- **H1 (aider python):** the aider install step now uses `/opt/homebrew/bin/python3.13` (brew's canonical post-install path) when arch-state says we'll have native brew, instead of picking up Intel brew's python3.13 as a first-fit slice-5 candidate. The plan is now architecturally consistent (all paths under `/opt/homebrew/`).
- **H2 (non-TTY refuse):** `minsky bootstrap-local-llm < /dev/null` (or under launchd / systemd / any context where stdin is not a TTY) refuses immediately with exit code 1 and prints the manual installer one-liner instead of hanging silently at sudo. To install `/opt/homebrew/` from a daemonized context: run `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` in Terminal, then rerun `minsky bootstrap-local-llm` from any shell.

## Smoke test

In one terminal:

```bash
mlx_lm.server \
  --model mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit \
  --host 127.0.0.1 --port 8080
```

In a second terminal (against a throwaway worktree — never the live repo):

```bash
git worktree add /tmp/local-llm-smoke -B local-llm-smoke main
cd /tmp/local-llm-smoke
aider \
  --model openai/mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit \
  --edit-format diff-fenced \
  --openai-api-base http://127.0.0.1:8080/v1 \
  --openai-api-key dummy \
  --yes \
  --no-show-model-warnings \
  --message "Add a top-level file SMOKE.md with one paragraph explaining what Minsky is, sourced from the README. Commit it."
```

**`--edit-format diff-fenced` is mandatory for Qwen3-Coder**. Verified empirically on 2026-05-07: the default (`whole`) produces a filename + fenced block but the model writes the filename in mixed case (`SMoke.md` vs the requested `SMOKE.md`) and aider treats the result as unparseable; the standard `diff` format fails too — Qwen3 emits prose markdown instead of the SEARCH/REPLACE block aider expects. Only `diff-fenced` produces a clean SEARCH/REPLACE block aider applies on the first try. Slice 2's `buildAiderInvocation` adapter must hard-code `--edit-format diff-fenced` for the local provider.

**Pass criteria**: aider produces a single commit on `local-llm-smoke` containing `SMOKE.md` within ≤15 minutes wall-clock; the commit message is non-empty; the file content is plausibly drawn from the README (not hallucinated).

**Cleanup**:

```bash
git worktree remove --force /tmp/local-llm-smoke
git branch -D local-llm-smoke
```

### Verified — 2026-05-07 (M1 Max 32 GB)

Two end-to-end smoke runs on this machine on 2026-05-07.

**Run A — Qwen2.5-Coder-32B-Instruct-4bit (initial pick, dense)** — recorded for comparison only; this model is no longer the operator-elected stack.

- Cold-start `mlx_lm.server` boot to `GET /v1/models` 200 OK: ~45 s.
- Steady-state 47-token prompt, 124-token completion: 8.8 s wall-clock → ~14 tok/s.
- Aider one-shot edit (7.6k prompt tokens, 72 completion tokens, single SEARCH/REPLACE block applied to `SMOKE.md`): under 30 s wall-clock end-to-end.

**Run B — Qwen3-Coder-30B-A3B-Instruct-4bit (current pick, MoE)** — replaces Run A as the canonical baseline.

- Cold-start `mlx_lm.server` boot to `GET /v1/models` 200 OK: 34 s (~10 s faster than Run A — smaller weights file).
- Steady-state across 3 trials (24-token prompt, 600-token completion each): **35.7 / 51.1 / 53.3 tok/s** — average **~46.7 tok/s**, beating Run A (14 tok/s) by **~3.3×**. The expected ~25–40 tok/s lower bound was exceeded; the MoE skip-90 %-of-params behavior on M1 Max is real.
- Aider end-to-end one-shot, `--edit-format diff-fenced`, 7.6k prompt tokens, 87 completion tokens, single SEARCH/REPLACE block applied to `SMOKE.md`: **28 s wall-clock end-to-end** (Run A: 30 s — within noise).
- **Format gotcha (load-bearing)**: aider's default edit-format selection for Qwen3-Coder is `whole`, which **fails** — Qwen3 emits a mixed-case filename (`SMoke.md`) plus a fenced block aider can't parse. The standard `diff` format **also fails** — Qwen3 emits prose markdown instead of the required `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` block. Only `--edit-format diff-fenced` produces a clean, applyable edit. Slice 2's `buildAiderInvocation` adapter must hard-code this flag for the local provider.
- Output quality: `SMOKE.md` content is grounded in README (not hallucinated). Three sentences, accurate framing. Minor over-creativity (added an unrequested `# Minsky` header) but trivially correctable.

**Pre-registered acceptance gate (from PR #358 → #365)**: ≥1.5× Run-A tok/s **and** equal-or-better aider-edit success rate over 5 trial runs. **Gate result**: 3.3× tok/s ≫ 1.5× threshold ✅; aider-edit success rate matches Run A once the format is pinned to `diff-fenced` ✅. Gate passed; Qwen3-Coder-30B-A3B-Instruct is locked in as the canonical baseline. The 14 tok/s Run-A figure is now historical-only — slice 1's `decideProvider` is judged against ~46.7 tok/s.

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

### Cross-restart exhaustion detection (slice 4 of `minsky-claude-exhaustion-persisted-state`)

The `claude --print "ping"` startup probe is a 1-token query; Anthropic's quota metering hits at the multi-K-token level. When the operator's quota is exhausted the probe can still return exit 0 — false-positive `healthy`. The daemon then spawns claude on iteration 1, which fails with a hard-limit; the existing per-iteration `decideProvider` correctly switches to local on iteration 2, but the wasted spawn already occurred and the local-LLM stack might not be installed yet.

Slice 4 closes this gap:

1. **Daemon writes hard-limit hits** to `.minsky/state.json::last_claude_hard_limit = { ts, reason }` via the `persistHardLimit` seam in `LlmProviderSpawnStrategy::captureClaudeFailure` (fires when `isClaudeHardLimit(failure) === true`).
2. **CLI consults persisted state on startup** (`bin/minsky.mjs::maybeBootstrapLocalLlm`) BEFORE the live probe. Within `MINSKY_HARD_LIMIT_TTL_MIN` minutes (default 60), skip the probe and go straight to local-LLM bootstrap. Beyond TTL, run the live probe as before.
3. **Doctor row** — `minsky doctor` shows `✓ claude exhaustion (persisted)` when unset or stale, and `⚠ claude exhaustion (persisted) <ts> (<N>m ago)` when within TTL.

Implementation: `novel/tick-loop/src/claude-exhaustion-state.ts` (pure read/write helpers; paired-tested over 8 chaos rows). Persistence failures are graceful-degrade per rule #6 — the in-process `lastClaudeFailure` carry-over still works even if the disk write fails.

## Bidirectional runtime auto-pivot (local ⇄ remote, mid-run, zero operator action)

The slice-1 `decideProvider` matrix above governs which provider an iteration
starts on. The **runtime auto-pivot** (`runtime-token-limit-auto-pivot-local-
and-back`) makes the live `bin/minsky-run.sh` loop switch in BOTH directions
during a run, without operator intervention:

- **Forward (remote → local).** When `decideRunAnyProvider` sees all remote
  backends exhausted/down, the iteration drops to local in ≤1 iteration (the
  pre-existing forward fallback). It now also persists
  `.minsky/runany-local-since.json` and appends a `provider-mode-transition`
  (`remote→local`) record to `.minsky/orchestrate.jsonl`.
- **Back (local → remote).** Each later iteration runs a cheap remote
  recover-probe FIRST (`runany-resolve-model.mjs --recover-probe`). The pure
  `decideRecoverFlipBack` flips the run back to remote only when a minimum dwell
  has elapsed AND N consecutive good probes have accrued — anti-flap. A bad probe
  resets the counter (transient-fail-no-flip). On flip-back the run honors
  `MINSKY_STRATEGIC_PIN_MODEL` verbatim (pin-precedence) and appends a
  `provider-mode-transition` (`local→remote`, `trigger: recover-flip-back`)
  record.

This is the runtime sibling of the `switchback` claude-probe described in the
slice-4 note below — but bidirectional, mid-run, and driven by remote-backend
liveness rather than a budget-state transition. Operator knobs
(`MINSKY_RECOVER_DWELL_MS`, `MINSKY_RECOVER_GOOD_PROBES`, the
`MINSKY_FORCE_EXHAUSTED` test seam) and the Pivot are documented in
[`docs/run-anywhere.md` § "Runtime recover-probe"](./run-anywhere.md). The pure
flip decision is unit-tested in
`scripts/lib/runany-provider-decision.test.mjs`.

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

## Concurrency-aware worker spawn — per-backend caps

When the daemon routes **local-only** (`MINSKY_LLM_PROVIDER=local-preferred` / `local-only`), the number of workers the machine-budget autoscaler ramps to must not exceed what the local inference server can run **concurrently**. `mlx_lm.server` and stock LM Studio serialise inference — one request in flight at a time — so N local-routed workers all queue behind a single inference loop, and effective throughput collapses to ~1/N (Little's Law: past the server's concurrency, extra workers add only contention, not throughput).

The autoscaler closes this gap with an optional `localServerConcurrencyCap` field on `AutoscalerState` (`novel/tick-loop/src/machine-budget-autoscaler.ts`). When set, `computeWorkerTarget` bounds the worker ceiling to `min(maxWorkersForBudget(cores, budgetPct), cap)` in **every** regime (ramp-up holds at the cap, knee-hold/at-budget clamp a stale higher target back down, gridlock-backoff still halves but within the capped ceiling). With no cap (cloud routing, or a concurrent backend) the controller free-runs to the budget ceiling exactly as before.

Per-backend cap matrix:

| Backend | Concurrent inference? | Recommended `localServerConcurrencyCap` |
| --- | --- | --- |
| `mlx_lm.server` (this machine's default) | No — single request in flight | `1` |
| LM Studio (stock) | No — single request in flight | `1` |
| LM Studio Pro / server mode | Sometimes — depends on the loaded model + GPU layers | `1` unless the build advertises concurrent decoding |
| [vLLM](https://github.com/vllm-project/vllm) | Yes — continuous batching | operator-set, sized to GPU memory (e.g. `4`–`8`) |
| [SGLang](https://github.com/sgl-project/sglang) | Yes — RadixAttention batching | operator-set, sized to GPU memory |

The edge (the launchd/config read in `bin/tick-loop.mjs`) owns the default: `1` for mlx/LM-Studio, raised only when the operator has migrated to a concurrent backend. Leaving the cap `undefined` means "cap inactive" — correct for cloud routing. The companion self-diagnose invariant `local-server-concurrency-mismatch` (`scripts/self-diagnose.mjs`) fires the other direction: it warns when `MINSKY_LOCAL_SERVER_MAX_CONCURRENT` is set ≥2 but the probed backend advertises no concurrency hint, i.e. the operator over-promised a single-inference server's capacity.

**Pivot (rule #9):** if vLLM-class concurrent-inference backends become the operator default, the fixed default-1 cap would throttle them wrongly. Decision boundary: ≥2 operator reports of an over-throttled concurrent backend in 30 days → abandon the static default and switch to probe-based cap discovery (read the server's advertised `max_concurrent_requests` and use it as the cap).

## Worktree lifecycle — the local path owns it

The **claude** spawn path gets a per-worker git worktree for free: `claude --worktree <name>` makes Claude Code create it. The **local** path (`MINSKY_LLM_PROVIDER=local-preferred`, aider / opencode) takes the `--worktree` arg out of the equation, so **the local path owns its own worktree lifecycle** — nothing else creates it.

- `novel/tick-loop/src/ensure-worktree.ts` (`ensureWorktree`) idempotently runs `git -C <minskyHome> worktree add --force -B <branch> <worktreeDir> origin/main`, so the worktree's `.git` file resolves to `<minskyHome>/.git/worktrees/<name>`. `buildLocalStrategy` (`bin/tick-loop.mjs`, aider + opencode branches) calls it via `ensureLocalWorktree(taskId)` *before* the spawn and threads the resolved dir through as the invocation `cwd`.
- Defense-in-depth at the workspace boundary (rule #6 / Armstrong 2007): even if the worktree is missing for any reason, `ProcessSpawnStrategy.spawn` checks the resolved `cwd` exists *before* calling `child_process.spawn`. A missing cwd fails loud with a one-line operator-actionable error that names the directory and the P0 task — never a cryptic `spawn aider ENOENT`, never a model spawned into a bad cwd.
- Single-process mode (no `workerConfig`) keeps inheriting the parent cwd (`minskyHome`) — `ensureLocalWorktree` returns `undefined`, no worktree, no guard. The per-task worktree is a multi-worker concern only.

Surfaced-by P0 `local-worker-worktree-never-created` (operator 2026-05-16 dogfood): before this, 100% of `local-preferred` iterations died at git/cwd setup before the Qwen3 call because the local path set `cwd` to a worktree nothing created.

## Failure modes & chaos verification

Steady-state hypothesis: the daemon's PR-merge rate stays >0 across budget-paused windows. Blast radius: a single worker iteration. Operator escape hatch: `MINSKY_LLM_PROVIDER=claude-only` env override forces the Claude path regardless of budget signal, so the operator can opt out of local fallback for a specific run.

| Failure mode | Trigger | Expected behavior | Chaos test |
| --- | --- | --- | --- |
| local server unreachable during fallback | `mlx_lm.server` crashed | iteration logs the probe failure, returns `status: "local-unreachable"`, no PR opened — not a destructive failure | `pkill -f mlx_lm.server` mid-iteration, assert no PR opened, no force-push, no destructive commit |
| worktree cwd missing on local spawn | per-worker worktree never created / pruned | `ensureWorktree` recreates it; if still missing, `ProcessSpawnStrategy.spawn` rejects loud naming the dir + P0 task — model never spawned into a bad cwd | inject `existsFn → false` with a builder `cwd`, assert reject names the dir and `spawnFn` is not called (`spawn-strategy.test.ts`) |
| local model produces a destructive PR | aider auto-commits `rm -rf node_modules` or similar | `daemon-fix-own-pr-on-ci-failure` catches via CI red; after 3 retries, labels `daemon-stuck` and stops | run synthetic brief that asks for a destructive change; assert it lands as a PR with `daemon-stuck` label, not as a force-push |
| switchback flap | budget oscillates near 85 % | 3-iteration claude-probe gates the return; flap suppressed | synthetic budget-state oscillation, assert provider transitions ≤2 in 24 h |
| memory pressure | local model resident + 3 claude workers running | invariant: only one provider resident at a time per machine; daemon holds before spawning local while any claude child still alive | assert `pgrep claude` returns empty before `mlx_lm.server` is spawned |

## Anchors

- `novel/budget-guard/src/index.ts` — the existing `circuit-break-and-notify` signal this fallback hooks into.
- `novel/tick-loop/src/spawn-strategy.ts:175` — the single spawn point that slice 2 extends.
- `novel/tick-loop/src/claude-exhaustion-state.ts` — persisted hard-limit read/write helpers; slice 4 of `minsky-claude-exhaustion-persisted-state`. Wired into `LlmProviderSpawnStrategy` (write) and `bin/minsky.mjs::maybeBootstrapLocalLlm` (read). See section above.
- `novel/tick-loop/src/log-path-fallback.ts` — graceful-degrade: falls back to `/tmp/minsky-worker-<id>-<pid>.log` on EACCES/EROFS/ENOSPC so the local-LLM daemon still starts while the operator fixes `.minsky/workers/` (slice 2 of `minsky-runtime-resilience`; see `novel/tick-loop/README.md` § Slice 2).
- `novel/tick-loop/src/workers-dir-mkdir.ts` — classifies `mkdirSync` errno into a recovery hint (chmod vs MINSKY_HOME); exits 1 with operator-actionable message instead of a raw Node.js stack trace if workers dir cannot be created (slice 2 of `minsky-runtime-resilience`).
- `vision.md` rule #6 (stay alive — silence is failure).
- `vision.md` rule #1 (don't reinvent — adopt MLX-LM, Qwen, aider as industry-standard).
- `vision.md` rule #9 (pre-registered HDD — the 7-day provider-throughput query is the canonical metric).
- Forsgren, Humble, Kim, *Accelerate* (2018) — DORA's deployment frequency stays >0 under fallback.
- Saltzer & Schroeder (1975) — fail-safe defaults: degraded throughput beats hanging at zero.
