# Competitor: Oh My Claude Code (OMC)

> OMC is a plugin that turns a single Claude Code session into a team of specialist roles that hand work to each other. Minsky uses it as the role layer for its Claude Code coding assistant — Minsky drives the outer loop; OMC plays the roles inside one session.

- **URL**: <https://github.com/Yeachan-Heo/oh-my-claudecode> / <https://ohmyclaudecode.com>
- **Status**: Active, v4.13.x as of 2026-05, 31.3k GitHub stars, MIT licensed
- **Pricing**: Free (open source, MIT). You pay only for the Claude models it calls.
- **Relationship**: **Dependency** — adopted as Minsky's `Orchestrator` layer on the Claude Code backend, scope-shrunk to that one backend.

## What this is

OMC is a zero-config plugin for Claude Code, the command-line coding assistant. Once installed, it lets one Claude Code session act as a team of specialist roles instead of one general-purpose assistant.

In this document, "agent" means the coding assistant that does the actual editing — Claude Code here. A **persona** is a role the agent takes on (researcher, planner, implementer, QA). Minsky is not an agent; it is the program that drives agents. OMC is the persona layer Minsky uses inside the Claude Code agent.

What OMC ships:

- **32 specialist personas** — architect, executor, qa-tester, code-reviewer, designer, security-reviewer, debugger, verifier, test-engineer, tdd-guide, planner, critic, analyst, product-manager, product-analyst, quality-strategist, scientist, writer, vision, dependency-expert, and more.
- **40+ skills.**
- **Four execution modes** — autopilot (run personas one after another), ultrawork (run them in parallel), team (a shared task list with personas messaging each other), and ralph (keep going until verified).
- **Smart model routing** — picks Haiku for simple work, Sonnet for medium, Opus for hard reasoning, with no operator ceremony. Claimed 30–50% token savings.
- **Architect verification gate** — in ralph mode, an architect persona must independently confirm the work is done before the session stops.

## What this is not

- **Not a daemon.** OMC has no background program that keeps running on your machine after the session ends. There is no auto-restart, no cross-session memory, and no "ship while you sleep" beyond a single in-session ralph loop. A daemon is a background program that keeps running; OMC is not one.
- **Not backend-agnostic.** OMC is a Claude Code plugin and runs only inside a Claude Code session. It cannot run against Devin, OpenHands, or a local model.
- **Not a peer to Minsky's outer loop.** OMC is the inner-loop role substrate Minsky wraps for one backend, the way Minsky wraps Aider for the local path.

## Strengths

- **Mature persona roster** — 32 personas, more comprehensive than Minsky would build from scratch.
- **Multiple coordination modes** — sequential (autopilot), parallel (ultrawork), team-with-shared-task-list, and relentless-verified (ralph).
- **Smart model routing built in** — Haiku for simple tasks, Opus for reasoning, chosen automatically.
- **Architect verification gate** — ralph mode never says "done" until an architect persona confirms it.
- **Inter-agent messaging** — built into team mode.
- **Large community** — 31k+ stars, 100+ articles, a plugins ecosystem.
- **MIT, free forever** — no licensing risk.
- **Clean distribution** — installs via the Claude Code marketplace.

## Weaknesses vs Minsky's vision

These are the layers Minsky adds above OMC. Several Minsky-specific terms appear here for the first time; each is glossed in plain words on first use.

1. **No 24/7 viability outside a session.** OMC is session-bound. There is no outer watchdog, no cross-session continuity, and no auto-restart.
2. **Token economy is not a system constraint.** OMC's routing optimizes each call on its own. It is unaware of 5-hour windows or weekly quota caps, and it has no auto-pause near limits and no error budget.
3. **No self-improvement loop.** OMC's architect verifies one task. Minsky runs a MAPE-K loop — a self-improvement loop with four phases: Monitor, Analyze, Plan, Execute, over a shared Knowledge base (Kephart & Chess, 2003). OMC does not watch its own results across many tasks or rewrite persona prompts based on observed failures over weeks.
4. **No constitutional grounding.** Minsky carries a constitution — the numbered, non-negotiable project rules in `vision.md`. OMC has no `vision.md`, so it cannot critique its own behavior against a fixed specification or detect specification drift.
5. **No prompt evolution.** OMC's personas are static. There are no A/B prompt variants tested against measurable metrics.
6. **No TASKS.md integration.** Minsky reads `TASKS.md`, a plain-text Markdown to-do list at a project's root, to pick work (per the tasks.md spec). OMC's internal "shared task list" is OMC-specific and not tasks.md-spec compatible. (Minsky has proposed this upstream as a community contribution.)
7. **No remote surface.** OMC is pure command line with a heads-up display. There is no phone, watch, or remote-control surface.
8. **No cross-repo roaming.** OMC is scoped to one project per session. It does not walk between repositories the way Minsky's `next-task` does.
9. **Empirical but ad hoc.** OMC works well but has no published theoretical framing (viable-system model, actor model, supervision tree). That framing matters for long-term evolvability and for teaching.

