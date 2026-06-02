# Competitor: MetaGPT

> Foundation-Agents' multi-role coding-agent framework — closest conceptual match, but Python-stacked and not 24/7-aligned.

- **URL**: <https://github.com/FoundationAgents/MetaGPT>
- **Paper**: ICLR 2024 — "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"
- **Status**: Active, large adoption
- **Relationship**: **Competitor** — closest conceptual match, but wrong stack

## What it is

A Python framework that simulates a "software company" of LLM agents: Product Manager, Architect, Project Manager, Engineer, QA. Takes a one-line requirement and outputs user stories, competitive analysis, requirements, data structures, APIs, and code. Tagline: "Code = SOP(Team)" — the system materializes Standard Operating Procedures and applies them to teams of LLMs.

## Strengths

- **Most direct conceptual analog** to Minsky's persona-driven philosophy
- **Roles already match** — PM/Architect/Engineer/QA/etc. mirror what we'd want
- **Battle-tested** — academic paper, large GitHub adoption, real production usage
- **One-line requirement → full project** — proves the autonomous-team paradigm works
- **Open source** — MIT-style licensing

## Gaps (why we don't use it as substrate)

1. **Wrong stack.** Python framework around generic GPT models. Minsky is Claude Code-native by design — to use Max subscription economy, OMC's persona system, native MCP and OTEL, the whole Anthropic ecosystem.
2. **No 24/7 viability framing.** MetaGPT is request-response: requirement in, project out. No long-running supervisor, no token-budget homeostasis, no mid-session pause/resume.
3. **No self-improvement loop.** Roles are static prompts; no metacognitive layer that observes performance and rewrites agent prompts over time.
4. **No constitutional grounding.** No vision-document layer; behavior drift is undetected.
5. **Heavy framework, not substrate.** MetaGPT owns the runtime; you build inside it. Minsky is the opposite — substrate-first, integrating tools others maintain.
6. **No mobile/Watch/remote** for solo developers running things on personal hardware.
7. **No tasks.md compatibility** — its task representation is internal Python objects.

## What we extract or learn

- **Role taxonomy** — MetaGPT's PM/Architect/Engineer/QA mapping is near-canonical; cross-check against OMC's 32 agents to find gaps
- **SOP framing** — "Code = SOP(Team)" is a useful aphorism for the human-readable task description discipline
- **Competitive analysis output** — MetaGPT auto-generates competitor analysis as part of project bootstrap; consider whether our `competitors/` folder generation could be agent-assisted
- **Validation that the persona-driven paradigm works** — reduces our risk by ~one academic paper

## Why we don't just use it

Stack incompatibility is fatal. We'd lose:

- Claude Code Max economy (MetaGPT bills per token via API)
- OMC's 32-agent maturity
- Native MCP and OTEL
- The tasks.md substrate

Adopting MetaGPT would mean rebuilding our orchestration, observability, and economy layers from scratch — exactly what `vision.md` principle 1 forbids.

## Pin / integration

Not a dependency. No adapter.

## Pattern conformance

- **Pattern MetaGPT implements**: Simulated software company / Standard Operating Procedure role-play across PM / Architect / Engineer / QA roles — Hong et al., "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework", *ICLR* 2024 (the primary paper) — anchored in the older organisational-design pattern of the chief-programmer team — Brooks, *The Mythical Man-Month*, Addison-Wesley, 1975, Ch. 3 ("The Surgical Team")
- **Conformance level**: full (in the pattern MetaGPT implements)
- **How Minsky relates**: don't adopt — Minsky shares the persona-driven paradigm but binds it to Claude Code via OMC (row 50) rather than to a Python+GPT runtime. The conceptual lineage is acknowledged; the substrate is incompatible.
- **Index row**: vision.md § "Pattern conformance index" row 48

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `humaneval-pass-at-1`               | 0.859 | 2024-05-07 | Hong, Zhuge, Chen, Zheng et al., "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework", arXiv 2308.00352, ICLR 2024 Oral (HumanEval Pass@1 = 85.9%, SoTA at publication; 28.2% relative improvement over GPT-4; methodology: Standardized Operating Procedure-shaped multi-agent assembly line) |

