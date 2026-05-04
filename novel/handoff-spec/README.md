# `@minsky/handoff-spec`

Spec + parser + validator for persona-to-persona handoff records. v0.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 9 / row 27:

- **Handoff record** — actor message-passing with continuation (Hewitt, Bishop, Steiger, *IJCAI* 1973). The record IS the message; `Suggested next` IS the continuation. **Conformance: full.**
- **Parser** — recursive-descent over markdown headings + bold-labelled fields. **Conformance: full** (standard parsing pattern).
- **Validator** — schema validation per the rules in `spec.md` § "Validation rules". **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every handoff that conforms to the spec parses to a `Handoff` record with zero errors; every handoff that violates the spec parses to zero handoffs and ≥1 specific `ParseError`.
- **Blast radius**: a single document. The parser is pure (no I/O, no shared state across calls).
- **Operator escape hatch**: `parseHandoffs(source).errors` exposes every error; the caller decides what to do.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Document has no `# Handoff:` heading | upstream-malformed | `circuit-break-and-notify` (return error, no handoffs) | covered by structural-error test |
| 2 | Required field missing (e.g., Status) | upstream-malformed | `circuit-break-and-notify` (per-field error) | covered by `invalid-01-missing-status` fixture |
| 3 | Status=blocked without Blockers | upstream-malformed (logical) | `circuit-break-and-notify` | covered by `invalid-02-blocked-without-blockers` fixture |
| 4 | Persona ID is not kebab-case | upstream-malformed (style) | `circuit-break-and-notify` | covered by `invalid-03-bad-persona-id` fixture |
| 5 | Created-at is not ISO-8601 | upstream-malformed | `circuit-break-and-notify` | covered by structural-error test |
| 6 | Document is enormous (>10 MB) | resource exhaustion | `loud-crash-supervisor-restart` (Node OOMs; let-it-crash) | (deferred — covered when `handoff-spec-size-cap` ships) |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a small declarative spec + recursive-descent parser + per-rule validators suffice to catch every malformed handoff before it reaches a downstream agent.
- **Success threshold**: 100 % branch + statement coverage; all 5 reference fixtures parse with zero errors; all 3 invalid fixtures fail with the *specific expected* `ParseError.kind`.
- **Pivot threshold**: if real-world handoffs introduce ≥3 fields not currently in the schema, OR if the hand-rolled parser starts requiring concessions to handle them, pivot to a small parser combinator (e.g., `parsimmon` / `chevrotain`) and a generated AST.
- **Measurement**: `pnpm test:coverage --reporter=verbose -- novel/handoff-spec`
- **Literature anchor**: Hewitt-Bishop-Steiger 1973 (the actor model); Aho-Sethi-Ullman *Compilers* 1986 (recursive-descent parsing).

## Usage

```ts
import { parseHandoffs, isValid } from "@minsky/handoff-spec";

const source = await fs.readFile("handoffs/2026-05-03.md", "utf-8");
const result = parseHandoffs(source);
if (isValid(result)) {
  for (const h of result.handoffs) {
    console.log(`${h.from} → ${h.to ?? h.suggestedNext.join(", ")}: ${h.status}`);
  }
} else {
  for (const e of result.errors) {
    console.error(`line ${e.line}: ${e.kind} — ${e.message}`);
  }
}
```

See [`spec.md`](./spec.md) for the full record format + validation rules.
