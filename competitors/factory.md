# Competitor: Factory (Factory.ai)

> A closed, venture-funded commercial platform of specialized coding agents with org-wide memory, fronted by a thin open-source command-line tool — the strongest paid competitor to Minsky on the "fleet of agents" axis.

- **URL**: <https://factory.ai>
- **GitHub**: <https://github.com/factory-ai/factory> (the `droid` command-line tool — an open front door; the product behind it is closed)
- **Status**: Active. Generally available since October 2025. Commercial, with a closed core and an open-source command-line entry point. ~906★ on the command-line tool's repo at time of review.
- **Pricing**: Commercial SaaS, per-seat or usage tiers. The command-line tool is free to install; the value (the agents, the org memory, the hosted execution) sits behind a paid account.
- **Funding**: Series B, ~$50M (Sequoia-led, per public reporting) — materially more capital than any open-source competitor in this corpus.
- **Relationship**: **Competitor (commercial / fleet tier).** A closed product with a different distribution model and a different business model. Not a dependency, not an integration. Listed here for the M1.10 competitor corpus and for the M5 commercial-vision threat assessment.

## What this is

Factory is a commercial platform that treats software delivery as a fleet of specialized coding agents it calls **Droids** — one per phase of the software development lifecycle. There is a code Droid, a review Droid, a tester/reliability Droid, a docs Droid, a migration Droid, and a knowledge Droid.

The work runs on Factory's own servers. The local `droid` command-line tool is a thin client: it signs you in to your Factory account and drives the hosted Droids from there.

Factory leads on four things:

- **Org-wide memory across sessions.** Droids accumulate knowledge of your organization's codebases, conventions, and past decisions, and carry it from one run to the next. This is the "the agent already knows your org" pitch, and it is the axis Factory competes hardest on.
- **A specialized Droid per phase.** Instead of one generalist agent, Factory routes each piece of work to the phase-appropriate Droid, each tuned for its slice.
- **A strong public benchmark.** Factory reported a #1 Terminal-Bench result (~58.8%) at general availability, plus the earlier "Code Droid: A Technical Report" SWE-bench numbers.
- **Hosted execution.** The heavy lifting runs on Factory's infrastructure; your machine only runs the thin client.

## What this is not

- **Not open-source software you can self-host.** The open repo (`factory-ai/factory`) is only the `droid` command-line client — a sign-in on-ramp. The Droids, the org-memory store, and the orchestration are closed and run in Factory's cloud. "It has an open-source repo" overstates how open the system is.
- **Not operator-owned.** You do not own the loop. The agents, the memory, and the orchestration live on someone else's servers, billed per seat. (An **operator** is the human who runs the tool, and **operator ownership** means the work runs on your own machine, under your own credentials.)
- **Not a continuous background program.** Factory's Droids are invoked against a piece of work. Minsky, by contrast, runs as a **daemon** — a background program that keeps running on your machine, surviving terminal close and restarting on crash — and continuously drains a to-do list across many repos.
- **Not a local-model path.** Factory is cloud-native by design. There is no zero-cloud-token, run-it-all-on-your-machine mode.

## Strengths

- **Org-wide memory across sessions.** This is the single feature most directly competitive with Minsky's plan to learn across runs, and Factory ships it today as a hosted, productized capability.
- **Specialized-Droid decomposition.** A clean, marketable model of "the right agent for each phase" that maps to how teams already think about roles.
- **#1 Terminal-Bench (~58.8%).** A credible, current benchmark lead — not a stale 2023 number.
- **Capital and general availability.** A $50M Series B and a shipped product mean real sales, real support, and real iteration speed. This is not a weekend project that will be archived in a year.
- **Polished commercial UX.** Onboarding, billing, dashboards, and support are a product team's job here, not an afterthought.

## Weaknesses vs Minsky's vision

