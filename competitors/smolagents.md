# Competitor: smolagents (Hugging Face)

> Hugging Face's minimal "agents that think in code" library — an agent-tier construction framework one layer below Minsky's orchestrator, kept as a reference for the CodeAct pattern and the minimal-agent thesis.

- **URL**: <https://github.com/huggingface/smolagents>
- **Docs**: <https://huggingface.co/docs/smolagents>
- **Blog**: Hugging Face, "Introducing smolagents: a simple library to build agents", huggingface.co/blog/smolagents, 2024
- **Status**: Alive — actively maintained (27.5k★ at task-filing, 2026-05-24), shipping releases on PyPI
- **Relationship**: **Reference** — agent-tier construction framework (a Python library you import to build one agent), wrong stack and wrong layer to wrap as a Minsky backend; the CodeAct pattern is the borrowable lesson

## What it is

A deliberately small Python library (the core agent logic is ~1000 lines) for building LLM agents whose **actions are Python code** rather than JSON tool-call blobs. The headline primitive is `CodeAgent`: instead of emitting a structured `{"tool": "...", "args": {...}}` call, the agent writes and runs a snippet of Python that calls the available tools as functions, observes the result, and iterates. A `ToolCallingAgent` variant keeps the classic JSON tool-call shape for models/providers that prefer it. smolagents is model-agnostic (works over any Hugging Face Inference, local Transformers, or third-party LLM via LiteLLM), tool-agnostic (any Python callable or a Hub-hosted tool becomes an action), and ships sandboxed execution backends (E2B, Docker, or a restricted local interpreter) so the generated code can't run unsandboxed by default.

## Strengths

- **CodeAct pattern, productised** — "write actions as code" is grounded in Wang et al.'s CodeAct result that a code action space beats JSON tool calls on multi-step tasks; smolagents is the most-adopted clean implementation of it
- **Minimal core (~1000 lines)** — the whole agent loop is small enough to read in one sitting; the minimal-agent thesis (less scaffold, more model) is the project's explicit design stance
- **Hugging Face distribution + Hub integration** — tools, prompts, and agents can be pushed to and pulled from the Hub; large community reach
- **Model- and tool-agnostic** — not locked to one provider; any Python callable is a tool
- **Sandboxed code execution by default** — E2B / Docker / restricted-interpreter backends are first-class, not an afterthought

## Weaknesses vs Minsky's vision

1. **Wrong stack.** Python library around generic LLM APIs. Minsky is Claude Code-native (Max subscription economy, OMC personas, native MCP + OTEL) with a TypeScript orchestrator surface.
2. **Wrong layer — agent-tier, not orchestrator-tier.** smolagents builds *one* agent you call to do *one* task; Minsky sits *above* agents and composes whichever CLI is best. They are adjacent layers of the same stack, not peers.
3. **No 24/7 viability framing.** smolagents is request-response: instantiate an agent, `run()` a task, return a result. No long-running supervisor, no token-budget homeostasis, no cross-repo fleet, no mid-task pause/resume.
4. **No self-improvement loop.** Prompts and tools are static configuration; there is no metacognitive layer that observes performance over time and rewrites prompts (no MAPE-K substrate).
5. **No constitution + deterministic enforcement.** No vision-document layer, no per-rule CI lints; behaviour drift is undetected.
6. **No operator-machine identity.** It is a library you embed in your own process; it has no opinion about running as the operator's user with the operator's `~/.ssh` / `~/.gitconfig` and landing commits as the operator.
7. **No TASKS.md-style operator surface.** Its task representation is in-process Python objects, not a plain-markdown, CI-gated work queue.

## What we learn / steal

