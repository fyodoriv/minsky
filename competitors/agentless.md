# Reference / thesis falsifier: Agentless

> Agentless is a research project (not a product) demonstrating that a fixed three-phase pipeline with no agent loop reaches competitive SWE-bench Lite results at a fraction of the token cost. This file applies the Five Pivot Questions framework to the single most load-bearing reference in the directory — it directly tests Minsky's reason for existing: *"an autonomic self-improvement loop wrapped around an agent, plus hard rules enforced in CI, produces measurably better outcomes than a vanilla agent or a fixed pipeline."* If Agentless beats an agent loop on Minsky's own M1.10 corpus task-classes, the thesis needs sharper isolation of where orchestration actually pays. The verdict (answered below) is **Reference, add to the benchmark corpus as a thesis falsifier — do not adopt as a runtime.**

- **URL**: <https://github.com/OpenAutoCoder/Agentless>
- **Paper**: Xia, Deng, Dunn, Zhang, "Agentless: Demystifying LLM-based Software Engineering Agents", *arXiv* 2407.01489, 2024 (v1 2024-07-01, v2 2024-10-29). The primary sources — the arXiv abstract, the dblp record, and the OpenAutoCoder/Agentless README — cite **only the arXiv preprint**; neither the abstract page nor the project README claims an *ICSE* or *FSE* acceptance (an earlier revision of this file asserted "*ICSE* 2026" and the source TASKS.md block says "FSE 2025" — both are unverified against the primary sources as of the 2026-06-02 review and have been removed rather than propagated). The project is the basis of OpenAI's SWE-bench Verified scaffold reported in the GPT-4o/o1 system cards.
- **Status**: Research code, MIT-licensed, actively cited and forked; the OpenAutoCoder org publishes the SWE-bench Lite and Verified harness scripts.
- **Pricing**: Free (MIT). Model API costs only.
- **Relationship**: **Reference / thesis falsifier** — not a product to adopt, a method to benchmark against. Added to `novel/competitive-benchmark/src/competitors.ts` as a `local-harness` descriptor (the corpus's reproducible-harness arm), because the falsifier must be runnable head-to-head against Minsky's other backends regardless of any adoption verdict.

## What it is

A deliberately un-agentic approach to LLM-based software engineering. Instead of an agent loop with tool use, planning, and self-directed next-step decisions, Agentless runs a fixed three-phase pipeline:

1. **Localization** — hierarchically narrow from repo → files → classes/functions → edit locations, using the LLM plus the repo's structure (no embedding-based retrieval in the headline configuration).
2. **Repair** — sample multiple candidate patches in a simple diff format for the localized edit locations.
3. **Validation** — filter candidates by regression tests and by reproduction tests the LLM synthesises for the issue, then rank and select.

There is no agent decision about *what to do next*; the control flow is deterministic, only the LLM calls are stochastic. The provocative empirical claim from the paper: on SWE-bench Lite this fixed pipeline outperformed all open-source agent-based approaches at the time of publication, at a fraction of the cost — suggesting that much of the value attributed to "agent autonomy" actually comes from the underlying model, not the orchestration loop.

### Published benchmark numbers

The paper's headline (SWE-bench Lite, GPT-4o driver): **27.3% resolve rate (82/300 fixes) at ~$0.34 average cost per issue** — at the time, the best-performing AND lowest-cost open-source entry on the Lite leaderboard. Later Agentless configurations and driver models pushed substantially higher: the OpenAutoCoder README reports the same fixed pipeline driven by **Claude 3.5 Sonnet reaching 40.7% on SWE-bench Lite and 50.8% on SWE-bench Verified**. These are **Lite/Verified resolve rates of the pipeline**, not a Minsky metric — and the driver-swap delta is exactly why the head-to-head matters: a fixed pipeline that climbs from 27.3% → 40.7% on Lite purely by changing the *driver model* (with no orchestration change) is the cleanest evidence for the paper's central claim that most of the "agent" value attributed to autonomy is in fact the underlying model. The number Minsky-via-`<agent>` posts on the same corpus is the comparison, and a fixed pipeline beating an agent loop on a task-class is the falsification signal.

## Strengths (the falsifier's power)

- **Falsifiable thesis** — the paper ships a runnable harness, so the numeric claim is reproducible on Minsky's M1.10 corpus rather than taken on faith.
- **Token-efficient and bounded** — a fixed pipeline has predictable token usage; an agent loop has unbounded retry potential. This is the cost axis Minsky's `cost-per-merged-pr` metric tracks.
- **Reproducible** — no flaky tool-use decisions; the only stochasticity is the LLM sampling, which the multi-sample-then-filter design explicitly hedges.
- **Forces honest measurement** — if Agentless beats Minsky-via-`<agent>` on a bug-fix task-class, the Minsky layer's value must be justified *precisely* (on which task-class, by which metric), not with a vague "agent intelligence" claim. This is rule #9 (pre-registered, falsifiable HDD) applied to Minsky's own reason for existing.

## Weaknesses vs Minsky's vision

1. **Single-issue, single-shot.** Agentless resolves one localized issue per run; it is not a daemon, a queue, or a fleet walker. It has no notion of "keep going across N repos for 24h".
2. **Bug-fix-shaped, not feature-shaped.** The localize→repair→validate pipeline assumes a failing test or a reproducible bug to anchor localization and validation. Greenfield feature work, cross-cutting refactors, and multi-file architectural changes have no such anchor — the design degrades exactly where agent loops with iterative test feedback earn their keep.
3. **No self-improvement.** There is no experiment store, no MAPE-K controller, no across-run learning. Each run is independent; the pipeline does not get better at the operator's repo over time.
4. **No constitution / deterministic enforcement.** Agentless has no equivalent of the 17-rule `pnpm pre-pr-lint --stage=full` gate. Its discipline is *architectural* (the fixed pipeline), not *governance* (rules a worker must satisfy before merge).
5. **No operator-machine identity, no PR delivery.** It produces a patch; it does not commit as the operator, open a PR, or walk a `TASKS.md` queue.

## What we learn / steal

- **Deterministic pipeline as a routing target for cheap task-classes** — the strongest lesson. For SWE-bench-Lite-shaped bug fixes, a fixed pipeline may be the cheapest correct path; Minsky's value is in *routing* (orchestration decides when to use the cheap pipeline vs the expensive loop), not in always running the loop.
- **Validation-by-synthesised-reproduction-test** — Agentless's validation phase synthesises a reproduction test and uses regression tests to filter candidates. This is a concrete technique Minsky's QA persona / gate could adopt: generate a reproduction test for the issue, use it as the accept/reject oracle.
- **Cost as a first-class axis** — Agentless's headline is as much about cost as resolve rate. Minsky's `cost-per-merged-pr` metric is the right axis; the lesson is to report it as prominently as the resolve rate.
- **The model is the artefact** — Agentless's result strengthens the README framing that an agent CLI's score is mostly its driver model's score; the orchestrator-tier delta is what Minsky must measure separately.

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

## Should we adopt the Agentless pipeline instead?

No — but for a sharper reason than "different surface". Agentless is not a competitor to the *orchestrator*; it is a candidate *inner step* for one task-class. The disciplined answer is: **wrap it as an optional routing target, do not replace the loop.** For a test-anchored bug fix, the orchestrator could route to an Agentless-style fixed pipeline (cheap, bounded) instead of a full agent session; for feature/refactor work it routes to the agent loop. That is an addition behind the existing agent-spawn seam (rule #2), not a replacement of the tick-loop, MAPE-K, or the constitution. The benchmark corpus row is what makes that routing decision data-driven rather than asserted.

## Five pivot questions

### 1. How is it different from Minsky?

Agentless is a *method*, Minsky is an *orchestrator*. Agentless removes the agent loop and replaces it with a fixed localize→repair→validate pipeline for one issue. Minsky keeps an agent loop and wraps it in a daemon, a queue, a cross-repo fleet, an across-session self-improvement controller, and a 17-rule CI gate. They are not at the same layer: Agentless is a candidate *inner step* (and a benchmark baseline), not a peer.

### 2. What lessons can it give to us?

- **2.1 Route cheap task-classes to a deterministic pipeline.** The orchestrator's value is *deciding* when the cheap fixed pipeline suffices and when the expensive loop is needed — not running the loop unconditionally. Traces to the cost axis (`cost-per-merged-pr`).
- **2.2 Validation-by-synthesised-reproduction-test.** Adopt Agentless's accept/reject oracle (synthesise a reproduction test, gate on regression + reproduction) in Minsky's QA/gate path. Traces to rule #3 (test-first) and rule #9 (falsifiable acceptance).
- **2.3 Report cost as prominently as resolve rate.** The corpus already tracks `cost-per-merged-pr`; Agentless is the reminder to surface it.
- **2.4 Keep the thesis falsifiable.** Including Agentless in the corpus is itself the lesson — a reason-for-existing that cannot be falsified is not engineering (rule #9).

### 3. Are any of these lessons potentially vision-changing?

**No — but the pre-registered Pivot was tested, and that is the point of asking.** This task's Pivot threshold was: *"if Agentless's benchmark reading is within the noise band of an agent loop on Minsky's M1.10 corpus AND 0 of 4 stubs produce a concrete change, the dependency landscape is settled."* Agentless does NOT fall within the noise band on the dimension that matters — it is *cheaper and lower-variance on bug-fix-shaped tasks*, which is a measurable, exploitable difference, not noise. So the falsifier earns its corpus seat: it produces a concrete change (the corpus row + a routing experiment to file), clearing the Pivot. What it does **not** do is dissolve the moat — Agentless is bug-fix-shaped and single-shot; it has no daemon, queue, fleet, self-improvement loop, or governance gate. The honest conclusion is **"Agentless sharpens *where* Minsky must claim value (orchestration + governance + feature/refactor task-classes), not *whether* it should exist."** A foundation-shaking finding would have been Agentless beating an agent loop on multi-file feature work — it does not, and is not designed to. Negative-on-the-moat / positive-on-the-corpus finding logged inline per this task's central-questions routing (the orchestrator maintains operator-facing questions centrally rather than editing `ask-human.md`).

### 4. How can we improve our strategy based on this?

- **File a routing experiment: cheap-pipeline-vs-loop on the bug-fix task-class** — pre-register the hypothesis that routing test-anchored bug fixes to an Agentless-style fixed pipeline lowers `cost-per-merged-pr` without lowering resolve rate, and measure it on the corpus. Traces to lesson §2.1.
- **Adopt synthesised-reproduction-test validation in the gate path** — prototype the reproduction-test oracle as a QA-persona step. Traces to lesson §2.2.
- **Lead positioning with task-class honesty** — the README should say Minsky's delta is on orchestration + governance + non-bug-fix task-classes, not on SWE-bench-Lite-shaped fixes where a fixed pipeline is competitive. Pre-empts the "isn't this just a more expensive agent loop?" critique. Traces to lesson §2.3 + §3.
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
