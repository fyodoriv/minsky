# Dependency (status: keep, scope-shrunk to Claude-Code-only): Oh My Claude Code (OMC)

> **2026-06-02 reassessment closed.** Decision: **KEEP OMC as an optional, Claude-Code-only persona layer, scope-shrunk; do NOT deprecate, do NOT make it the cross-agent default.** The 2026-05-22 reassessment flag (added because OpenHands' native persona stack — MicroAgents + DelegateTool + TaskToolSet + AgentDefinition — covers most of OMC's surface; see [`../docs/validated-learnings.md`](../docs/validated-learnings.md) entry `openhands-natively-covers-personas-and-skills`) is resolved here via the Five Pivot Questions framework below. OMC's surface is now bounded to the Claude-Code backend only: OpenHands carries personas natively for the OpenHands backend, so OMC stops being the universal `Orchestrator` and becomes a backend-specific convenience. Its two genuinely-unique pieces — cross-model Haiku/Sonnet/Opus routing and the architect verification gate — are technique-absorption candidates, not reasons to keep a cross-agent dependency. See [`openhands.md`](./openhands.md) and [`../docs/visions/2026-05-22-openhands-fulfillment.md`](../docs/visions/2026-05-22-openhands-fulfillment.md) for the adoption context.
>
> Oh My Claude Code — adopted as Minsky's `Orchestrator` layer on Claude Code (the persona/CLI substrate). Reassessment complete: keep, scope-shrunk to the Claude-Code backend.

- **URL**: <https://github.com/Yeachan-Heo/oh-my-claudecode>
- **Site**: <https://ohmyclaudecode.com>
- **Status**: Active, v4.13.x as of 2026-05, 31.3k GitHub stars, MIT licensed
- **Relationship**: **Dependency** — adopted as our `Orchestrator` layer

## What it is

Zero-config multi-agent orchestration plugin for Claude Code. 32 specialist agents (architect, executor, qa-tester, code-reviewer, designer, security-reviewer, debugger, verifier, test-engineer, tdd-guide, planner, critic, analyst, product-manager, product-analyst, quality-strategist, scientist, writer, vision, dependency-expert, and more). 40+ skills. Four execution modes (autopilot, ultrawork, team, ralph). Smart Haiku/Sonnet/Opus routing claiming 30-50% token savings. Architect verification gate.

## Strengths

- **Mature persona roster** — 32 agents, more comprehensive than we'd build from scratch
- **Multiple coordination modes** — sequential (autopilot), parallel (ultrawork), team-with-shared-task-list, relentless-verified (ralph)
- **Smart model routing built in** — Haiku for simple tasks, Opus for reasoning, automatic
- **Architect verification gate** — Ralph mode never says "done" until verified
- **Inter-agent messaging** — built into Team mode
- **Massive community** — 31k+ developers, 100+ articles, plugins ecosystem
- **MIT, free forever** — no licensing risk
- **Plugin distribution** — clean install via Claude Code marketplace

## Gaps (what Minsky adds above it)

