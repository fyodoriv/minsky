# Dependency-candidate: Claude Agent SDK

> Anthropic's official toolkit for building agents on Claude — a library Minsky could use to talk to Claude, not a rival to Minsky itself.

In this file, an **agent** means the coding assistant that does the actual work (Claude Code, Devin, Aider, or OpenHands). **Minsky** is not an agent — it drives agents. Minsky is a **daemon**: a background program that keeps running on your machine, picks the most important unfinished task from a project's to-do list, asks an agent to do it, and hands you a draft to review.

This file answers one question: now that Anthropic ships first-party building blocks for agents, does that change what Minsky uniquely provides, or does it just give Minsky a cleaner way to talk to Claude?

The short answer: it gives Minsky a cleaner Claude backend to wrap. Nothing in the orchestrator layer is at risk today. The one thing to watch is a future Anthropic feature — durable background sessions — and even that would only let Minsky simplify, not pivot.

- **URL**: <https://github.com/anthropics/claude-agent-sdk-python> / <https://github.com/anthropics/claude-agent-sdk-typescript>
- **Docs**: <https://docs.anthropic.com/en/api/agent-sdk/overview>
- **Status**: Active — rebranded from "Claude Code SDK" to "Claude Agent SDK" (Sep 2025) when Anthropic generalized the primitives beyond coding; ships in Python and TypeScript
- **Pricing**: SDK is free (MIT-licensed bindings); Anthropic API token costs apply per call
- **Relationship**: **Dependency-candidate** — the right substrate for Minsky's Claude-backend agent adapter; NOT an orchestrator competitor

## What this is

Anthropic's official library for building one agent on Claude. It exposes the loop that Claude Code itself runs — gather context, take an action, verify the result, repeat — as code you can call directly.

The building blocks it gives you:

