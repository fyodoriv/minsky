# Competitor: Devin (Cognition)

> Cognition's cloud coding agent — used by Minsky as a `cloud_agent` backend; also a primary direct competitor.

- **URL**: <https://devin.ai>
- **Status**: Active, Devin 2.0, 67% PR merge rate on defined tasks (morphllm.com 2026 benchmark)
- **Pricing**: Pro $20/mo, Max $200/mo, Teams $80/mo/seat, Enterprise custom
- **Relationship**: **Integration** — minsky uses Devin CLI as a cloud agent (`cloud_agent: "devin"`)

## What it is

Cloud-hosted autonomous software engineer. Runs in Cognition's cloud — full IDE, terminal, browser. Parallel agents (up to 10 concurrent sessions on Pro). Interactive Planning mode. Slack/Linear/Jira integrations. Devin Review for PR review. DeepWiki for repo understanding.

## Strengths

- **Polished UX** — cloud-hosted, zero local setup, web-based IDE
- **Interactive Planning** — Devin shows its plan before executing, operator can adjust
- **Parallel sessions** — up to 10 concurrent agents on Pro
- **Enterprise integrations** — Slack, Linear, Jira, GitHub/GitLab/Bitbucket native
- **Price dropped** — from $500/mo to $20/mo (Pro), democratized access
- **Fine-tuning** — enterprise customers can fine-tune Devin on their codebase patterns
- **67% PR merge rate** on defined tasks (third-party benchmark)

## Weaknesses vs minsky's vision

1. **Cloud-only** — code runs on Cognition's servers. No self-hosting, no air-gapped environments, no local models. Privacy-sensitive orgs can't use it.
2. **No 24/7 daemon mode** — Devin runs tasks on-demand, not as a persistent supervisor. No overnight unattended loop, no budget management, no automatic restart.
3. **No self-improvement** — no MAPE-K loop, no autonomous prompt optimization. Devin gets better when Cognition ships updates, not when it runs on your repo.
4. **Vendor lock-in** — proprietary, closed-source. If Cognition raises prices or shuts down, your workflow dies.
5. **No multi-agent orchestration** — Devin is a single agent (with parallel instances). No brain+workers architecture, no model routing.
6. **No competitive benchmarking** — Devin doesn't measure itself against competitors in your context.

## What we learn / steal

- **Interactive Planning** — minsky should show the plan before spawning (partially done via experiment YAML)
- **PR merge rate as a metric** — the 67% number is exactly the kind of metric minsky's scorecard should track
- **Price transparency** — Devin shows pricing upfront; minsky's cost-tier picker follows this pattern
- **Parallel sessions** — minsky's multi-worker architecture achieves this differently (local processes, not cloud VMs)

## Why a user would choose minsky over Devin

- Self-hosted, private, works offline with local models
- 24/7 daemon mode with budget management
- Multi-agent orchestration (brain + workers)
- Open source (MIT) — no vendor lock-in
- Self-improving (MAPE-K loop)
- Cheaper for heavy use ($0 on local models)

## Why a user would choose Devin over minsky

- Zero setup — sign up and start
- More polished UX for interactive work
- Enterprise integrations (Slack, Jira) built-in
- Fine-tuning support
- Better for teams who want managed infrastructure

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

The Minsky scorecard uses these dated, cited numbers for Devin. Update
this section whenever the corpus reading is updated; the `asOf` field
in the corpus must match the date here.

| Metric                              | Value | Date       | Primary source                                                                                                                                                                                                  |
| ----------------------------------- | ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous-merge-rate`             | 0.67  | 2026-04-07 | Cognition Labs, *2025 Annual Performance Review*, cognition.ai (real-world PR merge rate across thousands of customer codebases); cross-referenced AgentMarketCap, *Devin's 67% PR Merge Rate*, 2026-04-07.    |
| `human-intervention-rate`           | 0.33  | 2026-04-07 | Inverse of autonomous-merge-rate per the same source (the 33% of PRs that don't merge without significant rework).                                                                                              |
| `swe-bench-verified-resolve-rate`   | 0.139 | 2024-03-12 | Cognition Labs, *Introducing Devin*, cognition.ai, 2024-03-12 (original SWE-bench end-to-end resolve rate at launch). Note: Devin has not published a Verified-split-specific number since the original launch. |
| `mean-autonomous-merge-latency`     | 900 s | 2026-04-07 | AgentMarketCap, *Devin Doubled Its PR Merge Rate to 67%*, 2026-04-07 — 1 ACU ≈ 15 min Devin work, ~1 ACU per typical PR. 900 sec is the order-of-magnitude estimate, not a per-PR measurement.                  |

## Should we wrap Devin instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: ALREADY PARTIALLY WRAPPED at the right layer.** Further wrap kills moat #2 (operator-machine identity). Don't file a P0.

**Current state**: Devin IS already a Minsky backend option — `cloud_agent: "devin"` in `~/.minsky/config.json` (see `AGENTS.md` § "Per-machine agent config"). Per-task, Minsky's daemon spawns `devin` CLI which talks to Cognition Cloud + the Devbox sandbox; PRs come back to the operator's machine via the operator's `gh` credentials. This is the per-task wrap — the right shape — and ships today.

**The further-wrap question**: should Minsky delegate the FLEET LAYER too? I.e., submit all N repos' tasks to Cognition's API, let Devin's session-management run the cross-repo fleet, and have Minsky shrink to a thin operator-identity layer?

**Answer: NO** — net moat after this wrap is ≤4 of 6 because Cognition's session-management runs in Cognition Cloud, which:

1. **Kills moat #2 (operator-machine identity)** — Devin's whole architecture is Brain (on Cognition's servers) + Devbox (Cognition-provisioned sandbox). Commits originate from a Cognition identity (`devin-ai-integration[bot]`), NOT the operator. This is the loudest Minsky moat per `competitors/README.md` § "What Minsky uniquely does"; losing it collapses the differentiation story.
2. **Kills moat #1 (daemon-not-framework)** — if Cognition Cloud is the daemon, Minsky is just a wrapper around their API. The "operator attaches and walks away" framing only works if the daemon runs on the operator's machine.
3. **Kills moat #5 (cross-repo fleet at operator scale)** — Cognition manages the session lifecycle, not Minsky. We lose the launchd/systemd outer supervisor, the dynamic watchdog, the per-host round-robin.

The current PARTIAL wrap (per-task Devin, fleet-layer Minsky) preserves all 6 moats. The further wrap (fleet-layer Devin too) collapses 3 of them. The math is clear.

**What does change the answer**: if Cognition releases a self-hostable "Devin in your VPC" variant where the Brain runs on the operator's infrastructure (Cognition has hinted at enterprise-VPC deployment but it's not generally available), the operator-machine-identity argument weakens. At that point re-evaluate. Tracked indirectly by `enterprise-deployment-readiness-audit` in TASKS.md (which surfaces both Minsky's enterprise gap AND Devin's enterprise architecture for comparison).

**What gets re-evaluated periodically**: Minsky's `cloud_agent: "devin"` integration today is blocked by `spawn-failed-exit-minus-one-silent-empty-stderr` (P0 in TASKS.md). When that ships, Devin's per-task wrap will be fully functional + the comparison sharpens.

## Last reviewed

2026-05-22; 2026-05-22 wrap-feasibility analysis added per rule #1 + operator directive — verdict: per-task wrap already shipping (correct shape), fleet-layer wrap rejected (collapses 3/6 moats).
