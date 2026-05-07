# `@minsky/experiment-record`

Schema + parser + validator for `EXPERIMENT.yaml`, the per-PR pre-registration record carried by every non-trivial PR per [constitutional rule #9](../../vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes). The format and the parser are the *metric source* the rule-#9 automation layer (`ci-experiment-runner-v0`, `experiment-tracker-v0`) consumes.

See [`spec.md`](./spec.md) for the format reference; [`schema.json`](./schema.json) for the JSON-Schema (draft-07) definition.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Pre-registration record**: Munafò et al., "A Manifesto for Reproducible Science", *Nature Human Behaviour* 1, 0021, 2017. **Conformance: full.**
- **DTO + JSON-Schema validation**: Fowler, *Patterns of Enterprise Application Architecture*, 2002. **Conformance: full.**
- **Parser shape**: recursive-descent (Aho-Sethi-Ullman, *Compilers*, 1986) → schema check → semantic-rules pipeline. Same three-stage shape as [`@minsky/handoff-spec`](../handoff-spec/). **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `parse(yaml)` returns either a valid `ExperimentRecord` or a structured `ParseError[]` for every legitimate YAML input.
- **Blast radius**: a single experiment record. Parser is pure (no I / O).
- **Operator escape hatch**: bypass via `<!-- experiment: trivial — see exemption.md -->` comment in the PR description (handled by the runner, not by this parser).

See [`spec.md` § "Failure modes & chaos verification"](./spec.md#failure-modes--chaos-verification) for the long-form discussion. The same table is inlined here so that the rule-#7 chaos-coverage CI lint can mechanically verify every row's "Chaos test" cell.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Malformed YAML (unbalanced quotes, bad indent) | upstream-malformed | `graceful-degrade` — return `ParseError` with `kind: bad-yaml` and the line | covered by `invalid-bad-yaml.yaml` fixture + parse test |
| 2 | Missing required field (e.g., `pivot`) | upstream-malformed | `graceful-degrade` — return `ParseError` with `kind: missing-required-field` | covered by `invalid-missing-pivot.yaml` fixture + parse test |
| 3 | Vanity metric in `success` (e.g., "more commits") | rule-#9 anti-pattern | `graceful-degrade` — return `ParseError` with `kind: vanity-metric` | covered by `invalid-vanity-metric.yaml` fixture + parse test |
| 4 | Unknown extra field | upstream-malformed | `graceful-degrade` — return `ParseError` with `kind: unknown-field` | covered by `additionalProperties: false` JSON-Schema assertion in the parse test |
| 5 | `replay_windows_days: []` | edge case | `graceful-degrade` — return `ParseError` with `kind: empty-replay-windows` | covered by parser test (`empty-replay-windows` assertion) |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: A small declarative YAML schema (the five rule-#9 fields plus an experiment-id and replay windows) is sufficient to encode every PR's rule-#9 contract and produces a parser whose output the daily and weekly automation layers consume directly without further transformation.
- **Success threshold**: `pnpm vitest run novel/experiment-record/src/parse.test.ts` exits 0 with ≥6 paired fixtures (3 valid + 3 invalid); `wc -l` of `src/parse.ts + src/cli.ts + schema.json` ≤ 300.
- **Pivot threshold**: if YAML proves too rigid for the `measurement` field (shell commands with embedded YAML-unsafe characters), pivot to TOML or a fenced markdown block in `EXPERIMENT.md`. Reframe the parser; keep the schema intent.
- **Measurement**: see "Success threshold" above.
- **Literature anchor**: Munafò et al. 2017 (pre-registration); AsPredicted.org schema; Aho-Sethi-Ullman 1986; Gamma et al. 1994 (Adapter — schema is the interface).

## Usage

### Validate a file from the CLI

```sh
pnpm exec experiment-record validate path/to/EXPERIMENT.yaml
# exits 0 on valid, 1 on validation errors, 2 on bad usage / I/O errors
```

### Parse from JS / TS

```ts
import { parse } from "@minsky/experiment-record";

const result = parse(yamlString);
if (result.ok) {
  console.log(`experiment ${result.record.id}`);
} else {
  for (const err of result.errors) {
    console.error(`${err.kind}${err.field ? ` (${err.field})` : ""}: ${err.message}`);
  }
}
```

### Optional timeout

Each record may carry a per-experiment wall-clock cap:

```yaml
timeout_seconds: 120  # int, [1, 3600], default 60
```

The runner (`ci-experiment-runner-v0`) consumes this when executing the `measurement` command — anything that overruns is killed and reported as a `bad-timeout-value` failure rather than blocking the gate forever. Default is 60 s; raise it explicitly when a measurement is genuinely slow (e.g., a coverage run that takes 90 s on cold cache).

The schema enforces `[1, 3600]` integer values. Out-of-range or non-integer entries fail validation with `kind: bad-timeout-value`.

## Follow-up tasks

- **`experiment-tracker-v0`** — weekly/monthly layer: scheduled cron re-runs the measurement at each `replay_windows_days` value, emits `validated` / `regressed` / `inconclusive` verdicts. (Daily layer `ci-experiment-runner-v0` ships in this PR.)

## Threat model

STRIDE analysis per vision.md § 13 (Shostack, *Threat Modeling*, Wiley, 2014). The package is a pure parser with no I/O, network, or credential surfaces.

| Threat | Surface | Mitigation |
|---|---|---|
| Tampering | Malformed YAML input triggers parser edge cases or produces silently-wrong records | Validated against JSON Schema; `kind: bad-*` error codes signal all out-of-spec inputs |
| Information Disclosure | Experiment records encode measurement commands that may reveal internal paths or credentials | Records are committed to the repo; operators must not embed secrets in `measurement` fields |
| Denial of Service | Pathologically large YAML payload (deeply nested anchors) consumes unbounded memory | 1 MB input cap enforced before parsing; js-yaml safe mode prevents code execution |
| Repudiation | No cryptographic attestation; any writer can produce a record attributed to any persona | Git commit signature is the audit trail; `supply-chain-hardening-lockfile-sbom-slsa` P0 adds SLSA provenance |
