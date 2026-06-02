# Dependency-candidate: Claude Agent SDK

> Anthropic's official SDK for building agents on Claude — successor to the claude-code-sdk. It sits one level below Minsky's existing dependencies (Claude Code the harness, OMC the persona layer): the programmatic primitives. This file exists to answer one strategic question — does Anthropic shipping first-party agent primitives (and, critically, *durable background sessions*) reframe what Minsky uniquely provides, or does it just give Minsky a cleaner Claude backend to wrap?

- **URL**: <https://github.com/anthropics/claude-agent-sdk-python> / <https://github.com/anthropics/claude-agent-sdk-typescript>
- **Docs**: <https://docs.anthropic.com/en/api/agent-sdk/overview>
- **Status**: Active — rebranded from "Claude Code SDK" to "Claude Agent SDK" (Sep 2025) when Anthropic generalized the primitives beyond coding; ships in Python and TypeScript
- **Pricing**: SDK is free (MIT-licensed bindings); Anthropic API token costs apply per call
- **Relationship**: **Dependency-candidate** — the right substrate for Minsky's Claude-backend agent adapter; NOT an orchestrator competitor

## What it is

Anthropic's official SDK for building autonomous agents on Claude. It exposes the loop Claude Code itself is built on — the agentic harness — as a programmable library. Primitives: the agent loop (gather context → take action → verify → repeat), tool definition and execution, subagent spawning, MCP server hosting (in-process and external), Skills loading (markdown + YAML frontmatter, the same format as Minsky's skill library), permission/hook callbacks, session resumption, and structured streaming of the assistant turn.

The SDK is *what Claude Code is built on*, exposed for external use. That makes it the natural replacement for any Minsky component that currently shells out to the `claude` CLI and parses its output — a stable, Anthropic-maintained API instead of subprocess scraping.

## What it is NOT

- **Not a daemon / not a queue.** Like Claude Code, the SDK builds a *single agent session*. It has no cross-repo loop, no TASKS.md drain, no supervisor, no budget guard. Anthropic's own framing (docs § "Building agents with the Claude Agent SDK") is about *single-agent* and *multi-subagent* applications, not unattended fleets.
- **Not cross-model.** Claude-only by definition. The cross-model runtime is OpenHands' job in Minsky's stack.
- **Not self-improving.** No MAPE-K loop, no experiment store, no prompt-optimization substrate.

## Strengths

