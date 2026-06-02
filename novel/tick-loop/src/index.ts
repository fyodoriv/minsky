/**
 * `@minsky/tick-loop` — pure data shapes + anonymizer for the self-reported
 * findings a minsky installation submits back to `fyodoriv/minsky`. The I/O
 * (gh issue create) lives in `scripts/submit-finding.mjs`; this package is the
 * pure, unit-testable core per rule #13.7 (privacy by default — redact before
 * egress).
 *
 * See `README.md` for the pattern conformance, failure modes, and threat model.
 */

export {
  type AnonymizedFinding,
  anonymizeFinding,
  containsPii,
  type FindingType,
  type RawFinding,
  REDACTION_RULES,
  REDACTION_TOKEN,
  redact,
  renderIssueBody,
  renderPreview,
} from "./finding-reporter.js";
