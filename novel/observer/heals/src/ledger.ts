// MTTR ledger writer.
//
// Each heal helper calls `recordHealEvent` after `verify()` to append a
// row to `<host>/.minsky/heal-events.jsonl`. The reporter
// (scripts/heal-mttr-report.mjs) reads this file to compute the
// `mttr-self-heal` metric.
//
// Schema is in types.ts (HealEvent). Append-only — rows are never
// mutated. The directory is auto-created if missing (rule #6 — graceful
// degrade at the I/O boundary, not at the call site).
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-ledger appends an event entry with all required fields"
//   - "heal-ledger creates the parent directory if missing"
//   - "heal-ledger is monotonic — entries appear in call order"

import type { HealEvent } from "./types.js";

/** Injected I/O seams for the ledger writer. */
export type LedgerSeams = {
  ledgerPath: string;
  appendFileSyncFn: (path: string, data: string) => void;
  mkdirSyncFn: (path: string, options: { recursive: true }) => void;
  existsSyncFn: (path: string) => boolean;
  /** Resolve dirname for a path. Tests inject; production uses node:path's dirname. */
  dirnameFn: (path: string) => string;
};

/**
 * Append one HealEvent as a JSONL line. Auto-creates parent dir if missing.
 * @otel-exempt I/O at edge — caller's `observer.heal` span already wraps the
 * complete detect→apply→verify→record cycle; instrumenting the ledger writer
 * separately would double-count the heal duration.
 */
export function recordHealEvent(args: { event: HealEvent; seams: LedgerSeams }): void {
  const dir = args.seams.dirnameFn(args.seams.ledgerPath);
  if (!args.seams.existsSyncFn(dir)) {
    args.seams.mkdirSyncFn(dir, { recursive: true });
  }
  const line = `${JSON.stringify(args.event)}\n`;
  args.seams.appendFileSyncFn(args.seams.ledgerPath, line);
}

/**
 * Build a HealEvent from per-helper context. Helper-call timing is the source of truth.
 * @otel-exempt pure data-transform — no I/O, no caller-visible side effect, no span warranted.
 */
export function buildHealEvent(args: {
  tsObservedMs: number;
  tsFixedMs: number;
  failureClass: string;
  fixApplied: string;
  host: string;
  outcome: HealEvent["outcome"];
}): HealEvent {
  return {
    ts_observed: new Date(args.tsObservedMs).toISOString(),
    ts_fixed: new Date(args.tsFixedMs).toISOString(),
    failure_class: args.failureClass,
    fix_applied: args.fixApplied,
    duration_ms: Math.max(0, args.tsFixedMs - args.tsObservedMs),
    host: args.host,
    outcome: args.outcome,
  };
}