## What we learn / steal

- **Persona roster** — adopt all 32; no need to write Minsky's own.
- **Architect-verification gate** — extend the pattern to runtime specification monitoring at the meta-level (`claude-spec-monitor`).
- **Smart routing implementation** — borrow the difficulty-based selection patterns for Minsky's `claude-budget-guard`.
- **Plugin-distribution model** — Minsky may eventually ship as a Claude Code plugin itself.

## Why choose Minsky over OMC

Minsky and OMC are not peers, so the real answer is "use both." Minsky is the layer above. From `vision.md`:

> OMC handles "do this task well right now." Minsky handles "stay alive, on-budget, on-mission, and getting better, indefinitely."

OMC does not address the long-running viability layer. Minsky fills that gap and curates OMC into a full stack with the supervisor (the outer watchdog that restarts the program and survives reboots), observability, remote surface, and self-improvement pieces.

## Why choose OMC over Minsky

If your need is "make one Claude Code session dispatch the right specialist and verify the result before it says done," OMC covers it directly with zero config and a one-click marketplace install. Minsky's outer loop adds nothing when there is no fleet of repos to keep improving unattended.

## Scorecard readings

OMC has no entry in the benchmark corpus (`novel/competitive-benchmark/src/competitors.ts`), so there is no immutable scorecard table for it here. The only published number OMC claims is its smart-routing token saving of 30–50%, which is the vendor's own claim, not an independent benchmark. Treat it as a vendor claim with no methodology qualifier attached.

## Should we wrap OMC instead?

Per rule #1 (don't reinvent), every dependency-reassessment run ends with the wrap question: if a tool is excellent at what Minsky delegates to it, why not keep wrapping it everywhere? For OMC the answer is partly already true — OMC IS Minsky's adopted `Orchestrator` layer on Claude Code (32 personas, four modes, `AGENTS.md § Choosing an OMC mode for a task`). So the reassessment question is the inverse of the usual one: should Minsky keep wrapping OMC as the universal orchestrator, or shrink it to one backend now that OpenHands carries personas natively?

| Question | Output |
|---|---|
| 1. **Architectural fit** | Good as a **Claude-Code-only persona layer**, poor as a **cross-agent orchestrator**. OMC is a Claude Code plugin — it runs only inside a Claude Code session. With the OpenHands backend (`cloud_agent: openhands`) OMC cannot run at all; OpenHands' native MicroAgents + DelegateTool + TaskToolSet + AgentDefinition fill the persona role for that backend. Keeping OMC as *the* orchestrator forces a Claude-Code-shaped substrate onto a multi-backend daemon — a rule-#2 leak (a tool name, "OMC", implicitly in the orchestration path). |
| 2. **What we delegate** | **The in-Claude-Code persona dispatch + mode selection** (autopilot / ultrawork / team / ralph) when, and only when, the active backend is Claude Code. OMC owns: the 32-agent roster, the architect verification gate inside a ralph loop, and smart Haiku/Sonnet/Opus routing for Claude-family calls. Minsky keeps delegating exactly this for the Claude-Code path. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface). OMC has none of these — it is an inner-loop persona substrate Minsky drives within one backend, not a competitor for the outer loop. OpenHands now covers the same persona surface for its own backend, so OMC's wrap *shrinks* from "universal" to "Claude-Code-only" — it does not disappear. |
| 4. **Net moat after wrap** | 6 of 6. The relevant action is *scope-shrink + technique absorption*, not deeper delegation: absorb the cross-model routing heuristic (Haiku-for-simple / Opus-for-reasoning) into `claude-budget-guard`, and generalize the architect-verification-gate pattern into runtime specification monitoring (`claude-spec-monitor`). Neither requires OMC to be present on a non-Claude backend. |
| 5. **Verdict** | **NO cross-agent orchestrator wrap; YES keep-and-shrink the Claude-Code-only persona wrap.** OMC stays an optional Claude-Code layer; OpenHands carries personas for its backend; the two unique techniques (model routing, architect gate) are absorbed rather than depended-on cross-agent. No deprecation, no new universal-default task. |

**Trigger for re-evaluation**: if OMC ships outside Claude Code (a standalone CLI / daemon that runs against arbitrary backends), or if OpenHands' delegation regresses below OMC's roster quality, re-run this analysis — either event could re-expand OMC's scope from "one backend" back toward "universal".

## Five pivot questions

### 1. How is it different from Minsky?

