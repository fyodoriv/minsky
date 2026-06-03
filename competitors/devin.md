# Competitor: Devin (Cognition)

> Cognition's cloud coding agent — used by Minsky as a `cloud_agent` backend, and also a direct competitor.

- **URL**: <https://devin.ai>
- **Status**: Active, Devin 2.0, 67% PR merge rate on defined tasks (morphllm.com 2026 benchmark)
- **Pricing**: Pro $20/mo, Max $200/mo, Teams $80/mo/seat, Enterprise custom
- **Relationship**: **Integration** — Minsky drives the Devin CLI as one of its coding assistants (`cloud_agent: "devin"`)

## What this is

Devin is a cloud-hosted coding assistant. You hand it a task and it does the work on Cognition's servers, using a full editor, terminal, and browser it runs there.

A few things set it apart:

- It can run several agents at once — up to 10 concurrent sessions on the Pro plan.
- It has an Interactive Planning mode: it shows you its plan before it starts, so you can adjust.
- It connects to Slack, Linear, and Jira out of the box.
- It includes Devin Review (for reviewing pull requests) and DeepWiki (for understanding a repository).

To keep one term clear up front: an *agent* here means the coding assistant that does the actual work. Minsky is not an agent — Minsky is the background program that drives agents like Devin.

## What this is not

- **Not running as you.** Devin works on Cognition's servers under its own identity, so its commits land under a Cognition bot. Minsky runs on your own machine, as you, so its commits land under your name. This is what we call *operator-machine identity* — the work shows up under the human who runs it.
- **Not a stand-in for Minsky.** Minsky uses Devin as one of its coding assistants (`cloud_agent: "devin"`). Minsky's loop calls Devin to do a task; it does not race Devin turn-for-turn.
- **Not the discipline layer.** Devin has no `TASKS.md` (the plain-text to-do list Minsky reads to pick work), no constitutional CI lints (the numbered project rules Minsky enforces automatically), and no pre-registered-experiment harness. That discipline layer is what Minsky adds on top.

## Strengths

- **Polished UX** — cloud-hosted, zero local setup, web-based editor.
- **Interactive Planning** — Devin shows its plan before executing; you can adjust it.
- **Parallel sessions** — up to 10 concurrent agents on Pro.
- **Enterprise integrations** — Slack, Linear, Jira, and native GitHub/GitLab/Bitbucket.
- **Price dropped** — from $500/mo to $20/mo (Pro), opening up access.
- **Fine-tuning** — enterprise customers can fine-tune Devin on their own codebase patterns.
- **67% PR merge rate** on defined tasks (third-party benchmark).

## Weaknesses vs Minsky's vision

1. **Cloud-only.** Your code runs on Cognition's servers. There is no self-hosting, no air-gapped setup, and no local models. Privacy-sensitive teams cannot use it.
2. **No around-the-clock background mode.** Devin runs tasks on demand. It is not a *daemon* — a background program that keeps running on your machine after you start it, survives the terminal closing, and restarts on crash. So there is no overnight unattended loop, no budget management, no automatic restart.
3. **No self-improvement.** Devin has no loop that studies its own results and adjusts. It gets better when Cognition ships an update, not when it runs on your repository. (Minsky calls its self-improvement loop the MAPE-K loop — Monitor, Analyze, Plan, Execute over a Knowledge base.)
4. **Vendor lock-in.** It is proprietary and closed-source. If Cognition raises prices or shuts down, your workflow dies.
5. **No multi-agent orchestration.** Devin is a single agent that can run parallel copies of itself. There is no brain-plus-workers split and no routing between different models.
6. **No competitive benchmarking.** Devin does not measure itself against rivals in your own context.

## What we learn / steal

