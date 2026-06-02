# Competitors

> Strategic landscape analysis. Where Minsky sits, what it does that nobody else does, what it doesn't do that others do.

This directory holds one markdown research file per competitor in the M1.10 scorecard corpus. This README is the synthesised strategic view — read it to understand the LANDSCAPE; read each per-vendor file for the DETAILS.

## TL;DR

**Minsky is an orchestrator** (peer tier: MetaGPT, AutoGen, CrewAI, LangGraph, OpenAI Agents SDK). It sits ABOVE the agents (Claude / Devin / Aider) it composes.

**Minsky's distinctive moat** is the combination of six properties, no competitor has all six:

| # | Property | What it means | Who else has it |
|---|---|---|---|
| 1 | **Daemon, not framework** | Operator attaches and walks away. Not a Python library / SDK / Flow you wrap your code in. | None — every orchestrator competitor is a framework |
| 2 | **Operator-machine identity** | Runs as the operator's user with the operator's `~/.ssh`, `~/.gitconfig`, `~/.config/gh/`. Commits land as the operator. No cloud sandbox, no fresh clone. | None — Devin (Cognition Cloud + Devbox), CrewAI (Enterprise platform), AutoGen (whatever Python container) all run with separate identity. **OpenHands Agent Canvas (June 1, 2026) converged but did NOT match**: Dockerless self-host-on-VM still provisions a GitHub token *into* the managed agent-server rather than inheriting the operator's ambient `~/.config/gh` + `~/.gitconfig` + `~/.ssh` directly (per `competitors/openhands.md` weakness #6). |
| 3 | **Constitution + deterministic enforcement** | 17 non-negotiable rules, each enforced by a CI lint. Not "best practices in docs" — `pnpm pre-pr-lint --stage=full` runs 53 checks. | None |
| 4 | **MAPE-K self-improvement (substrate today, full loop forthcoming)** | The substrate ships: experiment-store + observer + spec monitor + task-filing audit (the daemon files tasks against its own weak spots). Closed-loop prompt A/B tuning is spec-only — `user-stories/003-mape-k-improves-prompts.md` status: Specification. CrewAI/AutoGen/MetaGPT have neither substrate nor closed loop; the substrate alone is already differentiated. | None (substrate); none plan a closed loop |
| 5 | **Cross-repo fleet at operator scale** | Walks N hosts in round-robin on one machine. | None — CrewAI Flow = one workflow, LangGraph thread = one conversation, Devin session = one task. **OpenHands Agent Canvas (June 1, 2026) still one-repo-at-a-time**: the Dockerless self-host-on-VM mode runs one agent-server per conversation; cross-repo workflows remain Enterprise-Automations-only (Agent Control Plane license). |
| 6 | **TASKS.md as operator surface** | Plain markdown file. No dashboard, no API, no DSL. | None |

**Minsky's honest gaps** vs competitors — things we DON'T do, by design or because we haven't shipped yet:

| # | Gap | Who has it | Status |
|---|---|---|---|
| 1 | Headline benchmark number | MetaGPT (HumanEval 85.9%) | Filed: `benchmark-minsky-via-claude-on-humaneval` |
| 2 | Enterprise distribution | CrewAI (60% Fortune 500), Devin (enterprise tier) | Filed: `enterprise-deployment-readiness-audit` |
| 3 | Multi-agent ensembling | Augment Code (Claude 3.7 + o1) | Filed: `explore-multi-agent-ensembling-experiment` |
| 4 | Graph-based execution with time-travel | LangGraph (checkpointer + thread_id + super-step replay) | Not planned — daemon iteration is linear by design |
| 5 | Python framework binding | CrewAI, AutoGen, MetaGPT, LangGraph, smolagents | Not planned — TypeScript is the orchestrator-tier surface |
| 6 | GAIA benchmark | AutoGen (SOTA March 2024) | Filed: `gaia-benchmark-evaluation-substrate` |

## The orchestrator tier in 2026

Five frameworks dominate the orchestrator tier:

| Orchestrator | Shape | Primary metric | Strength | Weakness vs Minsky |
|---|---|---|---|---|
| **MetaGPT** | Multi-role assembly line (PM/Architect/Engineer/QA) — Standardised Operating Procedure | HumanEval Pass@1 = 0.859 (ICLR 2024 SOTA) | Strong benchmark numbers; clean architectural metaphor | Stateless per-task; no daemon; no host-identity binding |
| **AutoGen** (Microsoft) | Multi-agent conversational framework | GAIA SOTA March 2024 (no specific %); MATH 69.48% | Microsoft research depth; AutoGenBench tool | Framework, not daemon; no host-identity binding |
| **CrewAI** | Crews + Flows (sequential / hierarchical / consensual) | 1.4B+ agentic executions, 60% Fortune 500 (no per-task benchmark) | Enterprise distribution; production state-persistence (`@persist`, checkpointing) | Framework, not daemon; cloud-platform model (not operator-machine) |
| **LangGraph** (LangChain) | Graph-based state machine | Third-party 62% complex-task success; 100% tool execution success | Time-travel debugging via checkpoints; durable execution; thread_id model | Framework, not daemon; you build the graph |
| **OpenAI Agents SDK** | Handoffs + guardrails + tracing | Production-ready March 2026; 26k+ stars (no headline benchmark yet) | OpenAI ecosystem distribution; production-grade tracing | Framework, not daemon; model-locked to OpenAI; no MAPE-K self-improvement |

