# Strategic Model Router

<!-- scope: human-approved slice 8 of `claude-usage-aware-strategic-model-router` (P0 task in TASKS.md, parent merged via PR #420; this file is the operator-facing routing matrix the parent's slice-8 cell calls for). -->

Operator-facing reference for Minsky's per-iteration model picker.

## TL;DR

Minsky picks the highest-quality Claude model whose remaining-usage fits the iteration's expected wall-time. When all Claude tiers exhaust, Minsky routes to the local stack. The picker is **on by default** as of 2026-05-10.

```text
remaining 5h ≥ 50%  → claude-opus-4-7
remaining 5h ∈ [30%, 50%) → claude-sonnet-4-6
remaining 5h < 30% → local
```

Same gating per-window for weekly + monthly. The most restrictive window wins.

## Why no Haiku

Local Qwen3.6-27B Dense matches Claude 4.5 Opus on Terminal-Bench 2.0 (59.3 vs 59.3) and scores 77.2 on SWE-bench Verified — both higher than Haiku 4.5 on agentic-coding benchmarks. Qwen3-14B (~64% SWE-bench Verified) also outperforms Haiku on the workloads Minsky cares about. Routing to Haiku when budget can't afford Sonnet is strictly worse than routing to local.

The `MODEL_CATALOG` therefore has 3 tiers, not 4. Re-add Haiku at `qualityTier 3` if a future Haiku release closes the coding-benchmark gap (≤2pp delta on SWE-bench Verified) — that's the documented pivot threshold.

## How it works

Each iteration:

1. Bin reads `realGuard.lastDecision()` (the most-recent BudgetGuard tick).
2. Computes `remainingFractions(snapshot)` — `{fivehour, weekly, monthly, observedAt}` triple.
3. Calls `pickStrategicModel({remaining, catalog: MODEL_CATALOG, hysteresis, operatorPin})` (pure function).
4. Threads `--model <id>` to `claude --print` when `agent === "claude"`; routes through the local strategy when `agent === "local"`.
5. Emits `tick-loop.strategic-pick` span with the decision + reasoning + per-window remaining + history size + per-window predicted exhaustion ms.

The picker walks the catalog ascending by `qualityTier`. First entry whose floors fit ALL three windows wins. Hysteresis (default ±5pp) prevents thrash near boundaries.

## Configuration

Three env vars cover most operator needs.

### Default-on / opt-out

| Env var | Default | Effect |
|---|---|---|
| `MINSKY_STRATEGIC_ROUTER` | **`1` (on)** | `0` or `false` disables. Any other value (or unset) enables. |

### Operator pin (escape hatch)

```bash
MINSKY_STRATEGIC_PIN_MODEL=claude-sonnet-4-6 pnpm minsky
```

Bypasses the catalog walk; every iteration uses Sonnet regardless of remaining usage. Operator's literal pin always wins. Hard overrides (`forceClaude` / `preferLocal` / `circuit-break`) still upstream-gate it.

### Refresh cadence

```bash
MINSKY_USAGE_REFRESH_INTERVAL_MS=30000 pnpm minsky    # default 30s
MINSKY_USAGE_REFRESH_INTERVAL_MS=5000  pnpm minsky    # hot-iteration day
MINSKY_USAGE_REFRESH_INTERVAL_MS=300000 pnpm minsky   # idle day
```

Tighter cadence → fresher remaining-% → picker reacts faster to external claude usage. The `MaciekTokenMonitor` walks `~/.claude/projects/<cwd>/<session>.jsonl` recursively, so any claude session on the machine (including ones you run directly outside Minsky) is reflected.

## Model catalog (May 2026)

| Tier | Model | Agent | $ in/out per Mtok | 5h floor | weekly floor | monthly floor |
|---|---|---|---|---|---|---|
| 1 | `claude-opus-4-7` | claude | $15 / $75 | 50% | 30% | 20% |
| 2 | `claude-sonnet-4-6` | claude | $3 / $15 | 30% | 20% | 15% |
| 3 | `local` | local | $0 / $0 | 0% | 0% | 0% |

Recency-anchored to 2026-05-10. Quarterly refresh process via `scripts/local-model-leaderboard.mjs --refresh` (filed as P1 #daemon-local-model-self-tune slice 1).

Operators on different plans (Pro / Max5 / Max20) can override floors per-tier via env in a future slice; v0 assumes Max20 economics.

## Observability

Every iteration emits a `tick-loop.strategic-pick` span:

```json
{
  "model":"claude-opus-4-7",
  "agent":"claude",
  "kind":"strategic-router",
  "reason":"strategic-router: tier-1 claude-opus-4-7 qualifies (remaining: 5h=0.95 ≥ 0.5, weekly=0.82 ≥ 0.3, monthly=0.88 ≥ 0.2)",
  "fivehour":0.950,
  "weekly":0.820,
  "monthly":0.880,
  "history_size":42,
  "exhaustion_ms_5h":null,
  "exhaustion_ms_weekly":null,
  "exhaustion_ms_monthly":null
}
```

`kind` is one of:

- `strategic-router` — picker walked the catalog and found a fitting tier.
- `hysteresis` — picker stuck with the previous pick because the candidate's gating-window remaining is within ±5pp of its floor.
- `operator-pin` — `MINSKY_STRATEGIC_PIN_MODEL` was honored.
- `fallback` — no tier qualified; lowest-tier (local) returned.

`exhaustion_ms_*` is `null` until the ring buffer has ≥2 entries with a monotone-decreasing trend; then it's the linear-regression extrapolated wall-clock ms until that window reaches 0.

Grep the supervisor log:

```bash
tail -F .minsky/workers/*.log | grep strategic-pick
```

## Composition

Strategic router composes with three other substrates:

- **`claude-orchestrator-local-worker-fanout`** — workers in worktrees use the same picker per-iteration; each worker's role can dictate a different operator pin (e.g., orchestrator → Opus, workers → local).
- **`support-opencode-lmstudio-mlx-qwen3-14b-stack`** — the `agent: "local"` row routes through whichever local stack the operator has configured (aider+mlx_lm.server OR opencode+LM-Studio).
- **`worker-model-per-machine-config`** — per-machine env vars / config files override the picker's `--model` thread when set; the picker is advisory.

## What's not yet built

- **Slice 7** — chaos invariants in `self-diagnose.mjs` (3 new probes) + dashboard tile + `minsky doctor` extension. Filed; not yet implemented.
- **Persistence** — the ring buffer is in-memory only. Slice 6.5 ratchet will persist to `.minsky/state.json` so trajectory survives daemon restart.
- **Per-tier-floor overrides via env** — operators can't yet set `MINSKY_STRATEGIC_FLOOR_OPUS_FIVEHOUR=0.3` to relax floors. Filed as a follow-up.

## See also

- [`@minsky/budget-guard` README](../novel/budget-guard/README.md) — `BudgetGuard.snapshotRemainingPercents()` is the picker's input.
- [`@minsky/token-monitor` README](../novel/adapters/token-monitor/README.md) — `MaciekTokenMonitor` is the snapshot source; it tracks ALL claude usage on the machine.
- [`novel/tick-loop/README.md`](../novel/tick-loop/README.md) — bin-side env-var reference + the full daemon docs.
- TASKS.md `claude-usage-aware-strategic-model-router` — the parent task block with the full 8-slice plan and recency-checked anchors.