1. **Closed core — the operator does not own the loop.** The Droids, the org-memory store, and the orchestration run on Factory's infrastructure. Minsky's whole identity is a daemon that lives on the operator's machine and that the operator owns end to end. Factory's value lives in someone else's cloud; Minsky's lives on your machine.
2. **No constitution enforced by deterministic CI.** Factory ships agents, not a set of non-negotiable project rules checked by automated CI. Minsky's moat #3 (an 18-rule constitution plus `pnpm pre-pr-lint --stage=full` acting as the reviewer) has no advertised equivalent. (The **constitution** is Minsky's numbered, non-negotiable project rules; a numbered **rule #N** ties a reference to its number and meaning.)
3. **Org memory is hosted, not operator-owned and event-sourced.** Factory's cross-session memory is a closed, hosted store. Minsky's equivalent — `.minsky/orchestrate.jsonl` plus `experiment-store/cross-repo/<host>/*.jsonl` — is local, inspectable, git-adjacent, and event-sourced, so the operator can read, replay, and audit it.
4. **The open surface is a thin client, not the system.** You cannot self-host the Droids or run them disconnected. The free command-line tool is a sign-in on-ramp.
5. **No zero-cloud-token, local-model path.** Minsky's `--local` mode (the Aider agent driving an Ollama model, with zero cloud egress) has no Factory equivalent. Factory is cloud-native by design.
6. **A per-task fleet, not a continuous repo-fleet daemon.** Factory's Droids are invoked against a piece of work. Minsky's daemon runs continuously and drains a to-do list (`TASKS.md`) across many repos in turn via `--hosts-dir` round-robin (moat #5). Different shapes. (A **host** is one code project Minsky works on; a **cross-repo fleet** is Minsky walking several hosts in turn.)

## What we learn / steal

- **Org-wide memory is a real, productized axis — and the one to watch.** Factory has shipped, as a commercial feature, the thing Minsky's self-improvement loop is designed to grow into ("learn across all prior runs"). The lesson is not "copy the implementation" (it is closed) but "treat across-session knowledge accumulation as a first-class, measurable Minsky surface, not an emergent side effect." Minsky already event-sources the raw substrate; the gap is the retrieval-and-reuse loop on top.
- **The specialized-Droid framing maps to Minsky's role decomposition.** Minsky already has a story for **personas** — roles the agent takes on (researcher, planner, implementer, QA), documented under `AGENTS.md § Choosing an OMC mode`. Factory's per-phase-Droid marketing is a cleaner external articulation of the same decomposition. Useful as positioning vocabulary, not as a new dependency.
- **Benchmark hygiene.** Factory cites a current Terminal-Bench number, not a 2023 SWE-bench Lite proxy. The lesson for the M1.10 corpus: prefer current, named, third-party-comparable benchmarks. Terminal-Bench is worth tracking as a harness Minsky should be able to cite against.

### Minsky vs Factory — side by side

This is the explicit head-to-head a planner or an investor should read.

| Axis | Factory (Factory.ai) | Minsky |
|---|---|---|
| **Ownership** | Closed core; Droids + memory run on Factory's cloud | Daemon on the operator's machine; the operator owns the whole loop |
| **Open surface** | Thin `droid` client only; product is closed | Fully open-source (MIT); `novel/` is the small custom layer, everything else wraps existing tools |
| **Cross-session memory** | Hosted org-memory store (productized, closed) | Event-sourced local state (`orchestrate.jsonl` + cross-repo JSONL); retrieval loop still maturing |
| **Quality gate** | Agent output; no advertised constitution-as-CI gate | 18-rule constitution enforced by deterministic CI as the reviewer (moat #3) |
| **Local / zero-cloud** | Cloud-native; no local-model path | `--local` mode: Aider + Ollama, zero cloud tokens |
| **Distribution model** | Commercial SaaS, per-seat / usage | Open-source daemon you run on your own machine across your own repos |
| **Fleet shape** | Specialized Droids invoked per phase | Continuous daemon draining `TASKS.md` across many repos (`--hosts-dir`) |
| **Capital / maturity** | $50M Series B, GA Oct 2025, polished UX | Pre-commercial open-source; the commercial story is the M5 vision, not shipped |
| **Benchmark** | #1 Terminal-Bench ~58.8% (GA) | M1.10 corpus cites third-party numbers; no own headline benchmark yet |

**Honest read.** On the axes Factory chose — org memory, polished fleet UX, benchmark lead, capital — Factory is ahead today. On the axes Minsky chose — operator ownership, fully-open self-hostable substrate, constitution-as-CI, zero-cloud-token local mode, continuous cross-repo daemon — Factory does not compete at all. They are not the same product. Factory sells a hosted fleet; Minsky is an owned, open, continuously-running substrate. The competitive risk is **narrative**, not feature parity: if "org-wide memory" becomes the category-defining expectation, Minsky must show that its event-sourced local substrate delivers the same outcome without the closed cloud.

## Why choose Minsky over Factory

- **You own the loop.** Minsky's daemon, state, and gates all live on your machine and are fully inspectable. Factory's Droids, memory, and orchestration live in Factory's cloud and are billed per seat.
- **The substrate is open and self-hostable.** Minsky is fully open-source (MIT). Factory's open repo is a sign-in on-ramp to a closed product.
- **A constitution enforces quality.** Minsky's 18-rule constitution runs as deterministic CI and acts as the reviewer (moat #3). Factory ships agents, with no advertised equivalent.
- **There is a zero-cloud-token mode.** Minsky's `--local` mode runs the whole loop on your machine with no cloud egress. Factory has no local-model path.
- **It runs continuously across many repos.** Minsky's daemon drains `TASKS.md` across many hosts in turn. Factory's Droids are invoked per task.

## Why choose Factory over Minsky

- **Org-wide memory ships today.** Factory has productized "the agent already knows your org." Minsky has the event-sourced substrate but no headline retrieval-and-reuse loop yet.
- **It is generally available, with capital behind it.** A $50M Series B and a shipped product mean real sales, support, and iteration speed.
- **The UX is polished.** Onboarding, billing, dashboards, and support are a product team's responsibility.
- **It leads a current benchmark.** #1 Terminal-Bench (~58.8%) at general availability.

## Scorecard readings

Factory has no entry in the M1.10 benchmark corpus's machine-tracked scorecard. The only public number cited here is the Terminal-Bench ~58.8% lead Factory reported at general availability, plus the earlier "Code Droid: A Technical Report" SWE-bench numbers. Track Terminal-Bench as a harness for the corpus; cite Factory's published number rather than re-running the harness.

## Should we wrap Factory instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with one question: if this tool is amazing at everything we do, why not wrap it and run it for 24 hours? Here is the honest answer.

**Verdict: CANNOT WRAP — closed product, no self-hostable surface.**

The open repo is the `droid` thin client. It signs in to a Factory account and drives hosted, closed Droids. There is nothing to embed behind a Minsky **adapter** (a small wrapper that lets Minsky talk to one outside tool through a fixed interface) except a SaaS client — and that client requires a paid account, cloud egress, and Factory-owned execution. Every one of those violates Minsky's operator-machine-identity and zero-cloud-token moats.

Wrapping the `droid` command-line tool as a cloud-agent backend would be wrapping a vendor's billing surface, not a capability we control. Rule #1 says "wrap the existing tool when one exists," but its prerequisite is that the tool be ownable and runnable on the operator's terms — which a closed SaaS core is not. So the honest answer is the opposite of the usual "yes, wrap it": there is no wrappable open surface, and the wrappable part (the client) carries the exact dependencies Minsky exists to avoid.

## Five pivot questions

### 1. How is it different from Minsky?

Factory is a **closed, hosted, commercial fleet** of specialized Droids with org-wide memory, fronted by a thin open-source command-line tool. Minsky is an **open daemon that lives on the operator's machine**, runs continuously, wraps existing agents, and enforces a constitution via CI.

The defining difference is **ownership of the loop**. Factory's Droids, memory, and orchestration live in Factory's cloud and are billed per seat. Minsky's daemon, state, and gates live on the operator's machine and are fully inspectable. Factory's open repo is an on-ramp to a closed product; Minsky's openness is the product. They lead on opposite axes — Factory on hosted polish, org memory, and capital; Minsky on ownership, self-hostability, constitution-as-reviewer, and a zero-cloud-token mode.

### 2. What lessons can it give to us?

- **Org-wide memory is a marketable, shippable axis.** Factory productized "the agent already knows your org." Minsky's self-improvement substrate is designed to grow into this but ships today only as event-sourced raw state. Lesson: make across-session knowledge **retrieval and reuse** a first-class, measurable surface, not an emergent property. (Factory GA materials; "Code Droid: A Technical Report.")
- **Specialized-Droid-per-phase is clean positioning vocabulary.** It maps onto Minsky's existing persona/role decomposition. Useful as external articulation, not as a new dependency.
- **Cite current, third-party-comparable benchmarks.** Factory leads with Terminal-Bench (~58.8%), a current named harness, not a stale proxy. Lesson for the M1.10 corpus: prefer current, comparable numbers; track Terminal-Bench as a harness Minsky should be able to cite against.
- **A well-capitalized closed competitor validates the category and clarifies the moat.** A $50M Series B plus general availability proves the autonomous-fleet category is real and contested. The negative lesson: do not try to out-feature a funded closed cloud on its own axes; win on the axes it structurally cannot follow Minsky onto (ownership, open self-hostable substrate, constitutional CI, local mode).

### 3. Are any of these lessons potentially vision-changing?

**One candidate examined, recorded as a watch-item, not a vision change.** The hypothesis behind this task was that a $50M-funded competitor with org-wide memory and six SDLC Droids might make Minsky's M5 commercial vision infeasible. On inspection it does not invalidate the vision. It sharpens one claim and raises one watch-item.

- **Sharpened claim.** Minsky's commercial differentiator is not "we also have agents" (Factory wins that on capital) but "we are the owned, open, self-hostable substrate with a constitutional reviewer and a zero-cloud-token mode." The M5 positioning must lead with ownership, openness, and the merge-gate-as-reviewer — never with raw agent capability.
- **Watch-item (logged here, not escalated).** If "org-wide cross-session memory" becomes the category-defining buyer expectation, Minsky's event-sourced local substrate must demonstrably deliver the same outcome (the daemon visibly reuses prior-run knowledge) before M5. This is a vision-relevant risk to the commercial story; it does not change the 18 rules. Per this task's brief, operator-facing questions are routed centrally rather than written into `ask-human.md` from this worker; the threat is therefore recorded inline here for the next planning pass. **No rule change to `vision.md`; recommend filing an M5-readiness probe task ("demonstrate cross-session knowledge reuse end-to-end") when the M5 milestone opens.**

### 4. How can we improve our strategy based on this?

- **Promote across-session knowledge reuse to a measurable surface.** Factory ships org-memory as a feature; Minsky has the substrate (event-sourced JSONL) but no headline retrieval/reuse metric. Strategy move: define a metric for "iterations that demonstrably reused a prior-run lesson" and wire it to the dashboard (rule #4). Traces to lesson §2.1.
- **Lead all commercial / M5 positioning with ownership, openness, and constitution-as-reviewer.** Never lead with raw agent capability, which a funded closed cloud will always out-spend. Strategy move: bake "you own the loop; the gate is the reviewer; a zero-cloud-token mode exists" into the M5 narrative. Traces to lesson §2.4.
- **Adopt Terminal-Bench as a tracked harness for the M1.10 corpus.** Cite a current, comparable number rather than a stale proxy. Strategy move: add Terminal-Bench to the benchmarks the corpus tracks (rule #1 — reuse the existing public harness, don't build a parallel one). Traces to lesson §2.3.
- **Use the specialized-Droid framing as positioning vocabulary** for Minsky's persona/role decomposition, without adopting any Factory dependency. Traces to lesson §2.2.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **Daemon / loop**: KEEP — Factory has no operator-resident daemon to substitute; its loop runs in Factory's cloud.
- **Self-improvement loop / cross-session memory**: KEEP + DEEPEN — do **not** delegate to Factory's closed org-memory store (it violates operator ownership and the zero-cloud-token moat); instead deepen Minsky's own event-sourced substrate with a retrieval-and-reuse loop. The lesson is "build the reuse loop," not "buy the closed store."
- **Adapters / agent backend**: N/A — the wrappable surface (`droid` client) is a billed SaaS client requiring cloud egress; wrapping it would import the exact dependencies Minsky avoids. No adapter filed.
- **Sandbox**: N/A — out of Factory's open scope.
- **Corpus / scorecard**: KEEP + CITE — Factory stays in the M1.10 corpus as a tracked commercial competitor; cite its published Terminal-Bench number rather than re-running a harness.
- **Dashboard / TASKS.md surface**: KEEP — Factory's dashboards are hosted and closed; Minsky's operator surface is local markdown plus the Watch.

**Total replace across all surfaces: 0%.** Nothing in Minsky is replaceable by Factory, because Factory's value lives behind a closed, hosted, paid surface that contradicts Minsky's ownership and zero-cloud moats. The actionable output is one DEEPEN (the cross-session reuse loop) and one CITE (Terminal-Bench in the corpus) — no wrap, no adapter, no delegation.

## Pin / integration

Not a dependency. No adapter. Closed commercial product — there is no self-hostable surface to wrap. Tracked in the M1.10 corpus as the strongest commercial fleet-tier competitor. Watch its org-memory and Terminal-Bench positioning for axes the M5 commercial vision must answer with ownership and openness rather than feature-matching.

## Pattern conformance

- **Pattern Factory implements**: a specialized-agent fleet with shared organizational memory — a multi-agent system with a shared blackboard / institutional memory (Hayes-Roth, B., *A Blackboard Architecture for Control*, Artificial Intelligence 26(3), 1985) combined with the SaaS hosted-multi-tenant distribution model (Mell & Grance, *The NIST Definition of Cloud Computing*, NIST SP 800-145, 2011).
- **Conformance level**: full (in the pattern Factory implements — a hosted multi-agent blackboard with org-scoped shared memory).
- **How Minsky relates**: don't adopt — wrong ownership (closed cloud vs operator machine), wrong distribution (hosted SaaS vs open-source daemon), no constitution-as-CI gate, no zero-cloud-token path. Minsky borrows the axis (across-session knowledge accumulation is worth productizing as a measurable surface) and the positioning vocabulary (specialized roles per phase) while rejecting the closed hosted substrate. The shared-memory pattern is absorbed via Minsky's own event-sourced local state (`.minsky/orchestrate.jsonl` + cross-repo JSONL), not via Factory's store.
- **Index relation**: this entry is a competitor analysis, not a new Minsky artifact — no new `vision.md` § "Pattern conformance index" row is added (the pattern Minsky uses for its own shared-memory substrate — event sourcing — is already indexed via the MAPE-K / orchestrate.jsonl rows).

## Last reviewed

2026-06-02 — initial deep-dive added per task `competitor-add-factory` (Five Pivot Questions framework + explicit "Minsky vs Factory" positioning). Verdict: CANNOT WRAP (closed product, thin-client-only open surface); the competitive risk is narrative (org-wide memory as a category expectation), not feature parity. No `vision.md` change; recommend an M5-readiness "demonstrate cross-session knowledge reuse end-to-end" probe task when the M5 milestone opens (vision-relevant watch-item logged inline per this task's central-questions routing — `ask-human.md` intentionally not edited).
