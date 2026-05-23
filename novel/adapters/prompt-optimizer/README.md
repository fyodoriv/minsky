# `@minsky/prompt-optimizer`

Adapter (Gamma 1994) for prompt-A/B and structured one-shot LLM calls — the
DSPy fallback per [`research.md` § "DSPy fit"](../../../research.md#dspy-fit).
Sub-task 1 of 4 of the `mape-k-loop-v0` decomposition.

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index):

- **`PromptOptimizer` interface** — Adapter (structural) per Gamma et al.,
  *Design Patterns*, 1994. **Conformance: full.**
- **`StubPromptOptimizer`** — Strategy (behavioral) backed by an in-memory
  fake (Meszaros, *xUnit Test Patterns*, 2007). **Conformance: full.**
- **`AnthropicPromptOptimizer`** — Strategy (behavioral) backed by
  `@anthropic-ai/sdk` with `cache_control` on the system prefix per
  [`ARCHITECTURE.md` § "Token economy"](../../../ARCHITECTURE.md). **Conformance: full.**
- **`runABTest`** — A/B-test primitive per Kohavi, Tang, Xu,
  *Trustworthy Online Controlled Experiments*, Cambridge UP 2020, Ch. 3
  (`sustainedGainAt7d` is the Kohavi sustained-gain window operationalised).
  **Conformance: partial** — the v0 `runABTest` returns
  `sustainedGainAt7d: false` unconditionally; the sustained-gain check is
  computed in the downstream `mape-k-loop` Plan / Execute phase
  (sub-task 3) once a verdict log spans ≥7 d.
- **`structured<T>`** — DSPy `Signature` analogue (Khattab et al., "DSPy",
  *ICLR* 2024) without the Python runtime. **Conformance: partial** —
  schema is currently a system-prompt rider; tool-use response constraints
  arrive in a follow-up.
- **`selfTest()`** — health probe (Avizienis 1985 / Burns 2016).
  **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `runABTest` invokes `messages.create` exactly
  once per `(variant × input)` pair and returns an `ABResult` whose
  `winnerId` is the variant with the highest mean score, tie broken by
  lowest variant id. `selfTest()` returns `green` against a healthy
  injected client and `yellow` (graceful-degrade) when no API key is set.
- **Blast radius**: a single A/B run; the adapter holds no shared state
  across calls except the cached default `Anthropic` client (cleared by
  destroying the optimizer).
- **Operator escape hatch**: every public method accepts a constructor-
  injected `client`; tests and chaos drills swap in a deterministic stub
  without an `ANTHROPIC_API_KEY`. Production deployments can wrap the
  optimizer in the supervisor's restart envelope (rule #6 / let-it-crash).

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` unset, default client implicitly constructed | env-vars / config | `graceful-degrade` — `selfTest()` returns `yellow` with an explanatory message; `runABTest` / `structured` *would* throw the SDK's auth error if invoked, surfaced through the supervisor | covered by `anthropic.test.ts` "returns yellow when no API key is set" assertion |
| 2 | Anthropic API HTTP 5xx during `messages.create` | network / upstream-malformed | `red` `SelfTestResult` (caught in `selfTest`'s try/catch); A/B failures bubble up so the supervisor's restart envelope can re-attempt | covered by `anthropic.test.ts` "returns red when the injected client throws" assertion |
| 3 | Model returns malformed JSON inside `structured()` | upstream-malformed | `loud-crash-supervisor-restart` — `JSON.parse` throws synchronously; caller decides whether to retry or pivot to `runABTest` | (deferred — covered when `prompt-optimizer-malformed-json-chaos-test` ships) |
| 4 | A/B variant has zero inputs (degenerate eval) | edge case | `graceful-degrade` — return a deterministic winner (the first listed variant) with an empty `results` array; downstream consumers must check `results.length` before computing sustained gain | covered by `index.test.ts` "zero-input case still returns a deterministic winner" assertion |
| 5 | Cache-prefix invariant broken (system prefix not cache-pinned) | configuration drift | `loud-crash-supervisor-restart` — would silently inflate token spend; the test asserts `cache_control` on the system prefix to fail-fast in CI | covered by `anthropic.test.ts` "attaches cache_control to the system prefix" assertion |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: an Anthropic-SDK-backed `PromptOptimizer` Strategy fitting
  the two-method shape (`runABTest`, `structured`) defined in
  `research.md` § "DSPy fit" is sufficient for the MAPE-K Plan / Execute
  phases (sub-task 3) without a Python sidecar.
- **Success threshold**: 8+ tests pass, `pnpm typecheck` exits 0, the
  package builds, and `selfTest()` returns `yellow` (not `red`) without an
  `ANTHROPIC_API_KEY` set.
- **Pivot threshold**: if the Anthropic SDK shape doesn't fit the
  `runABTest` signature cleanly (e.g., the `messages.create` request /
  response contract diverges materially from the
  `MessagesClient` shape declared here), revisit `research.md` § "DSPy fit"
  and revise the interface before sub-task 3.
- **Measurement**: `pnpm typecheck && pnpm vitest run novel/adapters/prompt-optimizer/`.
- **Literature anchor**: `research.md` § "DSPy fit" (the operationalised
  fallback); Khattab et al., "DSPy", *ICLR* 2024 (the rejected baseline);
  Gamma et al., *Design Patterns*, 1994 (Adapter + Strategy);
  Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*, Cambridge
  UP 2020, Ch. 3 (sustained-gain window).

## Usage

```ts
import { StubPromptOptimizer } from "@minsky/prompt-optimizer";