- the agent loop (gather context, act, verify, repeat)
- defining and running tools
- spawning subagents (one agent kicking off helper agents)
- hosting MCP servers (Model Context Protocol — a standard way for an agent to reach outside tools), both in-process and external
- loading Skills (Markdown files with YAML frontmatter — the same format Minsky's skill library already uses)
- permission and hook callbacks that let the host allow or deny each tool call
- resuming a session by id
- streaming the assistant's turn as structured output

The SDK is the same machinery Claude Code is built on, now exposed for outside use. It is the successor to the earlier Claude Code SDK. That makes it the natural replacement for any Minsky component that currently runs the `claude` command-line tool and parses its text output — a stable API maintained by Anthropic, instead of scraping subprocess output.

Where it fits in Minsky's stack: the SDK sits one level below Minsky's existing Claude dependencies. Claude Code is the harness Minsky drives; OMC (a layer that gives the agent a role to play, such as researcher or implementer) sits on top of that; the SDK is the lower-level building block both are built from.

## What this is not

- **Not a daemon, not a queue.** Like Claude Code, the SDK builds one agent session. It has no loop across projects, no draining of a to-do list, no watchdog that restarts it, and no spending limit. Anthropic's own docs ("Building agents with the Claude Agent SDK") frame it as single-agent and multi-subagent applications, not unattended fleets.
- **Not cross-model.** Claude only, by definition. In Minsky's stack, the cross-model runtime (Claude plus OpenAI plus a model on your own machine) is OpenHands' job.
- **Not self-improving.** No MAPE-K loop, no store of past experiments, no prompt-optimization layer. (MAPE-K — Monitor, Analyze, Plan, Execute over a Knowledge base — is the self-improvement loop in which Minsky studies its own results and files notes on how to do better.)

## Strengths

- **Anthropic-maintained.** Ships in step with model releases. Harness updates that used to force Minsky to chase changes in the `claude` command-line tool now arrive as SDK versions.
- **The agent loop, batteries included.** Context gathering, tool execution, verification, and compaction are handled. You do not rebuild the loop.
- **Native Skills loading.** Markdown skills with YAML frontmatter — the same format Minsky's skill library already uses, so Minsky's skills drop into an SDK-hosted session with no rewrite.
- **Native MCP.** First-class hosting of MCP servers, both in-process and external (stdio or HTTP).
- **Subagent spawning.** A code-level version of Claude Code's Task tool, with a separate system prompt and tool allowlist per subagent.
- **Permission and hook callbacks.** The `canUseTool` callback and hook interception let a host enforce policy at the moment a tool is called — the exact seam Minsky's rules care about.
- **Session resumption.** A session can be resumed by id. This is the primitive that matters most to Minsky (see pivot question 3).

## Weaknesses vs Minsky's vision

1. **Claude only.** The wrong choice as the *sole* runtime for a cross-model strategy. Minsky needs Claude, OpenAI, and local-model paths; the SDK covers exactly one.
2. **Single-session shape.** It builds agent loops, not daemons. No queue, no fleet across projects, no unattended outer loop.
3. **No self-improvement layer.** It stays at the agent-runtime layer. It does not replace Minsky's MAPE-K loop, experiment store, or spending limit.
4. **No constitution, no merge gate.** The SDK can enforce a tool policy through hooks, but it has no notion of a 17-rule constitution checked by CI before a draft is allowed to merge. (The **constitution** is the set of numbered, non-negotiable project rules in `vision.md`.) That governance layer is Minsky's, not Anthropic's.

## What we learn / steal

- **The agent loop as a stable contract** (docs: "Building agents with the Claude Agent SDK" — gather context, act, verify, repeat). Anthropic has frozen the harness Minsky currently scrapes from the `claude` command-line tool into a versioned API. Lesson: Minsky's Claude adapter (`novel/adapters/agent-runtime.claude.ts`) should depend on this contract (rule #2, the adapter pattern) rather than on CLI output format, which drifts release to release and causes recurring brittle-parse bugs.
- **Skills as the portable unit of capability** (docs: "Agent Skills" — Markdown plus YAML frontmatter). The SDK loads the exact skill format Minsky already uses. Lesson: Minsky's skill library is already SDK-portable, so the capability layer is not a lock-in risk. This independently confirms the Markdown-skill convention was the right bet.
- **Hooks and `canUseTool` as a policy seam** (docs: "Permissions" and "Hooks"). Anthropic exposes tool-call interception so the host can allow, deny, or modify each tool use. Lesson: this is a deterministic enforcement hook (rule #10) Minsky can use to apply its rules *during* a session, not only at the merge gate afterward — a way to tighten the constitution from "check at the end" to "check at the seam".
- **Subagents and MCP hosting as first-class** (docs: "Subagents", "MCP"). Anthropic treats both as runtime primitives. Lesson: Minsky should not reimplement either. Once the SDK is adopted, any Minsky code that hand-rolls subagent spawning or MCP plumbing for the Claude backend is a rule #1 (don't reinvent) violation.

## Why choose Minsky over the Claude Agent SDK

The SDK is an agent-tier library for building one Claude agent session (with subagents) inside a host process. Minsky is an orchestrator-tier daemon that runs around the clock and drives agents — including, in future, SDK-hosted Claude sessions — picking work from a to-do list across many projects, under a constitution enforced by a CI merge gate.

They are not peers. The SDK is the kind of inner-loop runtime Minsky *wraps*, the same way it already wraps Claude Code, Devin, and Aider. The defining difference is the outer loop and the gate: the SDK runs one session to the end and stops; Minsky never stops, picks the next task itself, and refuses to merge any output that fails the 17-rule constitution. The SDK gives you a great agent. Minsky gives you a fleet of them that runs unattended and governs itself.

## Why choose the Claude Agent SDK over Minsky

If you only need one Claude agent session inside your own program — no fleet, no unattended loop, no governance — the SDK is the direct, Anthropic-maintained way to get it. You write the host; the SDK handles the loop. That is exactly the scope Anthropic designed it for.

## Should we wrap the Claude Agent SDK instead?

Rule #1 (don't reinvent) means every dependency-candidate review ends with the honest question: if this is the real substrate for the thing we do, why aren't we already wrapping it? For the Claude Agent SDK the answer is: **we should wrap it — but at the agent tier, not the orchestrator tier.** The SDK is the inner loop Minsky drives, not a competitor for the outer loop.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Excellent as an **agent-tier backend**, irrelevant as an **orchestrator replacement**. The SDK is a per-session agent loop. It slots cleanly behind Minsky's agent seam — `novel/adapters/agent-runtime.claude.ts` becomes a thin call into the SDK instead of wrapping the `claude` CLI subprocess (rule #2: the SDK is the dependency, the adapter is the interface). It cannot host the scheduler-loop, supervisor, spending-limit, or experiment-store layers — Anthropic explicitly scopes the SDK to single-agent and multi-subagent applications, not unattended fleets. |
| 2. **What we delegate** | **The Claude single-iteration agent loop** — context assembly, tool execution, subagent spawning, MCP hosting, Skills loading, verification, compaction. Today Minsky delivers this by running the `claude` CLI subprocess, feeding it a brief on stdin, and parsing its output. The SDK owns it as a typed API. We delegate the harness; we keep owning *what brief goes in and what gate the output must clear*. |
| 3. **What we keep** | All 6 moats survive (daemon-not-framework, operator-machine identity, constitution plus CI merge gate, MAPE-K loop, cross-repo fleet, TASKS.md surface). The SDK has none of these. Wrapping it *more deeply* (making it the canonical Claude backend) erodes zero moats and removes subprocess-scraping fragility — pure upside. |
| 4. **Net moat after wrap** | 6 of 6 (the SDK becomes the Claude agent backend; no orchestrator surface is delegated). The action is a backend swap (`claude` CLI subprocess to SDK call), not a structural delegation of the loop Minsky exists to run. |
| 5. **Verdict** | **NO orchestrator wrap; YES adopt the SDK as the Claude agent-runtime backend.** Replace the `claude` CLI subprocess in `novel/adapters/agent-runtime.claude.ts` with the SDK once a Minsky component needs Claude programmatically. No P0 *vision* task is filed; this is a P2/P3 adapter modernization (subprocess to typed API), tracked when the Claude backend next needs touching. The OpenHands wrap stays the cross-model runtime; the SDK is the Claude-specific path. The two coexist. |

**Trigger for re-evaluation**: if Anthropic ships a *durable, unattended background-session API* — sessions that survive process death, advance without a foreground client, and can be polled or resumed by a daemon — then the SDK starts encroaching on the scheduler loop's reason to exist. That specific capability is the watch item; see pivot question 3.

## Five pivot questions

### 1. How is it different from Minsky?

The Claude Agent SDK is an **agent-tier library** for building one Claude agent session (with subagents) inside a host process. Minsky is an **orchestrator-tier 24/7 daemon** that drives agents — including, in future, SDK-hosted Claude sessions — on a queue across projects, under a constitution enforced by a CI merge gate. They are not peers. The SDK is the inner-loop runtime Minsky *wraps*, the same way it already wraps Claude Code, Devin, and Aider.

The structural difference is the outer loop and the gate: the SDK runs one session to the end and stops; Minsky never stops, picks the next task itself, and refuses to merge any output that fails the 17-rule constitution. Anthropic's SDK gives you a great agent; Minsky gives you a fleet of them that runs unattended and governs itself.

### 2. What lessons can it give to us?

- **The agent loop as a stable contract** (docs: "Building agents with the Claude Agent SDK" — gather context, act, verify, repeat). Anthropic has frozen the harness Minsky currently scrapes from the `claude` CLI into a versioned API. Lesson: Minsky's `novel/adapters/agent-runtime.claude.ts` should depend on this contract (rule #2) rather than on CLI output format, which drifts release to release and is the source of recurring brittle-parse bugs.
- **Skills as the portable capability unit** (docs: "Agent Skills" — Markdown plus YAML frontmatter). The SDK loads the exact skill format Minsky already uses. Lesson: Minsky's skill library is already SDK-portable; the capability layer is not a lock-in surface. This independently confirms the Markdown-skill convention was the right bet.
- **Hooks and `canUseTool` as a policy seam** (docs: "Permissions" and "Hooks"). Anthropic exposes tool-call interception so the host can allow, deny, or modify each tool use. Lesson: this is a deterministic enforcement hook (rule #10) Minsky can use to apply its rules *during* a session, not only at the merge gate afterward — a candidate for tightening moat #3 from "gate at the end" to "gate at the seam".
- **Subagents and MCP hosting as first-class** (docs: "Subagents", "MCP"). Anthropic treats both as runtime primitives. Lesson: Minsky should *not* reimplement either; once the SDK is adopted, any Minsky code that hand-rolls subagent spawning or MCP plumbing for the Claude backend is a rule #1 violation.

### 3. Are any of these lessons potentially vision-changing?

**This is the load-bearing question, and the answer is: NO vision rewrite is forced today — but the task's hypothesis identifies a real, specific roadmap threat that stays on the watch list.** The hypothesis was: *if Anthropic ships durable background-session APIs, Minsky's scheduler loop becomes a thinner wrapper.* Examined honestly:

- **What exists today does NOT force a rewrite.** The current SDK is a single-session, foreground agent loop. It has session resumption (resume-by-id), but resumption is client-driven: something has to call the SDK to advance the session. There is no Anthropic-hosted, self-advancing, process-death-surviving background loop. The thing that would obviate the scheduler loop — an unattended session that advances on its own and can be polled by a daemon — is precisely the thing the SDK does **not** ship. So the scheduler loop's reason to exist (an outer loop that picks the next task and keeps a session alive across process death, rate limits, and machine reboots) is untouched. Minsky's `vision.md` identity ("a daemon, not a framework") and the scheduler loop's role both stand.
- **Even the maximal version of the threat does not dissolve the moat.** Suppose Anthropic *does* ship durable background sessions. That would let Minsky delete the session-keep-alive mechanics inside the scheduler loop (a real and welcome simplification — rule #1). It would **not** provide: task selection across projects, the TASKS.md queue surface, operator-machine identity, the spending limit, the experiment store, or — most importantly — the **constitution plus CI merge gate**. Durable sessions make the inner loop cheaper; they do not supply the governance and fleet layers that are moats #3 through #6. The correct response to that future would be **fold, not pivot**: thin the scheduler loop's keep-alive code to a wrapper over Anthropic's durable-session primitive, keep everything above it.
- **Conclusion (pre-registered pivot check):** the pivot threshold was "if the SDK roadmap obviates 40% or more of Minsky's scheduler-loop surface, file a vision-threat question." Today the SDK obviates roughly 0% (no durable background API exists). The potential obviation, if durable sessions ship, is bounded by the keep-alive and resumption share of the scheduler loop — a minority of its surface, below the 40% bar, because task selection, supervision, and the gate are not session primitives. **Threshold not crossed → no vision-threat question filed.** This is a negative finding, recorded here per the deep-research convention. Recommendation: **adopt the SDK as the Claude backend; keep the durable-background-session capability as the single explicit watch item; no `vision.md` change.**

### 4. How can we improve our strategy based on this?

- **Modernize the Claude backend from CLI subprocess to SDK call.** The recurring brittle-parse failures in the `claude` CLI path are a fragility tax. Strategy move: make `novel/adapters/agent-runtime.claude.ts` depend on the Claude Agent SDK contract (rule #2), eliminating output-format scraping. Traces to lesson 2.1.
- **Treat the constitution as a tool-seam policy, not only a merge gate.** The SDK's `canUseTool` hook lets Minsky deny constitution-violating tool calls *during* a session, catching violations earlier and cheaper than the merge gate. Strategy move: prototype a constitutional `canUseTool` hook as a deterministic in-session enforcement layer (rule #10), complementing — not replacing — the merge gate. Traces to lesson 2.3.
- **Lean on Anthropic's subagent and MCP primitives instead of hand-rolling.** For the Claude backend, delete any Minsky code that reimplements subagent spawning or MCP hosting once the SDK is adopted (rule #1). Strategy move: an audit pass over the Claude adapter for reinvented primitives at SDK-adoption time. Traces to lesson 2.4.
- **Pre-position the "fold, don't pivot" plan for durable sessions.** Write down now (this file) that durable background sessions, if Anthropic ships them, are a scheduler-loop *simplification*, not an existential threat. Strategy move: keep the watch item explicit so a future agent does not over-react to the announcement. Traces to lesson 2.1 and pivot question 3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **scheduler loop**: KEEP — the SDK has no daemon, queue, or cross-repo loop. *Watch*: if durable background sessions ship, fold the keep-alive mechanics into a wrapper over the SDK primitive; do not delete the outer loop (task selection and supervision are not session primitives).
- **MAPE-K loop**: KEEP — no self-improvement substrate in the SDK.
- **adapters / agent backend**: ADOPT — replace the `claude` CLI subprocess in `novel/adapters/agent-runtime.claude.ts` with an SDK call. Seam: the agent-spawn boundary; the SDK becomes the Claude-specific implementation behind the existing interface (rule #2). This is the one surface where the SDK genuinely replaces Minsky code (subprocess scraping), and it should.
- **sandbox**: N/A — the SDK runs in-process; OS-level isolation stays Minsky's job.
- **constitution / merge gate**: KEEP + AUGMENT — the gate stays Minsky's; additionally use the SDK's `canUseTool` hook to enforce constitutional constraints in-session (earlier, cheaper enforcement). The SDK supplies a mechanism; the policy (the 17 rules) is Minsky's.
- **corpus / scorecard**: N/A — the SDK is a dependency-candidate, not a benchmarked competitor, so it is intentionally NOT in the live M1.10 corpus (`novel/competitive-benchmark/src/competitors.ts`). Adding a non-orchestrator library to the scorecard would skew the denominator.
- **TASKS.md surface / fleet dashboard**: KEEP — the SDK has neither.

**Total replace across all surfaces: 0% orchestrator replacement; 1 ADOPT at the Claude agent-backend adapter (subprocess to typed SDK call) plus 1 AUGMENT at the constitution seam.** The headline for the operator: nothing in the orchestrator to replace; adopt the SDK as the Claude backend to kill subprocess-scraping fragility; the only roadmap threat to watch is durable background sessions, and even that is a fold (simplify the scheduler loop), not a pivot.

## Tentative verdict (now confirmed by deep research)

**A dependency for the Claude-backend adapter, not the runtime or orchestrator layer.** OpenHands handles the cross-model runtime; the Claude Agent SDK handles the Claude-specific agent loop more cleanly than Minsky's current subprocess wrapping. Result: `novel/adapters/agent-runtime.openhands.ts` for the general case, `novel/adapters/agent-runtime.claude.ts` adopting the Claude Agent SDK for Claude-only runs. The two coexist. No `vision.md` change; durable background sessions are the single watch item (pivot question 3).

## Last reviewed

2026-06-02 — deepened with `## Should we wrap the Claude Agent SDK instead?` plus `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-claude-agent-sdk`. Verdict: ADOPT the SDK as Minsky's Claude agent-runtime backend (subprocess to typed API); KEEP every orchestrator surface; no vision rewrite — the task's 40%-or-more scheduler-loop-obviation pivot threshold is not crossed (the SDK ships no durable background-session API), so the durable-session capability is logged as the single explicit watch item rather than a vision-threat question (negative finding recorded inline per this task's central-questions routing).

Earlier reviews: 2026-05-22 (initial STUB entry — existence and version pending confirmation).