The agent tier (Claude Code, Devin, Aider, OpenHands, SWE-agent, Cursor agent, OpenAI Codex, Augment Code) sits BELOW the orchestrator tier — orchestrators compose them. Minsky-via-Claude inherits Claude Code's SWE-bench score; Minsky-via-Devin inherits Devin's PR merge rate. The orchestrator-tier delta is what Minsky's MAPE-K loop + 24/7 daemon + constitution adds on top.

## Architectural patterns we adopt or reject

### Adopt

- **State persistence with checkpointing** (LangGraph thread_id + CrewAI @persist) — Minsky's `.minsky/orchestrate.jsonl` is the iteration-level analog. Could extend to per-iteration sub-states (mid-iteration crash recovery) — filed as `minsky-iteration-checkpoint-substrate`.
- **Multi-role assembly line** (MetaGPT SoP) — Minsky's persona spawner (`novel/adapters/persona-spawner/`) is the equivalent, but Minsky's personas (researcher, planner, implementer) are bound to ONE agent per spawn. The MetaGPT pattern of role-handoff within ONE task is documented as a candidate experiment.
- **Handoffs + guardrails** (OpenAI Agents SDK) — Minsky's runtime invariants serve a similar role (gate before iteration); the handoff substrate is the candidate for multi-persona-per-task.

### Reject (by design)

- **Graph DSL** (LangGraph) — operators don't want to write a graph definition. TASKS.md is simpler and stays simpler as the queue grows.
- **Cloud sandbox** (Devin Devbox) — Minsky's identity is the operator's identity. Cloud sandbox introduces a separate identity boundary that complicates credentials, git config, and trust.
- **Python framework binding** (CrewAI/AutoGen/MetaGPT) — orchestrator-tier work in 2026 is full-stack: orchestrator interface (TypeScript), agent adapter (TypeScript), prompt evolution (TypeScript). Python adds zero value here.
- **Enterprise-platform deployment** (CrewAI Enterprise) — Minsky stays operator-owned. The platform model is a different product.

## The corpus + scorecard

The M1.10 scorecard at `novel/competitive-benchmark/` measures Minsky against this set on shared metrics. Read [`novel/competitive-benchmark/README.md`](../novel/competitive-benchmark/README.md) for the metric catalogue + grid shape.

Current corpus state (as of 2026-05-23):

- **9 competitors** (8 agent-tier + 1 orchestrator-tier — MetaGPT)
- **12 metrics** (DORA 4 + agentic 6 + public-benchmark 2: SWE-bench Verified + HumanEval Pass@1)
- **Grid**: 108 cells (12 × 9)
- **Self-refreshing**: weekly `corpus-refresh-check` + quarterly `corpus-discover-quarterly` (PR #719); `/competitor-research <url>` skill is the on-ramp for new vendors (PR #718)

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

## Discovered but blocked on primary citation

Vendors the discovery sweep identified but couldn't add (no vendor-primary number on the M1.10 catalogue):

- **AutoGen** (`corpus-add-autogen-microsoft`) — Microsoft has MATH 69.48% as primary, but the orchestrator-tier metric is `humaneval-pass-at-1`. Wait for Magentic-One-style follow-up paper.
- **CrewAI** (`corpus-add-crewai`) — 1.4B+ executions + 60% Fortune 500 published, but no benchmark.
- **LangGraph** (`corpus-add-langgraph`) — third-party benchmarks (AImultiple, JetThoughts) only.
- **OpenAI Agents SDK** (`corpus-add-openai-agents-sdk`) — March 2026 launch, no benchmark yet.
- **GitHub Copilot Coding Agent** (`corpus-add-github-copilot-coding-agent`) — launch post doesn't cite SWE-bench; AIDev arxiv 2602.02345 has Copilot data but extraction pending.
- **Goose** (Block, `corpus-add-goose-block`) — Block hasn't published official benchmarks (third-party 45% on SWE-bench).
- **Factory Droid** (`corpus-add-factory-droid`) — factory.ai 2024 report has SWE-bench Full + Lite only, not Verified.

The validator's published-primary rule (rule #4 — visible, no fabricated readings) is doing real work — these vendors all have substantial adoption, but the corpus stays honest about what's measurable.

## Anchor

- [vision.md § "What Minsky uniquely does"](../vision.md#what-minsky-uniquely-does-the-moat) — the six moats this analysis enumerates
- [novel/competitive-benchmark/README.md](../novel/competitive-benchmark/README.md) — the M1.10 scorecard substrate
- [user-stories/012-operator-machine-identity-moat.md](../user-stories/012-operator-machine-identity-moat.md) — the moat-1 user story
- [user-stories/013-daemon-not-framework-moat.md](../user-stories/013-daemon-not-framework-moat.md) — the moat-2 user story
- [`.claude/skills/competitor-research/SKILL.md`](../.claude/skills/competitor-research/SKILL.md) — the workflow that lifts new URLs into this corpus
- Sheremetyev, F., *Git Wasn't Designed for Agents*, Medium, 2026-05 (the operator-machine-identity vs cloud-sandbox architectural distinction)
- Cognition Labs, *Devin Enterprise Deployment Overview*, docs.devin.ai, 2026 (the Brain + Devbox architectural contrast — Devin's stateless cloud Brain is the deliberate inverse of Minsky's operator-machine daemon)
