# Competitor: Factory (Factory.ai)

> The strongest *commercial* competitor on the "agent fleet" axis: a closed, venture-funded platform of specialized SDLC "Droids" with org-level memory across sessions, fronted by a thin open-source CLI (`factory-ai/factory`). This file exists so Minsky's strategy is graded honestly against a well-capitalized, GA-shipped product — not just against the OSS field — and so the OSS-facade-vs-closed-product distinction is recorded before it confuses a future planning session.

- **URL**: <https://factory.ai>
- **GitHub**: <https://github.com/factory-ai/factory> (the `droid` CLI — the open facade; the product is closed)
- **Status**: Active. GA October 2025. Commercial, closed-core with an open-source CLI entry point. ~906★ on the CLI repo at time of review.
- **Pricing**: Commercial SaaS (per-seat / usage tiers). The CLI is free to install; the value (Droids, org memory, hosted execution) sits behind the account.
- **Funding**: Series B, ~$50M (Sequoia-led, per public reporting) — materially more capital than any OSS competitor in this corpus.
- **Relationship**: **Competitor (commercial / fleet tier)** — closed product, different distribution model, different business model. Not a dependency, not an integration. Listed here for the M1.10 corpus and for the M5 commercial-vision threat assessment.

## What it is

Factory is a commercial platform that frames software delivery as a fleet of specialized agents it calls **Droids** — one per phase of the SDLC (e.g. a code Droid, a review Droid, a tester / reliability Droid, a docs Droid, a migration Droid, a knowledge Droid). The headline differentiators are:

- **Org-level memory across sessions** — Droids accumulate knowledge of the organization's codebases, conventions, and prior decisions, and carry it between runs. This is the "the agent already knows your org" pitch, and it is the axis Factory leads on.
- **Specialized Droids per SDLC phase** — rather than one generalist agent, Factory routes work to a phase-appropriate Droid, each tuned for its slice.
- **Strong public benchmark** — Factory reported a #1 Terminal-Bench result (~58.8%) at GA, plus the earlier "Code Droid: A Technical Report" SWE-bench numbers.
- **Hosted execution** — the heavy lifting runs on Factory's infrastructure; the local `droid` CLI is the thin client.

The open-source piece (`factory-ai/factory`) is the **`droid` command-line client** — an entry point that authenticates against the account and drives the hosted Droids. The product itself — the Droids, the org-memory store, the orchestration — is **closed**. This is the load-bearing distinction: the OSS repo is a facade / on-ramp, not the system.

## Strengths

- **Org-level cross-session memory** — the single feature most directly competitive with Minsky's MAPE-K "learn across runs" thesis, and Factory ships it as a productized, hosted capability today.
- **Specialized-Droid decomposition** — a clean, marketable model of "the right agent for each SDLC phase" that maps intuitively to how teams already think about roles.
- **#1 Terminal-Bench (~58.8%)** — a credible, current, third-party-style benchmark lead; not a stale 2023 number.
- **Capital + GA** — $50M Series B and a shipped GA product means real sales, real support, real iteration velocity. This is not a weekend project that will be archived in a year.
- **Polished commercial UX** — onboarding, billing, dashboards, and support are a product team's job here, not an afterthought.

## Gaps (why we don't use it / where Minsky differs)