1. **24/7 viability outside a session.** OMC is session-bound. No outer supervisor, no cross-session continuity, no auto-restart, no "ship while you sleep" beyond a single in-session Ralph loop.
2. **Token economy as a system constraint.** Smart routing optimizes per-call but is unaware of 5-hour windows or weekly caps; no auto-pause near limits; no error budget.
3. **MAPE-K loop / self-improvement.** OMC's architect verifies one task. It doesn't observe drift across tasks or rewrite agent prompts based on observed failures over weeks.
4. **Constitutional grounding.** No vision.md → no critique against a constitution → no detection of behavioral drift.
5. **DSPy-style prompt evolution.** Agents are static. No A/B variants tested against measurable metrics.
6. **tasks.md integration.** Internal "shared task list" is OMC-specific; not tasks.md-spec compatible. (We've proposed this upstream as a community contribution.)
7. **Mobile / Watch / remote.** Pure CLI with HUD; no iPhone, Watch, or remote control surface.
8. **Cross-repo Roam.** Project-scoped per session; doesn't roam between repos like tasks.md `/next-task` does.
9. **Theoretical grounding.** Empirically excellent but ad hoc — no published VSM/Hewitt/supervision-tree framing. Matters for long-term evolvability and for documentation/teachability.

## What we extract or learn

- **Persona roster** — adopt all 32; no need to write our own
- **Architect-verification gate** — extend the pattern to runtime specification monitoring at the meta-level (`claude-spec-monitor`)
- **Smart routing implementation** — borrow patterns for our `claude-budget-guard`
- **Plugin distribution model** — Minsky may itself eventually ship as a Claude Code plugin

## Why we don't just use it

We do, for the layer it covers. Minsky is the layer above. From `vision.md`:

> OMC handles "do this task well right now." Minsky handles "stay alive, on-budget, on-mission, and getting better, indefinitely."

OMC explicitly does not address the long-running viability layer; Minsky exists to fill that gap and curate OMC into a full stack with the supervisor, observability, mobile, and meta-improvement pieces.

## Pin / integration

- **Version**: v4.13.x (minor-floating; integration tests gate updates)
- **Adapter**: `novel/adapters/orchestrator.omc.ts` (forthcoming)
- **Replacement procedure**: write `orchestrator.<replacement>.ts`; switch the import; run integration tests

## Open issues we're tracking

- **Native tasks.md integration upstream** — file an issue proposing OMC `/team` mode optionally reads from `TASKS.md`. Tracked as P1 `omc-tasksmd-issue`.
- **Handoff persistence** — does OMC's shared task list persist to disk parseably? Determines bridge complexity. Tracked as P0 `research-omc-handoff-persistence`.

## Should we wrap OMC instead?

> Per rule #1 (don't reinvent), every dependency-reassessment run ends with the wrap question: *if this is amazing at what we delegate to it, why not keep wrapping it everywhere?* For OMC the answer is partly already true — OMC IS Minsky's adopted `Orchestrator` layer on Claude Code (32 personas, four modes, `AGENTS.md § Choosing an OMC mode for a task`). The reassessment question is therefore the inverse of the usual one: *should we keep wrapping it as the universal orchestrator, or shrink it to one backend now that OpenHands carries personas natively?*

| Question | Output |
|---|---|
| 1. **Architectural fit** | Good as a **Claude-Code-only persona layer**, poor as a **cross-agent orchestrator**. OMC is a Claude Code plugin — it runs only inside a Claude Code session. With the OpenHands backend (`cloud_agent: openhands`) OMC cannot run at all; OpenHands' native MicroAgents + DelegateTool + TaskToolSet + AgentDefinition fill the persona role for that backend. Keeping OMC as *the* orchestrator forces a Claude-Code-shaped substrate onto a multi-backend daemon — a rule-#2 leak (a tool name, "OMC", implicitly in the orchestration path). |
| 2. **What we delegate** | **The in-Claude-Code persona dispatch + mode selection** (autopilot / ultrawork / team / ralph) when, and only when, the active backend is Claude Code. OMC owns: the 32-agent roster, the architect verification gate inside a Ralph loop, and smart Haiku/Sonnet/Opus routing for Claude-family calls. We keep delegating exactly this for the Claude-Code path. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface). OMC has none of these — it is an inner-loop persona substrate Minsky drives within one backend, not a competitor for the outer loop. OpenHands now covers the same persona surface for its own backend, so OMC's wrap *shrinks* from "universal" to "Claude-Code-only" — it does not disappear. |
| 4. **Net moat after wrap** | 6 of 6. The relevant action is *scope-shrink + technique absorption*, not deeper delegation: absorb the cross-model routing heuristic (Haiku-for-simple / Opus-for-reasoning) into `claude-budget-guard`, and generalize the architect-verification-gate pattern into runtime spec-monitoring (`claude-spec-monitor`). Neither requires OMC to be present on a non-Claude backend. |
| 5. **Verdict** | **NO cross-agent orchestrator wrap; YES keep-and-shrink the Claude-Code-only persona wrap.** OMC stays an optional Claude-Code layer; OpenHands carries personas for its backend; the two unique techniques (model routing, architect gate) are absorbed rather than depended-on cross-agent. No deprecation, no new universal-default task. |

**Trigger for re-evaluation**: if OMC ships outside Claude Code (a standalone CLI / daemon that runs against arbitrary backends), or if OpenHands' delegation regresses below OMC's roster quality, re-run this analysis — either event could re-expand OMC's scope from "one backend" back toward "universal".

## Five pivot questions

