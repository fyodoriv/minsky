// <!-- scope: human-approved 2026-05-05 user request "implement a meaningful changelog for humans … as a part of the minsky loop. It must show also which metrics improved." -->
/**
 * Daily-fire changelog runner — gate / spawn / lock seams.
 *
 * Pattern (rule #2): mirror of `runCtoAudit` (per-task) but per-day. The
 * gate decision is "is today already authored in CHANGELOG.md?"; if not,
 * fire `claude --print` in changelog-mode. Pure substrate (`buildChangelogEntry`)
 * landed in #179. This is the I/O wrapper that composes the gate + spawn
 * seams the daemon will dispatch into.
 *
 * Source: 2026-05-05 user directive — "implement a meaningful changelog
 * for humans … as a part of the minsky loop". Acceptance criterion (3):
 * "I/O wrapper fires daily" — this module.
 *
 * Conformance: full — pure decision functions (`hasDateSection`,
 * `shouldRunChangelog`) tested deterministically; the I/O wrapper takes
 * injected `read` / `spawn` seams so tests drive it without filesystem
 * or subprocess. The CLI binding lands in a follow-up iteration alongside
 * the metric-snapshot file format.
 *
 * Pivot (rule #9): if the per-day gate fires too aggressively (>1
 * spawn/day on the same date) OR misses days (the daemon iterates on
 * the date-rollover edge but no entry appears), tighten the date-section
 * regex. Don't retire the per-day cadence — that IS the task's contract.
 */

