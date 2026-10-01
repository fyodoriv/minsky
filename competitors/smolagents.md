# Competitor: smolagents (Hugging Face)

> A small Python library for building one code-writing agent. It sits one layer below Minsky's orchestrator. We keep it as a reference for the "agent writes code" pattern, not as something to wrap.

- **URL**: <https://github.com/huggingface/smolagents>
- **Docs**: <https://huggingface.co/docs/smolagents>
- **Blog**: Hugging Face, "Introducing smolagents: a simple library to build agents", huggingface.co/blog/smolagents, 2024
- **Status**: Alive — actively maintained (27.5k★ at task-filing, 2026-05-24), shipping releases on PyPI
- **Relationship**: **Reference** — an agent-tier construction framework (a Python library you import to build one agent). Wrong stack and wrong layer to wrap as a Minsky backend. The CodeAct pattern is the borrowable lesson.

## What this is

smolagents is a small Python library for building an LLM agent whose **actions are Python code** instead of JSON tool-call blobs. The core agent loop is about 1000 lines — small enough to read in one sitting.

Its headline primitive is `CodeAgent`. Instead of emitting a structured `{"tool": "...", "args": {...}}` call, the agent writes a snippet of Python that calls the available tools as functions, runs it, observes the result, and iterates. A `ToolCallingAgent` variant keeps the classic JSON tool-call shape for models or providers that prefer it.

smolagents is model-agnostic (it works over any Hugging Face Inference endpoint, local Transformers, or third-party LLM via LiteLLM) and tool-agnostic (any Python callable, or a Hub-hosted tool, becomes an action). It ships sandboxed execution backends (E2B, Docker, or a restricted local interpreter), so the generated code does not run unsandboxed by default.

Throughout this doc, "agent" means the coding assistant that does the actual work — here, the one smolagents helps you build. Minsky is not an agent; Minsky is a background program that drives agents.

## What this is not

- Not an orchestrator. smolagents builds one agent you call to do one task. It does not sit above agents and compose the best one for the job.
- Not a daemon — that is, not a background program that keeps running on your machine after you start it. smolagents is request-response: instantiate an agent, `run()` a task, get a result.
- Not a spawnable agent CLI. It is a library you import into your own process, not a command-line tool Minsky could spawn and drive the way it spawns Claude Code, Devin, Aider, or OpenHands.
- Not a product with a vendor benchmark line. Its score, when measured, is just the score of whichever model you plugged in.

## Strengths

- **CodeAct pattern, productised** — "write actions as code" is grounded in Wang et al.'s result that a code action space beats JSON tool calls on multi-step tasks. smolagents is the most-adopted clean implementation of it.
- **Minimal core (~1000 lines)** — the whole agent loop is small. The minimal-agent thesis (less scaffold, more model) is the project's explicit design stance.
- **Hugging Face distribution + Hub integration** — tools, prompts, and agents push to and pull from the Hub. Large community reach.
- **Model- and tool-agnostic** — not locked to one provider. Any Python callable is a tool.
- **Sandboxed code execution by default** — E2B, Docker, and restricted-interpreter backends are first-class, not an afterthought.

## Weaknesses vs Minsky's vision

1. **Wrong stack.** It is a Python library around generic LLM APIs. Minsky is Claude Code-native (Max subscription economy, OMC personas, native MCP and OpenTelemetry (OTEL)) with a TypeScript orchestrator surface.
2. **Wrong layer — agent-tier, not orchestrator-tier.** smolagents builds *one* agent you call to do *one* task. Minsky sits *above* agents and composes whichever CLI is best. They are adjacent layers of the same stack, not peers.
3. **No around-the-clock viability framing.** smolagents is request-response. There is no long-running supervisor (the outer watchdog that restarts the program if it dies), no token-budget homeostasis, no cross-repo fleet, and no mid-task pause/resume.
4. **No self-improvement loop.** Prompts and tools are static configuration. There is no MAPE-K loop — the Monitor, Analyze, Plan, Execute loop over a Knowledge base — that watches performance over time and rewrites prompts.
5. **No constitution with deterministic enforcement.** The constitution is Minsky's set of numbered, non-negotiable project rules. smolagents has no such vision-document layer and no per-rule CI lints, so behaviour drift goes undetected.
6. **No operator-machine identity.** It is a library you embed in your own process. It has no opinion about running as you — the operator — under your own `~/.ssh` and `~/.gitconfig`, landing commits under your name.
7. **No TASKS.md-style operator surface.** TASKS.md is the plain-text to-do list at a project's root that Minsky reads to pick work. smolagents represents tasks as in-process Python objects, not a plain-markdown, CI-gated work queue.

