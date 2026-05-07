# OTEL spans must not carry PII-shaped attributes

**Rule**: rule #13 item 2 — data minimisation in observability signals.

Minsky emits OpenTelemetry spans for every daemon phase
(`tick-loop.iteration`, `mape.monitor.snapshot`, etc.). These spans travel
to whatever OTLP backend the operator configures (OpenObserve, Jaeger,
Grafana Cloud). If a span attribute carries a PII value — an email address,
an API token, a password — that value leaves the machine and may be stored,
indexed, or logged by the backend for months.

The CI lint `check-rule-otel-no-pii.mjs` enforces **data minimisation at the
attribute-key level**: any literal key whose name matches a PII pattern blocks
the merge.

## What counts as a PII-shaped key

The deny-list (see `scripts/check-rule-otel-no-pii.mjs`, `PII_WORDS`) covers:

| Pattern | Example keys caught |
|---------|---------------------|
| `email` | `user.email`, `userEmail`, `email_address` |
| `password` / `passwd` | `password`, `passwd`, `user.password` |
| `secret` | `client.secret`, `secretKey` |
| `token` | `auth.token`, `session_token`, `apiToken` |
| `api_key` / `apikey` | `apiKey`, `api.key`, `ANTHROPIC_API_KEY` |
| `access_key` | `access_key_id`, `accessKey` |
| `private_key` | `privateKey`, `private.key` |
| `credential` | `credentials`, `user.credential` |
| `ssn` | `ssn`, `social_security_number` |
| `phone` | `phone_number`, `phoneNumber` |
| `credit_card` | `creditCard`, `credit_card_number` |
| `authorization` | `authorization`, `auth.header` |

Matching is **substring after normalisation** (camelCase → snake_case,
lowercase, dots/dashes → underscores). `auth_token` matches `token`.

## What is NOT flagged

Keys describing system state that happen to share a substring with a
PII word are **not** in scope if they do not carry user-identifiable data.
The lint focuses on attribute key names, not values. Safe keys in use today:

- `iteration.status`, `iteration.reason`, `task.id`
- `audit.outcome`, `audit.exit_code`, `audit.duration_ms`
- `violations.count`, `constraint.ruleId`, `execute.decision`
- `knowledge.calibrationMae`, `knowledge.amendmentProposed`

## Opt-out (allow-list)

If a key legitimately contains a deny-list word but carries only
non-PII data (e.g., a hashed or truncated opaque identifier), suppress the
violation with an annotation **on the flagged line or the immediately
preceding line**:

```typescript
// @otel-pii-allowed: TASKS-xyz — hashed SHA-256 of session id, not raw
emit({ name: "span", attributes: { "session.token": sha256(raw) } });
```

The reason must be non-empty and should reference the TASKS-id that justifies
the exception (rule #9 — pre-registered deviation).

## How the lint works

`scripts/check-rule-otel-no-pii.mjs` scans `novel/**/*.ts` for two patterns:

1. **`attributes: { ... }` blocks** — multi-line brace counting extracts all
   literal string and identifier keys from the object body.
2. **`record({ ... })` calls** — single-line regex catches direct calls where
   the object is the first argument.

Variable references (`attributes: snapshotAttrs(snapshot)`) are not flagged —
the lint cannot statically evaluate the return value. Ensure helper functions
that build attribute objects also do not introduce PII keys.

## CI enforcement

The `otel-no-pii` CI job runs on every PR. It diffs against `origin/main`
so only changed files are inspected; the job gate is identical to the local
`pnpm pre-pr-lint` gate (rule #10 — single source of truth).

## References

- rule #13, vision.md § 13 — Security & privacy, item 2 (OTEL data minimisation)
- GDPR Article 5(1)(c) — data minimisation principle
- OWASP ASVS v4.0 §7.1.2 — logs must not include sensitive data
- Cavoukian 2011, "Privacy by Design" — embed privacy at architecture level
- rule #10 — deterministic enforcement; CI gate, not hope
