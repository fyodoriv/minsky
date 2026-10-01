# Competitor: MetaGPT (Foundation-Agents)

> A Python framework that turns a one-line product idea into a whole codebase by simulating a software company of LLM agents. It is the closest match to Minsky's role-based philosophy, but it is built on a different stack and does not run around the clock.

- **URL**: <https://github.com/FoundationAgents/MetaGPT>
- **Paper**: ICLR 2024 — "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"
- **Status**: Active, large adoption
- **Pricing**: Open source (MIT-style); you pay the per-token API cost of whatever model it drives
- **Relationship**: **Competitor** — closest conceptual match, but wrong stack

## What this is

MetaGPT is a Python framework that simulates a software company staffed by LLM agents. Each agent plays a role: Product Manager, Architect, Project Manager, Engineer, QA. You hand it a one-line requirement, and it runs those roles in a fixed sequence to produce user stories, a competitive analysis, requirements, data structures, APIs, and finally code.

Its tagline is "Code = SOP(Team)". An SOP is a Standard Operating Procedure — a fixed script of steps. MetaGPT writes those steps down and applies them to a team of LLMs, so the agents follow a defined assembly line instead of chatting freely.

Throughout this file, the word "agent" means a coding assistant. Minsky drives agents; it is not one itself.

## What this is not

- **Not a long-running background program.** MetaGPT is request-response: an idea goes in, a repo comes out, and the process exits. Minsky runs as a daemon — a background program that keeps running — picking its own next task around the clock.
- **Not a brownfield maintenance tool.** MetaGPT builds new projects from scratch in a fresh `workspace/` directory. It does not edit an existing repository in place.
- **Not a self-improving system.** Its roles are static prompts. There is no layer that watches its own results and rewrites those prompts over time.
- **Not a substrate Minsky builds on.** MetaGPT owns the runtime; you write your code inside it. Minsky is the opposite: it integrates tools that other people maintain.

## Strengths

- **Most direct conceptual analog** to Minsky's persona-driven design. A persona is a role the agent takes on — researcher, planner, implementer, QA.
- **Roles already match.** Its Product Manager / Architect / Engineer / QA set mirrors the roles Minsky would want.
- **Battle-tested.** An academic paper, large GitHub adoption, and real production use.
- **One-line requirement to full project.** It proves the autonomous-team idea works end to end.
- **Open source** under an MIT-style license.

## Weaknesses vs Minsky's vision

1. **Wrong stack.** MetaGPT is a Python framework around generic GPT models. Minsky is built natively for Claude Code, so it can use the Max-subscription economy, OMC's persona system (Oh My Claude Code — a plugin that gives a Claude Code session 32 specialist personas), and native MCP (Model Context Protocol) and OpenTelemetry (OTEL) — the open standard Minsky emits for traces, metrics, and logs.
2. **No around-the-clock framing.** MetaGPT is request-response: requirement in, project out. There is no outer supervisor, no token-budget pause, and no mid-run resume.
3. **No self-improvement loop.** Roles are static prompts. There is no layer that observes performance and rewrites the agent prompts over time.
4. **No constitution.** Minsky's behavior is pinned by numbered, non-negotiable rules in `vision.md`. MetaGPT has no such layer, so behavior drift goes undetected.
5. **Heavy framework, not substrate.** MetaGPT owns the runtime; you build inside it. Minsky integrates tools others maintain.
6. **No mobile, watch, or remote surface** for a solo developer running work on personal hardware.
7. **No TASKS.md compatibility.** TASKS.md is the plain-text Markdown to-do list at a project's root that Minsky reads to pick work. MetaGPT represents tasks as internal Python objects instead.

## What we learn / steal

- **Role taxonomy.** MetaGPT's Product Manager / Architect / Engineer / QA mapping is near-canonical. Use it as a coverage checklist against OMC's 32 personas to find gaps — not as something to import.
- **SOP framing.** "Code = SOP(Team)" is a useful aphorism for the discipline of writing human-readable task descriptions.
- **Auto-generated competitive analysis.** MetaGPT emits a competitor-analysis document as part of project bootstrap. Minsky's `competitors/` corpus is hand-authored today; agent-assisted drafting of that corpus is worth considering, as long as the deterministic validation gate stays in place.
- **Validation that the persona-driven paradigm works.** This reduces Minsky's risk by roughly one academic paper.

## Why choose Minsky over MetaGPT

