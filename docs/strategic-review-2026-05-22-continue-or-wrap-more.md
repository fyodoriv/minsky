# Strategic review — continue, sunset, or wrap-more?

> Reviewed 2026-05-22, post-PR #734 (OpenHands wrap future-vision shipped). The operator's four questions, answered honestly.

## Status

This doc is durable. It's the durable-artifact half of a strategic-review-skill run (the skill's default is to delete the analysis after committing tasks; for Minsky we keep it because the operator preserves these decisions across sessions). Re-read when one of the re-evaluation triggers in § 9 fires.

## The operator's four questions

> *"Then let's compare that future vision in detail with other competitors in the field. Should we wrap someone else? What makes us unique? Should we, a team of 1 human, continue work on this project or just already use what exists and rely on external party on gradually improving their own version of minsky? Alternatively maybe if we take in more already built products, maybe I would be able to maintain it and make it a better version?"*

The fourth question is the existential one. Q1-Q3 feed into it.

## The codebase, honestly

Before answering: what's the project's actual shape today?

| Metric | Value | Source |
|---|---|---|
| Total LOC (non-test) | ~67,574 | `fd -e ts -e mjs -e js \| xargs wc -l` |
| LOC in `scripts/` alone (the lint stack) | ~53,000 | same |
| Number of `novel/` packages | 14 | `ls novel/` |
| Entries under `novel/` | 485 | `fd novel/` |
| Maintainer | 1 person (operator) | `git log --pretty=format:'%ae' \| sort -u \| wc -l` |
| Last 10 commits | All docs / strategy | `git log --oneline -10` |
| Repos competing in this space | 11 catalogued in `competitors/`, top 4 with $20M-$4B funding | `competitors/README.md` |

The 1-FTE industry rule of thumb is ~5K-10K LOC for indefinitely-maintainable code. Minsky is 7-14× that. It's already past the cliff for a 1-operator team — current pace works because the operator is energized + AI-authored code lets them ship 2-3× faster than human-only, but a single 6-month low-energy window collapses the project.

That's not pessimism; that's the math. Now to the four questions.

---

## Q1: Post-wrap Minsky vs competitors

Reference: [`docs/plans/2026-05-22-path-c-openhands-reshape.md`](./plans/2026-05-22-path-c-openhands-reshape.md) — the canonical Path C reshape plan, which describes the post-wrap world (consolidated from the now-deleted `docs/minsky-wraps-openhands-vision.md`).

Post-wrap, Minsky becomes "operator-machine-identity + cross-repo fleet + constitution-as-CI layer over a wrapped agent". The other layers shrink. Where does that leave Minsky vs each direct competitor?

| Competitor | Their distinctive value | Post-wrap Minsky distinctive value | Net |
|---|---|---|---|
| **OpenHands** (the wrapped one) | Agent loop, Docker sandbox, 15+ LLMs, 65.8% SWE-bench, web UI, community + capital | Daemon shell, operator identity, cross-repo fleet, constitution-as-CI, TASKS.md surface, MAPE-K substrate | Minsky owns 6 layers OpenHands doesn't ship. After their June 1 Agent Canvas Initiative adds bring-your-own-agent + Dockerless + self-host-on-VM, Minsky's 6-moat list narrows to 4-5 because Canvas covers daemon-ish + bring-your-own-agent. The remaining 4-5 moats stay distinctive. |
| **CrewAI** | Memory architecture, manager-agent delegation, 60% Fortune 500 adoption, $18M funding | Coding-specific, daemon, operator identity, constitution-as-CI, git-native surface | Different target (general-purpose orchestration vs coding-specific). Operators don't pick one OR the other; they pick CrewAI for marketing/research/customer-support, Minsky for "ship code". |
| **Devin** | Mature SaaS, $4B valuation, Cognition Cloud + Devbox, 67% PR merge rate | Operator identity (Devin runs in their cloud), constitution-as-CI, daemon survives terminal close | Different deployment shape (SaaS vs operator-machine). Operators concerned about data-egress can't use Devin; that's Minsky's niche. |
| **MetaGPT** | HumanEval 85.9%, ICLR 2024 Oral, role-based SOP pipeline | Brownfield maintenance shape (not greenfield), operator identity, git-native, daemon | Different task shape. MetaGPT optimises for "build from scratch"; Minsky optimises for "fix bugs in existing repos". |
| **Claude Code / Aider** | Best interactive pair-programming UX | 24/7 daemon (vs interactive), cross-repo fleet, constitution-as-CI | Different mode (background daemon vs interactive). They're already wrapped as Minsky backends; not really competitors anymore. |

