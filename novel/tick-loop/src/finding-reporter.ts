// Pattern: DTO + sanitizer (Fowler, PoEAA 2002 — Data Transfer Object) over a
//   self-reported finding, with a STRIDE-shaped redaction pass before any
//   egress. Pure data shape + pure anonymizer; the I/O (gh issue create) lives
//   in scripts/submit-finding.mjs.
// Source: TASKS.md `minsky-remote-task-submission`; vision.md rule #13.7
//   (privacy by default — redact before egress); Mozilla Crash Reporter +
//   VSCode telemetry (opt-in, transparent, anonymized).
// <!-- pattern: not-applicable — DTO + redaction sanitizer; pattern grounding lives in this header + the package README "Pattern conformance" section, not the vision.md index (vision.md is MAPE-K-owned and out of this task's scope) -->

/**
 * The category of a self-reported finding. Mirrors the rule-#17 proactive-heal
 * vocabulary so a submitted finding maps cleanly onto a TASKS.md task block on
 * the receiving end.
 */
export type FindingType = "bug" | "limitation" | "improvement" | "crash" | "flaky-test";

/**
 * The raw finding a minsky installation observes during a run, BEFORE
 * anonymization. May contain code excerpts, absolute paths, or secrets in its
 * free-text fields — anything the caller scrapes from a failing iteration.
 * Nothing in this shape is sent over the wire; only its anonymized projection
 * (`AnonymizedFinding`) is.
 */
export interface RawFinding {
  /** What kind of finding this is. */
  readonly type: FindingType;
  /** One-line human summary (free text — may contain paths/secrets). */
  readonly title: string;
  /** Ordered reproduction steps (free text — may contain paths/secrets). */
  readonly reproSteps: readonly string[];
  /** minsky version string, e.g. "0.1.0". */
  readonly minskyVersion: string;
  /** OS identifier, e.g. "darwin", "linux". */
  readonly os: string;
  /** Agent type that surfaced the finding, e.g. "claude", "devin", "aider". */
  readonly agent: string;
}

/**
 * The anonymized projection of a `RawFinding` — the ONLY shape that crosses
 * the trust boundary to `fyodoriv/minsky`. Free-text fields have been passed
 * through `redact`; no code, no secrets, no user-home paths survive.
 */
export interface AnonymizedFinding {
  readonly type: FindingType;
  readonly title: string;
  readonly reproSteps: readonly string[];
  readonly minskyVersion: string;
  readonly os: string;
  readonly agent: string;
}

/** Replacement token substituted for every redacted span. */
export const REDACTION_TOKEN = "[redacted]";

/**
 * Redaction rules applied (in order) to every free-text field before egress.
 * The shapes mirror `scripts/check-otel-no-pii.mjs`'s classifier so the egress
 * boundary and the OTEL boundary agree on what counts as a secret / PII — one
 * definition, two enforcement points (rule #2 — single seam).
 *
 * Each rule is `[name, pattern]`; `pattern` MUST carry the global flag so
 * `String.prototype.replace` rewrites every occurrence, not just the first.
 */
export const REDACTION_RULES: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  // Credential prefixes (longest-match shapes first so they win over generic
  // token rules).
  ["openai-anthropic-key", /sk-[A-Za-z0-9_-]{20,}/g],
  ["github-pat", /ghp_[A-Za-z0-9]{20,}/g],
  ["github-fine-grained-pat", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["slack-token", /xox[bporas]-[A-Za-z0-9-]{10,}/g],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  // User-home filesystem paths (leak the operator's local username).
  ["macos-home-path", /\/Users\/[^/\s]+/g],
  ["linux-home-path", /\/home\/[^/\s]+/g],
  // Email addresses.
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  // Bare IPv4 addresses (an IP can de-anonymize a reporter).
  ["ipv4", /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g],
]);

/**
 * Redact every secret / PII / user-home-path span from a single free-text
 * string, returning the sanitized text. Pure — no I/O, deterministic for a
 * given input. Applied to every free-text field of a `RawFinding` by
 * `anonymizeFinding`.
 *
 * @otel finding-reporter.redact
 * @param text the raw free-text field
 * @returns the same text with every matched span replaced by REDACTION_TOKEN
 */
