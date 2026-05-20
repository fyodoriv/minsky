// Heal-helper types — shared by every `heal-*.ts` module in this package.
//
// Pattern: SRE on-call automation (detect → apply → verify), Beyer 2016
// Ch. 6 "Effective Troubleshooting" + Ch. 11 "Being On-Call". Each helper
// is a pure-with-I/O-at-edge module — the I/O seams (fs, exec, killFn)
// are injected so tests can run hermetically without mocking globals.
//
// User-story: user-stories/007-agent-self-heals-catalogued-failures.md
//
// Constitutional anchors:
// - AGENTS.md rule #3: every heal has paired tests + GWT scenarios
// - AGENTS.md rule #6: graceful-degrade at the I/O boundary (no throws)
// - AGENTS.md rule #17: proactive healing — detect→apply→verify in one pass

/** Result of `detect()` — is the failure mode present right now? */
export type DetectResult =
  | { present: true; signal: string; evidence: Record<string, unknown> }
  | { present: false };

/** Result of `apply()` — did the fix get applied? Idempotent: applying twice is safe. */
export type ApplyResult = {
  applied: boolean;
  changedFiles: string[];
  /** Free-form notes used by the ledger writer. */
  notes?: string;
};

/** Result of `verify()` — re-detect after apply. If healed:false, the apply did not fix the underlying symptom. */
export type VerifyResult =
  | { healed: true }
  | { healed: false; residualSignal: string };

/** Outcome of a complete heal cycle, written to the ledger. */
export type HealOutcome = "healed" | "verified-failed" | "skipped";

/** One row of `.minsky/heal-events.jsonl`. Append-only; never mutate prior rows. */
export type HealEvent = {
  ts_observed: string; // ISO 8601 UTC
  ts_fixed: string; // ISO 8601 UTC
  failure_class: string; // matches the catalogue entry's id
  fix_applied: string; // helper file name OR "skipped" for no-op
  duration_ms: number; // ts_fixed - ts_observed, >= 0
  host: string; // hostname or fixture-host id
  outcome: HealOutcome;
};
