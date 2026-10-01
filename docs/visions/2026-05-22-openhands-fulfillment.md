# Alternative vision — "OpenHands that improves itself + follows hard rules"

> **Status: alternative under review.** This document is a candidate sharpening of the canonical [`vision.md`](../../vision.md), not a replacement. Authored 2026-05-22 by an agent session in response to the operator's thought experiment "what is minsky if it adopts OpenHands maximally?" Operator's verbatim formulation is the title. To promote this to canonical: copy the relevant sections into `vision.md`, remove this document, record the promotion in `validated-learnings.md`. To reject: leave this document in place as a recorded alternative considered.

## The one-sentence identity

**Minsky is OpenHands that improves itself + follows some hard rules and principles.**

This is the operator's verbatim formulation from the 2026-05-22 conversation. It is sharper than every prior framing in the repo because it (a) names the runtime explicitly, (b) names the self-improvement property, (c) names the constraint discipline, and (d) implies the integration-distribution identity that the canonical vision already articulates.

## The two axes

The surviving minsky surface — what remains after maximally adopting OpenHands and resolving the latent rule-#1 violations — collapses cleanly into two axes. Every novel/ package maps to exactly one. Anything that doesn't map to one of the two is a rule-#1 violation in waiting.

### Axis 1 — Self-improvement loop (the "improves itself" half)

The autonomic management layer that turns a single OpenHands session into a fleet that operates unattended and improves across runs.

- **MAPE-K control plane** — Monitor / Analyze / Plan / Execute over a Knowledge base. *(Kephart, J. O. & Chess, D. M., "The Vision of Autonomic Computing", IEEE Computer, vol. 36, no. 1, Jan 2003.)*
- **Experiment store + validated-learnings ledger** — cross-run knowledge accumulation that drives subsequent task selection and brief curation. *(Beer, S., *Brain of the Firm*, 2nd ed., Wiley 1981 — Viable System Model, System 4 long-term adaptation.)*
- **Multi-host fair scheduler** — 3-iterations-per-host round-robin across N repos under `--hosts-dir`. Standard scheduler fairness applied to repo-as-host.
- **Watchdog + budget guard + local-model fallback** — keeps the loop alive when cloud quotas exhaust or a child hangs. *(Armstrong, J., "Making reliable distributed systems in the presence of software errors", PhD thesis, KTH 2003 — Erlang/OTP "let it crash" + supervisor restart semantics.)*
- **OS supervisor integration** — launchd / systemd KeepAlive so the daemon survives host reboots.
- **Fleet dashboard (`minsky watch`)** — operator-facing observability of the autonomic loop.

### Axis 2 — Hard rules and principles (the "follows hard rules" half)

The constitution + its deterministic enforcement. Every change passes through these gates; none of them are advisory.