export function redact(text: string): string {
  let out = text;
  for (const [, pattern] of REDACTION_RULES) {
    // Each pattern is global; clone the lastIndex-free regex per call so a
    // stateful `g` regex can't leak `lastIndex` across invocations.
    out = out.replace(new RegExp(pattern.source, pattern.flags), REDACTION_TOKEN);
  }
  return out;
}

/**
 * Project a `RawFinding` into the `AnonymizedFinding` that is safe to egress.
 * Free-text fields (`title`, `reproSteps`) are redacted; the structured
 * metadata fields (`type`, `minskyVersion`, `os`, `agent`) are passed through
 * unchanged — they carry no PII by construction (an enum, a semver string, a
 * platform token, an agent name).
 *
 * @otel finding-reporter.anonymize
 * @param raw the observed finding
 * @returns the anonymized projection — the only shape that crosses the wire
 */
export function anonymizeFinding(raw: RawFinding): AnonymizedFinding {
  return {
    type: raw.type,
    title: redact(raw.title),
    reproSteps: raw.reproSteps.map((step) => redact(step)),
    minskyVersion: raw.minskyVersion,
    os: raw.os,
    agent: raw.agent,
  };
}

/**
 * True iff the anonymized finding still contains a recognizable secret / PII
 * span — a defense-in-depth assertion the caller runs AFTER `anonymizeFinding`
 * and BEFORE egress. A `false` return is the green light to submit; a `true`
 * return means redaction missed something and the submission must be aborted
 * (let-it-crash, rule #6 — never egress on a leak).
 *
 * @otel finding-reporter.contains-pii
 * @param finding the anonymized finding to re-scan
 * @returns whether any redaction rule still matches any free-text field
 */
export function containsPii(finding: AnonymizedFinding): boolean {
  const haystacks = [finding.title, ...finding.reproSteps];
  for (const text of haystacks) {
    for (const [, pattern] of REDACTION_RULES) {
      if (new RegExp(pattern.source, pattern.flags).test(text)) return true;
    }
  }
  return false;
}

/**
 * Render the anonymized finding as the exact human-readable preview the
 * operator approves before submission (`minsky submit-finding --preview`).
 * Pure string builder — the CLI prints this verbatim, so what the operator
 * sees is byte-for-byte what gets submitted.
 *
 * @otel finding-reporter.render-preview
 * @param finding the anonymized finding
 * @returns the multi-line preview text
 */
export function renderPreview(finding: AnonymizedFinding): string {
  const lines: string[] = [];
  lines.push("─── minsky finding (anonymized) ───");
  lines.push(`type:    ${finding.type}`);
  lines.push(`title:   ${finding.title}`);
  lines.push(`version: ${finding.minskyVersion}`);
  lines.push(`os:      ${finding.os}`);
  lines.push(`agent:   ${finding.agent}`);
  lines.push("repro steps:");
  if (finding.reproSteps.length === 0) {
    lines.push("  (none provided)");
  } else {
    finding.reproSteps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
  }
  lines.push("───────────────────────────────────");
  lines.push("This is the COMPLETE payload. Nothing else is sent.");
  return lines.join("\n");
}

/**
 * Render the anonymized finding as the GitHub issue body submitted to
 * `fyodoriv/minsky`. Markdown-shaped so it renders cleanly in the issue UI.
 *
 * @otel finding-reporter.render-issue-body
 * @param finding the anonymized finding
 * @returns the GitHub-flavored-markdown issue body
 */
export function renderIssueBody(finding: AnonymizedFinding): string {
  const lines: string[] = [];
  lines.push(`**Finding type:** ${finding.type}`);
  lines.push("");
  lines.push("**Reproduction steps:**");
  if (finding.reproSteps.length === 0) {
    lines.push("- (none provided)");
  } else {
    for (const step of finding.reproSteps) lines.push(`- ${step}`);
  }
  lines.push("");
  lines.push("**Environment:**");
  lines.push(`- minsky version: ${finding.minskyVersion}`);
  lines.push(`- OS: ${finding.os}`);
  lines.push(`- agent: ${finding.agent}`);
  lines.push("");
  lines.push(
    "_Submitted via `minsky submit-finding`. Anonymized: no code, no secrets, no file paths beyond the minsky repo._",
  );
  return lines.join("\n");
}
