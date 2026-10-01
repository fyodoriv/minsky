<!-- scope: human-approved closes-research-replace-or-relocate-mape-k-loop (P2; task block removed in the same commit per rule #17 — completion deletes the queue entry, history stays in git log). -->

# `@minsky/mape-k-loop` — Replace or Relocate?

**Decision (2026-05-28)**: **KEEP** in `novel/`. No off-the-shelf
MAPE-K runtime maps onto Minsky's input shape; the pattern itself
(Kephart & Chess 2003) is generic-software-engineering, not Minsky-
specific, and the implementation is a thin set of pure decision
functions that fit the project's no-framework discipline.

## What this file is

A re-evaluable replace-or-relocate research note per rule #1
(don't reinvent the wheel — re-check quarterly whether an upstream
project now fits). Adds detail to the `<!-- rule-1: ... -->`
comment that already sits at the top of `README.md`.

## Replacement candidates evaluated

### Akka actors (Lightbend, JVM)

- **Verdict**: REJECTED.
- **Why**: Akka's supervision tree is a runtime concern (supervisor
  strategies, mailbox sizing, dispatcher tuning); Minsky's MAPE
  loop is a single-process decision pipeline whose hot path is
  `tick(input) → decision` — no concurrency, no message passing,
  no failure-recovery semantics. Adopting Akka would force a JVM
  runtime onto the daemon (currently Node + Python) for zero gain;
  the supervisor tree's value is for distributed actor systems, not
  for a single-process autonomic manager.

### Erlang / OTP supervision trees

- **Verdict**: REJECTED, same as Akka.
- **Why**: OTP's `gen_server` + `supervisor` behaviors are the
  canonical implementation of long-lived stateful actors with
  failure recovery. Minsky's MAPE phases are stateless functions
  reading from disk (`TASKS.md`, `experiment-store/*.jsonl`,
  `spec-advisories/*.md`); the Knowledge phase is an append-only
  log writer over `constraints.md`. OTP's value-add (process
  isolation + restart-supervision) doesn't map onto pure
  functions.

### Temporal.io workflows

- **Verdict**: REJECTED.
- **Why**: Temporal's workflow runtime is for distributed long-
  running orchestrations (days–weeks per workflow, retries across
  worker restarts, durable state in a workflow history). Minsky's
  `tick()` runs in <1s end-to-end against parsed-disk inputs.
  Wrapping `tick()` as a Temporal workflow would add a hosted-
  service dependency, a workflow-history database, and worker
  fleet management — for a function that's already a single bash
  invocation.

### IBM Tivoli Autonomic Computing Toolkit / OpenStack Heat / Kubernetes operator-sdk

- **Verdict**: REJECTED. (Already documented in the README rule-1
  comment.)
- **Why**: each is a control-plane-coupled runtime — JMX endpoints
  (Tivoli), Heat templates (OpenStack), Kubernetes CRDs (operator-
  sdk). Minsky's inputs are markdown + JSONL + GH Actions JSON;
  none of these runtimes accept those input shapes without a
  substantial adapter layer that would dwarf the current code.

## Relocation analysis

**Verdict**: UNLIKELY.

The MAPE-K **pattern** is generic — anyone running an autonomic
loop could borrow the architecture. But the **implementation**
binds tightly to Minsky's data sources:

- `costEstimate(ruleId)` weights are per-rule based on Minsky's
  constitution (`vision.md` rules #1–#18).
- `analyze()` uses Theory of Constraints to find the top
  constraint by `violationCount × costEstimate(ruleId)`; the
  ranking is constitution-specific.
- The Knowledge phase appends to `constraints.md` in Minsky's
  exact markdown format.

Relocation to a sibling project (e.g. `agentbrew`) would need:

- A configurable rule-weight table (not hardcoded).
- An adapter for the consumer's "constraint log" format.
- A way to swap the `tick()` assembly's input parsers.

That's a 100–200 LOC refactor — appropriate when a 2nd consumer
actually wants the loop. Until then, the cost of generalizing
exceeds the cost of keeping it in `novel/mape-k-loop`.

## Re-evaluation criteria

Re-check this decision when ANY of:

1. A second consumer (inside or outside Minsky) asks to call
   `tick()` with their own rule weights + constraint log format.
   → trigger the 100–200 LOC generalization refactor + extract
   to `@<scope>/mape-k-loop` package.
2. An off-the-shelf autonomic-manager runtime ships with a
   pluggable input adapter (no JMX / Heat / K8s lock-in).
   → re-evaluate the Akka/OTP/Temporal verdicts.
3. The `tick()` hot path grows past 1s wall-clock (today: <100ms).
   → consider a workflow-runtime backend like Temporal, where
   the durable-state cost is justified by the longer-running
   loop.

## Anchor

- Kephart & Chess, "The Vision of Autonomic Computing", *IEEE
  Computer*, 2003. The MAPE-K reference architecture.
- Goldratt, *The Goal*, 1984. Theory of Constraints (used by
  `analyze()`).
- Helland, "Immutability Changes Everything", *CIDR*, 2007.
  Append-only log discipline (Knowledge phase over
  `constraints.md`).
- Rule #1 (`vision.md`): don't reinvent the wheel — re-check
  this quarterly per the `review-q*` cadence task.