- **Interactive Planning** — Minsky should show its plan before it starts an agent. This is partly done today through its experiment YAML.
- **PR merge rate as a metric** — the 67% number is exactly the kind of metric Minsky's scorecard should track. (A *scorecard* is Minsky's dated, cited table of competitor benchmark numbers.)
- **Price transparency** — Devin shows pricing upfront; Minsky's cost-tier picker follows the same pattern.
- **Parallel sessions** — Minsky's multi-worker setup reaches the same goal a different way: local processes, not cloud machines.

## Why a user would choose Minsky over Devin

- Self-hosted and private; works offline with local models.
- Runs around the clock as a daemon, with budget management.
- Multi-agent orchestration (a brain plus workers).
- Open source (MIT) — no vendor lock-in.
- Self-improving (the MAPE-K loop).
- Cheaper for heavy use ($0 on local models).

## Why a user would choose Devin over Minsky

- Zero setup — sign up and start.
- More polished UX for interactive work.
- Built-in enterprise integrations (Slack, Jira).
- Fine-tuning support.
- Better for teams who want managed infrastructure.

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

**Current state**: Devin IS already a Minsky backend option — `cloud_agent: "devin"` in `~/.minsky/config.json` (see `AGENTS.md` § "Per-machine agent config"). Per task, Minsky's daemon starts the `devin` CLI, which talks to Cognition Cloud and the Devbox sandbox; the pull request comes back to your machine through your own `gh` credentials. This is the per-task wrap — the right shape — and it ships today.

**The further-wrap question**: should Minsky hand off the *fleet layer* too? That is, submit every repository's tasks to Cognition's API, let Devin manage the sessions across all your repositories, and shrink Minsky down to a thin layer that only supplies your identity? ("Fleet" means Minsky walking several repositories in turn.)

**Answer: NO** — net moat after this wrap is ≤4 of 6, because Cognition's session-management runs in Cognition Cloud, which:

1. **Kills moat #2 (operator-machine identity)** — Devin's whole architecture is a Brain (on Cognition's servers) plus a Devbox (a Cognition-provisioned sandbox). Commits originate from a Cognition identity (`devin-ai-integration[bot]`), NOT the operator. This is the loudest Minsky moat per `competitors/README.md` § "What Minsky uniquely does"; losing it collapses the differentiation story.
2. **Kills moat #1 (daemon-not-framework)** — if Cognition Cloud is the daemon, Minsky is just a wrapper around their API. The "attach Minsky and walk away" framing only works if the daemon runs on your own machine.
3. **Kills moat #5 (cross-repo fleet at operator scale)** — Cognition would manage the session lifecycle, not Minsky. We would lose the launchd/systemd outer supervisor, the dynamic watchdog, and the per-host round-robin. (The *supervisor* is the outer watchdog — systemd on Linux, launchd on macOS — that restarts Minsky if it dies.)

The current PARTIAL wrap (per-task Devin, fleet-layer Minsky) preserves all 6 moats. The further wrap (fleet-layer Devin too) collapses 3 of them. The math is clear.

