# Competitor: Refact.ai (smallcloudai)

> Refact.ai is an open-source coding assistant you run on your own servers, so your code never leaves your network. Minsky tracks it as a Reference: a tool to learn from, not to adopt, wrap, or compete with head-on.

- **URL**: <https://github.com/smallcloudai/refact>
- **Site**: <https://refact.ai>
- **Status**: Active, BSD-3-Clause, ~3.5k★; multiple releases; a hosted SaaS tier plus a self-hostable Docker-deployable server (`refact_server` / `refact-lsp`).
- **Pricing**: Free and open-source for the self-hosted server (you bring your own GPU and models). The hosted Refact.ai cloud tier is paid (per-seat). Self-hosting removes per-token cloud cost in exchange for owning the inference hardware.
- **Relationship**: **Reference.** Refact has a different shape from Minsky. It is a self-hosted inference server plus an editor plugin, used by one developer at a time with a human in the loop. Minsky is a daemon — a background program that keeps running — that works across many repositories on its own. The two are not competitors at the same layer, and neither depends on the other. Refact is intentionally NOT in `novel/competitive-benchmark/src/competitors.ts`: its headline "#1 open-source agent on SWE-bench Verified" claim is a model-plus-harness number, not an independently reproducible reading. Adding it would double-count whatever driver model the agent points at (rule #4 — no fabricated or double-counted readings).

## What this is

Refact.ai is an open-source AI coding assistant that can run fully on your own machines. Its defining features:

- **Local-first Rust engine.** `refact-lsp` (the engine, shaped like a Language Server) and the self-hostable `refact_server` are built around a Rust core. It serves completions, chat, and agent tool-calls without a mandatory trip to the cloud. The point is that your code never leaves your network.
- **Self-hostable, bring-your-own-model.** Deploy the server in Docker on your own GPU and point it at open-weight models (or a hosted endpoint). Fine-tuning on a team's own codebase is a first-class feature.
- **Agent mode.** An autonomous loop that plans, edits files, and runs tools — shell, web, database, debugger, via MCP integrations — and iterates. It is not just inline completion. (MCP is the Model Context Protocol, the open standard for letting an assistant call outside tools.)
- **Editor-plugin distribution.** VS Code and JetBrains plugins are the main human surface. The developer stays in the loop, in the editor.
- **MCP-capable.** The agent can call MCP servers as tools, so external integrations plug in without custom wiring.
- **Marketed SWE-bench leadership.** Refact markets itself as a top open-source agent on SWE-bench Verified. That number depends on the model and harness together; it is not an independently reproducible reading of Refact on its own.

## What this is not

- Not a daemon. Refact does not keep running in the background unattended; a developer drives it from the editor.
- Not a cross-repo fleet runner. It serves one developer per seat, with no shared task queue and no walk across many repositories.
- Not a Minsky competitor at the same layer. Refact competes on *where the model runs* (on your own hardware). Minsky competes on *how long the loop runs unattended* (indefinitely).
- Not a Minsky dependency — except that its `refact_server` could optionally serve as one local inference backend for Minsky's `--local` mode, which is a config choice, not a code dependency.

## Strengths

- **Local-first, air-gapped deployment.** The strongest differentiator: code never leaves the network. That is a hard requirement for regulated and enterprise buyers, and a niche cloud agents structurally cannot serve.
- **Self-hosted inference with open-weight models.** No per-token cloud bill once the GPU is owned. A real total-cost-of-ownership story for high-volume teams.
- **Codebase fine-tuning.** Adapting the served model to a team's own repository is a first-class workflow, not an afterthought.
- **Agent mode with MCP tool-calls.** A genuine plan-edit-run loop, not only completion. MCP integration means ecosystem tools port in.
- **Rust engine.** A fast, memory-lean serving layer. The local-first claim is credible because the engine is built for on-device latency.
- **Open-source (BSD-3).** A permissive license. The server is inspectable and forkable, which matters to the security-conscious buyer it targets.

## Weaknesses vs Minsky's vision

1. **Editor-plugin, not daemon-shaped.** Refact is driven from inside VS Code or JetBrains by a developer at the keyboard. It is not a 24/7 unattended runner; the operator (the human who runs it) must be present in the editor.
2. **One developer per seat.** No cross-repo fleet, no walk across many hosts (each host is one repository Minsky works on), no shared task queue. The human is the scheduler.
3. **Human-in-the-loop by design.** Agent mode still assumes a developer reviewing and approving in the editor — the structural inverse of Minsky's "attach and walk away".
4. **No experiment store or MAPE-K loop.** Single-session. No cross-run learning. The MAPE-K loop (Monitor, Analyze, Plan, Execute over a Knowledge base — Kephart & Chess, 2003) is Minsky's self-improvement loop; Refact has nothing like it.
5. **No persona pipeline.** A single agent loop, not a research → plan → implement → QA decomposition. (A persona is a role the agent takes on.)
6. **No constitution or deterministic enforcement.** Conventions live in prompts and human review, not in a 17-rule `pnpm pre-pr-lint --stage=full` gate that gates every merge. (The constitution is Minsky's set of numbered, non-negotiable project rules.)
7. **Benchmark honesty gap.** The "#1 open-source agent" framing is a model-plus-harness number. It is not a property of Refact-the-tool independent of its driver model, so Minsky's corpus cannot cite it without double-counting.

## What we learn / steal

- **Local-first as a deployment posture, not just a privacy feature.** Refact proves there is a real buyer for "the agent runs entirely on your infrastructure". Minsky already has a `--local` mode (the agent Aider plus the local model runner Ollama, zero cloud tokens). The lesson is to keep that path first-class and loud, because it is a structural moat cloud-only competitors cannot copy.
- **Self-hosted, bring-your-own-model total-cost story.** Refact's per-token-cost-elimination pitch maps directly onto Minsky's `--local` value. The lesson is positioning: make the zero-cloud-token path a headline benefit, not a footnote.
- **MCP tool-calls as table stakes.** Refact's agent calls MCP servers as tools; Minsky already wraps MCP. The lesson is to keep that surface first-class and reuse the ecosystem rather than rebuild tools (rule #1, don't reinvent).
- **Codebase fine-tuning as a per-team adaptation seam.** Refact treats fine-tuning the served model on the team's own repo as first-class. Minsky's analogue is the MAPE-K experiment store learning per-host iteration history. The lesson: per-context adaptation is a recognised buyer expectation, and Minsky's cross-run learning is the right shape to satisfy it without shipping a fine-tuning pipeline.

## Why choose Minsky over Refact.ai

- A 24/7 unattended daemon plus task queue plus cross-repo fleet — Refact is editor-plugin-bound and single-developer; it does not walk a fleet of repositories on its own.
- MAPE-K across-session self-improvement — Refact has no experiment store or learning loop over its own orchestration.
- Constitution-as-CI (17 deterministic rules) — Refact relies on prompts plus human review.
- Operator-machine identity with PR delivery on a walk-away cadence — Refact keeps the developer in the editor by design. (Operator-machine identity means the work runs as you, under your own git and SSH credentials.)

## Why choose Refact.ai over Minsky

- You need code to never leave your network — fully self-hosted, on-prem inference with open-weight models.
- You want an in-editor, human-supervised coding assistant plus agent for a single developer, with VS Code or JetBrains plugins.
- You want to fine-tune the served model on your own codebase and own the inference hardware to eliminate per-token cloud cost.

## Should we wrap Refact.ai instead?

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor. Refact is a self-hosted inference server plus editor plugin whose value is the in-editor, human-supervised, single-developer experience. There is no headless fleet-runner mode that Minsky's daemon could wrap as a drop-in agent or orchestrator. The self-hostable `refact_server` is an inference backend, not an agent-orchestration layer — at most a *model provider* Minsky's `--local` path could point at, which is a dependency relationship, not a wrap of the agent layer. |
| 2. **What we delegate** | Nothing at the orchestrator, fleet, or queue layer (Refact has none). The only delegatable surface is "local inference endpoint", already covered by Minsky's `--local` Aider-plus-Ollama path. Pointing Aider at a `refact_server` endpoint would be a config change, not a wrap. |
| 3. **What we keep** | All 6 moats: daemon-not-framework, operator-machine identity, constitution-plus-CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface. Refact touches none of them. (TASKS.md is the plain-text Markdown to-do list at a project's root that Minsky reads to pick work.) |
| 4. **Net moat after wrap** | 6 of 6 survive — because there is nothing to wrap. Wrapping Refact's editor-plugin layer would strip the property that makes Refact good (in-editor human supervision), exactly as with Cline. |
| 5. **Verdict** | **NO.** Refact is the wrong shape (self-hosted inference server plus editor plugin, single-developer, human-in-the-loop). The disciplined answer: **learn from its local-first posture; optionally treat `refact_server` as one possible `--local` inference backend; do not wrap the agent layer.** |

**Trigger for re-evaluation**: flip this analysis to PARTIAL YES only if Refact ships a genuine headless fleet-runner / unattended-daemon mode (no editor, no developer in the loop) that could serve as a pluggable agent backend — then re-run the wrap-feasibility questions. As of this review no such mode exists.

## Five pivot questions

### 1. How is it different from Minsky?

Refact is a self-hosted, local-first inference server plus an editor plugin that keeps a single developer in the loop. Its intent is "run a capable coding agent entirely on your own infrastructure so code never leaves the network" (refact.ai, smallcloudai/refact README). Minsky is an unattended, multi-task, cross-repo daemon with a MAPE-K self-improvement loop and a 17-rule governance gate. Its intent is "attach to a fleet of repos and walk away while it produces PRs 24/7". The interaction models are inverses: Refact's value is in-editor human supervision on a single developer's machine; Minsky's value is that the operator attaches and leaves. They occupy different niches by design — Refact competes on *where the model runs* (on-prem), Minsky competes on *how long the loop runs unattended* (indefinitely).

### 2. What lessons can it give to us?

- **2.1 Local-first is a structural moat, not a checkbox.** Refact's whole pitch — `refact_server` self-hosted, code never leaves the network (smallcloudai/refact README § self-hosting / Docker deployment) — proves there is a real buyer for fully on-prem agents. Minsky already has `--local` (Aider plus Ollama, zero cloud tokens; AGENTS.md § "Running minsky"). The lesson is to keep that path first-class and loud. Traces to rule #1 (reuse the local-inference ecosystem) plus the `--local` user story.
- **2.2 Self-hosted bring-your-own-model cost is the positioning lever.** Refact's per-token-cost-elimination story (refact.ai self-host marketing) is exactly Minsky's `--local` value stated as a buyer benefit. The lesson is positioning, not architecture: surface "zero cloud tokens" as a headline benefit. Traces to lesson §2.1 plus rule #4 (everything visible — make the cost surface loud).
- **2.3 MCP tool-calls are table stakes; keep them first-class.** Refact's agent calls MCP servers as tools (smallcloudai/refact integrations). Minsky already wraps MCP; the lesson is to reuse the ecosystem rather than rebuild tools. Traces to rule #1 (don't reinvent).
- **2.4 Per-context adaptation is an expected capability.** Refact treats codebase fine-tuning as first-class (refact.ai fine-tuning docs). Minsky's analogue is MAPE-K cross-run learning over per-host iteration history. The lesson: per-context adaptation is a recognised buyer expectation, and Minsky's experiment store is the right shape to satisfy it without a fine-tuning pipeline. Traces to rule #5 (theoretical grounding — MAPE-K) plus the self-improvement user story.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** Every lesson above sits *on top of* Minsky's existing architecture without touching the tick-loop, MAPE-K, identity model, or the 17-rule constitution. (A tick is one wake-up of the loop on its timer.) The local-first lesson (§2.1) reinforces an architectural choice Minsky already made (`--local`) rather than forcing a rewrite of `vision.md § What Minsky is`. The cost (§2.2) and MCP (§2.3) lessons are positioning and ecosystem refinements. The adaptation lesson (§2.4) is already served by the existing MAPE-K substrate. The one strategic axis where Refact is structurally ahead — fully on-prem inference as a productised, marketed deployment — is one Minsky can match through its existing `--local` path (optionally pointing at a `refact_server` endpoint). So it is an absorb-the-positioning lesson, not a vision threat. The pre-registered Pivot for this stub was "does deep research surface a daemon/unattended mode that makes Refact a runtime candidate?" The answer is **no headless fleet mode exists**, so the Reference classification holds and no `ask-human.md` entry is warranted.

### 4. How can we improve our strategy based on this?

- **Make the zero-cloud-token `--local` path a headline, not a footnote.** Refact's growth proves the on-prem buyer is real; Minsky already has the capability, so the strategy lever is positioning. Traces to lessons §2.1 plus §2.2.
- **Treat `refact_server` (and any open-weight local server) as a documented `--local` inference backend option.** Reuse the ecosystem rather than rebuild an inference engine — a config-level dependency, not a build. Traces to lesson §2.1 plus rule #1.
- **Keep MCP first-class and watch Refact's integration set.** Adopt community MCP servers that fit; do not rebuild what the ecosystem ships. Traces to lesson §2.3 plus rule #1.
- **Frame per-context learning as MAPE-K, not fine-tuning.** Position Minsky's cross-run experiment store as the adaptation seam buyers expect, avoiding a fine-tuning pipeline Minsky has no reason to own. Traces to lesson §2.4 plus rule #5.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Refact has no daemon, queue, or fleet; it is single-developer, editor-plugin-bound. Nothing to replace.
- **MAPE-K**: KEEP — no experiment store or across-session learning in Refact.
- **adapters / agent backend**: DO-NOT-WRAP — Refact has no headless or fleet mode; wrapping it would strip the in-editor human-supervised property that is its whole point (same shape as Cline). (An adapter is a small wrapper file that lets Minsky talk to one outside tool through a fixed interface.)
- **adapters / local-inference backend**: AUGMENT (optional) — `refact_server` is one possible self-hosted inference endpoint the `--local` path could point at, via the existing local-agent config seam (`~/.minsky/config.json` `local_agent` / `ollama_base_url`). A config option, not a code wrap.
- **MCP surface**: KEEP + WATCH — Minsky is already MCP-native; watch Refact's integration set for community servers to reuse.
- **constitution-as-CI / lint stack**: KEEP — Refact relies on human review; this is the layer that lets Minsky run unattended.
- **corpus / scorecard**: KEEP (do NOT add) — Refact's "#1 open-source agent" claim is a model-plus-harness number, not a standalone reproducible reading; adding it would double-count the driver model (rule #4 — no fabricated or double-counted readings).
- **identity / fleet / TASKS.md surface**: KEEP — Refact is editor-plugin-bound and single-developer.

**Total replace % across all surfaces: 0% replacement; 1 DO-NOT-WRAP (the agent backend — wrapping would break Refact's defining property) plus 1 optional AUGMENT (the local-inference backend — `refact_server` as a `--local` endpoint, config not code) plus 1 KEEP+WATCH (MCP).** Headline for the operator: *nothing in Minsky to replace. Refact is a Reference whose value is a positioning lesson (make the on-prem `--local` path a headline) and an optional local-inference backend option. Its self-hosted-server-plus-editor-plugin, human-in-the-loop, single-developer shape is orthogonal to Minsky's unattended cross-repo daemon — adopting its agent layer would break the thing that makes it good.*

## Scorecard readings

Refact.ai carries no corpus entry. Its headline SWE-bench Verified claim is a model-plus-harness number — a property of the driver model and the agent harness together, not of Refact-the-tool independent of its model. Adding a model-dependent reading would double-count the driver model already represented in the corpus (rule #4 — visible, no fabricated readings).

| Metric | Value | Date | Primary source |
| --- | --- | --- | --- |
| `swe-bench-verified-resolve-rate` | n/a | — | Refact markets a "#1 open-source agent on SWE-bench Verified" number, but it is model-plus-harness dependent and not an independently reproducible standalone reading Minsky's corpus can cite as a primary source. Like every IDE-plugin/agent tool, the harness is plumbing and the model is the measured artefact. |

## Last reviewed

2026-06-02 — created from stub via `competitor-add-refact-ai` (Five Pivot Questions framework, `--deep`). Verdict: REFERENCE — learn from Refact's local-first/on-prem deployment posture (reinforces Minsky's existing `--local` path; make it a headline) and treat `refact_server` as an optional `--local` inference backend; DO-NOT-WRAP the agent layer (Refact has no headless/fleet mode; wrapping would strip its in-editor human-supervised property). No corpus entry (the SWE-bench claim is a model-plus-harness number; rule #4). No vision change — Refact's self-hosted-server-plus-IDE-plugin, single-developer, human-in-the-loop shape is orthogonal to Minsky's unattended cross-repo daemon, which is exactly why it is a Reference and not a competitor or dependency.
