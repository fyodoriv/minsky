# OTEL no-PII — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 2 ("No PII in OTEL spans"), Minsky runs a deterministic regex+AST gate that rejects any span attribute whose name looks like a credential or whose string-literal value matches a known credential prefix. This doc consolidates the threat model, the classifier rules, the allow-annotation seam, and the verification commands. Anchors: OpenTelemetry semantic-conventions / data-classification (opentelemetry.io/docs/specs/semconv/general/attribute-naming/, 2025); GDPR Article 25 ("data protection by design and by default", 2016); CCPA equivalent in California; OWASP A04:2021 ("Insecure Design"); Truffle Security "The State of Secrets Sprawl 2023" — the empirical credential-prefix patterns the value rule pins.

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003. The empirical precedent: tracing pipelines are routinely the longest-lived, lowest-friction exfiltration channel — spans persist for weeks in OpenObserve / Honeycomb / Datadog, are queryable by anyone with viewer access, and are the *first* thing copy-pasted into a debugging chat. A single `record({ apiKey: env.ANTHROPIC_API_KEY })` regression survives the post-incident rotation only if someone notices the field name in the trace UI; the gate's job is to ensure no such field ever gets emitted in the first place.

- **Untrusted inputs**: every `attributes: { … }` object literal that ends up on an OTEL span — Minsky's `emit({ name, attributes })` call sites, OTEL's `setAttributes({ … })`, and any third-party tracer wrapper that takes the same shape. The supervisor's own iterations are explicitly in scope — Minsky-on-Minsky is not exempt.
- **Trusted state**: the in-tree pattern set in [`scripts/check-otel-no-pii.mjs`](../../scripts/check-otel-no-pii.mjs) (`NAME_PATTERNS` for credential-shaped attribute names, `VALUE_PATTERNS` for credential-prefix-shaped string values); the `// @otel-pii-allowed: <reason>` annotation seam (the targeted relief valve, ≥3 chars of substantive reason required); the `.test.ts` / `.spec.ts` / `.fixture.ts` / `.d.ts` suffix exclusion plus the `/test/fixtures/` and `/__fixtures__/` path-segment exclusion (test fixtures are allowed to construct shape-shaped strings inline).
- **Trust boundary**: the CI `otel-no-pii` job rejects any `novel/**/*.ts` file whose `attributes: { … }` literal contains a flagged property. Past that boundary the bytes are trusted to have been reviewed.
- **STRIDE focus**:
  - **S**poofing — out of scope; the gate addresses leak prevention, not authentication. Tokens that pre-date the gate are rotated separately.
  - **T**ampering — out of scope at the gate layer; the OTEL exporter's transport integrity is OTEL's concern (`@opentelemetry/exporter-trace-otlp-http` over HTTPS to an operator-controlled endpoint, per `docs/security/privacy-data-egress.md`).
  - **R**epudiation — every gate failure prints the file path, the 1-based line number of the offending property, the attribute name, the rejection shape (`name-shape` or `value-shape`), and the matched pattern's stable tag (`api-key`, `password`, `secret`, `credential`, `bearer`, `token`, `anthropic-or-openai-key`, `github-pat`, `slack-bot-token`, `slack-user-token`). Saltzer & Schroeder #4 "complete mediation" — the diagnostic names the file *and* the line, never the full matched value (the value would itself be a leak).
  - **I**nformation disclosure — this *is* the gate against information disclosure for the runtime-telemetry surface. Companion gates: `secret-scanning-precommit-and-ci` (rule #13.1) for static-source secrets; `privacy-data-egress` (rule #13.7) for the documented egress allow-list; `dashboard-localhost-only-by-default` (rule #13.4) for the network surface that exposes spans to a viewer.
  - **D**enial of service — out of scope; the lint runs in <2s on the current `novel/` tree and CI runners are ephemeral. The TypeScript AST walker scales linearly in source bytes.
  - **E**levation of privilege — out of scope; a credential whose emission was rejected never reaches the trace store, so no privilege is granted via spans.

## Layer 1: name-shape rejection (shipped)

The classifier in [`scripts/check-otel-no-pii.mjs`](../../scripts/check-otel-no-pii.mjs) flags any attribute name whose string contains one of the credential-shaped substrings, case-insensitive: `api[_-]?key`, `password`, `secret`, `credential`, `bearer`, `token`. Substring match (not whole-word) so `apiKey`, `userPassword`, `clientSecret`, `bearer_jwt`, `auth_token`, and the `_*Key` / `*Password*` family all flag uniformly. The `reason` field on the rejection cites the first-matched tag from `NAME_PATTERNS`, which is also the order the operator should expect to see in CI output.

Non-string attribute names — defensively rejected as `name-shape: attribute name must be a string`. OTEL accepts only string keys in real usage; this guard exists so a malformed call site (an identifier mis-typed as a number) doesn't slip past the classifier.

## Layer 2: value-shape rejection (shipped)

The classifier also flags string-literal values that match a known credential prefix — independently of the name. A field named `note` whose string value is `sk-…` (Anthropic / OpenAI) still flags. The current value patterns (regex tail length calibrated to issuer-documented minimums to keep the false-positive rate near zero on prose):

- **Anthropic / OpenAI key** — `\bsk-[A-Za-z0-9_-]{20,}\b` (Anthropic's `sk-ant-…` is a common subset; `sk-test` does NOT flag because the tail is too short).
- **GitHub PAT** — `\bghp_[A-Za-z0-9]{30,}\b` (GitHub's documented `ghp_` token has a 36-char tail; `ghp_short` does NOT flag).
- **Slack bot token** — `\bxoxb-[A-Za-z0-9-]{10,}\b`.
- **Slack user token** — `\bxoxp-[A-Za-z0-9-]{10,}\b`.

Non-string values (numbers, booleans, arrays, `undefined`) short-circuit the value rule — they cannot encode a credential by themselves. Non-literal expressions (variable references, function calls) similarly skip the value rule because the AST walker cannot statically prove the runtime value's shape; the *name* of the property is still classified, so a non-literal value with a flagged name still flags.

## Layer 3: AST walker (shipped)

`extractAttributeViolations({ files })` walks every TypeScript source file and finds each `PropertyAssignment` whose key is the literal `attributes` and whose initializer is an `ObjectLiteralExpression`. For each inner property, the classifier runs against (a) the property's static name (identifier or string-literal key) and (b) the property's value when it's a string literal or no-substitution template literal. Computed property keys (`[NAME]: …`) are skipped — the static name is unknown and the right point to catch those is a runtime classifier (filed as a slice ≥4 follow-up, not blocking).

The walker is pure — no I/O, no globals — and the CLI wrapper feeds it the source files it reads off disk. The AST seam means a hand-rolled regex over `attributes: \{[^}]+\}` is *not* the gate; the TypeScript compiler's parser is, so multi-line literals, trailing commas, and nested object shapes are handled correctly.

## Layer 4: CI gate (shipped)

The `otel-no-pii` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs `node scripts/check-otel-no-pii.mjs` on every push to `main` and every PR. Push-event coverage is deliberate: a leak that lands via direct push must still surface — a PR-only gate is not enough. The job is wired into the `ci` aggregator's `needs:` list and the bash `mustSucceed` bucket, so a red `otel-no-pii` blocks the merge regardless of which branch protection rule is configured upstream.

Full-scan rather than diff-based: the parent task's hypothesis (TASKS.md `otel-no-pii-in-spans-lint`) preregisters "0 PII-shaped attributes across all current `record({…})` calls", which is a global invariant — diff-based grandfathering would defeat it. The scope is `novel/**/*.ts` (excluding the test/fixture suffixes and segments enumerated in `EXCLUDED_SUFFIXES` / `EXCLUDED_SEGMENTS`). Out-of-scope files (e.g., `scripts/`, `tools/`) do not emit spans in production and are excluded for the same reason `vendor/` is excluded from a lint scope.

## Layer 5: allow-annotation seam (shipped)

`// @otel-pii-allowed: <reason>` is the documented bypass for legitimate matches that resemble credentials but are not. The annotation must:

1. Appear in the *leading trivia* of the offending property — between the previous token (the opening `{` or the previous property's trailing `,`) and the property's first token.
2. Carry a non-empty reason of ≥3 characters of substantive text. The bare token (`@otel-pii-allowed:` with empty reason) does NOT suppress.

Both `// line` and `/* block */` comment forms are honoured. The minimum-reason floor (`MIN_ALLOW_REASON_LEN = 3`) matches `check-pr-security-review.mjs`'s `MIN_OPT_OUT_REASON_LEN` so opt-out reasons across security gates have the same minimum substantiveness.

Examples:

```ts
emit({
  name: "claim.acquire",
  attributes: {
    // @otel-pii-allowed: hash of the opaque task-id, not the secret itself
    tokenHash: hashClaimToken(rawId),
    durationMs: t1 - t0,
  },
});
```

```ts
emit({
  name: "fixture.span",
  attributes: {
    // @otel-pii-allowed: synthetic key used by paired AST test
    // @scan-secrets-allowed: synthetic doc example, not a real credential
    apiKey: "sk-fixture-not-a-real-credential",
  },
});
```

A malformed annotation (missing reason, reason < 3 chars) does NOT suppress — the original violation stands so the operator can fix one or the other. This is fail-safe defaults applied to the relief valve itself: an unintelligible escape hatch is no escape hatch.

## Performance-first carve-out

Per rule #13's relief valve: when security and performance compete, performance wins on a case-by-case basis with the security cost declared in writing. None declared at this layer — the lint runs in <2s on the current `novel/` tree, the AST walker is the same parser the typecheck gate already pays for, and the CI runner is ephemeral. No hot-path latency is on the line.

## Verification

- **CI gate (clean tree)**: `node scripts/check-otel-no-pii.mjs` on a clean checkout exits 0 with `otel-no-pii ok: scanned <N> novel/**/*.ts file(s); 0 PII-shaped span attributes.`.
- **Name-shape violation**: a `novel/<package>/src/<file>.ts` containing `emit({ name: "x", attributes: { apiKey: someValue } })` makes the lint exit 1 with `name-shape: attribute name matches credential pattern: api-key` and the file:line.
- **Value-shape violation**: a `novel/<package>/src/<file>.ts` containing `emit({ name: "x", attributes: { note: "sk-aaaaaaaaaaaaaaaaaaaaaaa" } })` makes the lint exit 1 with `value-shape: attribute value matches credential prefix: anthropic-or-openai-key` and the file:line. <!-- @scan-secrets-allowed: synthetic doc example, the sk- literal above is a placeholder, not a real credential -->
- **Allow-annotation accepted**: prepending `// @otel-pii-allowed: hash of an opaque ID` on the line above the flagged property makes the lint exit 0.
- **Allow-annotation reason missing**: same line with `// @otel-pii-allowed:` (empty reason) keeps the lint at exit 1 — the bare token does not satisfy the gate.
- **Test/fixture exclusion**: a `.test.ts` / `.spec.ts` / `.fixture.ts` / file under `/test/fixtures/` or `/__fixtures__/` containing a flagged literal does not trip the scanner.

Paired tests pin every CLI verdict path: [`scripts/check-otel-no-pii.test.mjs`](../../scripts/check-otel-no-pii.test.mjs).

## Sources

- OpenTelemetry semantic conventions — General attributes (opentelemetry.io/docs/specs/semconv/general/attribute-naming/, 2025) — the canonical reference for what an attribute *is*; this gate is the local enforcement that the conventions' "do not record sensitive data" guidance becomes a CI-level invariant rather than a code-review checklist.
- GDPR Article 25 — data protection by design and by default (2016) — the regulatory anchor for not emitting PII to a downstream observability store.
- CCPA — California Consumer Privacy Act (2018) — the parallel US-state anchor; Minsky's eventual cloud-tier consumer base will include California residents.
- OWASP Top 10 A04:2021 — Insecure Design; OWASP ASVS 8.3.4 ("verify that sensitive information is not logged") — the empirical case for blocking credential-shaped fields at the call-site rather than at the exporter.
- Truffle Security — "The State of Secrets Sprawl 2023" — the credential prefix patterns this gate's `VALUE_PATTERNS` enumerates (Anthropic / OpenAI `sk-…`, GitHub `ghp_…`, Slack `xoxb-…` / `xoxp-…`).
- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — fail-safe defaults (the gate exits 1 on any match; the malformed-annotation case keeps the original violation rather than silently suppressing); complete mediation (the diagnostic names the file *and* the line, never the matched value).
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