- **CodeAct as a first-class action space** — validation that a code action space (write Python that calls tools) can beat JSON tool calls on multi-step work. Relevant to how Minsky frames the *agent's* action surface when it wraps a backend, and to any future first-party action loop; recorded as a borrowable instinct, not a component to adopt today.
- **Minimal-agent thesis** — the ~1000-line core is a useful counterweight to scaffold-heavy frameworks. The lesson for Minsky is "the value is in the loop + constitution + measurement, not in a thick agent abstraction" — keep the `novel/` layer thin (rule #1).
- **Sandbox-by-default for generated code** — E2B / Docker / restricted-interpreter backends ship with the library. Reinforces Minsky's own sandbox-hardening discipline (`supervisor-sandbox-hardening` lint) — running model-generated actions should be sandboxed by default, never opt-in.

## Five pivot questions

### 1. How is it different from Minsky?

smolagents is an **agent-tier construction framework** — a small Python library you import to build one code-writing agent and `run()` it on a task. Minsky is an **orchestrator-tier 24/7 daemon** that sits *above* agents and ships *changes into existing repos*: it walks a fleet of repos in round-robin, picks tasks from a markdown queue, composes whichever agent CLI is best, and gates every change with a verified measurement under a 17-rule constitution. smolagents' intent is to give a developer the smallest possible scaffold around an LLM so the model does the heavy lifting; Minsky's intent is to keep existing repos improving indefinitely and stay alive across process death, rate limits, and dependency failures. They are not peers — they are adjacent layers of the same stack. smolagents is the kind of library an agent backend *could be built with*; it is not itself a spawnable agent CLI to wrap.

### 2. What lessons can it give to us?

- **A code action space can beat JSON tool calls** (the `CodeAgent` headline, grounded in CodeAct) — letting the agent express actions as code that calls tools as functions is a strong default for multi-step tasks. Relevant to how Minsky frames an agent's action surface when wrapping a backend.
- **Keep the scaffold minimal** (the ~1000-line core) — the minimal-agent thesis confirms that the differentiation lives in the loop + constitution + measurement, not in a thick agent abstraction. Reinforces rule #1 (don't reinvent; keep `novel/` thin).
- **Sandbox generated code by default** (E2B / Docker / restricted-interpreter backends as first-class) — running model-generated actions must be sandboxed from the start, never bolted on later. Reinforces Minsky's `supervisor-sandbox-hardening` discipline.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons are *engineering-discipline* level — they *confirm* existing `vision.md` commitments (rule #1's keep-it-thin stance, the sandbox-hardening discipline, and the general "value is in the loop" framing) rather than challenge them. Nothing here forces a rewrite of `vision.md § What Minsky is` or invalidates any of the 17 rules: smolagents is an agent-construction *framework* one layer below Minsky's orchestrator, so it neither subsumes Minsky's loop nor threatens any of the 6 moats (it has none of daemon-not-framework, operator-machine identity, constitution + enforcement, MAPE-K, cross-repo fleet, or TASKS.md surface). The framework-vs-product framing the task anticipated resolves cleanly — Minsky is the product/daemon; smolagents is an ingredient. A negative (no-vision-change) finding of this kind is the expected output of the deep-research convention for a framework that operates at a different layer; the orchestrator records operator questions centrally (this task does not edit `ask-human.md`).

### 4. How can we improve our strategy based on this?