### 1. How is it different from Minsky?

OMC is a **session-bound, Claude-Code-only persona orchestrator**; Minsky is a **backend-agnostic 24/7 daemon** that drives agents (including a Claude-Code session that may itself run OMC) on a queue across repos. OMC's intent is to make a *single Claude Code session* dispatch the right specialist persona in the right coordination mode and verify the result before saying "done". Minsky's intent is to keep a fleet of repos improving *without* a human and *without* assuming any one backend, under a constitution enforced by CI. They are not peers: OMC is the kind of inner-loop substrate Minsky wraps for one backend, the way it wraps Aider for the local path. The defining structural differences are (a) the outer loop — OMC has no daemon, no cross-session continuity, no auto-restart, no budget homeostasis; and (b) backend-agnosticism — OMC only exists inside Claude Code, whereas Minsky must run identically under Claude, Devin, OpenHands, and local models (MILESTONES.md M1.9).

### 2. What lessons can it give to us?

- **Mode-per-task-shape dispatch** (`AGENTS.md § Choosing an OMC mode for a task`) — OMC maps a task's shape to a coordination mode (sequential autopilot / parallel ultrawork / team-with-shared-list / relentless ralph). The portable lesson: the brief Minsky hands an agent should carry the *coordination shape* derived from the task's `**Tags**`, not just the task text — Minsky already encodes a thin version of this in the tag→mode table, and OMC validates that a small, fixed mode vocabulary beats per-task improvisation.
- **Architect verification gate** (Ralph mode "never says done until verified") — OMC pairs every relentless run with an architect persona that must independently confirm completion. This is the in-session ancestor of Minsky's meta-level move: replace the *per-task* architect with a *deterministic* gate (`pnpm pre-pr-lint --stage=full` + the merge gate) so the verification never depends on a second LLM's mood. OMC proves operators trust a verification step; Minsky's job is to make that step deterministic (rule #10).
- **Smart model routing as a default, not a flag** (Haiku/Sonnet/Opus auto-selection, claimed 30–50% token savings) — OMC routes per-call by inferred difficulty with no operator ceremony. The lesson for `claude-budget-guard`: difficulty-based model selection is a *default-by-default* (rule #16) candidate, but OMC's routing is window-unaware (it optimizes per call, not against 5-hour / weekly caps), which is exactly the gap Minsky's budget-guard exists to close — so absorb the heuristic, keep the window-awareness Minsky adds.
- **Plugin-distribution ergonomics as a negative-for-now lesson** — OMC's clean Claude-Code-marketplace install is its reach multiplier, but it is *also* why it cannot be the cross-agent orchestrator: the very thing that makes it easy to adopt (being a Claude Code plugin) is the thing that scopes it to one backend. The lesson is to keep Minsky's orchestration substrate *outside* any single agent's plugin format, even though that costs the marketplace-distribution convenience.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — and the reassessment is closed as "keep, scope-shrunk".** The Hypothesis behind this task was that OpenHands' native persona stack might force OMC's deprecation from the dependency table, which would in turn touch the `Orchestrator`-layer framing in `vision.md`. On inspection it does not: OMC's deprecation is not warranted, only its *scope-shrink* from universal-orchestrator to Claude-Code-only persona layer. The `Orchestrator` layer in the architecture survives intact — it is simply now backend-pluggable (OMC for Claude Code, OpenHands-native delegation for OpenHands, no persona layer for raw Devin / local). This *sharpens* vision.md § "What Minsky is" ("Minsky is not a framework … each layer is provided by an existing tool someone else maintains") rather than contradicting it: having two interchangeable persona substrates behind one seam is the rule-#2 adapter pattern working as designed, not a vision revision. The four lessons in §2 are all technique/strategy-level (routing heuristic, verification-gate pattern, coordination-shape-in-brief, plugin-scope caution) — none touches the 17 rules. Per the deep-research convention this negative finding is recorded inline (this task's brief routes operator questions centrally rather than into this file); recommendation: **keep OMC scope-shrunk, absorb the two techniques, no vision change**.

### 4. How can we improve our strategy based on this?

- **Make the persona/orchestrator layer an explicit backend-pluggable seam** — OMC's Claude-Code-only nature exposed that "Orchestrator" was implicitly Claude-Code-shaped. Strategy move: define the persona-dispatch boundary as a rule-#2 adapter so OMC (Claude Code) and OpenHands-native delegation (OpenHands) plug in interchangeably, with "no persona layer" as a valid third option. Traces to lesson §2.1 + §2.4.
- **Keep verification deterministic, not delegated** — OMC's architect gate is trusted but LLM-driven. Strategy move: never regress Minsky's merge gate into a second-LLM check; the architect-gate pattern is absorbed as the *shape* (verify before done) while the *mechanism* stays deterministic (rule #10). Traces to lesson §2.2.
- **Absorb difficulty-based routing into budget-guard, keep window-awareness** — OMC routes per call; Minsky must route per call *and* per token-window. Strategy move: lift OMC's difficulty heuristic into `claude-budget-guard` as the inner selector, with the 5-hour/weekly-cap logic wrapping it. Traces to lesson §2.3.
- **Treat OMC as a Claude-Code-distribution channel, not the orchestrator** — OMC's marketplace reach is real. Strategy move: if Minsky ever ships a Claude-Code plugin, ride OMC's distribution model for that one backend, while the daemon substrate stays plugin-agnostic. Traces to lesson §2.4.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — OMC has no daemon/queue/cross-session loop; nothing to replace. This is the outer-loop surface OMC is structurally unable to provide (session-bound, Claude-Code-scoped).
- **MAPE-K**: KEEP — OMC's architect verifies one task in one session; it has no cross-task drift detection or prompt-evolution substrate.
- **Orchestrator / persona layer**: ALREADY-WRAPPED + SCOPE-SHRINK — OMC IS the persona layer on Claude Code (the wrap exists); shrink it from universal to Claude-Code-only and add OpenHands-native delegation as the sibling backend behind the same seam. Absorb model-routing + architect-gate techniques.
- **adapters / agent backend**: N/A — OMC is not an agent backend; it orchestrates personas inside the Claude Code backend.
- **sandbox**: N/A — out of OMC's scope.
- **corpus / scorecard**: KEEP — OMC stays in the M1.10 corpus as the Claude-Code persona dependency.
- **dashboard / TASKS.md surface**: KEEP — OMC's internal shared task list is OMC-specific and not tasks.md-spec compatible; Minsky's TASKS.md surface and fleet dashboard have no OMC equivalent.

**Total replace % across all surfaces: 0% orchestrator replacement** (OMC already fills the Claude-Code persona slot; one SCOPE-SHRINK on that layer plus two technique absorptions; everything else KEEP/N/A). The headline for the operator: *nothing in the outer loop to replace; OMC stays the Claude-Code persona layer, scope-shrunk now that OpenHands carries personas natively; two techniques (model routing, architect gate) to absorb.*

## Pattern conformance

- **Pattern OMC implements**: Multi-agent orchestration with a shared task list and a manager-agent dispatcher (Team mode); blackboard-style coordination — Hayes-Roth, "A Blackboard Architecture for Control", *Artificial Intelligence* 26(3) 1985 — combined with a generic role-based agent collective — Wooldridge, *An Introduction to MultiAgent Systems*, 2nd ed., Wiley, 2009
- **Conformance level**: full (in the pattern OMC implements)
- **How Minsky relates**: adopt — OMC is the `Orchestrator` dependency. The blackboard substrate maps directly to Minsky's `TASKS.md` (row 8). Minsky adds the layers OMC explicitly does not cover (24 / 7 supervision, token-economy homeostasis, MAPE-K self-improvement, mobile / Watch surface) but does not reimplement the orchestration layer.
- **Index row**: vision.md § "Pattern conformance index" row 50

## Last reviewed

2026-06-02 — deepened with `## Should we wrap OMC instead?` + `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-omc`. The 2026-05-22 reassessment flag is closed: verdict **KEEP OMC, scope-shrunk to a Claude-Code-only persona layer** (not deprecated; not the cross-agent default) now that OpenHands carries personas natively for its own backend. Absorb cross-model routing + architect-verification-gate techniques; no vision change — backend-pluggable persona seam sharpens rather than contradicts the rule-#2 `Orchestrator`-layer framing (negative finding logged inline per this task's central-questions routing).

Earlier reviews: 2026-05-03 (initial entry + scorecard reading); 2026-05-22 (reassessment flag added under the OpenHands adoption).