MetaGPT optimizes for greenfield generation — turn one idea into a fresh repo. Minsky optimizes for brownfield maintenance — pick a task from an existing repo's TASKS.md, make a targeted change on a feature branch, run the repo's own tests, and open a draft pull request for review. Minsky never stops, picks its own next task, survives process death, and refuses to merge any agent output that fails its constitutional CI gate. MetaGPT is the kind of inner-loop pipeline an orchestrator might spawn per task — not an orchestrator itself. It has no cross-repo fleet loop, no token-budget control, and no self-improvement layer.

## Why choose MetaGPT over Minsky

If your job is to spin up brand-new projects from a one-line idea, MetaGPT's fixed five-role assembly line is purpose-built for that. Its HumanEval Pass@1 of 85.9% (ICLR 2024 Oral) is the best published orchestrator-tier coding result in Minsky's corpus. For greenfield code generation from a spec, that pipeline adds real value at every role — including the Product Manager and Architect phases that Minsky's brownfield tasks would skip.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `humaneval-pass-at-1`               | 0.859 | 2024-05-07 | Hong, Zhuge, Chen, Zheng et al., "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework", arXiv 2308.00352, ICLR 2024 Oral (HumanEval Pass@1 = 85.9%, SoTA at publication; 28.2% relative improvement over GPT-4; methodology: Standardized Operating Procedure-shaped multi-agent assembly line) |

MetaGPT also published `mbpp-pass-at-1 = 0.877` in the same paper. That number is tracked in the citation string but not yet promoted to a separate metric in the M1.10 catalogue. Promotion path: add `mbpp-pass-at-1` only if a second orchestrator-tier competitor publishes the same metric — single-source metrics are forbidden under rule #9, pre-registered hypothesis-driven development, which bans vanity metrics.

### Stale-by-vendor (audited 2026-06-02, `corpus-refresh-metagpt` Pivot)

The `humaneval-pass-at-1 = 0.859` reading carries `asOf: 2024-05-07`. The freshness gate (`scripts/check-corpus-freshness.mjs`) classifies it `very-stale` (older than 180 days). The `corpus-refresh-metagpt` task's **Success** path asks for a publication 90 days old or newer; its **Pivot** path applies when "the vendor has not published a new number in the last 365 days". A 2026-06-02 vendor-publication audit confirms the Pivot:

| Vendor publication (most recent)                | Date     | arXiv         | Refreshes the MetaGPT framework reading? |
| ----------------------------------------------- | -------- | ------------- | ---------------------------------------- |
| Atom of Thoughts (test-time scaling)            | Feb 2025 | 2502.12018    | No — test-time-scaling method, no MetaGPT-framework HumanEval/MBPP Pass@1 republished |
| Self-Supervised Prompt Optimization (SPO)       | Feb 2025 | 2502.06855    | No — prompt-optimization scaffolding, not a framework coding-benchmark headline |
| AFlow: Automating Agentic Workflow Generation   | ICLR 2025 (Jan 2025) | 2410.07869 | No — workflow-search method evaluated on HumanEval/MBPP/MATH/GSM8K/HotpotQA/DROP, not a MetaGPT-framework Pass@1 |

Both most-recent dated publications (Feb 2025) are more than 365 days before this audit. Per the Pivot, the `asOf` is **not** restamped: masking the staleness with a re-stated old number is worse than acknowledging it. The reading stays at its honest 2024-05-07 date, flagged `stale-by-vendor` in `novel/competitive-benchmark/src/competitors.ts`. Re-audit when Foundation-Agents publishes a new absolute coding-benchmark reading for the MetaGPT framework itself (not for a workflow or prompt-optimization sub-method). The `(AWO, arXiv:2601.22037, Feb 2026)` agentic-workflow paper surfaced during the audit is **not** a Foundation-Agents publication (Abuzakuk, Kermarrec et al.) and reports only relative deltas, so it does not refresh this reading.

## Should we wrap MetaGPT instead?

> Per rule #1 (don't reinvent), every direct-competitor study must end with one question: if this competitor is amazing at everything we do, why not wrap it and let it run for 24 hours? Here is the honest answer.

**Verdict: NO** — task-shape mismatch. Don't file a P0 wrap proposal.

MetaGPT's HumanEval Pass@1 of 0.859 (ICLR 2024 Oral) is the best published orchestrator-tier coding result in Minsky's corpus, so the wrap question is worth asking. But the architectures don't compose for Minsky's specific job.