**The honest summary**: post-wrap Minsky is the only product targeting "operator-machine-identity + 24/7 daemon + git-native task queue + constitutional gates + cross-repo fleet — all using a wrapped state-of-the-art agent". That's a real niche. But it's NARROW. Operators outside that profile (want SaaS / want general-purpose / want greenfield / want interactive) all have better options.

**Adoption-rate reality check**: 70K stars (OpenHands), 48K stars (CrewAI), $4B valuation (Devin), $18.8M Series A (OpenHands), 60% Fortune 500 (CrewAI), Minsky's deployed-instances count = 1 (the operator's). The niche may be real but it's currently empty.

---

## Q2: Should we wrap someone else?

Three layers of analysis.

### Q2.1: Already-filed wrap analyses

Recap from [`.claude/skills/competitor-research/SKILL.md`](../.claude/skills/competitor-research/SKILL.md) § Phase 7 + the per-competitor `## Should we wrap?` sections:

| Competitor | Verdict | Status |
|---|---|---|
| OpenHands (agent layer) | PARTIAL YES — approved 2026-05-22 | P0 filed, external-dep-blocked on June 1 |
| OpenHands (orchestrator layer via Automations) | NO — kills 3 moats (daemon, TASKS.md, cross-repo) | Rejected per the wrap-feasibility analysis |
| CrewAI | NO — structural mismatch (general-purpose, code execution deprecated) | Steal memory pattern (P3 filed) |
| Devin | ALREADY PARTIALLY WRAPPED at right layer | Further fleet-layer wrap kills 3 moats; rejected |
| MetaGPT | NO — task-shape mismatch (greenfield not brownfield) | Steal SOP pattern via `multi-persona-pipeline-handoff-spec` |

### Q2.2: Reconsidering Shape B (OpenHands Automations at orchestrator layer)

The original wrap analysis rejected Shape B because it kills 3 moats (daemon-not-framework, TASKS.md surface, cross-repo fleet — net 3 of 6 survive). The threshold for "distinctive" is ≥4 moats; Shape B fails it.

But Q4 of the operator's questions reframes this: *"maybe if we take in more already built products, maybe I would be able to maintain it"*. The operator is signalling willingness to trade moat-collapse for maintenance reduction. Worth a re-think.

Post-Shape-B-wrap, Minsky would own ~3 moats:

| Moat | Status post-Shape-B-wrap | Retained value |
|---|---|---|
| Operator-machine identity | ✅ Strong — Automations run on operator's machine if configured that way | The single most defensible moat (VC-funded teams can't replicate it) |
| Constitution as deterministic CI | ✅ Strong — Minsky gates the agent's PRs regardless of which orchestrator scheduled them | Distinctive but copy-able (anyone could write the lint stack) |
| MAPE-K substrate | 🟡 Partial — observes Automations' outcomes rather than Minsky's own runner | Smaller value once OpenHands ships their own observability |
| Daemon-not-framework | ❌ — Automations IS the daemon | Lost |
| Cross-repo fleet | ❌ — Automations handle multi-repo workflows | Lost |
| TASKS.md surface | ❌ — Automations are configured via UI/SDK | Lost (BIG loss — this is the operator-friendliness moat) |

The TASKS.md-surface loss is the dealbreaker. The operator-machine identity moat depends on "operator edits markdown, daemon picks it up" — if Automations replace TASKS.md with a UI/SDK config, the operator's interface becomes vendor-controlled. Minsky becomes a security/identity wrapper around OpenHands' product, not its own product.

**Verdict on Shape B**: still NO, but now for a sharpened reason — TASKS.md loss is operator-facing, not just internal architecture. The 3-moat threshold reasoning was right but didn't name the load-bearing reason: **the operator surface IS the product**.

UNLESS OpenHands ships a "markdown-file work queue" option in Automations (they haven't announced this, but it's the natural shape). If they do, re-evaluate.

### Q2.3: New competitors worth wrapping

The untouched direct competitors per Phase 7 of the skill: AutoGen, LangGraph, OpenAI Agents SDK (orchestrator-tier); Augment Code, Cursor Agent, OpenAI Codex, SWE-Agent (agent-tier).

Quick wrap-feasibility judgement on each:

