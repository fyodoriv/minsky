// Iteration record — pure rendering of the JSONL line the runner appends to
// `experiment-store/cross-repo/<id>.jsonl` after each `minsky run`. Mirrors
// the existing `experiment-store/<id>.jsonl` shape (rule #1 — match the
// existing data layer rather than coining a new one).
//
// Pattern: append-only journal (Hellerstein, "Architecture of a Database
//   System", 2007 — write-ahead log shape, not a snapshot file). Source:
//   user-stories/006-runner-on-any-repo.md § "Acceptance criteria" — runner
//   "writes the iteration result to <host>/.minsky/experiment-store/".
// Conformance: full — pure function over typed inputs.

export type IterationVerdict =
  | "planned"
  | "validated"
  | "regressed"
  | "inconclusive"
  | "budget-paused"
  | "scope-leak"
  | "aborted";

export interface IterationRecord {
  /** ISO-8601 UTC timestamp the iteration was recorded. */
  ts: string;
  /** The task / experiment id (kebab-case). */
  experiment_id: string;
  /** The host repo (owner/repo) the iteration ran against. */
  host_repo: string;
  /** Branch the spawn cut. */
  branch: string;
  /** The verdict for this iteration. */
  verdict: IterationVerdict;
  /** Optional PR URL (set on validated / regressed / inconclusive). */
  pr_url: string | null;
  /** Optional reason / notes. */
  notes: string;
}

/**
 * Pure function: render an `IterationRecord` to a single JSONL line. The
 * line ends with `\n` so consumers can append directly.
 *
 * @otel cross-repo-runner.render-iteration-record
 */
export function renderIterationRecord(record: IterationRecord): string {
  return `${JSON.stringify(record)}\n`;
}