**Architectural fit.** MetaGPT is a Python framework (`pip install metagpt`) aimed at greenfield software generation. It turns a one-line product idea ("build me a snake game") into a full repo via a fixed pipeline: Product Manager, Architect, Engineer, QA, Tester — all five roles run in sequence per the SOP-shaped Standardized Operating Procedure. Its success metric is HumanEval, which measures writing functions correctly from scratch.

Minsky's job is brownfield maintenance: pick a task from an existing repo's TASKS.md, make a targeted change on a feature branch, run the existing tests, open a pull request for review. Its success shape is `prs-opened` × `iteration-stability-pct`, not HumanEval.

**What MetaGPT would replace: nothing in Minsky's current loop.** MetaGPT's five-role pipeline runs once per task. Spawning it for every TASKS.md item would (a) cost about 5× the LLM budget per task, because every task gets the full Product Manager / Architect / Engineer / QA pipeline regardless of size; (b) over-spec small tasks — a typo fix does not need a Product Manager phase; and (c) lose the agent's git-awareness, because MetaGPT's pipeline writes code into a fresh `workspace/` directory rather than editing the existing repo.

**What we keep if we don't wrap: everything.**

**Why we shouldn't wrap:**

1. **Wrong task shape.** Minsky tasks are "fix X in this existing repo"; MetaGPT optimizes for "build X from scratch". The HumanEval result doesn't transfer to Minsky's task distribution.
2. **Per-task overhead is wrong.** Five-role pipelines pay off in greenfield, where the Product Manager and Architect phases add real value. A typical Minsky task ("rename function `getCwd` to `getCurrentWorkingDirectory` across 15 files") doesn't need a Project Manager phase.
3. **Git-blindness.** MetaGPT writes to `workspace/<task-id>/`, not to the operator's existing repo. Wrapping it would mean bolting git-awareness on, undoing its clean pipeline.
4. **The valuable pattern is portable.** The thing worth borrowing is the SOP-shaped multi-agent pipeline pattern (Hong et al. 2024, "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"). That is what `multi-persona-pipeline-handoff-spec` (M2) tracks — pattern reuse, not a framework wrap.

**Trigger for re-evaluation:** re-open this analysis if MetaGPT publishes a brownfield-targeted variant (`metagpt-maintain` or similar) that operates on existing repos with a smaller per-task footprint, OR if MetaGPT's per-task pipeline overhead drops below 2× the baseline LLM cost. Until then, MetaGPT is citation material for `multi-persona-pipeline-handoff-spec`, not wrap material for the daemon.

## Five pivot questions

### 1. How is it different from Minsky?

MetaGPT is a per-invocation greenfield assembly line. You `pip install metagpt`, hand it a one-line product idea ("build a snake game"), and a fixed five-role Standard Operating Procedure (Product Manager → Architect → Project Manager → Engineer → QA) builds a fresh `workspace/<project>/` repo from scratch. The tagline "Code = SOP(Team)" names the bet: static role prompts, sequenced by an SOP, simulate a software company.

Minsky is the structural inverse on three axes:

