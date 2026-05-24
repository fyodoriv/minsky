# Story 015 — Local models until the daemon is stable

**Milestone(s)**: M1, M1.1

> **Operator stance, recorded 2026-05-24.** Minsky runs every iteration against a local model (Ollama / LM Studio / MLX) and explicitly avoids requiring a cloud API key. The stance holds until the daemon's stability — measured by the M1.1 stability target (`spawn-failed-exit-minus-one-silent-empty-stderr` and the broader 24/7 pillar's restart-event rate) — reaches 90%. Only then does it become *acceptable* to flip the default back to a cloud model (Claude / GPT / Gemini) for the operator's main loop. Cloud-model A/B benchmarks are still allowed while the stance is active (they're how we'll measure the eventual flip), but they are not the daemon's default runtime path.

## Story

As an operator I have no Anthropic / OpenAI / Gemini key. I have Ollama running on my MacBook with `qwen3-coder:30b` pulled. I want Minsky to drain my `TASKS.md` overnight without me handing it a cloud bill.

I edit `~/.minsky/config.json`:

```json
{
  "cloud_agent": "openhands",
  "cloud_agent_model": "ollama_chat/qwen3-coder:30b",
  "ollama_base_url": "http://localhost:11434"
}
```

I run `minsky`. The daemon ticks. The OpenHands shim spawns against Ollama. PRs land. No cloud key ever materialized.

That's not a fallback path. That's *the* path until I — the operator — say otherwise. The daemon does not silently upgrade to a cloud model when it detects a key in my environment; it does not nag me to set `ANTHROPIC_API_KEY`; it does not slot a "use cloud for hard tasks, local for easy ones" auto-router in front of me. It runs on local until the M1.1 stability gate trips.

When the gate trips — measured by `scripts/measure-stability.mjs` reporting 90% of the trailing-7-day iterations had a clean exit — the daemon emits a one-time observability event ("local-models stance: gate lifted") and writes a banner to `minsky watch` recommending an A/B against a cloud model. The operator decides whether to flip. The stance is *advisory* after the gate lifts, *iron* before.

## Acceptance criteria

