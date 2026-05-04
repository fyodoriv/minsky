/**
 * Shapes for the read-only OMC → tasks.md bridge.
 *
 * `OmcTeamTask` mirrors the public shape of OMC's `TaskFile` / `TeamTask`
 * persisted to `<repoRoot>/.omc/state/team/<teamName>/tasks/<taskId>.json`.
 * See research.md § "OMC handoff persistence" for the source citations
 * (`src/team/types.ts:38-58, 195-213` in the OMC repo).
 *
 * v0 is intentionally permissive on optional fields — the bridge is a
 * thin reader that should not fail on tasks carrying fields we don't yet
 * surface in tasks.md (forward-compatibility per Helland 2007 § "the
 * receiver tolerates fields it does not understand").
 */

/**
 * OMC's team-task status enum, per `src/team/types.ts`. Other values may
 * appear in newer OMC releases; the bridge passes the raw string through
 * to the tasks.md `Status:` field rather than rejecting unknown values
 * (rule #7 graceful-degrade — better to surface an unknown status than
 * to drop the task).
 */
export type OmcTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | (string & { readonly __omcTaskStatusBrand?: never });

/**
 * Optimistic-concurrency claim envelope written by OMC's `claimTask`
 * (`src/team/state/tasks.ts:90`). Read-only here; the v1+ reverse-sync
 * bridge will need a CRDT story for this field.
 */
export interface OmcTaskClaim {
  readonly owner: string;
  readonly token: string;
  readonly leased_until: string;
}

/**
 * One OMC team task as persisted to disk. All fields beyond the
 * `id` / `subject` / `status` / `created_at` quartet are optional —
 * older or newer OMC releases may emit a subset.
 */
export interface OmcTeamTask {
  readonly id: string;
  readonly subject: string;
  readonly description?: string;
  readonly status: OmcTaskStatus;
  readonly owner?: string;
  readonly blocks?: readonly string[];
  readonly blocked_by?: readonly string[];
  readonly depends_on?: readonly string[];
  readonly created_at: string;
  readonly completed_at?: string;
  readonly version?: number;
  readonly claim?: OmcTaskClaim;
  readonly result?: string;
  readonly error?: string;
  readonly requires_code_change?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Options for `OmcReader.list`.
 */
export interface BridgeOptions {
  /**
   * Repository root containing `.omc/state/team/<teamName>/tasks/`.
   */
  readonly repoRoot: string;
  /**
   * Optional team filter. Omit (or pass `undefined`) to read every
   * team's tasks under `<repoRoot>/.omc/state/team/*`.
   */
  readonly teamName?: string;
}

/**
 * Sync mode for `syncOmcToTasksMd`.
 *
 * - `replace-section`: idempotent rewrite — re-running yields the same
 *   bytes given the same input. The bridge's v0 default; matches the
 *   "thin reader" stance of the read-only direction.
 * - `merge-by-id`: deferred to v1+ when reverse direction is sketched
 *   (per the brief). Selected here only so the type is closed and the
 *   sync function can branch deterministically; v0 implementation
 *   throws `NotImplementedError` for this mode.
 */
export type SyncMode = "replace-section" | "merge-by-id";

/**
 * Input record for `syncOmcToTasksMd`.
 */
export interface SyncInput {
  readonly omcTasks: readonly OmcTeamTask[];
  readonly existingTasksMd: string;
  readonly mode: SyncMode;
}
