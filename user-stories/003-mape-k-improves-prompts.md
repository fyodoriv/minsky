# Story 003 — Minsky improves its own prompts measurably

**Milestone(s)**: M1.7

## Story

Minsky drives a coding assistant (an *agent* such as Claude Code) to do the
actual work. The agent plays different roles, and each role is called a
*persona* — for example, the QA persona that checks work. The prompt behind a
persona can be weak, and a weak prompt means more failed tasks.

This story is about Minsky fixing its own weak prompts while you are away.

The self-improvement loop is the *MAPE-K loop*: Monitor, Analyze, Plan, Execute
over a Knowledge base. It is the component called the *autonomic manager* (see
[vision.md § Glossary](../vision.md#glossary--every-term-has-a-cs-anchor)).

As the operator (the human who runs Minsky — you), here is what I see. Over the
first month, the QA persona's pass rate sits around 62% — too low. I do nothing.
Two weeks later, the MAPE-K loop has found the bottleneck on its own, written
three new prompt variants, run an A/B test (the metric: tasks closed without
rollback), kept the winner, and raised the QA pass rate to 81%. I find the
change recorded in `constraints.md`, the full history in `git log`, and a
notification on my Watch telling me the rollout finished.

## Acceptance criteria

- The MAPE-K loop reads persona-level metrics from OpenTelemetry (OTEL) spans —
  the open standard Minsky emits for traces, metrics, and logs. This is the
  *Monitor* phase.
- It picks the single bottleneck per Goldratt's Theory of Constraints (TOC).
  This is the *Analyze* phase.
- It proposes at least 2 prompt variants. This is the *Plan* phase. Each variant
  is seeded by the reflection step of Reflexion (Shinn et al. 2023): the loop
  reads the recent episodic-memory entries
  (`state → action → outcome → reflection`, schema at
  [`novel/experiment-record/src/reflexion-schema.ts`](../novel/experiment-record/src/reflexion-schema.ts))
  for the constrained persona and turns each verbal self-critique into a
  candidate prompt edit, rather than generating variants blind.
- It runs an A/B test through the `PromptOptimizer` adapter (DSPy). An *adapter*
  is a small wrapper file that lets Minsky talk to one outside tool through a
  fixed interface, so the tool can be swapped without touching the rest of the
  code. This is the *Execute* phase.
- It rolls out the winner only when the metric improves by ≥10% with statistical
  confidence (p < 0.05).
- It logs the change to `constraints.md` with hypothesis / intervention /
  result. `constraints.md` is the *Knowledge* base.
- A notification fires on rollout.

## Metric

- **Name**: `mapek_improvements_per_month`
- **Definition**: Count of persona prompt changes landed in a calendar month
  with measurable metric gain ≥10% relative to baseline, sustained for ≥7 days
  post-rollout
- **Threshold**: ≥4/month after the first quarter (Q1 ramps up)
- **Source**: `Observability` adapter — counts entries in `constraints.md` with
  `result: improved` AND verifies sustained metric gain via OTEL query

## Integration test

- **File**: `user-stories/003-mape-k-improves-prompts.test.ts` (forthcoming)
- **Setup**:
  - Synthetic 100-task corpus with a known QA failure pattern (tasks involving
    regex are misjudged)
  - Mock the `Orchestrator` to deterministically reproduce the QA failure
    pattern under prompt-A and succeed under prompt-B
  - MAPE-K loop configured with `min_improvement: 10%`, `confidence: 0.95`
- **Action**: Run the synthetic loop for 50 scheduler iterations. A *scheduler
  iteration* (or *tick*) is one wake-up of the loop on its timer.
- **Assert**:
  - The autonomic manager identifies the QA persona as the constraint within
    20 iterations
  - At least one A/B test runs
  - The winner (prompt-B) is rolled out
  - `constraints.md` has a structured entry: hypothesis / intervention / result
  - The QA persona file in `.claude/agents/qa-tester.md` is updated and committed
  - Notification fired

## Proof

- **Live**: The Watch surface (glanceable display per Card & Mackinlay 1999)
  shows "this-week's constraint". It updates from "QA pass rate" to a different
  bottleneck after the fix.
- **Dashboard**: A constraint history chart shows each constraint's lifetime.
- **Audit**: `constraints.md` contains the full diagnostic narrative.
  `git log -- .claude/agents/qa-tester.md` shows the prompt change with its
  rationale.
- **Statistical**: 30 days post-rollout, the metric remains ≥10% above baseline.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7). A constitutional rule is a
numbered, non-negotiable project rule in `vision.md`.

- **Steady-state hypothesis**: ≥4 prompt rollouts per month after Q1, each with
  a sustained measured gain (≥10% over baseline, p < 0.05) and no per-persona
  pass-rate regression in the 7-day post-rollout window.
- **Blast radius**: a single persona prompt file (`.claude/agents/<persona>.md`).
  Rollback is `git revert <rollout-commit>` plus a supervisor restart. The
  *supervisor* is the outer watchdog (systemd on Linux / launchd on macOS) that
  restarts Minsky if it dies. The blast radius is never the loop itself and
  never another persona.
- **Operator escape hatch**:
  `git revert <prompt-rollout-commit> && systemctl --user restart minsky-tick-loop`
  from the CLI. The Watch-action equivalent fires the same shell.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | A/B winner regresses inside the 7-day sustained-gain window | Fixture: prompt-B beats A on day 1 but day-5 metric drops below baseline (upstream signal-reversal) | `loud-crash-supervisor-restart` (auto-revert) | Inject the regression fixture; assert auto-revert triggers, `constraints.md` records `result: regressed`, notification fires. |
| 2 | Oscillation — the same prompt proposed twice within N iterations | Cache a "winner" that recurses (upstream-malformed analysis) | `circuit-break-and-notify` | Run with the recurrence; assert the oscillation detector refuses the second proposal, fires a notification, advances the cadence to the next constraint. |
| 3 | DSPy adapter crashes during optimization | `kill -9 $(pgrep -f dspy-worker)` (process death) | `loud-crash-supervisor-restart` (worker only) | Kill the worker; assert the mape-k-loop continues, the current cycle ends with no rollout, OTEL span `mape.execute.failed=true`. |
| 4 | Constraint analysis identifies a false bottleneck (low signal-to-noise) | Synthetic workload with no clear bottleneck (upstream-malformed analysis) | `graceful-degrade` | Run on a flat-distribution fixture; assert the cycle is marked inconclusive, no prompts modified, OTEL span `mape.analyze.inconclusive=true`. |
| 5 | A prompt rollout breaks the downstream handoff format | Deliberately broken prompt that produces an invalid handoff (upstream-malformed) | `loud-crash-supervisor-restart` (auto-revert within 1 scheduler iteration) | Roll out the broken prompt; assert the handoff-spec validator rejects on the next handoff, auto-revert lands within one iteration. |
| 6 | `constraints.md` write conflicts with a concurrent edit | Two writers append simultaneously (file-lock contention) | `graceful-degrade` | Spawn two writes; assert `flock` serialises, no partial entries, no lost data. |

## Status

- **Phase**: Specification
- **Blocking**: P1 `handoff-spec-v0`; P2 `spec-monitor-skill`; P2 `mape-k-loop-v0`
  (forthcoming)
- **Theoretical anchors**: Kephart & Chess MAPE-K (the loop structure itself),
  Goldratt TOC (constraint discipline), Khattab DSPy (prompt-as-program),
  Hofstadter (the strange loop of a system improving itself), Shinn et al.
  Reflexion (agent verbal memory of failures)
- **Risk**: This is the most novel layer. The failure mode is the autonomic
  manager either oscillating (changing the same prompt repeatedly) or
  confidently rolling out regressions. Both have explicit guards: the
  sustained-gain check (≥7 days post-rollout) and the oscillation detector
  (refuses to revisit a prompt within N iterations of a recent change).

## Pattern conformance

- **Pattern**: MAPE-K reference architecture for autonomic computing — Kephart &
  Chess, "The Vision of Autonomic Computing", *IEEE Computer* 36(1) 2003 —
  combined with Goal-Question-Metric for the rollout decision — Basili, Caldiera,
  Rombach, "The Goal-Question-Metric Approach", *Encyclopedia of Software
  Engineering*, 1994
- **Conformance level**: full
- **Index row**: vision.md § "Pattern conformance index" row 43
- **Notes**: Each phase (Monitor / Analyze / Plan / Execute) emits one OTEL span,
  and the Knowledge base is `constraints.md`. Cross-references the planned
  implementation at row 5 (`claude-mape-k-loop`); this row anchors the
  user-story specification, row 5 anchors the implementation contract. The
  *Plan* phase additionally instantiates Reflexion's reflection→memory→recall
  loop (Shinn et al. 2023): the episodic-memory schema lives at
  `novel/experiment-record/src/reflexion-schema.ts` and the implementation
  pattern is recorded in vision.md § "Pattern conformance index".

## Security & privacy

(Operator directive 2026-05-06 — vision.md rule #13 "Security & privacy — second
priority after performance".) Industry-standard primitives only; rule #1 (don't
reinvent) applies.

- **Trust boundary**: this story's untrusted inputs are the operator's TASKS.md
  content plus `claude --print` stdout (LLM output, treated as untrusted by
  default per OWASP LLM02). Trusted: the local filesystem plus the launchd
  unit-file's environment. Anything that crosses the boundary (PR body emission,
  OTEL span content) passes through the secret-leak scanner
  (`scripts/scan-secrets.mjs`) and the no-PII span lint.
- **Secrets**: no API keys, tokens, or `.env` content in PR bodies, OTEL spans,
  or `.minsky/` logs. Floor: `scan-secrets` pre-commit plus
  `secret-scanning-precommit-and-ci` (TASKS.md P0).
- **PII**: no email, IP, or full-paths-with-username in OTEL span attributes.
  Floor: `otel-no-pii-in-spans-lint` (TASKS.md P0).
- **Sandbox**: the supervisor process's filesystem and network reach is
  restricted to what this story actually needs. Floor:
  `supervisor-sandbox-syscall-restriction` (TASKS.md P0); industry standard via
  systemd `ProtectSystem=strict` plus `PrivateTmp=true` / launchd App Sandbox.
- **Performance carve-out**: when a security restriction would cost >10% on this
  story's load-bearing latency metric, the trade-off is documented in this
  section as a declared deviation with a numeric cost figure. Silent trade-offs
  are forbidden (vision.md rule #13's "performance-first carve-out" clause).