| Competitor | Likely verdict | Reasoning |
|---|---|---|
| **AutoGen** (Microsoft) | NO — structural mismatch | Python framework; general-purpose multi-agent; same shape as CrewAI |
| **LangGraph** | NO — structural mismatch | State-machine framework targeting LangChain users; not coding-specific |
| **OpenAI Agents SDK** | NO — moat collapse | OpenAI-only LLM lock-in; kills multi-LLM via OpenHands wrap |
| **Augment Code** | MAYBE — add as agent backend | Claude 3.7 + o1 ensemble, 65.4% SWE-bench. Different agent shape than OpenHands; could be a 5th backend in `~/.minsky/config.json`. Low-priority. |
| **Cursor Agent** | NO — wrong mode | IDE-first; Minsky targets background daemon, not editor integration |
| **OpenAI Codex** | MAYBE — add as agent backend | Once Codex CLI is mature; structurally similar to OpenHands |
| **SWE-Agent** | NO — academic baseline | Princeton research artifact; not maintained as production product |

**Net wrap-feasibility verdict**: 2 candidates worth full Phase-7 analyses in the next 6 months (Augment Code, OpenAI Codex). Both are agent-layer wraps as additional backends in `~/.minsky/config.json` — same shape as the approved OpenHands wrap. No new orchestrator-layer wraps clear the moat threshold.

---

## Q3: What makes us unique?

Pre-wrap, the moats list was 6:

1. Daemon-not-framework
2. Operator-machine identity
3. Constitution + deterministic CI
4. MAPE-K substrate
5. Cross-repo fleet
6. TASKS.md as operator surface

Post-OpenHands-wrap, all 6 survive (per [`docs/plans/2026-05-22-path-c-openhands-reshape.md`](./plans/2026-05-22-path-c-openhands-reshape.md) § "What OpenHands does NOT provide").

But the question "what makes us unique" deserves a sharper answer. Not all 6 are equally defensible:

| Moat | Defensibility | Why |
|---|---|---|
| **Operator-machine identity** | HIGH | VC-funded teams CAN'T build this because their business model requires running in their cloud. Devin = cloud-side Brain. CrewAI AMP = SaaS vault. OpenHands Cloud = SaaS. The "agent runs as you on your laptop with your credentials" moat is structurally hostile to the VC-funded business model. |
| **Constitution + deterministic CI** | MEDIUM | Distinctive today (no competitor enforces 17 rules via 53 lint stages) but COPYABLE. Any team could write a similar lint stack. The defensibility comes from the cost of maintaining 53 stages, not the IP. |
| **TASKS.md as operator surface** | MEDIUM | The convention is portable (tasks.md spec at github.com/tasksmd/tasks.md is OSS). Minsky's distinctive value is that the daemon honours the spec; the spec itself isn't proprietary. |
| **MAPE-K substrate** | LOW | Pattern is well-published (Kephart-Chess 2003, IBM autonomic computing). Anyone could implement; Minsky's substrate isn't shipping the closed loop yet anyway. |
| **Cross-repo fleet** | LOW | Once OpenHands Enterprise Automations ships open-source (June 1, 2026), this becomes a copyable feature. |
| **Daemon-not-framework** | LOW | Once OpenHands' Agent Canvas adds self-host-on-VM as first-class, Minsky's daemon shape becomes one of two daemon shapes available, not the only one. |

**The honest unique value is just operator-machine identity + constitution-as-CI.** The other 4 moats are real but copyable on a 6-12 month horizon as competitors mature.

This is the strategic kernel: **Minsky's permanent niche is "operator-controlled agent execution with deterministic gates on the agent's output"**. Everything else is tactical.

---

## Q4: Continue, sunset, or wrap-more?

This is the existential question. Three honest paths.

### Path A: Sunset Minsky, use what exists

Stop investing. Use OpenHands directly. Use Claude Code directly. Stop maintaining the daemon shell + the 53-stage lint stack + the cross-repo runner.

**What's gained**: ~10 hours/week of the operator's time back. No more dependency-management on 70K LOC.

