/**
 * `@minsky/tick-loop/changelog-runner` — daily-fire I/O wrapper for the
 * `daily-changelog-for-humans` task. Mirrors the `post-task-cto-audit`
 * shape (PR #175): a pure gate (`shouldFireChangelog`) + a thin async
 * orchestrator (`runChangelog`) that wires the gate to a spawn seam.
 *
 * Pattern (rule #2): the daemon is the I/O boundary, this module is the
 * smallest unit-testable surface above it. The pure-builder substrate
 * (`scripts/generate-changelog-entry.mjs`, PR #179) is what the spawned
 * `claude --print` invocation runs to materialise the day's section; this
 * module decides _whether_ to fire on a given iteration and constructs
 * the brief that steers the spawn.
 *
 * Cadence (sub-step (d) of the task block): one fire per UTC day, gated
 * on whether `## YYYY-MM-DD` already exists in `CHANGELOG.md`. Idempotent
 * across daemon restarts (the gate IS the lock — no separate per-day
 * sentinel file needed) and across the fleet of in-process iterations
 * (cheap string scan; safe to call every iteration).
 *
 * `MINSKY_CHANGELOG=off` disables firing entirely (sub-step (f)).
 *
 * Pivot (rule #9): if false-positive fires (heading already present but
 * misformatted) >5%/30d, switch the gate from substring to a stricter
 * line-anchored regex. Don't retire the architecture — gate semantics
 * tighten in place.
 *
 * @module tick-loop/changelog-runner
 */

// ---- Pure gate ------------------------------------------------------------

export type ChangelogSkipReason = "env-disabled" | "already-fired";