- **Task shape.** Minsky does brownfield maintenance — pick a TASKS.md item from an existing repo, make a targeted feature-branch change, run the repo's own tests, open a pull request. MetaGPT optimizes for greenfield generation.
- **Lifecycle.** MetaGPT is request-response: idea in, repo out, process exits. Minsky is a daemon that never stops, selects its own next task, and survives process death (rule #6).
- **Governance.** MetaGPT's roles are static prompts with no constitution and no merge gate. Minsky refuses to merge any agent output that fails its 18-rule constitutional CI gate.

MetaGPT is the kind of inner-loop multi-agent pipeline an orchestrator might spawn per task — not an orchestrator itself. It has no cross-repo fleet loop (Minsky walking several repos in turn), no token-budget control, and no self-improvement layer.

### 2. What lessons can it give to us?

- **SOP-shaped role sequencing as a named pattern** (Hong et al., *MetaGPT*, ICLR 2024 — "Code = SOP(Team)"): encoding the Product Manager → Architect → Engineer → QA handoff as an explicit Standard Operating Procedure, rather than ad-hoc agent chatter, is the pattern `multi-persona-pipeline-handoff-spec` (M2) tracks. Lesson: adopt the pattern (a typed handoff contract between personas) without the framework runtime — the same play as adopting OTEL without locking to a vendor.
- **Role taxonomy cross-check** (MetaGPT's 5 roles vs OMC's 32-persona set): MetaGPT's Product Manager / Architect / Engineer / QA mapping is near-canonical for greenfield. Lesson: use it as a coverage checklist to find gaps, not as something to import.
- **Auto-generated competitive analysis as a bootstrap artifact** (MetaGPT emits a competitor-analysis document during project bootstrap): Minsky's `competitors/` corpus is hand-authored via `/competitor-research`. Lesson: the corpus-refresh step is a candidate for agent-assisted drafting — but the deterministic validation gate (`scripts/competitor-research-validate.mjs`) must stay. So this is "assist the draft, keep the gate", not "automate the corpus".
- **Staleness is a signal, not just metadata** (MetaGPT's last absolute coding-benchmark reading is ICLR 2024; later Foundation-Agents papers pivoted to workflow-search and prompt-optimization sub-methods): Lesson: a 4-month-stale headline result on a 68k-star project is evidence that the "simulated software company" framing under-delivered on sustained benchmark progress — confirmation that Minsky's bet on brownfield maintenance plus a self-improvement loop, over greenfield SOP role-play, is the right axis.

### 3. Are any of these lessons potentially vision-changing?

**No vision rewrite is forced.** The task's pre-registered Hypothesis was: *MetaGPT's multi-agent-software-company framing + AFlow MCTS-workflow-generation may seed Minsky's research-agenda layer, but the 4-month stale signal suggests the framing under-delivered; Q3 unlikely vision-changing.* Examined against the pre-registered Pivot (*if MetaGPT becomes archived, run the full post-mortem mode; otherwise the framing stays citation material*):

- **The valuable lessons are pattern-level, not constitution-level.** The SOP-shaped handoff (§2.1) is already routed to `multi-persona-pipeline-handoff-spec` (M2) as pattern reuse, which is exactly what rule #1 (don't reinvent) and rule #8 prescribe. No rewrite of `vision.md § What Minsky is` and no invalidation of any of the 18 rules is implied.
- **The maximal version of the threat does not dissolve the moat.** Even if Minsky adopted MetaGPT's entire five-role SOP wholesale, it would gain a greenfield generation pipeline it has no demand for, while gaining none of Minsky's differentiators — cross-repo task selection, the TASKS.md operator surface, the budget guard, the around-the-clock supervisor, or the constitutional merge gate (moats #3–#6). MetaGPT supplies a per-task pipeline; it supplies no fleet layer and no governance.
- **The staleness signal reinforces, rather than threatens, the current vision.** A 68k-star project going 4 months without a new framework Pass@1 is mild evidence *against* the greenfield-SOP framing's durability, not *for* a Minsky pivot toward it. This is a negative finding — no vision-threat question is filed; it is recorded here inline per this task's central-questions routing, rather than by editing `ask-human.md`.

### 4. How can we improve our strategy based on this?

- **Carry the SOP-handoff lesson into `multi-persona-pipeline-handoff-spec` (M2).** Record now that the persona handoff should be a typed contract (MetaGPT's SOP made explicit), not free-form agent chatter. Traces to lesson §2.1.
- **Keep the corpus-draft / corpus-gate split explicit.** When corpus drafting becomes agent-assisted, the `competitor-research-validate.mjs` gate stays load-bearing (rule #10). Traces to lesson §2.3 — the agent assists the draft, the deterministic gate keeps it honest.
- **Treat vendor staleness as a first-class scorecard signal.** The `stale-by-vendor` flag this doc already carries (per `corpus-refresh-metagpt`) is the right shape: surface staleness honestly rather than restamping an old `asOf`. Traces to lesson §2.4 and the freshness gate (`scripts/check-corpus-freshness.mjs`).
- **Watch the brownfield-variant and overhead-drop triggers.** The two re-evaluation triggers in "Should we wrap MetaGPT instead?" are the only conditions that change the wrap math; keeping them explicit is cheap insurance. Traces to "Trigger for re-evaluation".

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **Tick-loop** (the wake-up of the loop on its timer): KEEP — MetaGPT has no daemon, no queue, no cross-repo loop; it runs one five-role pipeline on one idea and exits. There is no outer loop to replace.
- **Self-improvement (the MAPE-K loop: Monitor, Analyze, Plan, Execute over a Knowledge base)**: KEEP — MetaGPT's roles are static prompts; it has no layer that observes performance and rewrites agent prompts. Nothing to fold in.
- **Adapters / agent backend** (a small wrapper that lets Minsky talk to one outside tool through a fixed interface): N/A — MetaGPT is a per-task generation framework, not a pluggable agent runtime. The per-task multi-step loop is dominated by the approved OpenHands CodeAct wrap, and a MetaGPT pipeline would cost about 5× the LLM budget per task (full Product Manager / Architect / Engineer / QA / Tester regardless of task size) and write to a fresh `workspace/` rather than the operator's repo (git-blindness).
- **Sandbox**: N/A — MetaGPT runs in-process Python; OS-level isolation stays Minsky's job.
- **Constitution / merge gate**: KEEP — MetaGPT defines a generation pipeline, not policy; the 18-rule constitutional gate (moat #3) has no analog.
- **Cross-repo fleet**: KEEP — the `--hosts-dir` round-robin (moat #5) has no MetaGPT equivalent; a pipeline runs on one idea.
- **Corpus / scorecard**: N/A — MetaGPT is a benchmarked orchestrator-tier peer in `competitors/README.md` (HumanEval Pass@1 = 0.859, ICLR 2024 Oral), intentionally a competitor record in the M1.10 corpus denominator, not a dependency-candidate.
- **Multi-persona handoff (M2)**: BORROW PATTERN, NOT FRAMEWORK — the SOP-shaped handoff is the one genuinely portable idea; it lands as a citation in `multi-persona-pipeline-handoff-spec`, not as a `pip install metagpt` dependency.
- **TASKS.md surface / fleet dashboard**: KEEP — operators edit markdown; MetaGPT's task representation is internal Python objects with no operator surface and no dashboard.

**Total replace across all surfaces: 0% — structural and task-shape mismatch.** Honest headline for the operator: there is nothing in the orchestrator to replace. MetaGPT optimizes greenfield generation while Minsky optimizes brownfield maintenance, so even its SoTA-at-publication HumanEval result doesn't transfer to Minsky's task distribution. The one portable idea — the SOP-shaped persona handoff — is already routed to `multi-persona-pipeline-handoff-spec` as pattern reuse. The two re-evaluation triggers (a brownfield-targeted `metagpt-maintain` variant, or per-task overhead dropping below 2× baseline) are the only conditions that change the math.

## Pattern conformance

- **Pattern MetaGPT implements**: Simulated software company / Standard Operating Procedure role-play across Product Manager / Architect / Engineer / QA roles — Hong et al., "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework", *ICLR* 2024 (the primary paper) — anchored in the older organisational-design pattern of the chief-programmer team — Brooks, *The Mythical Man-Month*, Addison-Wesley, 1975, Ch. 3 ("The Surgical Team").
- **Conformance level**: full (within the pattern MetaGPT implements).
- **How Minsky relates**: don't adopt. Minsky shares the persona-driven paradigm but binds it to Claude Code via OMC (row 50) rather than to a Python+GPT runtime. The conceptual lineage is acknowledged; the substrate is incompatible.
- **Index row**: `vision.md` § "Pattern conformance index" row 48.

## Last reviewed

2026-06-02 — deepened with the `## Five pivot questions` framework per task `competitor-deepen-metagpt`. Verdict: structural and task-shape mismatch (0% replace across all surfaces); MetaGPT optimizes greenfield generation while Minsky optimizes brownfield maintenance, so even its ICLR-2024-Oral HumanEval result doesn't transfer to Minsky's task distribution. The one portable idea — the SOP-shaped persona handoff (Hong et al. 2024) — is routed to `multi-persona-pipeline-handoff-spec` (M2) as pattern reuse, not a framework wrap. Negative finding — no vision-threat question filed (recorded inline per this task's central-questions routing rather than editing `ask-human.md`); the pre-registered Pivot (run the full post-mortem only if archived) is not triggered, so the entry stays `stale-by-vendor` with an honest `asOf`. Two explicit re-evaluation triggers remain: a brownfield-targeted `metagpt-maintain` variant, and per-task overhead dropping below 2× baseline.

Earlier reviews: 2026-05-23 (added to the scorecard corpus via `/competitor-research` as the first orchestrator-tier competitor); 2026-05-22 wrap-feasibility analysis added per rule #1 plus operator directive — verdict: wrong task shape, don't wrap; 2026-06-02 `corpus-refresh-metagpt` audit — the vendor's last absolute coding-benchmark reading is ICLR 2024, and subsequent Foundation-Agents papers (Feb 2025) don't republish a framework Pass@1, so the entry is flagged `stale-by-vendor` and `asOf` is left honest per the task Pivot.