1. The default in `bin/minsky-defaults.json` (or wherever the canonical default lives) is `cloud_agent: "openhands"`, `cloud_agent_model: "ollama_chat/qwen3-coder:30b"`. Operators with no cloud key can run Minsky immediately.
2. `novel/cross-repo-runner/bin/minsky-run.mjs` auto-detects local-model prefixes (`ollama_chat/`, `ollama/`, `lm_studio/`, `mlx/`) and threads `--base-url`, `--reasoning-effort=none`, `--no-extended-thinking` to the OpenHands shim without operator action.
3. `~/.minsky/config.json` written by the install runbook does NOT contain a cloud key field by default. Cloud-key fields are opt-in via a documented config edit.
4. `minsky doctor` distinguishes "cloud-model configured" from "local-model configured" and treats local-model configured as the canonical baseline (green status). Cloud-key-configured installs are healthy too but are now an explicit operator choice.
5. `scripts/measure-stability.mjs` (shipped 2026-05-24 — closes the `local-models-stability-gate-90-percent` P1 task) reads from `.minsky/experiment-store/cross-repo/*.jsonl` via `scripts/stability-number.mjs` (one source of truth for clean-exit fraction — the same data source the M1 P0 `single-stability-number` closure uses) over the trailing-7-day window. When ≥90%, it emits the "gate lifted" banner once per host (idempotent via `~/.minsky/stability-gate-lifted-at`). The bucketing logic and threshold constants (`DEFAULT_GATE_THRESHOLD=0.90`, `KEEP_ACTIVE_FLOOR=0.60`, `DEFAULT_WINDOW_DAYS=7`) are pinned in `scripts/measure-stability.mjs` as exported constants and unit-tested in `scripts/measure-stability.test.mjs` (25 paired tests). The operator can override the gate-lift threshold via `MINSKY_STABILITY_GATE_THRESHOLD` (per the Risk § "90% threshold is operator-chosen" mitigation).
6. `INSTALL.md` Step 0 names this stance explicitly: "Minsky's default runtime is local (Ollama / LM Studio / MLX). A cloud API key is NOT required to install or use Minsky."
7. `README.md` and `vision.md` are aligned with this stance — the pillar scorecard for OpenHands' agent-runtime row notes "local models default; cloud A/B pending stability gate".
8. The stance is reversible: if M1.1 stability never reaches 90% by milestone date, the operator can either (a) extend the stance, (b) flip it pre-emptively with documented reasoning in `docs/validated-learnings.md`, or (c) abandon the stance entirely (rule #15 milestone-alignment gate fires).

## Metric

- **Name**: `local-models-default-clean-exit-fraction`
- **Definition**: Fraction of Minsky iterations in the trailing-7-day window where the operator's daemon ran against a local model AND the iteration exited cleanly (no `spawn-failed-exit-minus-one-silent-empty-stderr`-class failures, no supervisor-restart events from agent-runtime crashes).
- **Threshold**: ≥90% to lift the stance (gate); ≥60% to keep it active (failure means the daemon has gotten *worse*, not "local models aren't ready"); <60% triggers a pivot evaluation.
- **Source**: `scripts/measure-stability.mjs` parsing `.minsky/iterations.jsonl` (the iteration ledger).

## Integration test

`test/contract/local-models-default.test.ts`:

1. Mock a fresh install — empty `~/.minsky/`, no `ANTHROPIC_API_KEY` in env.
2. Run the install runbook against a temp fixture repo.
3. Assert `~/.minsky/config.json` is populated with `cloud_agent: "openhands"` and `cloud_agent_model` matches the canonical local-model default.
4. Assert no cloud-key field appears in the config.
5. Spawn one stubbed iteration and assert the OpenHands shim is invoked with `--base-url`, `--reasoning-effort=none`, `--no-extended-thinking` (proof the local-model auto-detect path fired).
6. Run `minsky doctor` and assert exit 0 (no cloud key absent ≠ doctor failure).

## Proof

- PR #786 verified the live-spawn path against `ollama_chat/qwen3-coder:30b` end-to-end with reproducible file edits (envelope: `{"agent":"openhands","sdk_version":"1.7.0","files_changed":1,"diff_bytes":20,"ok":true}`).
- `novel/cross-repo-runner/bin/minsky-run.mjs` auto-detects local-model prefixes at the spawn-config-builder layer.
- `novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py` accepts `--base-url`, `--reasoning-effort`, `--no-extended-thinking` flags; tested live against Ollama.
- `docs/configuration.md` documents the local-model setup as the first-class path (not a fallback).
- The operator's directive from 2026-05-24 chat session (preserved in `docs/validated-learnings.md` under `operator-vision-2026-05-22-canonical`): "For now until we're super stable we'll rely on local models instead of getting an anthropic key."

## Failure modes & chaos verification

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Daemon silently upgrades to cloud when it detects `ANTHROPIC_API_KEY` in env | A future PR adds "if env has cloud key, switch model" auto-router | `circuit-break-and-notify` — the contract test (above) catches the divergence; the install path is forbidden from reading cloud keys at install time | `test/contract/local-models-default.test.ts` |
| Operator's local model is unavailable (Ollama server down) | Ollama crashed or wasn't started | `loud-crash-supervisor-restart` — OpenHands shim exits with a "connection refused" envelope; `minsky doctor` shows the issue with a copy-paste-able fix | already covered by `minsky doctor`'s Ollama-reachability check (slice of `minsky-fresh-clone-health-checks`) |
| Cloud-A/B benchmark accidentally becomes the default | A future PR makes the A/B comparison harness load-bearing on the main loop | `circuit-break-and-notify` — the A/B harness must run in isolation; the daemon's main loop never blocks on it | covered by `openhands-vs-claude-m110-corpus-live-ab` task scoping |
| Stability gate trips but the banner never shows | `scripts/measure-stability.mjs` has a bug; the gate-lifted event never fires | `graceful-degrade` — the stance stays active (safe default); a P1 scout task is filed to fix the gate measurement | covered by gate-measurement script's own test |
| Stability stays below 60% long-term (local models are *worse*, not the same) | Iteration ledger shows local-models cleanly-exiting fewer than 60% of the time | `loud-crash-supervisor-restart` — rule #15 milestone-alignment gate fires; the operator must decide whether to keep the stance | rule #15 PR-gate (`scripts/check-rule-15-milestone-alignment.mjs`) |

**Blast radius**: bounded to the daemon's main loop. Operators who explicitly opt into a cloud model are unaffected.

**Operator escape hatch**: edit `~/.minsky/config.json` to set `cloud_agent_model` to a cloud-model string (e.g., `anthropic/claude-3-5-sonnet-latest`) and set `ANTHROPIC_API_KEY` in the daemon's env. Documented in `docs/configuration.md`.

## Pre-registered umbrella experiment

`experiments/local-models-until-stable-2026-05-24.yaml`:

```yaml
id: local-models-until-stable
hypothesis: "While the daemon's clean-exit fraction is below 90% trailing-7d,
  forcing every iteration through a local model produces higher net throughput
  than a cloud-model default would, because (a) no cloud-key acquisition
  friction blocks operators, (b) no per-iteration cloud cost forces a
  budget-guard pause, (c) local-model failure modes are deterministic and
  the daemon's own M1.1 stability work fixes them. Once clean-exit ≥90%,
  the stance becomes advisory and a cloud A/B is the next step."
success_threshold:
  - local_models_default_clean_exit_fraction: 0.60  # keep-active floor
  - operator_install_friction_minutes: 5  # from clone to first PR, no cloud key
pivot:
  if: "local_models_default_clean_exit_fraction stays below 0.60 for 14
       consecutive days AND the M1.1 stability work has shipped"
  then: "the stance is wrong — local models genuinely aren't ready;
         re-evaluate cloud-default with documented reasoning in validated-learnings"
measurement:
  - "scripts/measure-stability.mjs --days=7 --threshold=0.90"  # gate-lift
  - "scripts/measure-stability.mjs --days=7 --threshold=0.60"  # keep-active
anchor: "Beck, K. — Extreme Programming Explained, 2nd ed., Addison-Wesley
  2004 — 'do the simplest thing that could possibly work' applied at the
  runtime-default level: local-first defaults remove cloud-key friction
  from the install path, which is the simplest thing that works for an
  operator with no cloud key."
```

## Notes

- This story records a *strategic stance*, not a feature. The feature is "local-models work" (already shipped in PR #786). The stance is "local-models are the default until stability gates lift it."
- Pairs with story 014 (launcher-agnostic feature parity): because the runtime defaults to local, the launcher even less determines runtime behavior — there's no cloud-key environment variable for a launcher to leak.
- Pairs with story 008 (per-task backend and personas): the per-task backend selection still works; this story doesn't restrict it. It just sets the default to local.
- Filed alongside the P1 task `local-models-stability-gate-90-percent` (TASKS.md) which carries the gate-measurement implementation.
- When the gate lifts, file a follow-up: `cloud-model-ab-flip-evaluation` — runs the full M1.10 corpus A/B (cloud vs. local) and produces a `validated-learnings` entry the operator approves or rejects.