const opt = new StubPromptOptimizer();
const result = await opt.runABTest({
  variants: [
    { id: "concise", system: "Be concise.", user: "Summarise: {{text}}" },
    { id: "verbose", system: "Be thorough.", user: "Summarise: {{text}}" },
  ],
  inputs: [{ text: "..." }],
  metric: async (output) => output.length, // toy metric
});
console.log(result.winnerId);
```

For production use:

```ts
import { AnthropicPromptOptimizer } from "@minsky/prompt-optimizer/anthropic";

const opt = new AnthropicPromptOptimizer(); // reads ANTHROPIC_API_KEY
const probe = await opt.selfTest();
if (probe.status !== "green") throw new Error(probe.message);
```

For unit tests, inject a stub `MessagesClient`:

```ts
import { AnthropicPromptOptimizer, type MessagesClient } from "@minsky/prompt-optimizer/anthropic";

const client: MessagesClient = {
  messages: { create: async () => ({ content: [{ type: "text", text: "ok" }] }) },
};
const opt = new AnthropicPromptOptimizer({ client });
```

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003. Treat LLM outputs per OWASP LLM Top 10 (2025 ed.) — model output is never trusted text.

- **Untrusted inputs**: model `content` blocks returned from `messages.create` (potential prompt-injection / jailbreak per OWASP LLM01); operator-supplied A/B `variants[].system` and `.user` template strings; `inputs[]` payloads bound into the user template; `ANTHROPIC_API_KEY` from env.
- **Trusted state**: the cache-prefix invariant (`cache_control` on the system prefix) is asserted by `anthropic.test.ts` per chaos row 5 — silent miss = loud test failure; the `runABTest` winner-selection is a pure reduction over scored results.
- **Trust boundary**: HTTPS to the Anthropic API; system + user prompts cross the wire; model output crosses back as untrusted text.
- **STRIDE focus**: **T**ampering — `structured()` v0 is `JSON.parse`'d without further runtime validation; downstream callers must validate against their own domain schema (the partial conformance is documented above and the future zod-rider tightens this); **I**nformation disclosure — operator-supplied system prompts cross to Anthropic, so callers must never embed secrets / API keys / PII in the system prefix (the cache-control invariant cannot defend against poor prompt hygiene — it only optimises spend); **D**enial-of-service — an A/B with N variants × M inputs costs N×M API calls; cost-bounded by caller via the `inputs.length` they pass; the daemon's budget-guard PAUSE is the upstream relief valve.
- **Performance-first carve-out** (rule #13's relief valve): the `cache_control` system-prefix pin IS a token-spend optimisation (rule #1's "performance comes first") — but breaking it would silently inflate spend (chaos row 5), so the test-asserted invariant prevents the carve-out from quietly disabling the security posture. They reinforce each other.