1. **Closed core — operator does not own the loop.** The Droids, the org-memory store, and the orchestration run on Factory's infrastructure. Minsky's entire identity is an operator-machine-resident daemon the operator owns end-to-end. Factory's value lives in someone else's cloud; Minsky's lives on your machine.
2. **No constitutional / CI merge-gate substrate.** Factory ships agents, not a *constitution enforced by deterministic CI*. Minsky's moat #3 (18-rule constitution + `pnpm pre-pr-lint --stage=full` as the reviewer) has no advertised analog.
3. **Org memory is hosted, not operator-owned event-sourced state.** Factory's cross-session memory is a closed, hosted store. Minsky's equivalent (`.minsky/orchestrate.jsonl` + `experiment-store/cross-repo/<host>/*.jsonl`) is local, inspectable, git-adjacent, and event-sourced — the operator can read, replay, and audit it.
4. **The OSS surface is a thin client, not the system.** You cannot self-host the Droids or run them disconnected. The free CLI is an authentication on-ramp, so "it has an OSS repo" overstates the open surface.
5. **No zero-cloud-token / local-model path.** Minsky's `--local` mode (aider + ollama, zero cloud egress) has no equivalent; Factory is cloud-native by design.
6. **Per-task fleet, not a continuous repo-fleet daemon.** Factory's Droids are invoked against work; Minsky's daemon runs continuously and drains a queue (`TASKS.md`) across N repos via `--hosts-dir` round-robin (moat #5). Different shapes.

## What we extract or learn

- **Org-level memory is a real, productized axis — and it's the one to watch.** Factory has shipped, as a commercial feature, the thing MAPE-K is *designed* to grow into ("learn across all prior runs"). The lesson is not "copy the implementation" (it's closed) but "treat across-session knowledge accumulation as a first-class, measurable Minsky surface, not an emergent side effect." Minsky already event-sources the substrate; the gap is the *retrieval + reuse* loop on top.
- **The specialized-Droid framing maps to OMC personas / role decomposition.** Minsky already has a persona/mode story (`AGENTS.md § Choosing an OMC mode`); Factory's per-phase-Droid marketing is a cleaner external articulation of the same decomposition. Useful as positioning vocabulary, not as a new dependency.
- **Benchmark hygiene.** Factory cites a current Terminal-Bench number, not a 2023 SWE-bench Lite proxy. Lesson for the M1.10 corpus: prefer current, named, third-party-comparable benchmarks; Terminal-Bench is worth tracking as a harness Minsky should be able to cite against.

## Minsky vs Factory

This is the explicit head-to-head the task asks for — the positioning a planner or an investor should read.

