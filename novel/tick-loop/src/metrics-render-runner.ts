// <!-- scope: human-approved 2026-05-05 user request "every minsky repo must have a list of important metrics … always be visible and updated" — task `canonical-metric-list-per-repo` Acceptance (3) "daemon refreshes daily". This is the daemon-side I/O wrapper that ensures `METRICS.md` is re-rendered once per UTC day from `SUCCESS_METRICS` + the daily snapshot store, mirroring `runSnapshot` but for the static-render output rather than the JSON capture. -->
/**
 * Daily-fire metrics-render runner — gate / render seams.
 *
 * Pattern (rule #2): mirror of `runSnapshot` (per-day) but for the static
 * `METRICS.md` writer rather than the `.minsky/metric-snapshots/<date>.json`
 * capture. The gate decision is "was today's UTC date already the
 * `lastRenderedDate`?"; if not, fire the render seam (production: spawns
 * `pnpm metrics:render --date <date>`; tests inject a stub).
 *
 * Why a separate runner from `runSnapshot` (and not folded into it):
 *   - The two outputs have different cadences in practice. A snapshot is
 *     captured every UTC day from `gh` queries; the rendered `METRICS.md`
 *     is the human-facing view that joins `SUCCESS_METRICS` + that snapshot.
 *     If the snapshot capture failed (rate limit, network, …) but yesterday's
 *     snapshot still works, we still want today's render to surface.
 *   - Folding render into `runSnapshot`'s gate would make a snapshot-capture
 *     failure suppress the render — the wrong failure mode. Rule #2: separate
 *     gates, separate failure modes (Helland 2007 — visible-not-silent).
 *
 * Source: 2026-05-05 user directive — "every minsky repo must have a list
 * of important metrics … always be visible and updated. Super critical not
 * to have wrong data or useless metrics." The `always updated` clause
 * requires day-N rendering of `METRICS.md` to fire every UTC day, not only
 * on snapshot-capture days. Slice 3/N (`scripts/metrics-render.mjs` +
 * `pnpm metrics:render`) shipped the operator CLI; this module is the
 * daemon-side per-day fire that closes the "no daily caller" gap.
 *
 * Conformance: full — pure decision (`shouldRunMetricsRender`) tested
 * deterministically; the I/O wrapper takes injected `getLastRenderedDate`
 * and `render` seams so tests drive it without filesystem or subprocess.
 *
 * Pivot (rule #9): if the daemon fires render-spawn more than once per
 * UTC date despite the gate (e.g., METRICS.md mtime drifts backwards mid-fire
 * so the same day's render reruns), tighten `getLastRenderedDate` to read
 * an explicit `_Updated:` marker from the file content rather than mtime.
 * Don't retire the per-day cadence — that IS the contract the freshness
 * lint depends on.
 */

/**
 * Gate seam: when was `METRICS.md` last rendered (UTC date)?
 *
 * Production binding (`createFileBackedLastRenderedDate` in
 * `metrics-render-cli-wiring.ts`, follow-up slice) wraps a `fs.stat`
 * against `<rootDir>/METRICS.md`, returning the mtime formatted as
 * `YYYY-MM-DD` on success or `null` on ENOENT (genesis case — METRICS.md
 * not yet authored). Other errors (EACCES, EISDIR, …) propagate so the
 * supervisor sees them — rule #6 let-it-crash at the right boundary.
 * Tests inject a deterministic stub.
 */
export type GetLastRenderedDate = () => Promise<string | null>;

/**
 * Render seam: invoke the static `METRICS.md` renderer for `date`,
 * returning the spawn-result shape. Production binding
 * (`createPnpmMetricsRender` in `metrics-render-cli-wiring.ts`, follow-up
 * slice) spawns `pnpm metrics:render --date <date>` via the daemon's
 * existing `SpawnStrategy`; tests inject a stub that records the call.
 * The shape is deliberately compatible with `SnapshotCapture` /
 * `ChangelogSpawn` / `CtoAuditSpawn` so the daemon can pass its
 * already-constructed strategy through (with a different command-line)
 * without an adapter.
 */
export interface MetricsRender {
  render(input: {
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
 * Pure gate: should the daemon fire metrics-render for `today`?
 *
 * Skip when:
 *   - `MINSKY_CHANGELOG=off` env override set (umbrella opt-out — same env
 *     var as `shouldRunChangelog` / `shouldRunSnapshot`; one switch turns
 *     the whole daily render pipeline off)
 *   - `lastRenderedDate === today` (today's render already happened)
 *
 * Note `lastRenderedDate === null` (genesis case — `METRICS.md` not yet
 * present) does NOT short-circuit to skip; it flows through to render so
 * the genesis file is authored on the first daemon iteration after a
 * fresh checkout. That mirrors `shouldRunChangelog`'s genesis behaviour.
 *
 * @otel-exempt pure decision; `runMetricsRender` carries the render span.
 */
export function shouldRunMetricsRender(args: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly lastRenderedDate: string | null;
  readonly today: string;
}): boolean {
  if (args.env["MINSKY_CHANGELOG"] === "off") return false;
  if (args.lastRenderedDate === args.today) return false;
  return true;
}

export type MetricsRenderSkipReason = "env-off" | "already-rendered";

export type RunMetricsRenderOutcome =
  | { readonly outcome: "skipped"; readonly reason: MetricsRenderSkipReason }
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly stdoutTail: string;
      readonly stderrTail: string;
    };

export interface RunMetricsRenderArgs {
  readonly today: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly getLastRenderedDate: GetLastRenderedDate;
  readonly render: MetricsRender;
}

/**
 * Run the daily metrics render for `today`. The I/O wrapper around
 * `shouldRunMetricsRender` + the daemon's render strategy.
 *
 * Skip order is observable + tested:
 *   1. `MINSKY_CHANGELOG=off` — operator disable, never even probes the file
 *   2. already-rendered — `<rootDir>/METRICS.md` mtime UTC date === today
 *
 * Idempotency comes from the file mtime itself, not a separate lock dir.
 * `pnpm metrics:render` is byte-deterministic for a given snapshot, so
 * even a double-fire would write identical bytes; the gate exists to keep
 * span noise + write churn down, not for correctness.
 *
 * @otel tick-loop.metrics-render
 */
export async function runMetricsRender(
  args: RunMetricsRenderArgs,
): Promise<RunMetricsRenderOutcome> {
  if (args.env["MINSKY_CHANGELOG"] === "off") {
    return { outcome: "skipped", reason: "env-off" };
  }

  const lastRenderedDate = await args.getLastRenderedDate();
  if (lastRenderedDate === args.today) {
    return { outcome: "skipped", reason: "already-rendered" };
  }

  const result = await args.render.render({ date: args.today, env: args.env });

  return {
    outcome: "ran",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}