## What we learn / steal

- **CodeAct as a first-class action space** — smolagents validates that a code action space (write Python that calls tools) can beat JSON tool calls on multi-step work. This is relevant to how Minsky frames the *agent's* action surface when it wraps a backend, and to any future first-party action loop. Recorded as a borrowable instinct, not a component to adopt today.
- **Minimal-agent thesis** — the ~1000-line core is a useful counterweight to scaffold-heavy frameworks. The lesson for Minsky: the value is in the loop, the constitution, and the measurement — not in a thick agent abstraction. Keep the `novel/` layer thin (rule #1, don't reinvent).
- **Sandbox-by-default for generated code** — E2B, Docker, and restricted-interpreter backends ship with the library. This reinforces Minsky's own sandbox-hardening discipline (the `supervisor-sandbox-hardening` lint): running model-generated actions should be sandboxed by default, never opt-in.

## Why choose Minsky over smolagents

You want a system that keeps existing repos improving around the clock on your own machine, under a constitution with deterministic enforcement, composing whichever agent CLI is best — not a Python library you embed to run one agent on one task.

## Why choose smolagents over Minsky

You are building a single application that needs an embeddable, minimal, model-agnostic agent with a code action space and sandboxed execution — and you do not want a daemon, a fleet, or an orchestrator above it.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

Intentionally none. smolagents is an agent-construction framework, not a product with a vendor-primary headline benchmark on the M1.10 catalogue. Its score, when run, is the chosen model's score — adding it would double-count a model reading, which rule #4's no-fabricated-readings discipline forbids. Recorded as a Reference only; no row in `competitors.ts`.

## Should we wrap smolagents instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**No.** smolagents is a library, not a headless agent CLI Minsky could spawn and drive the way it spawns Claude / Devin / Aider / OpenHands. Wrapping it would mean building a Python process around it and then driving *that* — strictly more work than driving an existing maintained CLI, with none of the daemon, fleet, identity, or constitution moats added. The borrowable value (CodeAct action space, sandbox-by-default, minimal core) is captured as a lesson above. There is no 24h-wrap case.

## Five pivot questions

### 1. How is it different from Minsky?

smolagents is an **agent-tier construction framework** — a small Python library you import to build one code-writing agent and `run()` it on a task. Minsky is an **orchestrator-tier daemon** that runs around the clock, sits *above* agents, and ships *changes into existing repos*. Minsky walks a fleet of repos in round-robin, picks tasks from a markdown queue, composes whichever agent CLI is best, and gates every change with a verified measurement under a 17-rule constitution.

smolagents' intent is to give a developer the smallest possible scaffold around an LLM so the model does the heavy lifting. Minsky's intent is to keep existing repos improving indefinitely and stay alive across process death, rate limits, and dependency failures. They are not peers — they are adjacent layers of the same stack. smolagents is the kind of library an agent backend *could be built with*; it is not itself a spawnable agent CLI to wrap.

### 2. What lessons can it give to us?

- **A code action space can beat JSON tool calls** (the `CodeAgent` headline, grounded in CodeAct). Letting the agent express actions as code that calls tools as functions is a strong default for multi-step tasks. Relevant to how Minsky frames an agent's action surface when wrapping a backend.
- **Keep the scaffold minimal** (the ~1000-line core). The minimal-agent thesis confirms that the differentiation lives in the loop, the constitution, and the measurement — not in a thick agent abstraction. Reinforces rule #1 (don't reinvent; keep `novel/` thin).
- **Sandbox generated code by default** (E2B / Docker / restricted-interpreter backends as first-class). Running model-generated actions must be sandboxed from the start, never bolted on later. Reinforces Minsky's `supervisor-sandbox-hardening` discipline.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons are *engineering-discipline* level. They *confirm* existing `vision.md` commitments — rule #1's keep-it-thin stance, the sandbox-hardening discipline, and the general "value is in the loop" framing — rather than challenge them.

Nothing here forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules. smolagents is an agent-construction *framework* one layer below Minsky's orchestrator, so it neither subsumes Minsky's loop nor threatens any of the 6 moats (it has none of daemon-not-framework, operator-machine identity, constitution + enforcement, MAPE-K, cross-repo fleet, or TASKS.md surface). The framework-vs-product framing the task anticipated resolves cleanly — Minsky is the product/daemon; smolagents is an ingredient. A negative (no-vision-change) finding of this kind is the expected output of the deep-research convention for a framework that operates at a different layer. The orchestrator records operator questions centrally (this task does not edit `ask-human.md`).

### 4. How can we improve our strategy based on this?

- **Treat the agent's action surface as a deliberate design choice.** smolagents proves a code action space is a viable, often-better default than JSON tool calls. Strategy move: when Minsky wraps or authors a backend, keep the action-space shape an explicit, measured decision (code-action vs tool-call) rather than an accident of the CLI. Traces to lesson §2.1.
- **Keep the `novel/` layer thin.** The minimal-agent thesis is a useful counterweight to scope creep. Strategy move: continue gating new `novel/` code through rule #1 (justify why it isn't already in someone else's tool) so the differentiation stays in the loop, the constitution, and the measurement. Traces to lesson §2.2.
- **Keep sandbox-by-default for any model-generated execution.** smolagents ships E2B/Docker/restricted backends as first-class. Strategy move: keep the `supervisor-sandbox-hardening` lint load-bearing so any path that runs model-generated actions is sandboxed by default, never opt-in. Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — smolagents has no around-the-clock cross-repo daemon. It is a library imported by an app to run one task, not an orchestrator loop. Nothing to replace.
- **MAPE-K**: KEEP — smolagents has no online observe-tune control loop over a running fleet. Prompts and tools are static configuration.
- **adapters / agent backends**: KEEP (with a possible future build-on) — smolagents is not a spawnable agent CLI to add as a backend row, but it is a candidate *implementation substrate* if Minsky ever authors a first-party code-action backend. That would be a new agent-matrix row, not a replacement of the adapter layer. An adapter here is a small wrapper file that lets Minsky talk to one outside tool through a fixed interface.
- **sandbox**: KEEP / borrow-the-instinct — Minsky already has supervisor sandboxing. smolagents' sandbox-by-default for generated code is a discipline to reinforce, not a component to swap in.
- **corpus / scorecard**: KEEP — intentionally not wired in (it is a framework, not a product with a vendor-primary benchmark line; rule #4 — no fabricated readings). Recorded as a reference only.
- **dashboard / TASKS.md surface**: KEEP — smolagents has no durable, operator-inspectable, CI-gated work queue. This is a Minsky-specific surface.

**Total replace % across all surfaces: 0%.** Every surface is KEEP/borrow. The one borrowable instinct — a code action space, plus sandbox-by-default — is a discipline to weigh, not a component to swap, and a smolagents-built backend would be a *new* row, not a replacement. The headline for the operator: *nothing to replace. smolagents is a lower-layer, minimal agent-construction framework Minsky composes above, and its CodeAct + minimal-core + sandbox-by-default lessons either confirm existing rules (#1) or reinforce existing discipline (sandbox-hardening).*

## Pin / integration

Not a dependency. No adapter. Recorded as a reference for the CodeAct pattern and the minimal-agent thesis.

## Pattern conformance

- **Pattern smolagents implements**: CodeAct — executable-code action space for LLM agents — Wang, Chen, Yang, Wang, Chen, Lin, Su, Sun, Cohan, Cui, Yang, Yih, Sun, Liang, "Executable Code Actions Elicit Better LLM Agents", arXiv 2402.01030, ICML 2024 (the result that a code action space outperforms JSON/text action spaces on multi-step agentic tasks); combined with the ReAct observe-act loop (Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models", arXiv 2210.03629, ICLR 2023)
- **Conformance level**: full (in the pattern smolagents implements — it is a clean CodeAct + ReAct loop)
- **How Minsky relates**: don't adopt as substrate — wrong stack (Python) and wrong layer (agent-tier construction library, not an orchestrator). Minsky borrows the CodeAct instinct (action-space-as-a-design-choice) and the sandbox-by-default discipline but binds its orchestration to Claude Code via OMC, not to a Python library.
- **Index row**: reference-only entry; no `vision.md § "Pattern conformance index"` row (no corpus reading, no adapter — same disposition as [pydantic-ai.md](pydantic-ai.md))

## Last reviewed

2026-06-02 — created via the `competitor-add-smolagents` task. Disposition: **Reference** (agent-tier construction framework, wrong stack + wrong layer to wrap; no corpus reading per rule #4). Lessons captured: CodeAct action space (Wang et al. arXiv 2402.01030, ICML 2024), minimal-agent thesis (reinforces rule #1), sandbox-by-default for generated code (reinforces `supervisor-sandbox-hardening`). Five-pivot-questions verdict: 0% replace; no vision-changing finding. The orchestrator records any operator questions centrally — this task does not edit `ask-human.md`.
