---
name: doubt-driven-development
description: Adversarial fresh-context review of a decision before it is finalized. Use before committing an architectural choice, a new adapter interface, a MAPE-K wiring change, or any decision involving unverifiable properties (thread safety, idempotence, budget-guard semantics). Runs a 3-cycle max loop. Outputs a RECONCILE block appended to the PR description or commit message.
allowed-tools: Bash, Read
---

# Doubt-driven development

Materialize a reviewer biased toward *disproving* — not approving — a decision, while the decision is still cheap to reverse. This skill runs *before* the code is committed, not after.

Adapted from *addyosmani/agent-skills*, doubt-driven-development.

## When to use

**Apply before:**
- Committing a new adapter interface in `novel/adapters/`
- Choosing an execution model for a new daemon or worker type
- Writing a new rule enforcement script (`scripts/check-*.mjs`)
- Any decision involving concurrent access to shared state (tick-loop, budget-guard, chaos-gate)
- Any change to the MAPE-K wiring (Monitor → Analyse → Plan → Execute boundaries)
- An irreversible operation (schema migration, dependency removal, public API addition)

**Skip when:**
- The change is mechanical (rename, format, move)
- The user explicitly says "use your judgment, no review needed"
- The decision is already fully constrained by an existing adapter contract

## Five-step protocol

### Step 1 — CLAIM

Name the decision and why it matters:

```
CLAIM: I am using [approach X] for [problem Y] because [reason Z].
This decision is irreversible / expensive to change because [consequence].
```

### Step 2 — EXTRACT

Isolate the artifact and its contract, stripped of your reasoning:

```
ARTIFACT: [the code, interface, or design being reviewed — exact text or pseudocode]

CONTRACT:
- Must do: [observable behaviour 1]
- Must do: [observable behaviour 2]
- Must NOT do: [invariant 1]
- Must NOT do: [invariant 2]
```

The contract is the only information passed to the adversarial review. Never include the CLAIM.

### Step 3 — DOUBT

Invoke a fresh-context adversarial review with this framing:

> "Find what is wrong with this artifact against its contract. Your job is to disprove correctness, not confirm it. Be specific: name the exact condition, input, or sequence that causes a failure."

For Minsky decisions, focus the adversary on:
- **Concurrency**: can two tick-loop iterations interleave and corrupt shared state?
- **Budget-guard semantics**: can the artifact cause a spawn when the 5h window is exhausted?
- **Idempotence**: can the artifact be safely retried after a partial execution?
- **Chaos-gate bypass**: does the artifact introduce a code path that skips the chaos verification step?
- **Adapter boundary leak**: does the artifact let implementation details bleed across an adapter interface?

In an interactive session, explicitly offer cross-model review to the operator before proceeding.

### Step 4 — RECONCILE

For each finding from Step 3, classify it:

| Classification | Meaning | Action |
|---|---|---|
| CONTRACT MISREAD | The reviewer misunderstood the contract | Update the contract to be unambiguous; re-run |
| ACTIONABLE | A real flaw the artifact must fix | Revise the artifact; re-run Step 3 |
| TRADE-OFF | A known weakness accepted consciously | Document it in the commit message or ADR |
| NOISE | Hypothetical that doesn't apply to this context | Dismiss with one sentence of reasoning |

### Step 5 — STOP

Exit after:
- All findings are NOISE or TRADE-OFF (success)
- 3 cycles (escalate unresolved ACTIONABLE items to the operator)
- The operator explicitly approves ("proceed")

Never run more than 3 cycles. If cycle 3 still has unresolved ACTIONABLE items, the decision needs human review — file a `[NEEDS CLARIFICATION]` in the task's TASKS.md block.

## Output format

Append a DOUBT-RECONCILE block to the PR description or commit message body:

```
## Doubt-driven review

**Decision**: [one sentence]

**Cycles**: [N]

**Findings**:
- [finding 1]: [CONTRACT MISREAD | ACTIONABLE (fixed) | TRADE-OFF | NOISE] — [one sentence]
- [finding 2]: ...

**Residual trade-offs**:
- [any accepted weaknesses, with reasoning]
```

## Critical rules

- Pass only ARTIFACT + CONTRACT to the adversarial step — **never the CLAIM**. The CLAIM primes the reviewer toward confirmation, not doubt.
- Use adversarial framing: "Find what is wrong," not "Is this good?"
- One decision per invocation. Do not batch multiple decisions into one DOUBT session.
- Do not spawn this skill from within a subagent context (orchestration anti-pattern — the subagent cannot run an interactive cross-model review).
- This skill does not replace /diagnose. Diagnose is for bugs that have already manifested. Doubt-driven development is for correctness that cannot yet be observed.

## Minsky-specific decision points that always require this skill

1. New `novel/adapters/<name>.ts` interface: the contract must be reviewed for Hyrum's Law violations (every observable behaviour becomes a de facto contract)
2. Changes to `BudgetGuard.decide()` semantics: budget decisions are irreversible within a 5h window
3. New chaos invariants in `self-diagnose`: a false-positive invariant will circuit-break the loop on valid states
4. Worker spawn logic changes: incorrect spawn decisions burn real API tokens
5. Changes to the tick-loop's brief-building step: stale or over-full briefs degrade all subsequent worker output

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Asking "Is this correct?" instead of "Find what's wrong" | Confirmation bias. The adversary will find reasons to agree. |
| Including the CLAIM in the adversarial prompt | The reasoning pre-answers the doubt. Extract only artifact + contract. |
| Running 10 cycles | After 3 cycles without resolution, the problem is underspecified — escalate to the operator. |
| Using this skill as a rubber-stamp after the decision is shipped | The value is in catching flaws before the code is committed. Post-hoc review is just documentation. |