MetaGPT also published `mbpp-pass-at-1 = 0.877` in the same paper, which is tracked in the citation string but not yet promoted to a separate metric in the M1.10 catalogue. Promotion path: add `mbpp-pass-at-1` if a second orchestrator-tier competitor publishes the same metric (avoid single-source metrics per rule #9 — vanity-metrics forbidden).

### Stale-by-vendor (audited 2026-06-02, `corpus-refresh-metagpt` Pivot)

The `humaneval-pass-at-1 = 0.859` reading carries `asOf: 2024-05-07` — the freshness gate (`scripts/check-corpus-freshness.mjs`) classifies it `very-stale` (>180 days). The `corpus-refresh-metagpt` task's **Success** path asks for a publication ≤90 days old; its **Pivot** path applies when "the vendor has not published a new number in the last 365 days". A 2026-06-02 vendor-publication audit confirms the Pivot:

| Vendor publication (most recent)                | Date     | arXiv         | Refreshes the MetaGPT framework reading? |
| ----------------------------------------------- | -------- | ------------- | ---------------------------------------- |
| Atom of Thoughts (test-time scaling)            | Feb 2025 | 2502.12018    | No — test-time-scaling method, no MetaGPT-framework HumanEval/MBPP Pass@1 republished |
| Self-Supervised Prompt Optimization (SPO)       | Feb 2025 | 2502.06855    | No — prompt-optimization scaffolding, not a framework coding-benchmark headline |
| AFlow: Automating Agentic Workflow Generation   | ICLR 2025 (Jan 2025) | 2410.07869 | No — workflow-search method evaluated on HumanEval/MBPP/MATH/GSM8K/HotpotQA/DROP, not a MetaGPT-framework Pass@1 |

Both of the most recent dated publications (Feb 2025) are >365 days before this audit. Per the Pivot, the `asOf` is **not** restamped: masking the staleness with a re-stated old number is worse than acknowledging it. The reading stays at its honest 2024-05-07 date, flagged `stale-by-vendor` in `novel/competitive-benchmark/src/competitors.ts`. Re-audit when FoundationAgents publishes a new absolute coding-benchmark reading for the MetaGPT framework itself (not for a workflow/prompt-optimization sub-method). The `(AWO, arXiv:2601.22037, Feb 2026)` agentic-workflow paper surfaced during the audit is **not** a FoundationAgents publication (Abuzakuk, Kermarrec et al.) and reports only relative deltas, so it does not refresh this reading.

## Should we wrap MetaGPT instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: NO** — task-shape mismatch. Don't file a P0 wrap proposal.

MetaGPT's HumanEval Pass@1 = 0.859 (ICLR 2024 Oral) is the best published orchestrator-tier coding result in Minsky's corpus. That makes the wrap question worth asking. But the architectures don't compose for Minsky's specific job shape:

**Architectural fit**: MetaGPT is a Python framework (`pip install metagpt`) targeting **greenfield software generation** — turn a one-line product idea ("build me a snake game") into a full repo via a fixed pipeline (PM → Architect → Engineer → QA → Tester, all 5 roles assembled in sequence per the SOP-shaped *Standardized Operating Procedure* methodology). The success metric is HumanEval (function-implementation correctness from scratch).

Minsky's job shape is **brownfield maintenance** — pick a task from an existing repo's `TASKS.md`, make a targeted change on a feature branch, run the existing tests, open a PR for review. The success shape is `prs-opened` × `iteration-stability-pct`, not HumanEval.

**What MetaGPT replaces**: nothing in Minsky's current loop. MetaGPT's 5-role pipeline runs per-task; spawning it for every TASKS.md item would (a) take 5x the LLM budget per task because every task gets the full PM/Arch/Eng/QA/Test pipeline regardless of size, (b) over-spec smaller tasks (a typo fix doesn't need a PM phase), (c) lose the agent's git-awareness because MetaGPT's pipeline generates code into a fresh `workspace/` directory rather than editing the existing repo.

**What we keep if we don't wrap**: everything.

**Why we shouldn't wrap**:

1. **Wrong task shape**. Minsky tasks are "fix X in this existing repo"; MetaGPT optimises for "build X from scratch". The HumanEval result doesn't transfer to Minsky's task distribution.
2. **Per-task overhead is wrong**. 5-role pipelines optimise for greenfield where the PM phase + Architect phase add real value. Minsky's typical task ("rename function getCwd to getCurrentWorkingDirectory across 15 files") doesn't benefit from a Project Manager phase.
3. **Git-blindness**. MetaGPT writes to `workspace/<task-id>/`, not to the operator's existing repo. We'd have to bolt git-awareness on, undoing MetaGPT's clean pipeline.
4. **The valuable pattern is portable**. The thing worth borrowing is the SOP-shaped multi-agent pipeline pattern (Hong et al. 2024, "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"). That's what `multi-persona-pipeline-handoff-spec` (M2) tracks — pattern reuse, not framework wrap.

**Trigger for re-evaluation**: if MetaGPT publishes a brownfield-targeted variant (`metagpt-maintain` or similar) that operates on existing repos with a smaller per-task footprint, OR if MetaGPT's pipeline-per-task overhead drops to <2x baseline LLM cost — then re-open this analysis. Until then, MetaGPT is citation material for `multi-persona-pipeline-handoff-spec`, not wrap material for the daemon.

## Last reviewed

2026-05-23 (added to scorecard corpus via `/competitor-research` as the first orchestrator-tier competitor); 2026-05-22 wrap-feasibility analysis added per rule #1 + operator directive — verdict: wrong task shape, don't wrap; 2026-06-02 `corpus-refresh-metagpt` audit — vendor's last absolute coding-benchmark reading is ICLR-2024; subsequent FoundationAgents papers (Feb 2025) don't republish a framework Pass@1, so the entry is flagged `stale-by-vendor` and `asOf` is left honest per the task Pivot.