export interface ShouldFireChangelogArgs {
  readonly date: string;
  readonly changelogContent: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Decide whether the daemon should fire a changelog entry for `date`.
 *
 * Rules (sub-step (d) + (f)):
 *   - `MINSKY_CHANGELOG=off` short-circuits to `false`.
 *   - Otherwise fire iff the `## ${date}` heading is NOT already present
 *     in `changelogContent`. The substring scan is anchored to the `## `
 *     prefix so a date appearing inside a narrative paragraph (e.g. "the
 *     2026-05-05 stall") doesn't suppress the fire.
 *
 * Pure: same inputs → same output (rule #10). The daemon's I/O boundary
 * (`runChangelog`) reads the file + threads the contents in.
 *
 * @otel-exempt pure decision function — `runChangelog` carries the
 *   spawn span; this is the gate.
 */
export function shouldFireChangelog(args: ShouldFireChangelogArgs): boolean {
  if (args.env["MINSKY_CHANGELOG"] === "off") return false;
  return !args.changelogContent.includes(`## ${args.date}`);
}

// ---- Brief builder --------------------------------------------------------

/**
 * Build the brief the spawned `claude --print` runs in changelog-mode.
 * The spawn is expected to:
 *   1. Enumerate today's merged PRs (`gh pr list --state=merged --search "merged:>=YYYY-MM-DDT00:00:00Z"`).
 *   2. Read prior-day metric snapshot at `.minsky/metric-snapshots/<prev>.json` if any.
 *   3. Compose `BuildChangelogEntryInput` and feed it to
 *      `node scripts/generate-changelog-entry.mjs --date YYYY-MM-DD`.
 *   4. Prepend the rendered section under the file's `---` divider (or
 *      below the existing latest section) and commit + open a PR.
 *
 * The brief is data, not code — drift surfaces in tests (`changelog-runner.test.ts`
 * `buildChangelogBrief includes the generator script path`) rather than
 * silently in production.
 *
 * @otel-exempt pure builder of the spawn-strategy input.
 */
export function buildChangelogBrief(args: { readonly date: string }): string {
  return [
    `# Changelog-mode brief for ${args.date}`,
    "",
    "## Goal",
    "",
    `Author the \`## ${args.date}\` section of \`CHANGELOG.md\` for today's UTC date. The section is for humans — operator + future audit — not robots.`,
    "",
    "## Substrate",
    "",
    "- Pure renderer: `scripts/generate-changelog-entry.mjs` (`buildChangelogEntry({date, mergedPRs, metricsSnapshot, prevMetricsSnapshot, narrativeOverride?})`).",
    "- CLI: `node scripts/generate-changelog-entry.mjs --date <YYYY-MM-DD> < input.json` writes the markdown section to stdout.",
    "- Today's snapshot lives at `.minsky/metric-snapshots/<date>.json`; prior day at `.minsky/metric-snapshots/<prev>.json`.",
    "",
    "## Steps",
    "",
    `1. Collect merged PRs for ${args.date} via \`gh pr list --state=merged --search "merged:${args.date}" --json number,title,additions,deletions,body\`.`,
    "2. Build a one-line `summary` per PR from the body's first non-trivial paragraph (skip the rule-#9 block headings).",
    `3. Read \`.minsky/metric-snapshots/${args.date}.json\` (today) and the previous day's file if it exists. If today's file is missing, persist whatever metrics you can collect cheaply (uptime, open-PR count, self-diagnose finding count) before continuing.`,
    "4. Compose a one-paragraph narrative: lead with the day's structural shift, then enumerate the substantive PRs. Card & Mackinlay 1999 — glanceable, not exhaustive.",
    `5. Feed the assembled \`BuildChangelogEntryInput\` to \`node scripts/generate-changelog-entry.mjs --date ${args.date}\` and prepend its output to \`CHANGELOG.md\` immediately below the \`---\` divider (above any pre-existing dated section).`,
    "6. Open a PR titled `docs(changelog): YYYY-MM-DD entry` with the rule-#9 self-grade block in the body.",
    "",
    "## Forbidden",
    "",
    `- Do NOT modify the \`## ${args.date}\` section if one already exists. Exit with \`noop, exiting\`.`,
    "- Do NOT invent metric deltas. Only report metrics you can measure now.",
    "- Do NOT add narrative for PRs you cannot enumerate from `gh`.",
    "",
  ].join("\n");
}

// ---- I/O wrapper ----------------------------------------------------------

/**
 * Minimum spawn surface `runChangelog` depends on. Structurally compatible
 * with `tick-loop/spawn-strategy.ts` `SpawnStrategy` so the daemon can pass
 * its already-constructed spawn strategy in without an adapter (mirrors
 * `CtoAuditSpawn` in `post-task-cto-audit.ts`).
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

export type RunChangelogOutcome =
  | { readonly outcome: "skipped"; readonly reason: ChangelogSkipReason }
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly stdoutTail: string;
      readonly stderrTail: string;
    };

export interface RunChangelogArgs {
  /** Today's UTC date (YYYY-MM-DD). The daemon supplies this from a clock seam. */
  readonly date: string;
  /** I/O seam — read the current `CHANGELOG.md` content. May throw `ENOENT`. */
  readonly readChangelog: () => string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawn: ChangelogSpawn;
}

/**
 * Fire the changelog-mode `claude --print` for `date` if the gate allows.
 *
 * Skip order is observable + tested:
 *   1. `MINSKY_CHANGELOG=off` short-circuits to `env-disabled`.
 *   2. `## ${date}` already in the file → `already-fired` (no spawn).
 *   3. Otherwise spawn with `buildChangelogBrief({date})`.
 *
 * `readChangelog` may throw `ENOENT` on a fresh checkout; that's treated
 * as an empty file (the gate then fires) — rule #7 graceful-degrade. Other
 * errors propagate up so the daemon's let-it-crash policy applies.
 *
 * No lock primitive: the gate IS the lock. Two iterations within the same
 * second on the same process see the spawn's resulting CHANGELOG.md write
 * and the second skips. A spawn that crashes mid-write leaves the heading
 * absent and the next iteration retries — that's the desired property.
 *
 * @otel tick-loop.changelog.run
 */
export async function runChangelog(args: RunChangelogArgs): Promise<RunChangelogOutcome> {
  if (args.env["MINSKY_CHANGELOG"] === "off") {
    return { outcome: "skipped", reason: "env-disabled" };
  }

  const changelogContent = readChangelogOrEmpty(args.readChangelog);
  const fire = shouldFireChangelog({ date: args.date, changelogContent, env: args.env });
  if (!fire) {
    return { outcome: "skipped", reason: "already-fired" };
  }

  const brief = buildChangelogBrief({ date: args.date });
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

function readChangelogOrEmpty(read: () => string): string {
  try {
    return read();
  } catch (err) {
    if (isEnoent(err)) return "";
    throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}