- **Anthropic-maintained** — ships in lockstep with model releases; the harness updates that used to require Minsky to chase `claude` CLI changes now arrive as SDK versions.
- **The agent loop, batteries-included** — context gathering, tool execution, verification, and compaction are handled; you don't rebuild the loop.
- **Native Skills loading** — markdown skills with YAML frontmatter; identical format to Minsky's existing skill library, so Minsky's skills are portable into an SDK-hosted session with zero rewrite.
- **Native MCP** — first-class MCP server hosting (in-process SDK servers + external stdio/HTTP servers).
- **Subagent spawning** — programmatic equivalent of Claude Code's Task tool, with per-subagent system prompts and tool allowlists.
- **Permission + hook callbacks** — `canUseTool` / hook interception is exposed, so a host can enforce policy at the tool boundary (the seam Minsky's constitution cares about).
- **Session resumption** — sessions can be resumed by id, which is the primitive that matters most to Minsky (see § "Five pivot questions" Q3).

## Gaps vs minsky's vision

1. **Claude-only.** Wrong choice as the *sole* runtime for a cross-model strategy. Minsky needs Claude + OpenAI + local-model paths; the SDK covers exactly one.
2. **Single-session shape.** Builds agent loops, not daemons. No queue, no cross-repo fleet, no unattended outer loop.
3. **No autonomic layer.** Stays at the agent-runtime layer; doesn't replace Minsky's MAPE-K supervisor, experiment store, or budget guard.
4. **No constitution / merge gate.** The SDK can *enforce a tool policy* via hooks, but it has no notion of a 17-rule constitution checked by CI before a PR merges. That governance layer is Minsky's, not Anthropic's.

## Should we wrap the Claude Agent SDK instead?

> Per rule #1 (don't reinvent), every dependency-candidate research run ends with the honest question: *if this is the real substrate for the thing we do, why aren't we already wrapping it?* For the Claude Agent SDK the answer is: **we should wrap it — but at the agent tier, not the orchestrator tier.** The SDK is the *inner loop* Minsky drives, not a competitor for the *outer loop*.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Excellent as an **agent-tier backend**, irrelevant as an **orchestrator replacement**. The SDK is a per-session agent loop. It slots cleanly behind Minsky's agent seam — `novel/adapters/agent-runtime.claude.ts` becomes a thin call into the SDK instead of subprocess-wrapping the `claude` CLI (rule #2: the SDK is the dependency, the adapter is the interface). It cannot host the tick-loop / supervisor / budget-guard / experiment-store layers — Anthropic explicitly scopes the SDK to single-agent + multi-subagent applications, not unattended fleets. |
| 2. **What we delegate** | **The Claude single-iteration agent loop** — context assembly, tool execution, subagent spawning, MCP hosting, Skills loading, verification, compaction. Today Minsky reimplements the *delivery* of this via `claude` CLI subprocess + stdin brief + output parsing. The SDK owns it as a typed API. We delegate the harness; we keep owning *what brief goes in and what gate the output must clear*. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution + CI merge gate, MAPE-K substrate, cross-repo fleet, TASKS.md surface). The SDK has none of these. Wrapping it *more deeply* (making it the canonical Claude backend) erodes zero moats and removes subprocess-scraping fragility — pure upside. |
| 4. **Net moat after wrap** | 6 of 6 (the SDK becomes the Claude agent backend; no orchestrator surface is delegated). The action is a backend swap (`claude` CLI subprocess → SDK call), not a structural delegation of the loop Minsky exists to run. |
| 5. **Verdict** | **NO orchestrator wrap; YES adopt the SDK as the Claude agent-runtime backend.** Replace the `claude` CLI subprocess in `novel/adapters/agent-runtime.claude.ts` with the SDK once a Minsky component needs Claude programmatically. No P0 *vision* task is filed; this is a P2/P3 adapter modernization (subprocess → typed API), tracked when the Claude backend next needs touching. The OpenHands wrap stays the cross-model runtime; the SDK is the Claude-specific path. The two coexist (the tentative verdict from the stub, now confirmed). |

**Trigger for re-evaluation**: if Anthropic ships a *durable, unattended background-session API* — sessions that survive process death, advance without a foreground client, and can be polled/resumed by a daemon — then the SDK starts encroaching on the tick-loop's reason to exist. That specific capability is the watch item; see Q3 below.

## Five pivot questions

### 1. How is it different from Minsky?

The Claude Agent SDK is an **agent-tier library** for building one Claude agent session (with subagents) inside a host process; Minsky is an **orchestrator-tier 24/7 daemon** that drives agents — including, prospectively, SDK-hosted Claude sessions — on a queue across repos, under a constitution enforced by a CI merge gate. They are not peers. The SDK is the kind of inner-loop runtime Minsky *wraps*, the same way it already wraps Claude Code, Devin, and Aider. The defining structural difference is the *outer loop and the gate*: the SDK runs one session to completion and stops; Minsky never stops, picks the next task itself, and refuses to merge any session's output that fails the 17-rule constitution. Anthropic's SDK gives you a great agent; Minsky gives you a fleet of them that runs unattended and self-governs.

### 2. What lessons can it give to us?