**What does change the answer**: if Cognition releases a self-hostable "Devin in your VPC" variant, where the Brain runs on your own infrastructure (Cognition has hinted at enterprise-VPC deployment, but it's not generally available), the operator-machine-identity argument weakens. At that point, re-evaluate. Tracked indirectly by `enterprise-deployment-readiness-audit` in TASKS.md, which surfaces both Minsky's enterprise gap and Devin's enterprise architecture for comparison.

**What gets re-evaluated periodically**: Minsky's `cloud_agent: "devin"` integration is blocked today by `spawn-failed-exit-minus-one-silent-empty-stderr` (P0 in TASKS.md). When that ships, Devin's per-task wrap will be fully functional and the comparison sharpens.

## Five pivot questions

> Applied per the Five Pivot Questions framework (`.claude/skills/competitor-research` § Phase 7, `--deep` mode). Question 5 is structurally N/A for Devin — it is closed-commercial, so "replacing part of Minsky with Devin" means *wrapping a paid API*, not adopting source; that question collapses into the wrap-feasibility analysis above and is reframed accordingly.

### 1. How is it different from Minsky?

Devin is a **cloud-hosted, vendor-managed, single-agent-with-parallel-instances** product. Its Brain and Devbox both run on Cognition's servers, and it commits under a Cognition bot identity (`devin-ai-integration[bot]`). Minsky is an **operator-machine daemon**: it wraps swappable coding assistants (Devin among them), runs an unattended cross-repo fleet, and commits under your own `gh` identity. The intent differs even more than the surface. Cognition sells a *finished autonomous engineer* you rent per-ACU. Minsky is an *integration distribution* that connects existing tools (Devin included) into a self-improving system you own. Cite: Cognition's product framing on <https://devin.ai> and the ACU pricing model; Minsky's `vision.md § What Minsky is` (daemon-not-framework, operator-machine identity).

### 2. What lessons can it give to us?

- **2.1 The headline number is benchmark-inflated — measure the real-world gap, not the leaderboard.** Devin's *launch* SWE-bench end-to-end resolve rate was 13.9% (Cognition, *Introducing Devin*, 2024-03-12), yet the marketed "AI software engineer" framing implied far more. The most-cited real-world counter-reading is Answer.AI's hands-on report, which found Devin completed only **3 of 20** tasks (~15%) in their evaluation (Answer.AI, *Thoughts on a Month with Devin*, 2025-01; widely discussed on Hacker News). Even the favourable 2026 third-party number — **67% PR merge rate on *defined* tasks** (Cognition's 2025 annual review, cross-referenced by AgentMarketCap 2026-04-07) — is explicitly scoped to *defined* tasks, meaning the task-shaping is doing heavy lifting. Lesson: Minsky's scorecard must record the *methodology scope* next to the number (it already does, in the `Primary source` column) and must never quote a competitor's best number without that qualifier. Traces to rule #4 (everything visible — no fabricated or context-stripped readings) and rule #9 (pre-registered hypothesis-driven development — falsifiable metrics, not vanity headlines). This is the field's canonical "marketing-vs-reality gap": OpenAI's own SWE-bench Verified work (Feb 2025) exists *because* the original SWE-bench was found to contain unsolvable and underspecified instances that inflated scores — which validates the "leaderboard ≠ capability" thesis.
- **2.2 "What makes a Devin task succeed vs fail" is the transferable pattern — pre-shape the task.** The 13.9% → 67% spread is not Devin getting 5× smarter; it is the difference between *open-ended* tasks and *defined* tasks. Devin's own Interactive Planning mode exists to turn the former into the latter before execution. Lesson for Minsky: success correlates with task pre-shaping, not raw model capability. Minsky already encodes this — `task-spec`/`task-slice` (vertical-slice decomposition plus Given/When/Then acceptance scenarios, rule #3a) and the `**Touches**:` blast-radius field are the "define the task before the agent touches it" discipline. The Devin data is empirical support for keeping those gates iron: a well-shaped TASKS.md block is the single biggest lever on merge rate, dwarfing the choice of coding assistant. Traces to rule #3 (test-first/spec-first) and the independent-testability gate.
- **2.3 Per-ACU cost transparency is a metric, not just a price tag.** Devin meters work in ACUs (≈15 min of Devin work each) and surfaces cost upfront. Minsky's corpus already tracks `cost-per-merged-pr` and `mean-autonomous-merge-latency` (900s ≈ 1 ACU for Devin). Lesson: keep cost a first-class *scorecard* dimension, so you can compare "Devin per merged PR" against "Claude-on-local per merged PR" — the cost axis is where the self-hosted moat shows up as a number. Traces to rule #4.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons sit *on top of* Minsky's existing architecture and reinforce existing rules rather than threatening any of the 17. The benchmark-inflation lesson (§2.1) strengthens rule #4 and rule #9; the task-shaping lesson (§2.2) strengthens rule #3/#3a and the `**Touches**:` discipline; the cost-transparency lesson (§2.3) strengthens rule #4. None forces a rewrite of `vision.md § What Minsky is`, and none invalidates a rule. The one place Devin *could* threaten the vision — if Cognition shipped a self-hostable "Devin in your VPC" Brain — is already captured in the wrap-feasibility analysis above as the explicit re-evaluation trigger, and it remains hypothetical (not generally available as of this review). Because no finding is vision-changing, no `ask-human.md` Q-block is required; this negative finding is recorded here for audit per the framework's "state the negative finding so it is auditable" rule. (The orchestrator owns `ask-human.md` for this task batch; were a real vision-threat to surface, it would be filed there as a Q-block, not inline.)

### 4. How can we improve our strategy based on this?

- **Publish the honesty comparison.** Position Minsky's competitive page around *methodology-qualified* numbers — "Devin's 67% is on *defined* tasks; its open-ended real-world rate is ~15% (Answer.AI)" — turning the benchmark-inflation gap into a trust differentiator rather than competing on the raw headline. Traces to lesson §2.1.
- **Double down on task pre-shaping as the merge-rate lever.** Treat `task-spec`/`task-slice`/`**Touches**:` as the highest-ROI investment for merge rate, backed by Devin's 13.9%→67% defined-vs-open spread — invest in the *task surface*, not in chasing a marginally-better coding assistant. Traces to lesson §2.2.
- **Keep cost a measured axis, not a footnote.** Maintain `cost-per-merged-pr` and `mean-autonomous-merge-latency` as standing scorecard metrics, so the self-hosted economic advantage is a number you can read, not a claim. Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

Structurally **N/A as source-adoption** (Devin is closed-commercial — there is no source to absorb), so this question reduces to the wrap-feasibility analysis above. Restated per Minsky surface, for completeness:

- **agent backend**: ALREADY-WRAPPED — Devin is a per-task `cloud_agent: "devin"` backend today. Correct shape; no further cut available.
- **tick-loop / fleet / queue**: KEEP — handing the fleet layer to Cognition Cloud collapses moats #1, #2, #5 (see wrap analysis). Do NOT replace.
- **MAPE-K / self-improvement**: KEEP — Devin has no across-session experiment store; nothing to absorb.
- **constitution-as-CI**: KEEP — Devin relies on Cognition's internal QA, not a 17-rule operator-side gate.
- **corpus / scorecard**: KEEP + REFRESH — Devin stays a cited corpus entry; the lesson is to keep the methodology qualifier on every reading.
- **identity / TASKS.md surface**: KEEP — operator-machine identity is moat #2; Devin's bot identity is the thing we deliberately do not adopt.

**Total replace % across all surfaces: 0% replacement; 1 ALREADY-WRAPPED (the agent backend, at the correct per-task layer).** Headline for the operator: *nothing further to cut — Devin is already wrapped at the right (per-task) layer; the strategic value of this deep-dive is the honesty framing (its headline 67% is benchmark-inflated relative to the ~15% open-ended real-world rate) and the empirical confirmation that task pre-shaping, not backend choice, is the merge-rate lever.*

## Last reviewed

2026-06-02 — added `## Five pivot questions` (Five Pivot Questions framework, `--deep` mode) per task `competitor-deepen-devin`. Verdict: ALREADY-WRAPPED at the per-task layer (no further cut); 0% additional replacement; no vision-changing finding. Key framing extracted: Devin's headline 67%-PR-merge number is benchmark-inflated — scoped to *defined* tasks against a launch SWE-bench resolve rate of 13.9% and a ~15% open-ended real-world rate (Answer.AI). Lesson: task pre-shaping (rule #3a + `**Touches**:`) is the dominant merge-rate lever, not backend choice.

Earlier reviews: 2026-05-22 (wrap-feasibility analysis added per rule #1 + operator directive — verdict: per-task wrap already shipping (correct shape), fleet-layer wrap rejected (collapses 3/6 moats)).
