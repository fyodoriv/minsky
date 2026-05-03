# Story 003 — MAPE-K loop improves persona prompts measurably

## Story

Over the first month, I notice the QA persona's pass rate is around 62% — too low. I do nothing. Two weeks later, the MAPE-K loop (the *autonomic manager*; see [vision.md § Glossary](../vision.md#glossary--every-term-has-a-cs-anchor)) has identified the bottleneck, generated three prompt variants, run an A/B test with measurable metric (tasks closed without rollback), kept the winner, and now the QA persona's pass rate is 81%. I see the change in `constraints.md`, the audit trail in git log, and a notification on my Watch when the rollout completed.

## Acceptance criteria

- The MAPE-K loop observes persona-level metrics from OTEL spans (the *Monitor* phase)
- It identifies the constraint per Goldratt TOC, single bottleneck (the *Analyze* phase)
- It proposes prompt variants ≥2 (the *Plan* phase)
- It runs an A/B test using the `PromptOptimizer` adapter (DSPy) (the *Execute* phase)
- It rolls out the winner only if the metric improves by ≥10% with statistical confidence (p < 0.05)
- The change is logged to `constraints.md` with hypothesis / intervention / result (the *Knowledge* base)
- A notification fires on rollout

## Metric

- **Name**: `mapek_improvements_per_month`
- **Definition**: Count of persona prompt changes landed in a calendar month with measurable metric gain ≥10% relative to baseline, sustained for ≥7 days post-rollout
- **Threshold**: ≥4/month after the first quarter (Q1 ramps up)
- **Source**: `Observability` adapter — counts entries in `constraints.md` with `result: improved` AND verifies sustained metric gain via OTEL query

## Integration test

- **File**: `user-stories/003-mape-k-improves-prompts.test.ts` (forthcoming)
- **Setup**:
  - Synthetic 100-task corpus with known QA failure pattern (tasks involving regex are misjudged)
  - Mock the `Orchestrator` to deterministically reproduce the QA failure pattern under prompt-A and succeed under prompt-B
  - MAPE-K loop configured with `min_improvement: 10%`, `confidence: 0.95`
- **Action**: Run synthetic loop for 50 scheduler iterations
- **Assert**:
  - The autonomic manager identifies QA persona as constraint within 20 iterations
  - At least one A/B test runs
  - Winner (prompt-B) is rolled out
  - `constraints.md` has a structured entry: hypothesis / intervention / result
  - The QA persona file in `.claude/agents/qa-tester.md` is updated and committed
  - Notification fired

## Proof

- **Live**: Watch surface (glanceable display per Card & Mackinlay 1999) "this-week's constraint" updates from "QA pass rate" to a different bottleneck after the fix
- **Dashboard**: Constraint history chart shows each constraint's lifetime
- **Audit**: `constraints.md` contains the full diagnostic narrative; `git log -- .claude/agents/qa-tester.md` shows the prompt change with rationale
- **Statistical**: 30 days post-rollout, the metric remains ≥10% above baseline

## Status

- **Phase**: Specification
- **Blocking**: P1 `handoff-spec-v0`; P2 `spec-monitor-skill`; P2 `mape-k-loop-v0` (forthcoming)
- **Theoretical anchors**: Kephart & Chess MAPE-K (the loop structure itself), Goldratt TOC (constraint discipline), Khattab DSPy (prompt-as-program), Hofstadter (the strange loop of a system improving itself), Shinn et al. Reflexion (agent verbal memory of failures)
- **Risk**: This is the most novel layer. Failure mode is the autonomic manager either oscillating (changing the same prompt repeatedly) or confidently rolling out regressions. Both have explicit guards: sustained-gain check (≥7 days post-rollout), oscillation detector (refuses to revisit a prompt within N iterations of a recent change).