- **The agent loop as a stable contract** (docs § "Building agents with the Claude Agent SDK" — gather context → act → verify → repeat) — Anthropic has frozen the harness Minsky currently scrapes from the `claude` CLI into a versioned API. Lesson: Minsky's `novel/adapters/agent-runtime.claude.ts` should depend on this contract (rule #2) rather than on CLI output format, which drifts release-to-release and is the source of recurring brittle-parse bugs.
- **Skills as the portable capability unit** (docs § "Agent Skills" — markdown + YAML frontmatter) — the SDK loads the *exact same skill format* Minsky already uses. Lesson: Minsky's skill library is already SDK-portable; the capability layer is not a lock-in surface. This is independent confirmation that the markdown-skill convention was the right bet.
- **Hooks / `canUseTool` as a policy seam** (docs § "Permissions" and "Hooks") — Anthropic exposes tool-call interception so the host can allow/deny/modify each tool use. Lesson: this is a *deterministic enforcement* hook (rule #10) Minsky can use to apply constitutional constraints *during* a session, not only at the post-hoc merge gate — a candidate for tightening moat #3 from "gate at the end" to "gate at the seam".
- **Subagent + MCP hosting as first-class** (docs § "Subagents", § "MCP") — Anthropic treats subagent spawning and MCP hosting as runtime primitives. Lesson: Minsky should *not* reimplement either; any Minsky code that hand-rolls subagent spawning or MCP plumbing for the Claude backend is a rule-#1 violation once the SDK is adopted.

### 3. Are any of these lessons potentially vision-changing?

**This is the load-bearing question for this task, and the answer is: NO vision rewrite is forced today — but the hypothesis behind the task identifies a real, specific roadmap threat that must stay on the watch list.** The task's Hypothesis was: *if Anthropic ships durable background-session APIs, Minsky's tick-loop becomes a thinner wrapper.* Examined honestly:

- **What exists today does NOT force a rewrite.** The current SDK is a *single-session, foreground* agent loop. It has session *resumption* (resume-by-id) but resumption is client-driven: something has to call the SDK to advance the session. There is no Anthropic-hosted, self-advancing, process-death-surviving background loop. The thing that would obviate the tick-loop — *an unattended session that advances on its own and can be polled by a daemon* — is precisely the thing the SDK does **not** ship. So the tick-loop's reason to exist (an outer loop that picks the next task and keeps a session alive across process death, rate limits, and machine reboots) is untouched. Minsky's `vision.md § What Minsky is` ("a daemon, not a framework") and the tick-loop's role stand.
- **Even the maximal version of the threat doesn't dissolve the moat.** Suppose Anthropic *does* ship durable background sessions. That would let Minsky delete the *session-keep-alive* mechanics inside the tick-loop (a real simplification, and a welcome one — rule #1). It would **not** provide: cross-repo task selection, the TASKS.md/queue surface, the operator-machine identity, the budget guard, the experiment store, or — most importantly — the **constitution + CI merge gate**. Durable sessions make the inner loop cheaper; they do not supply the *governance* and *fleet* layers that are moats #3–#6. So the correct response to that future would be **fold, not pivot**: thin the tick-loop's keep-alive code to a wrapper over Anthropic's durable-session primitive, keep everything above it.
- **Conclusion (pre-registered Pivot check):** the task's Pivot threshold was "if SDK roadmap obviates ≥40% of Minsky's tick-loop surface, file vision-threat Q." Today the SDK obviates ~0% (no durable background API exists). The *potential* obviation, if durable sessions ship, is bounded by the keep-alive/resumption share of the tick-loop — a minority of its surface, and below the 40% bar, because task-selection + supervision + the gate are not session primitives. **Threshold not crossed → no vision-threat question filed.** This is a *negative finding*, recorded here per the deep-research convention (this task's brief routes operator questions centrally rather than editing `ask-human.md`). Recommendation: **adopt the SDK as the Claude backend; keep the durable-background-session capability as the single explicit watch item; no `vision.md` change.**

### 4. How can we improve our strategy based on this?

- **Modernize the Claude backend from CLI-subprocess to SDK call** — the recurring brittle-parse failures in the `claude` CLI path are a fragility tax. Strategy move: make `novel/adapters/agent-runtime.claude.ts` depend on the Claude Agent SDK contract (rule #2), eliminating output-format scraping. Traces to lesson §2.1.
- **Treat the constitution as a tool-seam policy, not only a merge gate** — the SDK's `canUseTool` hook lets Minsky deny constitution-violating tool calls *during* a session, catching violations earlier and cheaper than the post-hoc PR gate. Strategy move: prototype a constitutional `canUseTool` hook as a deterministic in-session enforcement layer (rule #10), complementing — not replacing — the merge gate. Traces to lesson §2.3.
- **Lean on Anthropic's subagent/MCP primitives instead of hand-rolling** — for the Claude backend, delete any Minsky code that reimplements subagent spawning or MCP hosting once the SDK is adopted (rule #1). Strategy move: an audit pass over the Claude adapter for reinvented primitives at SDK-adoption time. Traces to lesson §2.4.
- **Pre-position the "fold, don't pivot" plan for durable sessions** — write down *now* (this file) that durable background sessions, if Anthropic ships them, are a tick-loop *simplification*, not an existential threat. Strategy move: keep the watch item explicit so a future agent doesn't over-react to the announcement. Traces to lesson §2.1 + Q3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — the SDK has no daemon/queue/cross-repo loop. *Watch*: if durable background sessions ship, fold the keep-alive mechanics into a wrapper over the SDK primitive; do not delete the outer loop (task selection + supervision are not session primitives).
- **MAPE-K**: KEEP — no self-improvement substrate in the SDK.
- **adapters / agent backend**: ADOPT — replace the `claude` CLI subprocess in `novel/adapters/agent-runtime.claude.ts` with an SDK call. Seam: the agent-spawn boundary; the SDK becomes the Claude-specific implementation behind the existing interface (rule #2). This is the one surface where the SDK genuinely replaces Minsky code (subprocess scraping), and it should.
- **sandbox**: N/A — the SDK runs in-process; OS-level isolation stays Minsky's job.
- **constitution / merge gate**: KEEP + AUGMENT — the gate stays Minsky's; additionally use the SDK's `canUseTool` hook to enforce constitutional constraints in-session (earlier, cheaper enforcement). The SDK supplies a *mechanism*; the *policy* (the 17 rules) is Minsky's.
- **corpus / scorecard**: N/A — the SDK is a dependency-candidate, not a benchmarked competitor, so it is intentionally NOT in the live M1.10 corpus (`novel/competitive-benchmark/src/competitors.ts`). Adding a non-orchestrator library to the scorecard would skew the denominator.
- **TASKS.md surface / fleet dashboard**: KEEP — the SDK has neither.

**Total replace % across all surfaces: 0% orchestrator replacement; 1 ADOPT at the Claude agent-backend adapter (subprocess → typed SDK call) + 1 AUGMENT at the constitution seam.** The headline for the operator: *nothing in the orchestrator to replace; adopt the SDK as the Claude backend to kill subprocess-scraping fragility; the only roadmap threat to watch is durable background sessions, and even that is a fold (simplify the tick-loop), not a pivot.*

## Tentative verdict (now confirmed by deep research)

**A dependency for the Claude-backend adapter, not the runtime/orchestrator layer.** OpenHands handles the cross-model runtime; the Claude Agent SDK handles the *Claude-specific* agent loop more cleanly than Minsky's current subprocess wrapping. Result: `novel/adapters/agent-runtime.openhands.ts` for the general case, `novel/adapters/agent-runtime.claude.ts` adopting the Claude Agent SDK for Claude-only runs. The two coexist. No `vision.md` change; durable background sessions are the single watch item (Q3).

## Last reviewed

2026-06-02 — deepened with `## Should we wrap the Claude Agent SDK instead?` + `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-claude-agent-sdk`. Verdict: ADOPT the SDK as Minsky's Claude agent-runtime backend (subprocess → typed API); KEEP every orchestrator surface; no vision rewrite — the task's ≥40%-tick-loop-obviation Pivot threshold is not crossed (the SDK ships no durable background-session API), so the durable-session capability is logged as the single explicit watch item rather than a vision-threat question (negative finding recorded inline per this task's central-questions routing).

Earlier reviews: 2026-05-22 (initial STUB entry — existence + version pending confirmation).
