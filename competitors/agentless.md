# Reference / thesis falsifier (stub): Agentless

<!-- STUB — needs deep research per task `competitor-deep-research-tier-s-2026-05`. This entry is the MOST important of the five Tier-S stubs because it directly tests minsky's load-bearing assumption that elaborate orchestration loops add value over a fixed pipeline. -->

> Research project (not a product) demonstrating that a fixed 3-step pipeline with no agent loop achieves competitive SWE-Bench results. Directly tests minsky's load-bearing thesis: *"orchestration loops + MAPE-K + persona pipelines + rule-#9 produce measurably better outcomes than a vanilla agent or a fixed pipeline."* If Agentless beats agent loops on minsky's own M1.10 corpus, the thesis needs revision — or sharper isolation of where orchestration actually pays.

- **URL**: <https://github.com/OpenAutoCoder/Agentless>
- **Paper**: Xia et al., "Agentless: Demystifying LLM-based Software Engineering Agents", *arXiv* 2024 (later venues 2025)
- **Status**: Research code, actively cited and forked
- **Pricing**: Free (MIT). Model costs only.
- **Relationship**: **Reference / thesis falsifier** — not a product to adopt, a method to benchmark against

## What it is

A simplified approach to LLM-based software engineering: instead of an agent loop with tool use and planning, Agentless uses a fixed three-step pipeline — *localization* (find the file / function), *repair* (generate patch candidates), *validation* (run tests / patch reproduction). No agent decisions about what to do next; the pipeline is deterministic, only the LLM calls are stochastic.

The provocative claim from the paper: this beats most agent-based approaches on SWE-Bench Lite at a fraction of the token cost, suggesting that the value attributed to "agent intelligence" is often coming from the underlying LLM, not the orchestration loop.

## Strengths (what we know)

- **Falsifiable thesis** — the paper's numeric claim is testable on minsky's M1.10 corpus
- **Token-efficient** — fixed pipeline = predictable token usage; agent loops have unbounded retry potential
- **Reproducible** — pure pipeline, no flaky tool-use decisions
- **Forces honest measurement** — if Agentless beats minsky on a code-fix task, the minsky-layer's value needs precise justification, not vague "agent intelligence" claims

## Implications for minsky (initial read — needs verification)

1. **Rule-#9's enforcement of falsifiability is the right discipline** — we can use Agentless to falsify our own thesis on M1.10.
2. **The minsky-layer should pay rent on specific task classes, not all of them.** Agentless likely loses on multi-step refactors, cross-cutting changes, and tasks requiring iterative test feedback. Minsky should claim value *there*, not on SWE-Bench Lite-shape bug fixes.
3. **Adding Agentless as a backend in `llm-provider-spawn-strategy.ts`** is interesting — for SWE-Bench-shape tasks, route to Agentless; for tasks requiring orchestration, route to OpenHands or Claude Code.

## OPEN: research questions for the deep write-up

1. **Run Agentless against minsky's M1.10 corpus.** What's the head-to-head result, task-class by task-class?
2. Does Agentless win on bug-fix tasks (which is what SWE-Bench Lite tests) but lose on multi-file refactors / new-feature additions?
3. What's the token cost ratio? If Agentless is 5x cheaper, that's a strong default-route signal for cheap tasks.
4. Has Agentless been extended to multi-step tasks since the original paper? (Several follow-up papers exist; need to survey.)
5. Could the Agentless pipeline run *inside* an OpenHands session as a sub-agent, getting deterministic-pipeline value while keeping orchestration where it pays?

## Tentative verdict (pre-deep-research)

**Adopt as a benchmark target in `competitive-benchmark`, not as a runtime.** This is the single most important reference in the directory because it pressure-tests minsky's reason for existing. If we don't include Agentless in the corpus, minsky's thesis isn't falsifiable.

Action: add Agentless to `novel/competitive-benchmark/src/competitors.ts` with a `local-harness` ResultSource so the scorecard runs it head-to-head against our other backends on the same task set.

## Last reviewed

2026-05-22 — **STUB**. Deep research pending. Highest priority of the five Tier-S stubs.