**What's lost**: operator-machine identity (every shipped product runs in the vendor's cloud or with weakened identity). Constitution-as-CI (no equivalent exists). The 1 deployed instance (the operator's own machine).

**When this is right**: if the operator's time is better spent on something else (a different project, a real product, a job change, life). If the philosophical niche doesn't matter enough to fight for.

**Risk if chosen**: opportunity cost of having NOT built something distinctive in a field where the next 12 months will define the agent-tier orchestrator-tier split.

### Path B: Continue as-is

Keep building Minsky in the current shape. ~70K LOC, 14 novel/ packages, 53-stage lint. Try to ship M1 stably. Add features (M2 multi-persona, M3 GitHub Actions, M4 enterprise readiness). Don't reshape the codebase.

**What's gained**: trajectory continuity. Existing investment preserved.

**What's lost**: maintainability. A 70K-LOC project competing with $20M-Series-A teams over feature-completeness will burn out a 1-operator team. The codebase has already accumulated the structural debt typical of single-maintainer-overreach (53K-LOC lint stack, 14 novel/ packages).

**When this is right**: never, honestly. The math doesn't work for a 1-operator team competing on feature breadth.

**Risk if chosen**: feature-creep + maintenance debt + burnout. The codebase becomes too big to maintain in 12-18 months; the project dies via abandonment rather than decision.

### Path C: Continue, but RESHAPE — wrap more, build less

The operator's framing: *"maybe if we take in more already built products, maybe I would be able to maintain it and make it a better version"*.

**The reshape**: post-wrap Minsky becomes a thin operator-identity + constitution-as-CI layer on top of OpenHands (agent) + agentbrew (skill distribution) + a few other narrowly-chosen wraps. Target codebase size: ~10K LOC by end of 2026 (down from ~70K).

**What's wrapped (delegated to competitors)**:

- Agent loop → OpenHands (PR #733 approved)
- Multi-LLM routing → OpenHands' 15+ backend support
- Docker sandbox → OpenHands' pluggable sandbox layer
- Multi-task benchmark harness → OpenHands Index (5-task suite, quarterly updated)
- Skill distribution → agentbrew (already done — PR #729 added Minsky's `.claude/skills` as an agentbrew source)
- Memory architecture (when needed) → CrewAI's `unified_memory.py` pattern (already filed, P3)
- Episodic memory schema → Reflexion (already filed, P3)
- Sub-agent delegation (M2 work) → OpenHands' sub-agent shape from their May 2026 roadmap

**What stays distinctively Minsky** (~10K LOC total target):

- Daemon shell (~1K LOC) — bash entry + launchd/systemd + dynamic watchdog
- TASKS.md reader (~500 LOC) — parser + picker
- Constitution lint stack (~5K LOC) — TARGET DOWN from 53K LOC; aggressive deletion of lints that OpenHands' output already satisfies
- Operator-machine-identity layer (~500 LOC) — git/gh/ssh credential pass-through
- MAPE-K substrate (~1.5K LOC) — experiment-store + observer + task-filing audit
- Cross-repo fleet walker (~1K LOC) — `--hosts-dir` round-robin
- Cross-cutting infra (~500 LOC) — config, logging, error handling

**The aggressive deletion of the lint stack** is the big move. Many of the 53 stages exist because Minsky couldn't trust the spawned agent (Claude/Devin/Aider) to do the right thing. Post-wrap, OpenHands' agent has higher single-task quality (65.8% SWE-bench) AND inherits OpenHands' own quality gates (critic + best-of-N inference-time scaling). Many Minsky lint stages become belt-and-braces: useful but redundant. Audit each stage; delete the ones OpenHands' output already satisfies. Target: 53 → 15-20 stages.

**What's gained from Path C**: maintainability (10K LOC is 1-operator-sized), distinctive moats preserved (operator identity + constitution), strategic optionality (if OpenHands pivots, fall back to claude/aider as backends).

**What's lost**: some control. If OpenHands changes their CLI surface, Minsky has to adapt. If they pivot, the migration cost matters.

**When this is right**: if the operator wants to continue working on Minsky AND wants to do so sustainably AND values the distinctive niche enough to defend it.

**Risk if chosen**: vendor dependency on OpenHands. Mitigated by the 4-backend matrix (claude/devin/aider/openhands) — if OpenHands becomes hostile, fall back is 1 config edit.

### Recommendation: Path C

The math (70K LOC vs 1 operator) rules out Path B. Path A is correct only if the operator wants to stop, and nothing in the recent commit history suggests that (the operator just shipped strategic deep-dives + the wrap discipline + the future-vision doc — those are investments in the project's long-term direction). Path C is the only sustainable continuation.

The reshape requires 4 substantive sub-projects, each a separate task:

1. **Audit + delete redundant lint stages** post-OpenHands-wrap. Target 53 → 20 stages. ~2 weeks work, but only after OpenHands wrap ships (we need to see what their output looks like to know which Minsky lints become redundant).
2. **Audit + delete redundant novel/ packages**. Of the 14 packages: `competitive-benchmark` becomes a candidate for replacement by OpenHands Index. `dashboard-web` becomes a candidate (replace with `minsky watch` CLI subscribing to OpenHands' WebSocket — already planned in the wrap vision). `mape-k-loop` if not shipping near-term, fold into `experiment-record`. Target 14 → 8 packages.
3. **Codebase-size north star**: ~10K LOC by 2026 EOY. Track via a `loc-budget` lint or a quarterly review. If LOC grows instead of shrinks, fire the pivot.
4. **Document the "permanent kernel"**: the 5-7 things that stay Minsky-distinctive regardless of what competitors do. This is the doc operators read in 2 years to understand "why is this still a separate project from OpenHands?". Goes in `competitors/README.md` § "What Minsky uniquely does" — already partly there; sharpen the framing post-reshape.

---

## What NOT to change

Strategic preservation list — things that ARE working and shouldn't be touched in the reshape:

- **The discipline of rule #9 (pre-registered hypothesis)** — the Hypothesis / Success / Pivot / Measurement / Anchor block on every task is the project's quality moat. Don't loosen it.
- **The discipline of rule #1 (don't reinvent)** — encoded in the wrap-feasibility skill (Phase 7). Don't dilute this; sharpen it.
- **The operator-machine identity moat** — the load-bearing distinctive value. Every reshape decision protects this.
- **The TASKS.md surface** — operator-editable, version-controlled. Every reshape decision protects this.
- **The constitution itself (the 17 rules)** — distinct from the lint stack. The rules are conceptually distinct + worth keeping; the deletions target the IMPLEMENTATION of the lints, not the rules themselves.
- **The wrap-feasibility discipline + 5 canonical verdicts** (PR #732) — exactly the right shape for a 1-operator team. Apply it every quarter.
- **The honesty discipline** — every public-facing claim must match underlying user-story status. PR #729's MAPE-K honesty fix is the canonical example. Don't slip on this.

---

## What's filed as TASKS.md tasks from this review

Five new tasks file alongside this review (visible in `TASKS.md`):

1. `lint-stack-audit-post-openhands-wrap` (P1) — audit + delete lint stages redundant with OpenHands' output. Target 53 → 20 stages. Blocked on the OpenHands wrap shipping (Path C reshape — the largest deletion lever).
2. `novel-packages-audit-post-wrap` (P1) — audit + consolidate `novel/` packages. Target 14 → 8. Blocked on the OpenHands wrap shipping (Path C reshape — second-largest deletion lever).
3. `wrap-feasibility-autogen` (P2) — complete Phase 7 wrap-feasibility analysis on Microsoft AutoGen. Q2.3's quick verdict (NO) needs the formal write-up in `competitors/autogen.md`.
4. `wrap-feasibility-langgraph` (P2) — complete Phase 7 wrap-feasibility analysis on LangGraph. Q2.3's quick verdict (NO, structural mismatch) needs the formal write-up.
5. `wrap-feasibility-openai-agents-sdk` (P2) — complete Phase 7 wrap-feasibility analysis on OpenAI Agents SDK. Q2.3's quick verdict (NO, moat collapse via OpenAI lock-in) needs the formal write-up.

Three additional tasks recommended by this review but NOT yet filed (operator's call whether to file them now or after Path C reshape kicks off):

- `loc-budget-north-star` (P2) — track codebase LOC quarterly; goal 10K LOC by 2026 EOY. Needs a `scripts/check-loc-budget.mjs` lint that exits 1 if non-test LOC exceeds the per-quarter budget. File this once Path C reshape lands the first deletion sweep so the baseline is realistic.
- `reconsider-openhands-automations-when-markdown-queue-ships` (P3) — re-evaluate Shape B wrap IF OpenHands adds a markdown-file work-queue option to Automations (the TASKS.md-loss dealbreaker would dissolve).
- `evaluate-augment-code-and-codex-as-additional-backends` (P3) — when their CLIs are mature, run Phase-7 wrap analysis. Both are likely additional-backend candidates, not orchestrator-layer wraps.

## Re-evaluation triggers

Re-read this doc when ANY of these fire:

1. **OpenHands Agent Canvas Initiative ships** (June 1, 2026) — verify the wrap shape predicted in `docs/plans/2026-05-22-path-c-openhands-reshape.md` § "Architecture changes" matches reality. If their CLI is materially different, the reshape changes.
2. **Operator's available hours drop below 5/week** — Path C requires sustained 10 hours/week. Below that, Path A becomes the honest answer.
3. **A competitor ships a "Minsky-shaped" product** (operator-machine-identity + 24/7 daemon + git-native + constitution-as-CI) — at that point, the distinctive niche is contested; re-evaluate.
4. **The 70K-LOC codebase grows toward 100K LOC** — the reshape failed; Path B was implicitly chosen by inaction. Fire the pivot to Path A.
5. **The operator has not shipped a meaningful Minsky improvement to their own workflow in 60 days** — the project has stopped serving the operator's actual needs. Re-evaluate.

## Last reviewed

2026-05-22 — initial strategic review post-PR #734. Update on the next OpenHands-related decision or one of the re-evaluation triggers firing.
