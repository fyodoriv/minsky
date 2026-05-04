# `@minsky/adapter-types`

Leaf types package — the shared health-probe contract every Minsky adapter
implements. Hoisted out of `@minsky/observability` so future adapters
(`@minsky/budget-guard`, `@minsky/token-monitor`, …) depend on this leaf
directly instead of forming a `budget-guard → observability` cycle through
a base type (Martin, *Clean Architecture*, 2017 — acyclic dependency
principle).

Public surface:

- `SelfTestStatus` — `"green" | "yellow" | "red"` (3-element lattice).
- `SelfTestResult` — `{ status, message, latencyMs, lastCheck }`.
- `aggregateStatus(results)` — worst-status-wins meet over the lattice.

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index) row 30:

- **Module shape** — supporting types for the Adapter pattern (Gamma et al., *Design Patterns*, 1994). **Conformance: full.**
- **`SelfTestResult` / health-probe shape** — self-checking software per Avizienis, *IEEE TSE* 1985; Kubernetes liveness probe per Burns et al., *ACM Queue* 2016. **Conformance: full.**
- **`aggregateStatus()`** — worst-status aggregation over a status lattice per Avizienis et al., *IEEE TDSC* 2004. Equivalent to the Kubernetes pod-phase rule. Identifier matches the canonical pattern name per rule #8. **Conformance: full.**
- **Leaf-package shape** — explicit dependencies per Wiggins, *The Twelve-Factor App*, 2011 (factor II). Zero internal Minsky deps; this is what makes it a viable leaf in the workspace DAG.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `aggregateStatus()` is a pure function over an
  immutable input — it returns the same `"green" | "yellow" | "red"` for the
  same input on every invocation, with no I/O, no side effects, and no shared
  state.
- **Blast radius**: a single function call. No process state can be corrupted
  by it.
- **Operator escape hatch**: not applicable — there is nothing to shut down.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Caller passes a malformed status (e.g., `"yellow "` with a trailing space) | upstream-malformed (the type system normally prevents this; a `JSON.parse`'d input bypasses it) | Treated as not-red and not-yellow → returns `"green"` | unit test in `novel/adapters/types/src/index.test.ts` asserts the closed-union behaviour against every legal status; runtime callers parsing JSON must validate before calling. A future task `adapter-types-runtime-guard` adds a `parseSelfTestResult` zod schema for the JSON boundary. |
| 2 | Caller passes a 1M-element array | resource exhaustion | Linear-time scan completes in < 100 ms on a single core | (manual) test invocation `aggregateStatus(Array.from({length: 1_000_000}, () => sample("green")))` asserts return within budget |
| 3 | Two adapters disagree on which status is dominant | upstream-malformed (impossible by type — the lattice is total) | N/A — `SelfTestStatus` is a closed string union; non-listed values fail at compile time | the `tsc --noEmit -p tsconfig.json` CI typecheck job asserts the closed union holds (compile-time test) |

There is no I/O on this code path, so most failure modes are categorically
absent. The remaining surface is the type boundary — and that is enforced
by `verbatimModuleSyntax` + `strict` + `noUncheckedIndexedAccess` in
`tsconfig.base.json` rather than runtime checks.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: hoisting `SelfTestStatus` / `SelfTestResult` /
  `aggregateStatus()` into a leaf package eliminates the latent
  `@minsky/budget-guard → @minsky/observability` dependency cycle without
  breaking observability's public API.
- **Success threshold**: `pnpm typecheck && pnpm test && pnpm publish --dry-run --workspace novel/adapters/types` all exit 0; existing observability tests pass unchanged; new types-package tests cover `aggregateStatus` 100 %.
- **Pivot threshold**: if the `@minsky/observability` re-export does not
  preserve type identity across declaration files (downstream consumers see
  two distinct `SelfTestStatus` types and refuse to unify them), revert and
  inline the contract per-adapter with a CI lint that asserts the inline
  copies are byte-equal.
- **Measurement**: `pnpm typecheck && pnpm test && pnpm publish --dry-run --workspace novel/adapters/types`; plus `node -e "import('@minsky/adapter-types').then(m => console.log(m.aggregateStatus([{status:'green',message:'',latencyMs:0,lastCheck:''},{status:'red',message:'',latencyMs:0,lastCheck:''}])))"` prints `red`.
- **Literature anchor**: Martin, *Clean Architecture*, 2017 (acyclic
  dependency principle); Wiggins, *The Twelve-Factor App*, 2011 (factor II
  — explicit dependencies).

## Usage

```ts
import { type SelfTestResult, aggregateStatus } from "@minsky/adapter-types";

const results: SelfTestResult[] = await Promise.all(adapters.map((a) => a.selfTest()));
const overall = aggregateStatus(results); // "green" | "yellow" | "red"
```

For back-compat, `@minsky/observability` continues to re-export these
identifiers; existing imports keep working unchanged.
