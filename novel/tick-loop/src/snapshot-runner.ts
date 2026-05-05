// <!-- scope: human-approved 2026-05-05 user request "implement a meaningful changelog for humans … as a part of the minsky loop. It must show also which metrics improved." — task `daily-changelog-for-humans` Details (e) "Snapshots persisted at .minsky/metric-snapshots/<date>.json". This is the daemon-side I/O wrapper that ensures today's snapshot is captured every UTC day, mirroring `runChangelog` but with its own per-day gate so a manually-authored CHANGELOG.md doesn't suppress snapshot capture. -->
/**
 * Daily-fire snapshot runner — gate / capture seams.
 *
 * Pattern (rule #2): mirror of `runChangelog` (per-day) but for the
 * `.minsky/metric-snapshots/<date>.json` writer rather than the
 * `claude --print` author. The gate decision is "does today's snapshot
 * already exist on disk?"; if not, fire the capture seam (production:
 * spawns `pnpm changelog:snapshot --date <date>`; tests inject a stub).
 *
 * Why a separate runner from `runChangelog` (and not a third seam inside it):
 *   - The two cadences must be **independent**. If the operator manually
 *     authored today's CHANGELOG.md section, `runChangelog` skips with
 *     `already-authored` — but today's snapshot still needs capturing
 *     so tomorrow's Δ rendering has data to diff against. Folding
 *     snapshot-capture into `runChangelog`'s gate would silently drop
 *     snapshot writes on manual-author days.
 *   - Snapshot capture is deterministic (gh fetch + JSON write), the
 *     changelog author is non-deterministic (claude --print). Keeping
 *     them separate keeps the failure modes separable.
 *
 * Source: 2026-05-05 user directive — "implement a meaningful changelog
 * for humans … It must show also which metrics improved." The `improved`
 * label requires day-N snapshot vs day-(N-1) snapshot; that requires
 * day-N snapshots to be captured every day, not only on changelog-fire
 * days. PR #188 shipped the operator CLI (`pnpm changelog:snapshot`);
 * this module is the daemon-side per-day fire that closes the
 * "snapshot writer has no daily caller" gap.
 *
 * Conformance: full — pure decision (`shouldRunSnapshot`) tested
 * deterministically; the I/O wrapper takes injected `snapshotExists`
 * and `capture` seams so tests drive it without filesystem or
 * subprocess. The CLI binding lands in a follow-up iteration alongside
 * the daemon wire-in (analog of #181 → #182 → #183 split for
 * `runChangelog`).
 *
 * Pivot (rule #9): if the daemon fires capture-spawn more than once per
 * UTC date despite the gate (e.g., the snapshot file is created mid-fire
 * with a stale mtime that misses the existence check), tighten
 * `snapshotExists` to do a content-shape probe rather than a stat.
 * Don't retire the per-day cadence — that IS the contract day-over-day Δ
 * rendering depends on.
 */

/**
 * Gate seam: does `date`'s snapshot already exist on disk?
 *
 * Production binding (a follow-up iteration) wraps a `fs.stat` against
 * `<rootDir>/.minsky/metric-snapshots/<date>.json` returning `true` on
 * success and `false` on ENOENT. Other errors (EACCES, EISDIR, …)
 * propagate so the supervisor sees them — rule #6 let-it-crash at the
 * right boundary. Tests inject a deterministic stub.
 */
export type SnapshotExists = (date: string) => Promise<boolean>;

/**
 * Capture seam: write `date`'s snapshot to disk, returning the spawn-result
 * shape. Production binding (a follow-up iteration) spawns
 * `pnpm changelog:snapshot --date <date>` via the daemon's existing
 * `SpawnStrategy`; tests inject a stub that records the call. The shape is
 * deliberately compatible with `ChangelogSpawn` / `CtoAuditSpawn` so the
 * daemon can pass its already-constructed strategy through (with a
 * different command-line) without an adapter.
 */
export interface SnapshotCapture {
  capture(input: {
    readonly date: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }): Promise<{
    readonly exitCode: number;
    readonly durationMs: number;
    readonly stdoutTail: string;
    readonly stderrTail: string;
  }>;
}

/**
 * Pure gate: should the daemon fire snapshot-capture for `date`?
 *
 * Skip when:
 *   - `MINSKY_CHANGELOG=off` env override set (umbrella opt-out — same
 *     env var as `shouldRunChangelog`; one switch turns the whole
 *     daily-changelog pipeline off)
 *   - `snapshotAlreadyExists === true` (today's snapshot already on disk)
 *
 * @otel-exempt pure decision; `runSnapshot` carries the capture span.
 */
export function shouldRunSnapshot(args: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly snapshotAlreadyExists: boolean;
}): boolean {
  if (args.env["MINSKY_CHANGELOG"] === "off") return false;
  if (args.snapshotAlreadyExists) return false;
  return true;
}

export type SnapshotSkipReason = "env-off" | "already-captured";

export type RunSnapshotOutcome =
  | { readonly outcome: "skipped"; readonly reason: SnapshotSkipReason }
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly stdoutTail: string;
      readonly stderrTail: string;
    };

export interface RunSnapshotArgs {
  readonly date: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly snapshotExists: SnapshotExists;
  readonly capture: SnapshotCapture;
}

/**
 * Run the daily snapshot capture for `date`. The I/O wrapper around
 * `shouldRunSnapshot` + the daemon's capture strategy.
 *
 * Skip order is observable + tested:
 *   1. `MINSKY_CHANGELOG=off` — operator disable, never even probes the file
 *   2. already-captured — `<rootDir>/.minsky/metric-snapshots/<date>.json` present
 *
 * Idempotency comes from the file existence itself, not a separate lock
 * dir (the way the CTO audit uses `.minsky/cto-audit-lock/<taskId>`). The
 * snapshot file IS the "this happened" record for the day — adding a
 * lock dir would just cache the same fact in two places (rule #2: data
 * not code; one source of truth). Same shape as `runChangelog`'s
 * file-content-as-lock pattern.
 *
 * @otel tick-loop.snapshot.run
 */
export async function runSnapshot(args: RunSnapshotArgs): Promise<RunSnapshotOutcome> {
  if (args.env["MINSKY_CHANGELOG"] === "off") {
    return { outcome: "skipped", reason: "env-off" };
  }

  const exists = await args.snapshotExists(args.date);
  if (exists) {
    return { outcome: "skipped", reason: "already-captured" };
  }

  const result = await args.capture.capture({ date: args.date, env: args.env });

  return {
    outcome: "ran",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}
