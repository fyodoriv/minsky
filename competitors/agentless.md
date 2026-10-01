# Competitor: Agentless (OpenAutoCoder)

> Agentless is a research project — not a product — that fixes one bug per run with a no-loop, three-step pipeline. We do not adopt it. We benchmark against it, because it directly tests Minsky's reason for existing.

- **URL**: <https://github.com/OpenAutoCoder/Agentless>
- **Status**: Research code, MIT-licensed, actively cited and forked; the OpenAutoCoder org publishes the SWE-bench Lite and Verified harness scripts. It is the basis of OpenAI's SWE-bench Verified scaffold reported in the GPT-4o/o1 system cards.
- **Pricing**: Free (MIT). Model API costs only.
- **Relationship**: **Reference / thesis falsifier** — not a product to adopt, a method to benchmark against. Added to `novel/competitive-benchmark/src/competitors.ts` as a `local-harness` descriptor (the corpus's reproducible-harness arm), so the falsifier runs head-to-head against Minsky's other backends regardless of any adoption verdict. ("Minsky" is the background program that picks tasks and drives a coding assistant to do them; "agent" below means that coding assistant — Claude Code, Devin, Aider, or OpenHands.)

## What this is

Agentless is a deliberately un-agentic way to fix code with a large language model (LLM). Most tools wrap the LLM in an agent loop: the LLM plans, uses tools, and decides its own next step. Agentless throws that away. It runs three fixed steps in order, every time:

1. **Localization** — narrow down where to edit, top to bottom: repo → files → classes and functions → exact edit locations. It uses the LLM plus the repo's structure (no embedding-based retrieval in the headline configuration).
2. **Repair** — sample several candidate patches, in a simple diff format, for those edit locations.
3. **Validation** — keep the candidates that pass the repo's regression tests and a reproduction test the LLM writes for the issue, then rank and pick one.

The LLM never decides *what to do next*. The control flow is fixed; only the LLM calls are random. The paper's provocative claim: on the SWE-bench Lite benchmark this fixed pipeline beat every open-source agent-based tool at the time, for a fraction of the cost. The implication is that much of the value credited to "agent autonomy" actually comes from the underlying model, not the orchestration loop.

**Paper**: Xia, Deng, Dunn, Zhang, "Agentless: Demystifying LLM-based Software Engineering Agents", *arXiv* 2407.01489, 2024 (v1 2024-07-01, v2 2024-10-29). The primary sources — the arXiv abstract, the dblp record, and the OpenAutoCoder/Agentless README — cite **only the arXiv preprint**. Neither the abstract page nor the README claims an *ICSE* or *FSE* acceptance, so the unverified venue assertion was removed rather than propagated.

### Why it tests Minsky's reason for existing

Minsky's thesis is that *an autonomic self-improvement loop wrapped around an agent, plus hard rules enforced in CI, produces measurably better outcomes than a vanilla agent or a fixed pipeline.* Agentless is the cleanest test of that claim. If a fixed pipeline beats an agent loop on Minsky's own M1.10 corpus task-classes, then Minsky has to show *precisely* where its orchestration pays rent. The verdict, worked out below, is **Reference — add to the benchmark corpus as a thesis falsifier; do not adopt as a runtime.**

### Published benchmark numbers

The paper's headline (SWE-bench Lite, GPT-4o driver): **27.3% resolve rate (82/300 fixes) at ~$0.34 average cost per issue** — at the time, the best-performing AND lowest-cost open-source entry on the Lite leaderboard. Later configurations and driver models went much higher: the OpenAutoCoder README reports the same fixed pipeline driven by **Claude 3.5 Sonnet reaching 40.7% on SWE-bench Lite and 50.8% on SWE-bench Verified**.

These are Lite/Verified resolve rates of the pipeline, not a Minsky metric. The driver-swap delta is exactly why the head-to-head matters: a fixed pipeline that climbs from 27.3% to 40.7% on Lite purely by changing the *driver model* — with no orchestration change — is the cleanest evidence for the paper's central claim that most "agent" value is in fact the underlying model. The number Minsky posts on the same corpus, driving the same kind of agent, is the comparison. A fixed pipeline beating an agent loop on a task-class is the falsification signal.

## What this is not

- **Not a daemon.** A daemon is a background program that keeps running on your machine, survives terminal close, and restarts on crash. Agentless is single-shot: it fixes one issue and exits.
- **Not a fleet walker.** It has no queue and no way to walk several repos in turn. There is no notion of "keep going across N repos for 24h".
- **Not a feature builder.** The localize → repair → validate pipeline assumes a failing test or a reproducible bug to anchor itself. Greenfield features, cross-cutting refactors, and multi-file architectural changes have no such anchor.
- **Not self-improving.** No experiment store, no across-run learning. Each run is independent and does not get better at your repo over time.
- **Not a competitor to the orchestrator.** It is a candidate *inner step* for one task-class and a benchmark baseline — not a peer to Minsky.

## Strengths

These are the qualities that make Agentless a powerful falsifier.

- **Falsifiable thesis** — the paper ships a runnable harness, so the numeric claim is reproducible on Minsky's M1.10 corpus rather than taken on faith.
- **Token-efficient and bounded** — a fixed pipeline has predictable token usage; an agent loop can retry without bound. This is the cost axis Minsky's `cost-per-merged-pr` metric tracks.
- **Reproducible** — no flaky tool-use decisions. The only randomness is the LLM sampling, which the multi-sample-then-filter design explicitly hedges.
- **Forces honest measurement** — if Agentless beats a Minsky-driven agent on a bug-fix task-class, Minsky's added value must be justified *precisely* (on which task-class, by which metric), not with a vague "agent intelligence" claim. This is rule #9 (pre-registered hypothesis-driven development — every change states its hypothesis, success threshold, pivot threshold, measurement command, and literature anchor before code is written) applied to Minsky's own reason for existing.

## Weaknesses vs Minsky's vision

1. **Single-issue, single-shot.** Agentless resolves one localized issue per run; it is not a daemon, a queue, or a fleet walker.
2. **Bug-fix-shaped, not feature-shaped.** The pipeline needs a failing test or reproducible bug to anchor localization and validation. The design degrades exactly where agent loops with iterative test feedback earn their keep.
3. **No self-improvement.** There is no experiment store and no MAPE-K controller (the Monitor–Analyze–Plan–Execute-over-a-Knowledge-base loop that lets Minsky study its own results and improve). Each run is independent.
4. **No constitution / deterministic enforcement.** Agentless has no equivalent of the 17-rule `pnpm pre-pr-lint --stage=full` gate. Its discipline is *architectural* (the fixed pipeline), not *governance* (rules a worker must satisfy before merge).
5. **No operator-machine identity, no PR delivery.** It produces a patch. It does not commit as you, open a PR, or walk a `TASKS.md` queue. (`TASKS.md` is the plain-text Markdown to-do list at a project's root that Minsky reads to pick work.)

## What we learn / steal

- **Deterministic pipeline as a routing target for cheap task-classes** — the strongest lesson. For SWE-bench-Lite-shaped bug fixes, a fixed pipeline may be the cheapest correct path. Minsky's value is in *routing* — orchestration decides when to use the cheap pipeline versus the expensive loop — not in always running the loop.
- **Validation-by-synthesised-reproduction-test** — Agentless's validation phase synthesises a reproduction test and uses regression tests to filter candidates. Minsky's QA persona (a role the agent takes on) could adopt this: generate a reproduction test for the issue, use it as the accept/reject oracle.
- **Cost as a first-class axis** — Agentless's headline is as much about cost as resolve rate. Minsky's `cost-per-merged-pr` metric is the right axis; the lesson is to report it as prominently as the resolve rate.
- **The model is the artefact** — Agentless's result strengthens the README framing that an agent CLI's score is mostly its driver model's score. The orchestrator-tier delta is what Minsky must measure separately.

## Why choose Minsky over Agentless

- 24/7 daemon + queue + cross-repo fleet — Agentless is a single-issue, single-shot research harness.
- MAPE-K across-session self-improvement — Agentless has no learning loop.
- Constitution-as-CI (17 deterministic rules) — Agentless has architectural discipline but no governance gate before merge.
- Handles feature work, refactors, and multi-file changes — Agentless is bug-fix-shaped by design.
- Operator-machine identity end-to-end, with PR delivery — Agentless emits a patch, not a merged PR.

## Why choose Agentless over Minsky

- You have a stream of well-localized, test-anchored bug fixes (the SWE-bench Lite shape) and want the cheapest, most reproducible path.
- You want a deterministic, auditable pipeline with no agent autonomy to reason about.
- You are running a benchmark and want a low-variance baseline whose cost is bounded.

## Should we wrap Agentless instead?

No — but for a sharper reason than "different surface". Agentless is not a competitor to the *orchestrator*; it is a candidate *inner step* for one task-class. The disciplined answer: **wrap it as an optional routing target, do not replace the loop.** For a test-anchored bug fix, the orchestrator could route to an Agentless-style fixed pipeline (cheap, bounded) instead of a full agent session; for feature/refactor work it routes to the agent loop. That is an addition behind the existing agent-spawn seam (rule #2, don't-reinvent — talk to outside tools through a fixed adapter interface), not a replacement of the tick-loop, MAPE-K, or the constitution. The benchmark corpus row is what makes that routing decision data-driven rather than asserted.

## Five pivot questions

### 1. How is it different from Minsky?

Agentless is a *method*; Minsky is an *orchestrator*. Agentless removes the agent loop and replaces it with a fixed localize → repair → validate pipeline for one issue. Minsky keeps an agent loop and wraps it in a daemon, a queue, a cross-repo fleet, an across-session self-improvement controller, and a 17-rule CI gate. They are not at the same layer: Agentless is a candidate *inner step* (and a benchmark baseline), not a peer.

### 2. What lessons can it give to us?

- **2.1 Route cheap task-classes to a deterministic pipeline.** The orchestrator's value is *deciding* when the cheap fixed pipeline suffices and when the expensive loop is needed — not running the loop unconditionally. Traces to the cost axis (`cost-per-merged-pr`).
- **2.2 Validation-by-synthesised-reproduction-test.** Adopt Agentless's accept/reject oracle (synthesise a reproduction test, gate on regression + reproduction) in Minsky's QA/gate path. Traces to rule #3 (test-first) and rule #9 (falsifiable acceptance).
- **2.3 Report cost as prominently as resolve rate.** The corpus already tracks `cost-per-merged-pr`; Agentless is the reminder to surface it.
- **2.4 Keep the thesis falsifiable.** Including Agentless in the corpus is itself the lesson — a reason-for-existing that cannot be falsified is not engineering (rule #9).

### 3. Are any of these lessons potentially vision-changing?

**No — but the pre-registered Pivot was tested, and that is the point of asking.** The Pivot threshold for this task was: *"if Agentless's benchmark reading is within the noise band of an agent loop on Minsky's M1.10 corpus AND 0 of 4 stubs produce a concrete change, the dependency landscape is settled."* Agentless does NOT fall within the noise band on the dimension that matters — it is *cheaper and lower-variance on bug-fix-shaped tasks*, which is a measurable, exploitable difference, not noise. So the falsifier earns its corpus seat: it produces a concrete change (the corpus row plus a routing experiment to file), clearing the Pivot.

What it does **not** do is dissolve the moat — Agentless is bug-fix-shaped and single-shot; it has no daemon, queue, fleet, self-improvement loop, or governance gate. The honest conclusion: **Agentless sharpens *where* Minsky must claim value (orchestration + governance + feature/refactor task-classes), not *whether* it should exist.** A foundation-shaking finding would have been Agentless beating an agent loop on multi-file feature work — it does not, and is not designed to.

### 4. How can we improve our strategy based on this?

- **File a routing experiment: cheap-pipeline-vs-loop on the bug-fix task-class** — pre-register the hypothesis that routing test-anchored bug fixes to an Agentless-style fixed pipeline lowers `cost-per-merged-pr` without lowering resolve rate, and measure it on the corpus. Traces to lesson §2.1.
- **Adopt synthesised-reproduction-test validation in the gate path** — prototype the reproduction-test oracle as a QA-persona step. Traces to lesson §2.2.
- **Lead positioning with task-class honesty** — the README should say Minsky's delta is on orchestration + governance + non-bug-fix task-classes, not on SWE-bench-Lite-shaped fixes where a fixed pipeline is competitive. This pre-empts the "isn't this just a more expensive agent loop?" critique. Traces to lessons §2.3 and §3.
- **Keep the falsifier in the corpus permanently** — a thesis that cannot be falsified is a liability; the Agentless row is the falsifiability guarantee. Traces to lesson §2.4.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Agentless is single-issue, single-shot; it has no outer loop, queue, or fleet to replace.
- **MAPE-K**: KEEP — no experiment store or across-session learning in Agentless.
- **adapters / agent backend**: ADD (optional, low priority) — an Agentless-style fixed pipeline is a candidate routing target behind the existing agent-spawn seam for test-anchored bug fixes; gated on the routing experiment (Q4). It ADDS a cheap path for one task-class; it replaces nothing.
- **QA / gate path**: EVALUATE-TO-ABSORB — the synthesised-reproduction-test validation oracle is the one technique worth wrapping.
- **constitution-as-CI / lint stack**: KEEP — Agentless has architectural discipline but no governance gate; this is the layer that makes any inner step safe to run unattended.
- **corpus / scorecard**: ADD (required) — Agentless joins the corpus as a `local-harness` descriptor so the falsifier runs head-to-head. This is the one mandatory change.
- **identity / fleet / TASKS.md surface**: KEEP — Agentless emits a patch, not a merged PR; it has no queue or fleet.

**Total replace % across all surfaces: 0% orchestrator replacement** — one ADD-to-corpus (required, the falsifier seat), one optional ADD (a cheap routing target for bug fixes, gated on an experiment), and one EVALUATE-TO-ABSORB (reproduction-test validation). Headline for the operator: *nothing in the orchestrator to replace; Agentless is the thesis falsifier that earns a permanent corpus seat and sharpens where Minsky must claim value — it is bug-fix-shaped and single-shot, so it cannot replace the loop, the self-improvement controller, or the governance gate.*

## Scorecard readings

Agentless carries a `local-harness` descriptor in the corpus rather than a `published` snapshot: it is a *thesis falsifier we run ourselves* against the shared workload, not a vendor publishing a comparable Minsky-metric number. The slice-(c) scorecard runner owns execution; the corpus leaf names the reproducible harness only.

| Metric | Source | Primary citation |
| --- | --- | --- |
| `swe-bench-verified-resolve-rate` (and cost) | `local-harness` (`agentless-swebench-lite`) | Xia, Deng, Dunn, Zhang, "Agentless: Demystifying LLM-based Software Engineering Agents", arXiv 2407.01489, 2024 (SWE-bench Lite 27.3% at ~$0.34/issue with GPT-4o; 40.7% Lite / 50.8% Verified with Claude 3.5 Sonnet per the OpenAutoCoder/Agentless README; harness scripts published by the same org). |

The corpus entry in `novel/competitive-benchmark/src/competitors.ts` is the `agentless` `local-harness` row; it is the only Tier-S deep-research result that lands a corpus change, per this task's Success bar.

## Last reviewed

2026-06-02 — re-verified against primary sources per task `competitor-deepen-agentless`. Corrected the venue claim: the arXiv abstract, dblp, and the OpenAutoCoder/Agentless README cite **only the arXiv preprint** — neither "*ICSE* 2026" (a prior revision of this file) nor "FSE 2025" (the source TASKS.md block) is verifiable against the primary sources, so the unverified venue assertion was removed rather than propagated. Added the Claude 3.5 Sonnet driver numbers from the project README (**40.7% Lite / 50.8% Verified**, up from the GPT-4o headline of 27.3% at ~$0.34/issue) — the driver-swap delta with no orchestration change sharpens the falsifier thesis (the autonomy premium is mostly the model). Verdict unchanged: REFERENCE / thesis falsifier; the `local-harness` corpus row stands; no vision change.

Earlier reviews: 2026-06-02 (deepened from stub with `## Should we adopt the Agentless pipeline instead?` + `## Five pivot questions` per task `competitor-deep-research-tier-s-2026-05`; verdict REFERENCE / thesis falsifier, ADD to corpus as `local-harness` row, optional ADD of a cheap routing target gated on a pre-registered experiment, EVALUATE-TO-ABSORB the synthesised-reproduction-test oracle; Pivot tested — Agentless is cheaper/lower-variance on bug-fix-shaped tasks but single-shot, so it sharpens *where* Minsky claims value rather than dissolving the moat). 2026-05-22 (STUB — deep research pending; flagged as the highest-priority of the five Tier-S stubs).