- **Treat the agent's action surface as a deliberate design choice** — smolagents proves a code action space is a viable, often-better default than JSON tool calls. Strategy move: when Minsky wraps or authors a backend, keep the action-space shape an explicit, measured decision (code-action vs tool-call) rather than an accident of the CLI — traces to lesson §2.1.
- **Keep the `novel/` layer thin** — the minimal-agent thesis is a useful counterweight to scope creep. Strategy move: continue gating new `novel/` code through rule #1 (justify why it isn't already in someone else's tool) so the differentiation stays in the loop + constitution + measurement — traces to lesson §2.2.
- **Keep sandbox-by-default for any model-generated execution** — smolagents ships E2B/Docker/restricted backends as first-class. Strategy move: keep the `supervisor-sandbox-hardening` lint load-bearing so any path that runs model-generated actions is sandboxed by default, never opt-in — traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — smolagents has no 24/7 cross-repo daemon; it is a library imported by an app to run one task, not an orchestrator loop. Nothing to replace.
- **MAPE-K**: KEEP — smolagents has no online observe-tune control loop over a running fleet; prompts and tools are static configuration.
- **adapters / agent backends**: KEEP (with a possible future build-on) — smolagents is not a spawnable agent CLI to add as a backend row, but it is a candidate *implementation substrate* if Minsky ever authors a first-party code-action backend; that would be a new agent-matrix row, not a replacement of the adapter layer.
- **sandbox**: KEEP / borrow-the-instinct — Minsky already has supervisor sandboxing; smolagents' sandbox-by-default for generated code is a discipline to reinforce, not a component to swap in.
- **corpus / scorecard**: KEEP — intentionally not wired in (framework, not a product with a vendor-primary benchmark line; rule #4 — no fabricated readings); recorded as a reference only.
- **dashboard / TASKS.md surface**: KEEP — smolagents has no durable, operator-inspectable, CI-gated work queue; this is a Minsky-specific surface.

**Total replace % across all surfaces: 0%** (every surface KEEP/borrow; the one borrowable instinct — a code action space, plus sandbox-by-default — is a discipline to weigh, not a component to swap, and a smolagents-built backend would be a *new* row, not a replacement). The headline for the operator: *nothing to replace; smolagents is a lower-layer, minimal agent-construction framework Minsky composes above, and its CodeAct + minimal-core + sandbox-by-default lessons either confirm existing rules (#1) or reinforce existing discipline (sandbox-hardening).*

## Why choose Minsky over smolagents

You want a system that keeps existing repos improving 24/7 on your own machine, under a constitution with deterministic enforcement, composing whichever agent CLI is best — not a Python library you embed to run one agent on one task.

## Why choose smolagents over Minsky

You are building a single application that needs an embeddable, minimal, model-agnostic agent with a code action space and sandboxed execution — and you don't want a daemon, a fleet, or an orchestrator above it.

## Pin / integration

Not a dependency. No adapter. Recorded as a reference for the CodeAct pattern and the minimal-agent thesis.

## Pattern conformance

- **Pattern smolagents implements**: CodeAct — executable-code action space for LLM agents — Wang, Chen, Yang, Wang, Chen, Lin, Su, Sun, Cohan, Cui, Yang, Yih, Sun, Liang, "Executable Code Actions Elicit Better LLM Agents", arXiv 2402.01030, ICML 2024 (the result that a code action space outperforms JSON/text action spaces on multi-step agentic tasks); combined with the ReAct observe-act loop (Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models", arXiv 2210.03629, ICLR 2023)
- **Conformance level**: full (in the pattern smolagents implements — it is a clean CodeAct + ReAct loop)
- **How Minsky relates**: don't adopt as substrate — wrong stack (Python) and wrong layer (agent-tier construction library, not an orchestrator). Minsky borrows the CodeAct instinct (action-space-as-a-design-choice) and the sandbox-by-default discipline but binds its orchestration to Claude Code via OMC, not to a Python library.
- **Index row**: reference-only entry; no `vision.md § "Pattern conformance index"` row (no corpus reading, no adapter — same disposition as [pydantic-ai.md](pydantic-ai.md))

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

Intentionally none. smolagents is an agent-construction framework, not a product with a vendor-primary headline benchmark on the M1.10 catalogue (its score, when run, is the chosen model's score — adding it would double-count a model reading, which rule #4's no-fabricated-readings discipline forbids). Recorded as a Reference only; no row in `competitors.ts`.

## Should we wrap smolagents instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**No.** smolagents is a library, not a headless agent CLI Minsky could spawn and drive the way it spawns Claude / Devin / Aider / OpenHands. Wrapping it would mean building a Python process around it and then driving *that* — strictly more work than driving an existing maintained CLI, with none of the daemon, fleet, identity, or constitution moats added. The borrowable value (CodeAct action space, sandbox-by-default, minimal core) is captured as a lesson above; there is no 24h-wrap case.

## Last reviewed

2026-06-02 — created via the `competitor-add-smolagents` task. Disposition: **Reference** (agent-tier construction framework, wrong stack + wrong layer to wrap; no corpus reading per rule #4). Lessons captured: CodeAct action space (Wang et al. arXiv 2402.01030, ICML 2024), minimal-agent thesis (reinforces rule #1), sandbox-by-default for generated code (reinforces `supervisor-sandbox-hardening`). Five-pivot-questions verdict: 0% replace; no vision-changing finding. The orchestrator records any operator questions centrally — this task does not edit `ask-human.md`.
