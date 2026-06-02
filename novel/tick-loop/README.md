# `@minsky/tick-loop`

<!-- rule-1: a generic redaction library (e.g. `redact-pii`, `scrubbr`) rejected because: the finding shape is Minsky-specific (FindingType enum mapped to the rule-#17 proactive-heal vocabulary, the AnonymizedFinding egress contract, the renderPreview/renderIssueBody surfaces) and the redaction rule-set is deliberately co-defined with `scripts/check-otel-no-pii.mjs` so the egress boundary and the OTEL boundary agree on what a secret is — a single seam (rule #2). An off-the-shelf scrubber would only cover the regex layer and would drift from the OTEL classifier; the DTO + preview/issue-body rendering have no off-the-shelf equivalent. -->

This package exists so a minsky installation can submit a self-observed finding (a bug, limitation, crash, or flaky test) back to `fyodoriv/minsky` **without ever leaking code, secrets, or file paths**. It is the pure, unit-testable core of the remote-task-submission flow: the data shape (`RawFinding` → `AnonymizedFinding`), the redaction pass (`redact`), the leak re-scan (`containsPii`), and the two renderers (`renderPreview` for the operator's `[Y/n]` approval, `renderIssueBody` for the GitHub issue). All I/O — `gh issue create`, the approval prompt — lives in [`scripts/submit-finding.mjs`](../../scripts/submit-finding.mjs); this package is pure so the privacy guarantee is testable in isolation.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Data Transfer Object (DTO)**: Fowler, *Patterns of Enterprise Application Architecture*, 2002. `RawFinding` (internal) → `AnonymizedFinding` (egress projection). **Conformance: full.**
- **Sanitizer / redaction before egress**: vision.md rule #13.7 (privacy by default); GDPR Art. 25 (data protection by design). The redaction rule-set mirrors `scripts/check-otel-no-pii.mjs`'s classifier — one definition of "secret", two enforcement points. **Conformance: full.**
- **Opt-in telemetry**: Mozilla Crash Reporter; VSCode telemetry (transparent + anonymized + approval-gated). **Conformance: full** — nothing egresses without the operator approving the rendered preview.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `anonymizeFinding(raw)` returns an `AnonymizedFinding` whose free-text fields contain zero secret/PII spans, for every `RawFinding` input; `containsPii(anonymized)` returns `false` on that output.
- **Blast radius**: a single finding submission. The package is pure (no I/O), so a defect cannot corrupt state or leak beyond the one payload the caller is about to render.
- **Operator escape hatch**: the submission is preview-then-approve (`renderPreview` → `[Y/n]` in `scripts/submit-finding.mjs`); declining the prompt sends nothing. There is no auto-submit path.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Secret in a free-text field (API key, PAT, Slack token, AWS key) | upstream-leak | `graceful-degrade` — `redact` replaces every matched span with `[redacted]` | `novel/tick-loop/src/finding-reporter.test.ts` (per-rule redaction assertions) |
| 2 | User-home path leaks the operator's username (`/Users/<name>`, `/home/<name>`) | upstream-leak | `graceful-degrade` — path prefix redacted | `novel/tick-loop/src/finding-reporter.test.ts` (home-path assertions) |
| 3 | Email or bare IPv4 that could de-anonymize the reporter | upstream-leak | `graceful-degrade` — span redacted | `novel/tick-loop/src/finding-reporter.test.ts` (email + ipv4 assertions) |
| 4 | A leak slips past redaction and reaches the egress boundary | redaction-miss | `loud-crash-supervisor-restart` — `containsPii` returns `true`; the CLI aborts before `gh issue create` | `novel/tick-loop/src/finding-reporter.test.ts` (containsPii assertions) + `scripts/submit-finding.test.mjs` (abort-on-leak assertion) |
| 5 | Multiple secrets in one field | upstream-leak | `graceful-degrade` — every occurrence redacted (global-flag rules) | `novel/tick-loop/src/finding-reporter.test.ts` (global-flag + stateless assertions) |

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: the `RawFinding` free-text fields (`title`, `reproSteps`) — scraped from a failing iteration on an arbitrary host; may contain code, absolute paths, API keys, or PII.
- **Trusted state**: the redaction rule-set is an in-source constant (`REDACTION_RULES`); the package is pure (no I/O, no env reads); the only shape that crosses the trust boundary is `AnonymizedFinding`.
- **Trust boundary**: `anonymizeFinding(raw)` is the boundary — its output is the only thing the CLI renders and submits; `containsPii` is the defense-in-depth re-scan the CLI runs before egress.
- **STRIDE focus**: **I**nformation disclosure — the entire package exists to prevent it; `redact` strips credential/PII/path spans and `containsPii` fails-closed if redaction missed one. **T**ampering — the structured metadata (`type`, `minskyVersion`, `os`, `agent`) is typed (an enum + plain strings) so a malicious field cannot smuggle markup into the issue body beyond inert text.
- **Performance-first carve-out** (rule #13's relief valve): none declared — redaction runs once per submission, far off any hot path.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a pure DTO + redaction core makes the privacy guarantee ("no code, no secrets, no file paths egress") unit-testable in isolation, so every secret-shape class is covered by a deterministic test rather than a hope.
- **Success threshold**: `pnpm vitest run novel/tick-loop/src/finding-reporter.test.ts` exits 0 with a test asserting redaction for each of the 9 secret/PII shapes in `REDACTION_RULES`, plus a `containsPii` fail-closed test.
- **Pivot threshold**: if the regex rule-set produces ≥2 false negatives (a real leak slips through) in any review window, pivot from regex redaction to an allow-list projection (only emit the structured metadata + a fixed-vocabulary finding type, drop free text entirely).
- **Measurement**: see "Success threshold" above.
- **Literature anchor**: Fowler 2002 (DTO); GDPR Art. 25 (privacy by design); Mozilla Crash Reporter / VSCode telemetry (opt-in, anonymized).

## Usage

```ts
import { anonymizeFinding, containsPii, renderPreview } from "@minsky/tick-loop";

const anon = anonymizeFinding(rawFinding);
if (containsPii(anon)) throw new Error("redaction missed a leak — aborting submission");
console.log(renderPreview(anon)); // operator approves this exact payload before egress
```

The CLI ([`scripts/submit-finding.mjs`](../../scripts/submit-finding.mjs)) wires this into `minsky submit-finding --preview` (default) and `minsky submit-finding --submit` (preview → `[Y/n]` → `gh issue create` on `fyodoriv/minsky`).
