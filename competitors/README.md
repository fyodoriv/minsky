# Competitors

> The strategic landscape: where Minsky sits, what it does that nobody else does, and what it deliberately leaves to others.

Minsky is a background program you point at your code projects. It picks the most important unfinished to-do, asks a coding assistant to do it, and hands you a draft to review — it never changes anything without your say-so. This directory compares Minsky against the other tools in the same space.

## What this is

The navigational index for Minsky's competitive landscape. It answers three questions in plain terms:

- Where Minsky sits among the tools that coordinate coding assistants.
- The six combined properties no competitor fully matches (Minsky's moat).
- Which per-vendor file to open for each competitor's details.

Read this page first. Open a per-vendor file only when you need that competitor's strengths, gaps, and our build-or-buy verdict.

## What this is not

- **Not a per-vendor analysis.** Each `competitors/<name>.md` holds one competitor's full research (strengths, gaps, wrap analysis, Five pivot questions).
- **Not the scorecard data.** See [scorecard.md](./scorecard.md) for the generated metric snapshot from `bin/minsky competitive`.
- **Not the product positioning.** See [README.md](../README.md) for how Minsky describes itself to operators (the human who runs it — you).

## TL;DR

**Minsky is an orchestrator.** An orchestrator sits *above* the coding assistants — Claude, Devin, Aider — and drives them. In this document, "agent" means one of those coding assistants. Minsky is not an agent; it composes agents. Its peer tier is MetaGPT, AutoGen, CrewAI, LangGraph, and the OpenAI Agents SDK.

**Minsky's moat is the combination of six properties. No competitor has all six.**

| # | Property | What it means | Who else has it |
|---|---|---|---|
| 1 | **Daemon, not framework** | A daemon is a background program that keeps running on your machine. You attach Minsky to a repo and walk away. It is not a Python library, SDK, or Flow you wrap your code in. | None — every orchestrator competitor is a framework |
| 2 | **Operator-machine identity** | Minsky runs as you, using your `~/.ssh`, `~/.gitconfig`, and `~/.config/gh/`. Commits land under your name. No cloud sandbox, no fresh clone. | None — Devin (Cognition Cloud + Devbox), CrewAI (Enterprise platform), AutoGen (whatever Python container) all run with separate identity. **OpenHands Agent Canvas (June 1, 2026) converged but did NOT match**: Dockerless self-host-on-VM still provisions a GitHub token *into* the managed agent-server rather than inheriting the operator's ambient `~/.config/gh` + `~/.gitconfig` + `~/.ssh` directly (per `competitors/openhands.md` weakness #6). |
| 3 | **Constitution + deterministic enforcement** | The constitution is Minsky's 17 numbered, non-negotiable project rules. Each one is enforced by a CI lint, not left as advice in docs. `pnpm pre-pr-lint --stage=full` runs 53 checks. | None |
| 4 | **MAPE-K self-improvement (substrate today, full loop forthcoming)** | MAPE-K is the self-improvement loop: Monitor, Analyze, Plan, Execute over a Knowledge base. The substrate ships: experiment-store + observer + spec monitor + task-filing audit (Minsky files tasks against its own weak spots). Closed-loop prompt A/B tuning is spec-only — `user-stories/003-mape-k-improves-prompts.md` status: Specification. CrewAI/AutoGen/MetaGPT have neither substrate nor closed loop; the substrate alone is already differentiated. | None (substrate); none plan a closed loop |
| 5 | **Cross-repo fleet at operator scale** | A host is one code project (git repository). Minsky walks N hosts in round-robin on one machine. | None — CrewAI Flow = one workflow, LangGraph thread = one conversation, Devin session = one task. **OpenHands Agent Canvas (June 1, 2026) still one-repo-at-a-time**: the Dockerless self-host-on-VM mode runs one agent-server per conversation; cross-repo workflows remain Enterprise-Automations-only (Agent Control Plane license). |
| 6 | **TASKS.md as operator surface** | The work queue is a plain Markdown to-do file at the project root. No dashboard, no API, no DSL. | None |

**Minsky's honest gaps.** Things we do NOT do — by design, or because we have not shipped them yet. Each filed gap names a real `TASKS.md` id.

| # | Gap | Who has it | Status |
|---|---|---|---|
| 1 | Headline benchmark number | MetaGPT (HumanEval 85.9%) | Filed: `benchmark-minsky-via-claude-on-humaneval` |
| 2 | Enterprise distribution | CrewAI (60% Fortune 500), Devin (enterprise tier) | Filed: `enterprise-deployment-readiness-audit` |
| 3 | Multi-agent ensembling | Augment Code (Claude 3.7 + o1) | Filed: `explore-multi-agent-ensembling-experiment` |
| 4 | Graph-based execution with time-travel | LangGraph (checkpointer + thread_id + super-step replay) | Not planned — daemon iteration is linear by design |
| 5 | Python framework binding | CrewAI, AutoGen, MetaGPT, LangGraph, smolagents | Not planned — TypeScript is the orchestrator-tier surface |
| 6 | GAIA benchmark | AutoGen (SOTA March 2024) | Filed: `gaia-benchmark-evaluation-substrate` |

## The orchestrator tier

Five frameworks dominate the orchestrator tier. The column "Weakness vs Minsky" names what each gives up relative to Minsky.

| Orchestrator | Shape | Primary metric | Strength | Weakness vs Minsky |
|---|---|---|---|---|
| **MetaGPT** | Multi-role assembly line (PM/Architect/Engineer/QA) — Standardised Operating Procedure | HumanEval Pass@1 = 0.859 (ICLR 2024 SOTA) | Strong benchmark numbers; clean architectural metaphor | Stateless per-task; no daemon; no host-identity binding |
| **AutoGen** (Microsoft) | Multi-agent conversational framework | GAIA SOTA March 2024 (no specific %); MATH 69.48% | Microsoft research depth; AutoGenBench tool | Framework, not daemon; no host-identity binding |
| **CrewAI** | Crews + Flows (sequential / hierarchical / consensual) | 1.4B+ agentic executions, 60% Fortune 500 (no per-task benchmark) | Enterprise distribution; production state-persistence (`@persist`, checkpointing) | Framework, not daemon; cloud-platform model (not operator-machine) |
| **LangGraph** (LangChain) | Graph-based state machine | Third-party 62% complex-task success; 100% tool execution success | Time-travel debugging via checkpoints; durable execution; thread_id model | Framework, not daemon; you build the graph |
| **OpenAI Agents SDK** | Handoffs + guardrails + tracing | Production-ready March 2026; 26k+ stars (no headline benchmark yet) | OpenAI ecosystem distribution; production-grade tracing | Framework, not daemon; model-locked to OpenAI; no MAPE-K self-improvement |

The agent tier sits *below* the orchestrator tier: Claude Code, Devin, Aider, OpenHands, SWE-agent, Cursor agent, OpenAI Codex, Augment Code. Orchestrators compose them. Minsky-via-Claude inherits Claude Code's SWE-bench score; Minsky-via-Devin inherits Devin's PR merge rate. The orchestrator-tier delta is what Minsky's MAPE-K loop + 24/7 daemon + constitution adds on top.

## Patterns we adopt or reject

### Adopt

- **State persistence with checkpointing** (LangGraph thread_id + CrewAI @persist) — Minsky's `.minsky/orchestrate.jsonl` is the iteration-level analog. Could extend to per-iteration sub-states (mid-iteration crash recovery) — filed as `minsky-iteration-checkpoint-substrate`.
- **Multi-role assembly line** (MetaGPT SoP) — Minsky's persona spawner (`novel/adapters/persona-spawner/`) is the equivalent. A persona is a role the agent takes on (researcher, planner, implementer). Minsky's personas are bound to ONE agent per spawn. The MetaGPT pattern of role-handoff within ONE task is documented as a candidate experiment.
- **Handoffs + guardrails** (OpenAI Agents SDK) — Minsky's runtime invariants serve a similar role (gate before iteration); the handoff substrate is the candidate for multi-persona-per-task.

### Reject (by design)

- **Graph DSL** (LangGraph) — operators don't want to write a graph definition. TASKS.md is simpler and stays simpler as the queue grows.
- **Cloud sandbox** (Devin Devbox) — Minsky's identity is the operator's identity. A cloud sandbox introduces a separate identity boundary that complicates credentials, git config, and trust.
- **Python framework binding** (CrewAI/AutoGen/MetaGPT) — orchestrator-tier work in 2026 is full-stack: orchestrator interface (TypeScript), agent adapter (TypeScript), prompt evolution (TypeScript). Python adds zero value here.
- **Enterprise-platform deployment** (CrewAI Enterprise) — Minsky stays operator-owned. The platform model is a different product.

## The corpus + scorecard

The corpus is the data set of competitor benchmark numbers; the scorecard is the rendered table built from it. The M1.10 scorecard at `novel/competitive-benchmark/` measures Minsky against this set on shared metrics. Read [`novel/competitive-benchmark/README.md`](../novel/competitive-benchmark/README.md) for the metric catalogue + grid shape.

Current corpus state (as of 2026-06-02):

- **11 corpus entries** — 8 agent-tier `published` snapshots + 2 orchestrator-tier `published` snapshots (MetaGPT, AutoGen) + 1 `local-harness` thesis-falsifier (Agentless)
- **Both `ResultSource` arms exercised** — `published` (dated vendor numbers) and `local-harness` (Agentless: a fixed-pipeline method Minsky runs head-to-head, not a vendor-published reading)
- **12 metrics** (DORA 4 + agentic 6 + public-benchmark 2: SWE-bench Verified + HumanEval Pass@1)
- **Self-refreshing**: weekly `corpus-refresh-check` + quarterly `corpus-discover-quarterly` (PR #719); `/competitor-research <url>` skill is the on-ramp for new vendors (PR #718)

### Deep-research backlog — Tier-S resolution

The 2026-05-22 operator conversation produced five Tier-S competitor stubs to deep-research under the sharpened identity *"OpenHands that improves itself + follows hard rules and principles"*. LangGraph was demoted same-day (no concrete use case post-OpenHands-adoption); the remaining four were resolved by tasks `competitor-deepen-goose`, `competitor-deepen-claude-agent-sdk`, and `competitor-deep-research-tier-s-2026-05`. Final dispositions:

| Stub | Relationship verdict | Corpus / adapter change | Resolved by |
|---|---|---|---|
| **Agentless** | **Reference / thesis falsifier** | ADD to corpus as `local-harness` (`agentless`, harness `agentless-swebench-lite`) — required; optional Agentless-style routing target for bug fixes (gated on an experiment) | `competitor-deep-research-tier-s-2026-05` |
| **Claude Agent SDK** | **Dependency** (Claude-backend adapter only) | ADOPT behind `novel/adapters/agent-runtime.claude.ts` (subprocess → typed SDK); no corpus entry (library, not a benchmarked competitor) | `competitor-deepen-claude-agent-sdk` |
| **Goose** | **Competitor (agent-tier) + candidate wrap target** | ADD as an optional low-priority agent backend; absorb recipe→brief portability; no corpus entry (score = chosen model's, no standalone benchmark) | `competitor-deepen-goose` |
| **Cline** | **Reference** | DO-NOT-WRAP (no headless mode); absorb Plan/Act-as-pre-registration + per-task cost UX; no corpus entry (rule #4 — no model-dependent double-count) | `competitor-deep-research-tier-s-2026-05` |
| **LangGraph** | Demoted from Tier-S (re-promote criterion on file) | None — see `competitors/langgraph.md` re-promote criterion | 2026-05-22 (demoted) |

The only stub that lands a corpus reading is **Agentless** — the thesis falsifier earns a permanent seat because a reason-for-existing that cannot be falsified is not engineering (rule #9, pre-registered hypothesis-driven development). The other three resolve to a Dependency (Claude Agent SDK), a candidate agent-backend ADD (Goose), and a learn-from Reference (Cline). None adds a corpus reading, by the rule-#4 no-fabricated-readings discipline.

### Discovered but blocked on primary citation

Vendors the discovery sweep identified but could not add (no vendor-primary number on the M1.10 catalogue):

- **AutoGen** (`corpus-add-autogen-microsoft`) — Microsoft has MATH 69.48% as primary, but the orchestrator-tier metric is `humaneval-pass-at-1`. Wait for Magentic-One-style follow-up paper.
- **CrewAI** (`corpus-add-crewai`) — 1.4B+ executions + 60% Fortune 500 published, but no benchmark.
- **LangGraph** (`corpus-add-langgraph`) — third-party benchmarks (AImultiple, JetThoughts) only.
- **OpenAI Agents SDK** (`corpus-add-openai-agents-sdk`) — March 2026 launch, no benchmark yet.
- **GitHub Copilot Coding Agent** (`corpus-add-github-copilot-coding-agent`) — launch post doesn't cite SWE-bench; AIDev arxiv 2602.02345 has Copilot data but extraction pending.
- **Goose** (Block, `corpus-add-goose-block`) — Block hasn't published official benchmarks (third-party 45% on SWE-bench).
- **Factory Droid** (`corpus-add-factory-droid`) — factory.ai 2024 report has SWE-bench Full + Lite only, not Verified.

The validator's published-primary rule (rule #4 — visible, no fabricated readings) is doing real work: these vendors all have substantial adoption, but the corpus stays honest about what's measurable.

## Per-vendor research files

Each `competitors/<id>.md` file follows the same template:

- URL, status, pricing, relationship (Competitor / Integration / Dependency / Research benchmark)
- What it is
- Strengths
- Weaknesses vs Minsky's vision
- What we learn / steal
- Why choose Minsky over `<vendor>`
- Why choose `<vendor>` over Minsky
- Scorecard readings (the data behind the M1.10 scorecard)
- Last reviewed

When the corpus self-refresh substrate (PR #719) auto-files a `corpus-refresh-<id>` task, this template is what the `/competitor-research <url> --refresh` workflow regenerates.

## Adding a new competitor

Run the `/competitor-research <vendor-url>` skill (defined at `.claude/skills/competitor-research/SKILL.md`). It walks the 6-phase workflow:

1. Identify — extract vendor name, kebab-case id, vendor-exclusion check
2. Research — find primary-cited metric readings on the M1.10 catalogue
3. Draft — build the corpus JSON entry
4. Validate — `scripts/competitor-research-validate.mjs` pins 6 invariants
5. Verify — add to `competitors.ts`, write `competitors/<id>.md`, run `bin/minsky competitive`
6. File follow-ups — if coverage is thin, file `corpus-refresh-<id>` task

Or invoke directly:

```bash
/competitor-research https://www.example-orchestrator.com
```

## Anchor

- [vision.md § "What Minsky uniquely does"](../vision.md#what-minsky-uniquely-does-the-moat) — the six moats this analysis enumerates
- [novel/competitive-benchmark/README.md](../novel/competitive-benchmark/README.md) — the M1.10 scorecard substrate
- [user-stories/012-operator-machine-identity-moat.md](../user-stories/012-operator-machine-identity-moat.md) — the moat-1 user story
- [user-stories/013-daemon-not-framework-moat.md](../user-stories/013-daemon-not-framework-moat.md) — the moat-2 user story
- [`.claude/skills/competitor-research/SKILL.md`](../.claude/skills/competitor-research/SKILL.md) — the workflow that lifts new URLs into this corpus
- Sheremetyev, F., *Git Wasn't Designed for Agents*, Medium, 2026-05 (the operator-machine-identity vs cloud-sandbox architectural distinction)
- Cognition Labs, *Devin Enterprise Deployment Overview*, docs.devin.ai, 2026 (the Brain + Devbox architectural contrast — Devin's stateless cloud Brain is the deliberate inverse of Minsky's operator-machine daemon)