| Axis | Factory (Factory.ai) | Minsky |
|---|---|---|
| **Ownership** | Closed core; Droids + memory run on Factory's cloud | Operator-machine-resident daemon; the operator owns the whole loop |
| **Open surface** | Thin `droid` CLI client only; product is closed | Fully OSS (MIT); `novel/` is the small custom layer, everything else is wrapped tools |
| **Cross-session memory** | Hosted org-memory store (productized, closed) | Event-sourced local state (`orchestrate.jsonl` + cross-repo JSONL); retrieval loop still maturing |
| **Quality gate** | Agent-produced output; no advertised constitutional CI gate | 18-rule constitution enforced by deterministic CI as the *reviewer* (moat #3) |
| **Local / zero-cloud** | Cloud-native; no local-model path | `--local` mode: aider + ollama, zero cloud tokens |
| **Distribution model** | Commercial SaaS, per-seat / usage | OSS daemon you run on your own machine across your own repos |
| **Fleet shape** | Specialized Droids invoked per SDLC phase | Continuous daemon draining `TASKS.md` across N repos (`--hosts-dir`) |
| **Capital / maturity** | $50M Series B, GA Oct 2025, polished UX | Pre-commercial OSS; commercial story is the M5 vision, not shipped |
| **Benchmark** | #1 Terminal-Bench ~58.8% (GA) | M1.10 corpus cites third-party numbers; no own headline benchmark yet |

**Honest read**: on the axes Factory chose to compete (org memory, polished fleet UX, benchmark lead, capital), Factory is ahead *today*. On the axes Minsky chose (operator ownership, fully-open self-hostable substrate, constitution-as-CI, zero-cloud-token local mode, continuous cross-repo daemon), Factory does not compete at all. They are not the same product — Factory sells a hosted fleet; Minsky is an owned, open, continuously-running substrate. The competitive risk is **narrative**, not feature parity: if "org-level memory" becomes the category-defining expectation, Minsky must show its event-sourced local substrate delivers the same *outcome* without the closed cloud.

## Should we wrap Factory instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run it for 24h?* Honest answer here.

**Verdict: CANNOT WRAP — closed product, no self-hostable surface.** The OSS repo is the `droid` thin client, which authenticates against Factory's account and drives hosted, closed Droids. There is nothing to embed behind a Minsky adapter except a SaaS client, and that client requires a paid account, cloud egress, and Factory-owned execution — every one of which violates Minsky's operator-machine-identity and zero-cloud-token moats. Wrapping the `droid` CLI as a cloud_agent backend would be wrapping *a vendor's billing surface*, not a capability we control. Rule #1 says "wrap the existing tool when one exists"; rule #1's prerequisite is that the tool be ownable/runnable on the operator's terms, which a closed SaaS core is not. So the honest answer is the opposite of the usual "yes, wrap it": there is no wrappable open surface, and the wrappable part (the client) carries the exact dependencies Minsky exists to avoid.

## Five pivot questions

### 1. How is it different from Minsky?

Factory is a **closed, hosted, commercial fleet** of specialized SDLC Droids with org-level memory, fronted by a thin open-source CLI. Minsky is an **open, operator-machine-resident, continuously-running daemon** that wraps existing agents and enforces a constitution via CI. The defining difference is **ownership of the loop**: Factory's Droids, memory, and orchestration live in Factory's cloud and are billed per seat; Minsky's daemon, state, and gates live on the operator's machine and are fully inspectable. Factory's open repo is an on-ramp to a closed product; Minsky's openness is the product. They lead on opposite axes — Factory on hosted polish + org memory + capital, Minsky on ownership + self-hostability + constitution-as-reviewer + zero-cloud-token mode.

### 2. What lessons can it give to us?

- **Org-level memory is a marketable, shippable axis** — Factory productized "the agent already knows your org." Minsky's MAPE-K substrate is *designed* to grow into this but ships it today only as event-sourced raw state. Lesson: make across-session knowledge **retrieval + reuse** a first-class, measurable surface, not an emergent property. (Factory GA materials; "Code Droid: A Technical Report.")
- **Specialized-Droid-per-phase is clean positioning vocabulary** — it maps onto Minsky's existing OMC persona/mode decomposition. Useful as external articulation, not as a new dependency.
- **Cite current third-party-comparable benchmarks** — Factory leads with Terminal-Bench (~58.8%), a current named harness, not a stale proxy. Lesson for the M1.10 corpus: prefer current, comparable numbers; track Terminal-Bench as a harness Minsky should be able to cite against.
- **A well-capitalized closed competitor validates the category and clarifies the moat** — $50M Series B + GA proves the autonomous-fleet category is real and contested. The negative lesson: do not try to out-feature a funded closed cloud on its own axes; win on the axes it structurally can't follow Minsky onto (ownership, open self-hostable substrate, constitutional CI, local mode).

### 3. Are any of these lessons potentially vision-changing?

**One candidate examined and recorded as a watch-item, not a vision change.** The hypothesis behind this task was that a $50M-funded competitor with org-level memory and 6 SDLC Droids might make Minsky's M5 *commercial* vision infeasible. On inspection it does not invalidate the vision, but it **sharpens** one claim and raises one watch-item:

- **Sharpened claim** — Minsky's commercial differentiator is not "we also have agents" (Factory wins that on capital) but "we are the *owned, open, self-hostable* substrate with a constitutional reviewer and a zero-cloud-token mode." The M5 positioning must lead with ownership + openness + the merge-gate-as-reviewer, never with raw agent capability.
- **Watch-item (logged here, not escalated)** — *if* "org-level cross-session memory" becomes the category-defining buyer expectation, Minsky's event-sourced local substrate must demonstrably deliver the same *outcome* (the daemon visibly reuses prior-run knowledge) before M5. This is a vision-relevant risk to the commercial story; it does not change the 18 rules. Per this task's brief, operator-facing questions are routed centrally rather than written into `ask-human.md` from this worker; the threat is therefore recorded inline here for the next planning pass. **No rule change to `vision.md`; recommend filing an M5-readiness probe task ("demonstrate cross-session knowledge reuse end-to-end") when the M5 milestone opens.**

### 4. How can we improve our strategy based on this?

- **Promote across-session knowledge reuse to a measurable surface** — Factory ships org-memory as a feature; Minsky has the substrate (event-sourced JSONL) but no headline retrieval/reuse metric. Strategy move: define a metric for "iterations that demonstrably reused a prior-run lesson" and wire it to the dashboard (rule #4). Traces to lesson §2.1.
- **Lead all commercial / M5 positioning with ownership + openness + constitution-as-reviewer** — never with raw agent capability, which a funded closed cloud will always out-spend. Strategy move: bake "you own the loop; the gate is the reviewer; zero-cloud-token mode exists" into the M5 narrative. Traces to lesson §2.4.
- **Adopt Terminal-Bench as a tracked harness for the M1.10 corpus** — cite a current, comparable number rather than a stale proxy. Strategy move: add Terminal-Bench to the benchmarks the corpus tracks (rule #1 — reuse the existing public harness, don't build a parallel one). Traces to lesson §2.3.
- **Use the specialized-Droid framing as positioning vocabulary** for Minsky's persona/mode decomposition, without adopting any Factory dependency. Traces to lesson §2.2.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop / daemon**: KEEP — Factory has no operator-resident daemon to substitute; its loop runs in Factory's cloud.
- **MAPE-K / cross-session memory**: KEEP + DEEPEN — do **not** delegate to Factory's closed org-memory store (it violates operator ownership + zero-cloud-token); instead deepen Minsky's own event-sourced substrate with a retrieval/reuse loop. The lesson is "build the reuse loop", not "buy the closed store".
- **adapters / agent backend**: N/A — the wrappable surface (`droid` CLI) is a billed SaaS client requiring cloud egress; wrapping it would import the exact dependencies Minsky avoids. No adapter filed.
- **sandbox**: N/A — out of Factory's open scope.
- **corpus / scorecard**: KEEP + CITE — Factory stays in the M1.10 corpus as a tracked commercial competitor; cite its published Terminal-Bench number rather than re-running a harness.
- **dashboard / TASKS.md surface**: KEEP — Factory's dashboards are hosted and closed; Minsky's operator surface is local markdown + the Watch.

**Total replace % across all surfaces: 0%.** Nothing in Minsky is replaceable by Factory, because Factory's value lives behind a closed, hosted, paid surface that contradicts Minsky's ownership and zero-cloud moats. The actionable output is one DEEPEN (the cross-session reuse loop) and one CITE (Terminal-Bench in the corpus) — no wrap, no adapter, no delegation.

## Pin / integration

Not a dependency. No adapter. Closed commercial product — there is no self-hostable surface to wrap. Tracked in the M1.10 corpus as the strongest commercial fleet-tier competitor; watch its org-memory + Terminal-Bench positioning for axes the M5 commercial vision must answer with ownership + openness rather than feature-matching.

## Pattern conformance

- **Pattern Factory implements**: specialized-agent fleet with shared organizational memory — multi-agent system with a shared blackboard / institutional memory (Hayes-Roth, B., *A Blackboard Architecture for Control*, Artificial Intelligence 26(3), 1985) combined with the SaaS hosted-multi-tenant distribution model (Mell & Grance, *The NIST Definition of Cloud Computing*, NIST SP 800-145, 2011).
- **Conformance level**: full (in the pattern Factory implements — a hosted multi-agent blackboard with org-scoped shared memory).
- **How Minsky relates**: don't adopt — wrong ownership (closed cloud vs operator machine), wrong distribution (hosted SaaS vs OSS daemon), no constitutional CI gate, no zero-cloud-token path. Minsky borrows the *axis* (across-session knowledge accumulation is worth productizing as a measurable surface) and the *positioning vocabulary* (specialized roles per SDLC phase) while rejecting the closed hosted substrate. The shared-memory pattern is absorbed via Minsky's own event-sourced local state (`.minsky/orchestrate.jsonl` + cross-repo JSONL), not via Factory's store.
- **Index relation**: this entry is a competitor analysis, not a new Minsky artifact — no new `vision.md` § "Pattern conformance index" row is added (the pattern Minsky uses for its own shared-memory substrate — event sourcing — is already indexed via the MAPE-K / orchestrate.jsonl rows).

## Last reviewed

2026-06-02 — initial deep-dive added per task `competitor-add-factory` (Five Pivot Questions framework + explicit "Minsky vs Factory" positioning). Verdict: CANNOT WRAP (closed product, thin-client-only open surface); the competitive risk is narrative (org-level memory as a category expectation), not feature parity. No `vision.md` change; recommend an M5-readiness "demonstrate cross-session knowledge reuse end-to-end" probe task when the M5 milestone opens (vision-relevant watch-item logged inline per this task's central-questions routing — `ask-human.md` intentionally not edited).
