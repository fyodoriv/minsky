# `novel/adapters/`

External-dependency adapters (rule #2 — every external dependency behind an interface). Each adapter is a separate package with its own README, chaos-verification table, and self-test seam.

Current adapters:

- [`@minsky/adapter-types`](./types/README.md) — shared health-probe contract (`SelfTestStatus` / `SelfTestResult` / `aggregateStatus`).
- [`@minsky/notifier`](./notifier/README.md) — push-notification channel (ntfy Strategy + stub).
- [`@minsky/observability`](./observability/README.md) — OpenTelemetry-backed observability adapter.
- [`@minsky/persona-spawner`](./persona-spawner/README.md) — OMC `/team` persona-spawn adapter.
- [`@minsky/prompt-optimizer`](./prompt-optimizer/README.md) — Anthropic SDK A/B-test + `structured()` adapter.
- [`@minsky/token-monitor`](./token-monitor/README.md) — Claude token-usage tracker (Maciek Strategy + stub).

The split between `novel/adapters/` (rule #2 — every external *dependency* behind an interface) and `novel/bridges/` (a *peer* format we own or read alongside our own) is intentional: an adapter wraps a third-party API Minsky does not control; a bridge is symmetric in spirit even when v0 ships only the read direction (Helland 2007).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

This README documents the *namespace*; each contained adapter package owns its own chaos table. The namespace itself is a directory of READMEs and has no runtime — there is no I/O, no parsing, no shared state to chaos-test at this level. Per-adapter tables live in each package's `README.md`.

- **Steady-state hypothesis**: every adapter package under `novel/adapters/` declares its own chaos table; `scripts/check-rule-7-chaos-coverage.mjs` enforces this on each package's `README.md` independently.
- **Blast radius**: zero — this README is documentation, not runtime code.
- **Operator escape hatch**: the per-package READMEs each carry their own chaos table.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | A new adapter package lands without its own chaos table | governance lapse | `circuit-break-and-notify` — `scripts/check-rule-7-chaos-coverage.mjs` fails the PR | covered by `scripts/check-rule-7-chaos-coverage.test.mjs` (the linter's paired test asserts the file-level policy) |
| 2 | An adapter package exposes an external service directly (rule #2 violation) | governance lapse | `circuit-break-and-notify` — rule #12 scope-discipline lint and PR review reject the direct import | covered by CI typecheck (the adapter interface must be the only import surface) |

## Threat model

STRIDE analysis per vision.md § 13 (Security & privacy — second priority after performance; Shostack, *Threat Modeling*, Wiley, 2014). The adapters namespace has no runtime; threat surface is governance-only.

| Threat | Surface | Mitigation |
|---|---|---|
| Tampering | A new adapter lands without a chaos table, weakening rule #7 coverage | `check-rule-7-chaos-coverage.mjs` enforces per-package chaos table at CI |
| Spoofing | An adapter violates rule #2 by embedding credentials at the interface boundary | PR review + rule #12 scope-discipline lint; adapters accept credentials via constructor opts only |
| Information Disclosure | An adapter leaks a third-party API key in OTEL spans or logs | `otel-no-pii-in-spans-lint` CI gate; each adapter's constructor docs declare secret-handling policy |
| Elevation of Privilege | An adapter accumulates write scope beyond its declared interface | Scope locked by the adapter interface shape; rule #12 lint detects scope drift |
| Denial of Service | Governance lapse: `adapters/` grows without per-adapter security review | PR review checklist in user-stories/006-runner-on-any-repo.md § Security & privacy |
| Repudiation | No audit trail for which operator approved an adapter's external-service scope | Git commit signature + PR reviewer record is the authoritative audit trail |
