# Story 020 — Ollama is in memory only when needed

**Milestone(s)**: M1.1 (stability) — closes a latent operator-burden gap from story 015.

> **Operator stance, recorded 2026-05-29.** Story 015 made local models (Ollama / `qwen3-coder:30b`) the default runtime. That landed the *correctness* half — iterations actually run against the local model with no cloud key. But the *resource* half was implicit: the model stays in RAM 24h after the last call (via the `OLLAMA_KEEP_ALIVE=24h` env var baked into `~/Library/LaunchAgents/com.dotfiles.ollama.plist`). On a 64 GB Mac the `qwen3-coder:30b` model claims ~42 GB wired RAM the moment it's touched, and holds it for a full day even when the operator's minsky daemon is stopped. That's not "in memory when needed". It's "in memory always".
>
> This story closes that gap by making Minsky's daemon explicitly manage Ollama's memory lifetime: warm the model when the daemon starts iterating against a local-LLM config, unload it when the daemon shuts down. The 24h plist-level keep_alive becomes a 10-minute safety net rather than the load-bearing default.

## Story

As an operator I run `minsky daemon start --local` on my MacBook overnight. The daemon iterates against `ollama_chat/qwen3-coder:30b` (per story 015's defaults). In the morning I `minsky daemon stop` and close my laptop lid.

Right now, the 42 GB the model claimed is **still locked in wired RAM 24 hours later** because of `OLLAMA_KEEP_ALIVE=24h`. If I open Slack, Chrome, Outlook — all the normal day-after-overnight-run apps — they fight that 42 GB for working set, and the system thrashes the memory compressor.

After this story ships, the same workflow looks like:

1. `minsky daemon start --local` warms the model exactly once (cold-start tax paid once: ~15-30 s).
2. The daemon iterates. The model stays loaded — every LiteLLM request refreshes Ollama's per-request keep_alive (defaulting to the env var, now 10 m).
3. `minsky daemon stop` (or `SIGTERM` from launchd) sends `keep_alive: 0` to Ollama, which evicts the model immediately. `vm_stat` shows wired pages drop by ~42 GB within 2 seconds.
4. If the daemon crashes abruptly (no graceful shutdown), the model auto-unloads after 10 min of idle (the env-var safety net). Worst case: 10 min of held RAM, not 24 hours.

Critically, story 015's "local models are the default" stance does **not** change. The daemon still defaults to local. It just stops holding 42 GB hostage between sessions.

## Acceptance criteria

### Given/When/Then (rule #3a — acceptance-scenario gate)

**Scenario 1 — daemon-start warm**
- **Given** `~/.minsky/config.json` has `local_llm_enabled: true` and the bash skeleton is about to start a host-walk
- **When** the runner begins `walk_hosts()` for the first time in this process
- **Then** it shells out to `bin/minsky-ollama-warm <model> <base_url>` exactly once, which POSTs `/api/generate` with an empty prompt and `keep_alive: "30m"`. The model is loaded into VRAM before the first iteration's openhands spawn so the first LiteLLM call doesn't pay the cold-start tax mid-agent-reasoning.

**Scenario 2 — daemon-stop unload**
- **Given** the daemon is running and has previously warmed a local model
- **When** the runner receives `SIGTERM` or `SIGINT` (the existing trap at `bin/minsky-run.sh:1321`)
- **Then** the trap handler shells out to `bin/minsky-ollama-unload <model> <base_url>` BEFORE `exit 0`. The Ollama `/api/generate` response carries `"done_reason": "unload"`. `curl /api/ps` shows the model gone within 2 s.

**Scenario 3 — cloud-model iteration is untouched**
- **Given** `~/.minsky/config.json` has `local_llm_enabled: false` (cloud Anthropic path)
- **When** the daemon starts and stops
- **Then** the runner does NOT touch Ollama. No `warm` call, no `unload` call. The adapter is a pure no-op on the cloud path.

**Scenario 4 — Ollama unreachable at warm time**
- **Given** `local_llm_enabled: true` but the Ollama daemon is down (port 11434 refuses connection)
- **When** `bin/minsky-ollama-warm` runs
- **Then** it exits non-zero and the bash runner CONTINUES walking hosts (graceful degrade per rule #7 — chaos table row `ollama-down-at-warm`). The existing `heal-ollama-down` recipe handles the actual heal; the warm-call failure must not block the iteration loop. (The first openhands spawn will trip the same connection refused, the heal fires, the daemon proceeds.)

**Scenario 5 — abrupt crash safety net**
- **Given** the daemon has warmed a local model and then is killed via `SIGKILL` (no trap firing)
- **When** 10 minutes pass with no further LLM activity
- **Then** Ollama's own `OLLAMA_KEEP_ALIVE=10m` env (set in the dotfiles launchd plist, lowered from `24h` in the same PR) auto-evicts the model. Worst-case memory hold across a crash = 10 min, not 24 h.

### Numbered acceptance criteria

1. A new adapter package exists at `novel/adapters/ollama/` with the standard shape (rule #2): interface in `src/index.ts`, HTTP Strategy impl in `src/http.ts`, in-memory test fake (`StubOllama`) for tests, `selfTest()` health probe returning `SelfTestResult` from `@minsky/adapter-types`. Mirrors the `notifier` adapter's file layout.
2. Two thin CLI binaries — `bin/minsky-ollama-warm` and `bin/minsky-ollama-unload` — each accept `<model>` and `<base-url>` argv, instantiate the HTTP Strategy, and call `.warm()` / `.unload()`. Exit 0 on success, non-zero on transport failure. ~15 LOC each.
3. `bin/minsky-run.sh` calls the warm binary once per process at the top of `walk_hosts()` when `local_llm_enabled == true`; idempotent (re-entering the function on a repeated `--loop` cycle does NOT re-warm — the SIGTERM trap is the only path that calls unload).
4. The SIGTERM/SIGINT trap at `bin/minsky-run.sh:1321` calls the unload binary when the runner has warmed a local model in this process; the existing `echo "SIGTERM received — exiting cleanly"` + `exit 0` semantics are preserved.
5. The adapter's HTTP shape matches Ollama's documented `/api/generate` and `/api/ps` endpoints (https://github.com/ollama/ollama/blob/main/docs/api.md § "Generate a completion" and § "List running models"). Specifically: empty `prompt` + `keep_alive: "30m"` warms; `keep_alive: 0` (or `"0"`) unloads.
6. Tests are hermetic: the HTTP Strategy takes an injected `fetch`-like callable (mirrors `NtfyNotifier`'s pattern), and the test fake records calls without touching the network. No test spawns ollama. No test sets a real timer.
7. The dotfiles launchd plist (`~/Library/LaunchAgents/com.dotfiles.ollama.plist`) is updated in a sibling PR in the **dotfiles** repo (NOT this minsky PR) from `OLLAMA_KEEP_ALIVE=24h` to `OLLAMA_KEEP_ALIVE=10m`. This minsky PR's TASKS.md entry documents the cross-repo dependency.
8. `docs/ARCHITECTURE.md`'s dependency table grows a row: `ollama HTTP API` → `novel/adapters/ollama/src/http.ts` → "warm/unload Ollama models for daemon-scoped memory management".
9. `vision.md`'s pattern-conformance index grows a row for the new package (Adapter + Strategy, conformance: full).
10. The story is reversible: if 30-min keep_alive causes mid-iteration evictions (because an iteration runs >30 min between LLM calls), the operator can raise the warm-call's keep_alive via `MINSKY_OLLAMA_WARM_KEEPALIVE=60m` in the env. Default stays 30m.

## Metric

- **Name**: `ollama-daemon-idle-wired-memory-mb`
- **Definition**: Wired-memory page count attributable to the Ollama runner process (`/Applications/Ollama.app/Contents/Resources/ollama runner`) when **no minsky daemon is running** and **10 minutes have passed since the last LLM call**. Sampled via `ps aux | awk '/ollama runner/ {print $6}'` (RSS KB, converted to MB).
- **Threshold (success)**: ≤ 500 MB (the `ollama serve` parent stays loaded; only the model-runner subprocess unloads). Today's value: ~42,000 MB.
- **Threshold (pivot)**: > 5,000 MB after 14 days of operator-default use → the unload path isn't firing reliably; investigate whether LiteLLM is overriding the env-var default with a hardcoded long keep_alive.
- **Source**: `scripts/measure-ollama-idle-memory.sh` (new in this PR, runnable from CI macOS runner + operator's host).

## Integration test

`novel/adapters/ollama/src/http.test.ts`:

1. Construct `HttpOllama` with an injected fetch mock.
2. Call `warm("qwen3-coder:30b")` and assert the mock was called with `POST /api/generate`, body `{"model":"qwen3-coder:30b","prompt":"","keep_alive":"30m"}`.
3. Call `unload("qwen3-coder:30b")` and assert body `{"model":"qwen3-coder:30b","keep_alive":0}`.
4. Mock returns 200 → `warm`/`unload` return `{ ok: true }`.
5. Mock throws (network error) → both return `{ ok: false, reason: "network: <msg>" }` per rule #7 graceful-degrade. **Never throw.**
6. Mock returns 503 → `{ ok: false, reason: "http 503" }`.
7. `ps()` GETs `/api/ps`; returns the parsed `models[]` array (one fixture: `qwen3-coder:30b` with `size_vram` 45 GB).
8. `selfTest()` calls `ps()` and returns `{ status: "green" }` on 200, `{ status: "red" }` on transport failure.

`bin/minsky-run.sh` integration:
- `tests/minsky-run-ollama-warm.bats` (new) — stubs `bin/minsky-ollama-warm` via PATH, sets `local_llm_enabled: true` in a fixture config, runs `bin/minsky-run.sh --hosts-dir <fixture> --max-iterations 1`, asserts the stub was invoked with the expected argv.
- Same shape for `tests/minsky-run-ollama-unload.bats` — sends `SIGTERM` to the running script, asserts the unload stub was invoked before exit.

## Proof

- This story is the implementation; the proof lands as the PR's `gh pr checks --watch` green CI run.
- A measurable artefact: `scripts/measure-ollama-idle-memory.sh` reports < 500 MB after running `minsky daemon start --local`, then `minsky daemon stop`, then waiting 12 s. Baseline reading (today, before this story ships) recorded in the PR body: ~42,656 MB.

## Failure modes & chaos verification

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Ollama unreachable at warm time | port 11434 refuses connection at daemon start | `graceful-degrade` — warm CLI exits 1, bash runner continues (rule #7); the existing `heal-ollama-down` recipe handles the actual heal on the first iteration's spawn failure | covered by `heal-ollama-down.test.ts` (no new test needed; the new warm CLI's failure is just one more entry point) |
| Ollama returns non-2xx on unload | model already unloaded; ollama upgraded mid-session; auth changed | `graceful-degrade` — unload CLI exits non-zero, trap STILL `exit 0`s the runner cleanly. Memory held by ollama is bounded by the 10-min env safety net | `http.test.ts` § "unload returns http 503" |
| Network partition mid-warm | fetch hangs forever | `circuit-break-and-notify` — warm CLI has a 30 s timeout (`AbortController`). On timeout, exits 124 and the runner continues without warming. First iteration pays the cold-start tax | `http.test.ts` § "warm times out after 30s with AbortSignal" |
| LiteLLM passes a longer keep_alive than env default | future LiteLLM upgrade sets `keep_alive: "1h"` per request, overriding our `OLLAMA_KEEP_ALIVE=10m` env | `loud-crash-supervisor-restart` — the daemon's `unload()` call at shutdown still works (per-request `keep_alive: 0` always wins). If unload fails AND LiteLLM holds a long keep_alive, the model lingers up to LiteLLM's value. Pivot trigger fires (see Metric § pivot) | covered by the metric's 14-day operator window; no test (LiteLLM behavior is an upstream invariant) |
| Both Ollama.app AND launchd plist running | port 11434 contention; warm/unload hits whichever wins the race | `loud-crash-supervisor-restart` — the existing `com.dotfiles.ollama.plist` warning ("do NOT run Ollama.app simultaneously") applies; the adapter doesn't try to detect this. `minsky doctor` already surfaces ollama health via `heal-ollama-down`'s probe | covered by `heal-ollama-down.test.ts` |

**Blast radius**: bounded to operators with `local_llm_enabled: true`. Cloud-path operators see zero behavior change.

**Operator escape hatch**: `MINSKY_OLLAMA_DISABLE_LIFECYCLE=1` in the daemon's env short-circuits BOTH the warm-on-start and unload-on-stop calls. Iterations still work; memory management reverts to env-only (10m safety net). Documented in `docs/configuration.md`.

## Pre-registered umbrella experiment

`experiments/ollama-jit-warm-unload-2026-05-29.yaml` — see file. Hypothesis: explicitly warming + unloading the local model around the daemon's active session brings idle wired-memory from ~42 GB to ≤500 MB without measurably reducing iteration throughput, because the per-iteration LiteLLM call cadence (~5-30 s) is well under the 30-min warm-window and the cold-start tax is paid exactly once per daemon-start.

## Notes

- Pairs with story 015 — same operator stance (local models default), this story closes the resource half.
- Pairs with story 018 (clean uninstall) — uninstall should also unload any loaded model; deferred to a follow-up TASKS.md entry to keep this PR scoped.
- The dotfiles plist change (`OLLAMA_KEEP_ALIVE` 24h → 10m) lives in a separate repo and ships as a separate PR. This minsky PR's TASKS.md entry tracks the cross-repo dependency.
- LiteLLM does not currently set `keep_alive` on its ollama requests (verified by inspecting the `/api/chat` payload during a live iteration), so the env default applies to in-flight requests. If LiteLLM ever changes this, the metric § pivot row catches it.