/** A single H2 section header for `date` in CHANGELOG.md, anchored. */
const DATE_HEADER_RE_FOR = (date: string): RegExp =>
  new RegExp(`^##\\s+${date.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "m");

/**
 * Does `content` already contain an H2 section for `date` (`## YYYY-MM-DD`)?
 * Pure: no I/O. The CHANGELOG.md genesis entry's shape (`## 2026-05-05`)
 * is the canonical authored-marker.
 *
 * @otel-exempt pure parser.
 */
export function hasDateSection(content: string, date: string): boolean {
  return DATE_HEADER_RE_FOR(date).test(content);
}

/**
 * Pure gate: should the daemon spawn the changelog-mode runner for `date`?
 *
 * Skip when:
 *   - `MINSKY_CHANGELOG=off` env override set
 *   - `changelogContent` already has a section header for `date`
 *
 * @otel-exempt pure decision; `runChangelog` carries the spawn span.
 */
export function shouldRunChangelog(args: {
  readonly date: string;
  readonly changelogContent: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): boolean {
  if (args.env["MINSKY_CHANGELOG"] === "off") return false;
  if (hasDateSection(args.changelogContent, args.date)) return false;
  return true;
}

/**
 * The changelog-mode prompt header. Data, not code — tested.
 *
 * The daemon spawn that hands this to `claude --print` runs against a
 * checkout where the canonical pipeline is `pnpm changelog:today` (shipped
 * in #185 — `scripts/changelog-today.mjs`): `gh pr list` → `BuildChangelogEntryInput`
 * → `scripts/generate-changelog-entry.mjs` collapsed into one command.
 * The model's job is to invoke that, supply the day's narrative, and
 * commit the appended section. Pre-registration: every day with merged
 * PRs has a corresponding section within 24h.
 *
 * Brief evolution (2026-05-05): earlier wording asked the model to
 * `gh pr list` and compose JSON manually, which duplicates the operator
 * CLI from #185 and adds variance per spawn. Rule #2 — one source of
 * truth; the substrate IS the command.
 */
export const CHANGELOG_PROMPT_HEADER = [
  "You are authoring today's CHANGELOG.md entry for the Minsky project.",
  "",
  "Goal: produce one H2 section for today (UTC) that explains what shipped,",
  "which metrics moved, and a one-paragraph narrative — Card & Mackinlay 1999",
  "glanceable display.",
  "",
  "Workflow:",
  "  (1) Run `pnpm changelog:today` to render today's section from merged PRs",
  "      (the script does `gh pr list` → JSON → markdown in one shot).",
  "      Use `pnpm changelog:today --json` first if you want to inspect the",
  "      structured shape; supply a `narrativeOverride` and pipe the edited",
  "      JSON through `node scripts/generate-changelog-entry.mjs` to render",
  "      with your narrative instead of the auto-synthesised one.",
  "  (2) Append the rendered section to CHANGELOG.md (after the existing",
  "      content; do not overwrite prior days).",
  "  (3) Open a PR with the changelog edit only.",
  "",
  "Discipline:",
  "  - Every metric line must carry an explicit Δ + improved/regressed/unchanged",
  "    label (the renderer does this when `prevMetricsSnapshot` is supplied).",
  "  - Refuse vanity-metric lines (Ries 2011 — counts that always go up:",
  "    LOC, commits, hours, tasks-in-flight). The metric must be falsifiable.",
  "  - Narrative is one paragraph, max — not a digest of every PR.",
  "  - If `pnpm changelog:today` reports zero PRs and no metrics moved,",
  "    output `noop, exiting` instead of opening a PR.",
  "",
].join("\n");

// ---- I/O wrapper ----------------------------------------------------------

/**
 * Minimum spawn surface `runChangelog` depends on. Structurally compatible
 * with `tick-loop/spawn-strategy.ts` `SpawnStrategy` so the daemon can pass
 * its already-constructed strategy in without an adapter. Mirrors
 * `CtoAuditSpawn` from `post-task-cto-audit.ts`.
 */
export interface ChangelogSpawn {
  spawn(input: {
    readonly taskId: string;
    readonly brief: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }): Promise<{
    readonly exitCode: number;
    readonly durationMs: number;
    readonly stdoutTail: string;
    readonly stderrTail: string;
  }>;
}

/**
 * Read CHANGELOG.md (or whichever path the daemon points at). Tests pass
 * a deterministic stub returning frozen content; production reads the
 * real file. Returning `""` for missing-file is intentional — a fresh
 * checkout pre-genesis should still fire (the runner authors the genesis
 * entry).
 */
export type ReadChangelog = () => Promise<string>;

export type RunChangelogOutcome =
  | { readonly outcome: "skipped"; readonly reason: ChangelogSkipReason }
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly stdoutTail: string;
      readonly stderrTail: string;
    };

export type ChangelogSkipReason = "env-off" | "already-authored";

export interface RunChangelogArgs {
  readonly date: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readChangelog: ReadChangelog;
  readonly spawn: ChangelogSpawn;
}

/**
 * Run the daily changelog author for `date`. The I/O wrapper around
 * `shouldRunChangelog` + `CHANGELOG_PROMPT_HEADER` + the daemon's spawn
 * strategy.
 *
 * Skip order is observable + tested:
 *   1. `MINSKY_CHANGELOG=off` — operator disable, never even reads the file
 *   2. already-authored — `## <date>` H2 already present in CHANGELOG.md
 *
 * Idempotency comes from the file content itself, not a separate lock dir
 * (the way the CTO audit uses `.minsky/cto-audit-lock/<taskId>`). The
 * CHANGELOG.md section header IS the "this happened" record — adding a
 * lock dir would just cache the same fact in two places (rule #2: data
 * not code; one source of truth).
 *
 * @otel tick-loop.changelog.run
 */
export async function runChangelog(args: RunChangelogArgs): Promise<RunChangelogOutcome> {
  if (args.env["MINSKY_CHANGELOG"] === "off") {
    return { outcome: "skipped", reason: "env-off" };
  }

  const changelogContent = await args.readChangelog();
  if (hasDateSection(changelogContent, args.date)) {
    return { outcome: "skipped", reason: "already-authored" };
  }

  const brief = `${CHANGELOG_PROMPT_HEADER}\n## Today's date (UTC)\n\n${args.date}\n`;
  const result = await args.spawn.spawn({
    taskId: `changelog:${args.date}`,
    brief,
    env: args.env,
  });

  return {
    outcome: "ran",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}
