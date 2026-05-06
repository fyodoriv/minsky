#!/usr/bin/env node
// @ts-check
// Slice 1 of `otel-no-pii-in-spans-lint` (TASKS.md): the pure classifier.
//
// `classifySpanAttribute(name, value)` decides whether a key/value pair that
// would land on an OTEL span attribute looks like PII or a credential. It is
// intentionally regex-based and deterministic; the call-site walker, CLI, and
// CI wiring ship in subsequent slices, against this fixed seam.
//
// Two rejection paths:
//
//   1. NAME-shape: the attribute name matches one of the credential-shaped
//      tokens documented in TASKS.md `otel-no-pii-in-spans-lint` Hypothesis —
//      `(api[_-]?key | password | token | secret | credential | bearer)`.
//      Match is case-insensitive and substring (so `apiKey`, `userPassword`,
//      `auth_token`, `clientSecret`, `bearer_jwt` all flag).
//
//   2. VALUE-shape: the value is a string and matches a known credential
//      prefix:
//        - `sk-…` (≥20 trailing alphanumerics) — Anthropic / OpenAI keys
//        - `ghp_…` (≥30 trailing alphanumerics) — GitHub PATs
//        - `xoxb-…` / `xoxp-…` — Slack tokens
//      The value rule is independent of the name; a span attribute named
//      `note` whose value is `sk-...` still flags.
//
// Both shapes return `{ ok: false, reason }`. Anything else returns
// `{ ok: true }`. Non-string values short-circuit value-shape detection
// (numbers, booleans, undefined are never credentials by themselves).
//
// Pre-registered (rule #9 / vision.md § 13.2 OTEL no-PII): pivot if the regex
// is too narrow (a leak class slips through) or too noisy (≥2 false positives
// per month on legitimate attribute names). The allow-list (slice ≥2) is the
// targeted relief valve, not regex relaxation.
//
// Pattern: deterministic gate (rule #10), pure function (rule #2 — the
// classifier is the seam, the call-site walker / CLI is the boundary).
// Source: rule #13.2 (OTEL no-PII as one of the eight security minimum-bar
//   items); GDPR Art. 25 (data protection by design); CCPA equivalent in
//   California; OWASP A04 "Insecure Design"; Truffle Security 2023 ("State of
//   Secrets Sprawl") — credential prefix patterns.
// Conformance: full — no I/O, no async, no LLM.

/**
 * @typedef {object} ClassifyResult
 * @property {boolean} ok                  true = safe to record on a span.
 * @property {string} [reason]             present when `ok === false`.
 * @property {"name-shape" | "value-shape"} [shape]
 *   which family triggered the rejection. Useful for slice ≥2 reporting +
 *   for the operator's allow-list annotation.
 */

// Name-shape: the substrings that flag a credential-like attribute name.
// `api[_-]?key` matches `apikey`, `api_key`, `api-key`, and via the
// case-insensitive flag, `apiKey` / `ApiKey` / etc. The other tokens are
// plain substrings — `password` flags `userPassword`, `passwordHash`,
// `oldPassword`, etc. Entry order is also the diagnostic order (the
// `reason` field cites the first-matched token).
const NAME_PATTERNS = Object.freeze([
  Object.freeze({ tag: "api-key", re: /api[_-]?key/i }),
  Object.freeze({ tag: "password", re: /password/i }),
  Object.freeze({ tag: "secret", re: /secret/i }),
  Object.freeze({ tag: "credential", re: /credential/i }),
  Object.freeze({ tag: "bearer", re: /bearer/i }),
  Object.freeze({ tag: "token", re: /token/i }),
]);

// Value-shape: known credential prefixes. The minimum-tail length (`{20,}`,
// `{30,}`) is a deliberate guard against e.g. `sk-test` being flagged when
// it's actually a label. Real Anthropic / OpenAI / GitHub keys are far
// longer than the floor; the floor exists to keep the false-positive rate
// near zero on prose.
const VALUE_PATTERNS = Object.freeze([
  Object.freeze({ tag: "anthropic-or-openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ }),
  Object.freeze({ tag: "github-pat", re: /\bghp_[A-Za-z0-9]{30,}\b/ }),
  Object.freeze({ tag: "slack-bot-token", re: /\bxoxb-[A-Za-z0-9-]{10,}\b/ }),
  Object.freeze({ tag: "slack-user-token", re: /\bxoxp-[A-Za-z0-9-]{10,}\b/ }),
]);

/**
 * Pure classifier. Decide whether a key/value pair would leak PII or a
 * credential if recorded on an OTEL span.
 *
 * @param {string} name                attribute key on the span
 * @param {unknown} value              attribute value (typed `unknown` because
 *                                     OTEL accepts string | number | bool |
 *                                     array; non-strings skip the value rule)
 * @returns {ClassifyResult}
 */
export function classifySpanAttribute(name, value) {
  if (typeof name !== "string") {
    // Defensive: `name` is always a string in real OTEL usage. If someone
    // hands us a non-string, treat it as a malformed attribute — reject.
    return {
      ok: false,
      shape: "name-shape",
      reason: "attribute name must be a string",
    };
  }

  for (const { tag, re } of NAME_PATTERNS) {
    if (re.test(name)) {
      return {
        ok: false,
        shape: "name-shape",
        reason: `attribute name matches credential pattern: ${tag}`,
      };
    }
  }

  if (typeof value === "string") {
    for (const { tag, re } of VALUE_PATTERNS) {
      if (re.test(value)) {
        return {
          ok: false,
          shape: "value-shape",
          reason: `attribute value matches credential prefix: ${tag}`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Convenience: classify every entry of a `Record<string, unknown>` (the shape
 * `record({ … })` call sites pass). Returns the first violation, or `null`
 * if every attribute is safe. The walker (slice ≥2) calls this against the
 * literal-object AST nodes it extracts.
 *
 * @param {Record<string, unknown>} attrs
 * @returns {(ClassifyResult & { name: string }) | null}
 */
export function classifyAttributesObject(attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    const result = classifySpanAttribute(name, value);
    if (!result.ok) {
      return { ...result, name };
    }
  }
  return null;
}