- **Rule-#9 pre-registered hypothesis-driven discipline** — every change carries Hypothesis / Success / Pivot / Measurement / Anchor *before* code. Iron rule, no exemption. *(Munafò, M. R., Nosek, B. A., Bishop, D. V. M., et al., "A manifesto for reproducible science", Nature Human Behaviour 1, 0021, 2017.)*
- **Constitutional rule lints (rule #10)** — every constitutional rule is a deterministic CI check, not a skill, not an LLM, not "the agent will remember." LLM-driven checks are advisory only; never load-bearing.
- **Literature-citation gate (rule #1 + rule #5)** — every PR cites the libraries it considered or the patterns it implements. Citation-or-fail-the-build.
- **TASKS.md rule-#9-enforcing picker** — rejects P0/P1 tasks missing any of the 5 pre-registration fields before they enter the autonomic loop.
- **Safety gates (defence in depth)** — scope-drift, secret scan, daemon-pr-lint, the 15-check mechanical pre-PR stack.

## What this resolves

A long-standing rule-#1 violation. The canonical vision.md already says *"Minsky is not a framework. It does not contain a multi-agent runtime... Each of those is provided by an existing tool someone else maintains."* The current code violates this at the runtime layer by maintaining direct Claude/Devin/Aider subprocess adapters. Adopting OpenHands maximally resolves the violation. The thought experiment is vision-fulfillment, not vision-revision.

Estimated minsky surface reduction: ~35% of novel/ code is replaced by the OpenHands adapter (Claude/Devin/Aider runtime adapters, worktree manager, multi-model abstraction). The remaining ~65% maps to the two axes above.

## What this rules OUT

Things this alternative vision explicitly does NOT include in minsky's scope, in case future agents need a reference:

1. **No task-level persona pipeline as a minsky component.** Personas (if needed) live in the runtime layer — either inside OpenHands' MicroAgents / delegate framework, or in a layer adopted from outside (research pending in TASKS.md `competitor-deep-research-tier-s-2026-05`).
2. **No multi-agent runtime maintained by minsky.** That's OpenHands' job.
3. **No DSL, no framework abstractions, no opinionated workflow engine.** Minsky composes existing tools through versioned adapter interfaces (rule #2).
4. **No closed-vendor lock-in.** Every dependency is OSS or has an OSS replacement candidate documented in `competitors/` and `ARCHITECTURE.md` § dependency table.

## Tagline candidates (in order of directness)

1. **"Self-improving OpenHands under constitutional discipline."** *(10 words, captures both axes, names the runtime)*
2. **"The autonomic supervisor for autonomous coding agents — pre-registered, hypothesis-driven, continuously improving."** *(more technical, anchors on MAPE-K)*
3. **"Wraps OpenHands in an autonomic loop. Enforces hypothesis-driven discipline on every PR. Runs unattended for years."** *(three-clause version)*

## Open questions — research outcomes 2026-05-22

The operator-initiated research on three of the four questions concluded same session. Findings recorded below; remaining open question is #4.

### Q1 — RESOLVED: OpenHands has rich native persona / sub-agent support

OpenHands ships **four complementary persona primitives**, all production-ready:

1. **MicroAgents** ([`.openhands/microagents/`](https://docs.openhands.dev/openhands/usage/prompting/microagents-overview)) — markdown files with YAML frontmatter, three sub-types:
   - **Knowledge agents** (KNOWLEDGE) — triggered by keywords in conversation; provide domain-specific playbooks
   - **Task agents** (TASK) — triggered by user commands, support parameterized `inputs:`
   - **Repository agents** (REPO) — auto-loaded for a specific repo from `.openhands/microagents/repo.md`
   - **Compatible with the AgentSkills specification** ([agentskills.io](https://agentskills.io/specification)) — *the same spec Claude Code's skills already use*, which means minsky's existing skill catalog (synced today via agentbrew to `.claude/`, `.cursor/`, `.codeium/`, `.config/devin/`, `.agents/`) ports to `.openhands/microagents/` mechanically. **This is a major rule-#1 win.**
2. **DelegateTool** ([`openhands.tools.delegate`](https://docs.openhands.dev/sdk/guides/agent-delegation)) — parallel sub-agent delegation. Main agent spawns N sub-agents with identifiers, dispatches tasks in parallel, blocks until all return, gets a consolidated observation. Has `DelegationVisualizer` for terminal UX.
3. **TaskToolSet** ([docs](https://docs.openhands.dev/sdk/guides/task-tool-set)) — sequential blocking sub-agent delegation. Parent calls `task` tool with `prompt` + `subagent_type`; sub-agents are persisted and resumable via `task_id`. Designed for chain-of-responsibility patterns.
4. **AgentDefinition** (`openhands.sdk.subagent.AgentDefinition`) — declarative sub-agent spec with `name`, `description`, `tools`, `system_prompt`. Register via `register_agent()` and reference by name in delegation. Example in `examples/01_standalone_sdk/42_file_based_subagents.py`.

**Implication for minsky:** there is **no need to build personas** in minsky's scope. OpenHands natively provides everything the persona pipeline pattern (research → developer → QA → reviewer) requires, *and the skill format is shared with Claude Code* so the existing skill catalog ports directly.

### Q2 — RESOLVED: Nobody has built minsky-shape on top of OpenHands

Searched 2026-05-22 across: GitHub topics, awesome-* lists, OpenHands' own ecosystem page, the V1 SDK paper ([arxiv:2511.03690](https://arxiv.org/abs/2511.03690)), the `OpenHands/extensions` registry. The OpenHands ecosystem includes:

- **OpenHands SDK** (V1, ~70k stars) — the agent foundation, used by all other OpenHands surfaces
- **OpenHands CLI** — terminal interface, Claude-Code-shaped
- **OpenHands Local GUI** — local-machine GUI, Devin-shaped
- **OpenHands Cloud** — hosted, ships Slack/Jira/Linear integrations, RBAC, multi-user, conversation sharing
- **OpenHands Enterprise** — self-hosted Cloud in VPC, Kubernetes-deployed
- **OpenHands extensions** — public skill marketplace ([github.com/OpenHands/extensions](https://github.com/OpenHands/extensions))

**Nothing in the ecosystem implements**: MAPE-K autonomic control, cross-run experiment store + validated-learnings, multi-host fair scheduler, rule-#9 pre-registration discipline, constitutional rule lints, literature-citation gate. The Supervisor Agent draft PR ([#4449](https://github.com/All-Hands-AI/OpenHands/pull/4449)) is *within-session* hierarchical agent supervision, not *across-session* fleet supervision. Different layer.

**Implication for minsky:** the niche is open. The two axes (self-improvement loop + hard rules) remain minsky's unique contribution.

### Q3 — RESOLVED: OMC's role contracts but doesn't necessarily disappear

OMC was adopted as the persona orchestrator on Claude Code, providing 32 specialist agents + multi-coordination modes + smart Haiku/Sonnet/Opus routing + architect verification gate + inter-agent messaging.

OpenHands' native delegation primitives (Q1) cover most of OMC's surface:

- 32 specialist agents → MicroAgents + AgentDefinition cover this directly
- Multi-coordination modes (autopilot/ultrawork/team/ralph) → DelegateTool (parallel) + TaskToolSet (sequential) cover the major modes; ralph mode is independently provided by [`competitors/ralph-wiggum-official.md`](../../competitors/ralph-wiggum-official.md)
- Inter-agent messaging → handled via delegation result-passing
- Open source / community → OpenHands is larger

What OMC adds that OpenHands doesn't natively provide:

- **Smart cross-model routing** (Haiku for cheap tasks, Opus for reasoning) — OpenHands picks one model per session, no auto-routing by task shape
- **Architect verification gate** (Ralph mode never says "done" until verified) — OpenHands has no equivalent yet; the Supervisor Agent draft PR is the closest

**Implication for minsky:** OMC moves from *primary persona orchestrator* to *optional model-routing + verification gate layer*, possibly used alongside OpenHands for specific tasks. Or deprecated entirely if the marginal value doesn't justify maintaining a Claude-Code-specific dependency. Defer the decision; mark OMC as "status under reassessment 2026-05-22" in [`competitors/omc.md`](../../competitors/omc.md).

### Q4 — STILL OPEN

**What's the smallest viable surface?** Could axis 1 (self-improvement loop) itself be delegated to an existing autonomic-systems library? Are there OSS MAPE-K implementations worth surveying? *(Lower priority than Q1-3; deferred until OpenHands adoption is concretely in progress.)*

## Relationship to canonical vision.md

This document does **not contradict** the canonical vision. It sharpens what vision.md already says:

| Canonical vision.md § "What Minsky is" | This alternative |
|---|---|
| *"Minsky is a plug-and-play repo transformer."* | Same — the runtime adopted (OpenHands) does the transforming; minsky's autonomic + rules layer makes it durable |
| *"Continuous improvement loop a repo runs on indefinitely."* | Same — axis 1 (self-improvement) names this explicitly |
| *"Every change is a pre-registered experiment under rule #9."* | Same — axis 2 (hard rules) names this explicitly |
| *"Minsky is not a framework. It does not contain a multi-agent runtime."* | This alternative makes that real at the runtime layer for the first time |
| *"The small layers nobody else is building."* | Axes 1 and 2 ARE the small layers |

The promotion path is: replace the existing vision.md § "What Minsky is" first paragraph with the one-sentence identity and the two-axis decomposition, leaving the rest of vision.md (constitution, glossary, pattern conformance index) untouched. The constitution doesn't change; only the identity statement sharpens.

## Promotion criteria

Three of the four original criteria are now resolved (2026-05-22 research session). Promote this alternative to canonical when the remaining gate is met:

1. ✅ **Q1 resolved** — OpenHands natively supports personas (MicroAgents + DelegateTool + TaskToolSet + AgentDefinition); AgentSkills-spec compatible; minsky's skill catalog ports mechanically.
2. ✅ **Q2 resolved** — no existing project covers >70% of axes 1+2; minsky's niche is open.
3. ✅ **Q3 resolved** — OMC reassessed; demoted from primary persona orchestrator to optional model-routing + verification gate layer, with deprecation pending.
4. ⏳ **Pending** — OpenHands adoption A/B from [`competitors/openhands.md`](../../competitors/openhands.md) is complete; the `agent-runtime.openhands.ts` adapter is merged and `bin/minsky competitive` data shows OpenHands is at parity or better on the M1.10 corpus.

When gate 4 closes green, copy the one-sentence identity + two-axis decomposition into `vision.md` § "What Minsky is", remove this document, and record the promotion in `validated-learnings.md`. If gate 4 closes red (OpenHands underperforms on the M1.10 corpus), this alternative stays as a recorded-but-not-adopted exploration and the canonical vision.md stays as-is.

## Cross-references

- [`vision.md`](../../vision.md) — the canonical constitution this alternative would sharpen
- [`validated-learnings.md`](../../validated-learnings.md) entry `vision-was-load-bearing-on-runtime-adoption` — records the realization that motivated this alternative
- [`competitors/openhands.md`](../../competitors/openhands.md) — the dependency adoption that makes this alternative possible
- [`competitors/README.md`](../../competitors/README.md) — the dependency decision rule applied throughout
- [`docs/language-strategy.md`](../language-strategy.md) — the polyglot pattern that makes OpenHands adoption a TS-interface + Python-implementation adapter, not a rewrite