OMC is a **session-bound, Claude-Code-only persona orchestrator**. Minsky is a **backend-agnostic 24/7 daemon** that drives agents (including a Claude Code session that may itself run OMC) on a queue across repositories. OMC's intent is to make a single Claude Code session dispatch the right specialist persona in the right coordination mode and verify the result before saying "done." Minsky's intent is to keep a fleet of repos improving without a human and without assuming any one backend, under a constitution enforced by CI.

They are not peers. OMC is the kind of inner-loop substrate Minsky wraps for one backend, the way it wraps Aider for the local path. The two defining structural differences:

- **The outer loop.** OMC has no daemon, no cross-session continuity, no auto-restart, and no budget homeostasis.
- **Backend-agnosticism.** OMC only exists inside Claude Code. Minsky must run identically under Claude, Devin, OpenHands, and local models (MILESTONES.md M1.9).

### 2. What lessons can it give to us?

- **Mode-per-task-shape dispatch** (`AGENTS.md § Choosing an OMC mode for a task`). OMC maps a task's shape to a coordination mode (sequential autopilot / parallel ultrawork / team-with-shared-list / relentless ralph). The portable lesson: the brief Minsky hands an agent should carry the *coordination shape* derived from the task's `**Tags**`, not just the task text. Minsky already encodes a thin version of this in its tag→mode table, and OMC validates that a small, fixed mode vocabulary beats per-task improvisation.
- **Architect verification gate** (ralph mode "never says done until verified"). OMC pairs every relentless run with an architect persona that must independently confirm completion. This is the in-session ancestor of Minsky's meta-level move: replace the *per-task* architect with a *deterministic* gate (`pnpm pre-pr-lint --stage=full` plus the merge gate) so verification never depends on a second LLM's mood. OMC proves operators trust a verification step; Minsky's job is to make that step deterministic (rule #10).
- **Smart model routing as a default, not a flag** (Haiku/Sonnet/Opus auto-selection, claimed 30–50% token savings). OMC routes per call by inferred difficulty with no operator ceremony. The lesson for `claude-budget-guard`: difficulty-based model selection is a default-by-default (rule #16) candidate. But OMC's routing is window-unaware — it optimizes per call, not against 5-hour or weekly caps — which is exactly the gap Minsky's budget-guard exists to close. So absorb the heuristic, and keep the window-awareness Minsky adds.
- **Plugin-distribution ergonomics, as a negative-for-now lesson.** OMC's clean Claude-Code-marketplace install is its reach multiplier, but it is also why it cannot be the cross-agent orchestrator: the very thing that makes it easy to adopt (being a Claude Code plugin) is the thing that scopes it to one backend. The lesson is to keep Minsky's orchestration substrate outside any single agent's plugin format, even though that costs the marketplace-distribution convenience.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — the reassessment is closed as "keep, scope-shrunk."** The hypothesis behind this task was that OpenHands' native persona stack might force OMC out of the dependency table, which would in turn touch the `Orchestrator`-layer framing in `vision.md`. On inspection it does not. OMC's deprecation is not warranted, only its *scope-shrink* from universal-orchestrator to Claude-Code-only persona layer.

The `Orchestrator` layer in the architecture survives intact — it is now backend-pluggable (OMC for Claude Code, OpenHands-native delegation for OpenHands, no persona layer for raw Devin or local). This *sharpens* `vision.md` § "What Minsky is" ("Minsky is not a framework … each layer is provided by an existing tool someone else maintains") rather than contradicting it: having two interchangeable persona substrates behind one seam is the rule-#2 adapter pattern working as designed, not a vision revision. The four lessons in §2 are all technique- or strategy-level (routing heuristic, verification-gate pattern, coordination-shape-in-brief, plugin-scope caution) — none touches the 17 constitutional rules. Per the deep-research convention this negative finding is recorded inline. Recommendation: **keep OMC scope-shrunk, absorb the two techniques, no vision change**.

### 4. How can we improve our strategy based on this?

- **Make the persona/orchestrator layer an explicit backend-pluggable seam.** OMC's Claude-Code-only nature exposed that "Orchestrator" was implicitly Claude-Code-shaped. Strategy move: define the persona-dispatch boundary as a rule-#2 adapter so OMC (Claude Code) and OpenHands-native delegation (OpenHands) plug in interchangeably, with "no persona layer" as a valid third option. Traces to lessons §2.1 and §2.4.
- **Keep verification deterministic, not delegated.** OMC's architect gate is trusted but LLM-driven. Strategy move: never regress Minsky's merge gate into a second-LLM check. Absorb the architect-gate pattern as the *shape* (verify before done) while the *mechanism* stays deterministic (rule #10). Traces to lesson §2.2.
- **Absorb difficulty-based routing into budget-guard, keep window-awareness.** OMC routes per call; Minsky must route per call *and* per token-window. Strategy move: lift OMC's difficulty heuristic into `claude-budget-guard` as the inner selector, with the 5-hour and weekly-cap logic wrapping it. Traces to lesson §2.3.
- **Treat OMC as a Claude-Code-distribution channel, not the orchestrator.** OMC's marketplace reach is real. Strategy move: if Minsky ever ships a Claude Code plugin, ride OMC's distribution model for that one backend, while the daemon substrate stays plugin-agnostic. Traces to lesson §2.4.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop** (the timer-driven outer loop): KEEP — OMC has no daemon, queue, or cross-session loop; nothing to replace. This is the outer-loop surface OMC is structurally unable to provide (session-bound, Claude-Code-scoped).
- **MAPE-K** (the self-improvement loop): KEEP — OMC's architect verifies one task in one session; it has no cross-task drift detection or prompt-evolution substrate.
- **Orchestrator / persona layer**: ALREADY-WRAPPED + SCOPE-SHRINK — OMC IS the persona layer on Claude Code (the wrap exists). Shrink it from universal to Claude-Code-only and add OpenHands-native delegation as the sibling backend behind the same seam. Absorb the model-routing and architect-gate techniques.
- **adapters / agent backend**: N/A — OMC is not an agent backend; it orchestrates personas inside the Claude Code backend.
- **sandbox**: N/A — out of OMC's scope.
- **corpus / scorecard**: KEEP — OMC stays in the M1.10 corpus as the Claude-Code persona dependency.
- **dashboard / TASKS.md surface**: KEEP — OMC's internal shared task list is OMC-specific and not tasks.md-spec compatible; Minsky's TASKS.md surface and fleet dashboard have no OMC equivalent.

**Total replace across all surfaces: 0% orchestrator replacement.** OMC already fills the Claude-Code persona slot; the action is one scope-shrink on that layer plus two technique absorptions, with everything else KEEP or N/A. The headline for the operator: nothing in the outer loop to replace; OMC stays the Claude-Code persona layer, scope-shrunk now that OpenHands carries personas natively; two techniques (model routing, architect gate) to absorb.

## Pin / integration

- **Version**: v4.13.x (minor-floating; integration tests gate updates).
- **Adapter**: `novel/adapters/orchestrator.omc.ts` (forthcoming).
- **Replacement procedure**: write `orchestrator.<replacement>.ts`; switch the import; run integration tests.

## Open issues we're tracking

- **Native tasks.md integration upstream** — file an issue proposing OMC `/team` mode optionally reads from `TASKS.md`. Tracked as P1 `omc-tasksmd-issue`.
- **Handoff persistence** — does OMC's shared task list persist to disk parseably? This determines bridge complexity. Tracked as P0 `research-omc-handoff-persistence`.

## Pattern conformance

- **Pattern OMC implements**: multi-agent orchestration with a shared task list and a manager-agent dispatcher (team mode); blackboard-style coordination — Hayes-Roth, "A Blackboard Architecture for Control", *Artificial Intelligence* 26(3) 1985 — combined with a generic role-based agent collective — Wooldridge, *An Introduction to MultiAgent Systems*, 2nd ed., Wiley, 2009.
- **Conformance level**: full (in the pattern OMC implements).
- **How Minsky relates**: adopt — OMC is the `Orchestrator` dependency. The blackboard substrate maps directly to Minsky's `TASKS.md` (row 8). Minsky adds the layers OMC explicitly does not cover (24/7 supervision, token-economy homeostasis, MAPE-K self-improvement, remote surface) but does not reimplement the orchestration layer.
- **Index row**: vision.md § "Pattern conformance index" row 50.

## Last reviewed

2026-06-02 — deepened with `## Should we wrap OMC instead?` plus `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-omc`. The 2026-05-22 reassessment flag is closed: verdict **KEEP OMC, scope-shrunk to a Claude-Code-only persona layer** (not deprecated; not the cross-agent default) now that OpenHands carries personas natively for its own backend. Absorb cross-model routing plus the architect-verification-gate technique; no vision change — a backend-pluggable persona seam sharpens rather than contradicts the rule-#2 `Orchestrator`-layer framing (negative finding logged inline per this task's central-questions routing).

Earlier reviews: 2026-05-03 (initial entry plus scorecard reading); 2026-05-22 (reassessment flag added under the OpenHands adoption).

## Read next

- [`openhands.md`](./openhands.md) — the backend that carries personas natively, the reason OMC's scope shrank.
- [`aider.md`](./aider.md) — the agent Minsky drives for the local-model path.
- [`../docs/validated-learnings.md`](../docs/validated-learnings.md) — entry `openhands-natively-covers-personas-and-skills`.
- [`../docs/visions/2026-05-22-openhands-fulfillment.md`](../docs/visions/2026-05-22-openhands-fulfillment.md) — the adoption context.
