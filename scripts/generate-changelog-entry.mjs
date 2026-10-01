#!/usr/bin/env node
// Pattern: pure builder / strategy seam (rule #2 — the daemon's
// `changelog-runner.ts` will be the I/O boundary; this module is the
// pure renderer it composes with).
// Source: 2026-05-05 user request — "implement a meaningful changelog
//   for humans … as a part of the minsky loop. It must show also which
//   metrics improved." Anchor: Card & Mackinlay 1999 (glanceable
//   historical-narrative display); rule #9 (the changelog IS the
//   post-hoc summary of pre-registered hypotheses).
// Conformance: full — pure data-in/string-out (rule #10 deterministic),
//   no I/O, no clock, no env reads inside the builder. The CLI wrapper
//   at the bottom is the only I/O surface.
// Pivot (rule #9): if direction labels are wrong >5% over 30d, tighten
//   per-metric `higherIsBetter` defaults. Don't retire the architecture
//   — narrative ergonomic value persists even with some delta errors.

/**
 * @typedef {Object} MergedPR
 * @property {number} number
 * @property {string} title
 * @property {number} additions
 * @property {number} deletions
 * @property {string} [summary]   one-line annotation rendered as a `>` blockquote
 * @property {boolean} [daemonAuthored] adds the "daemon-authored" tag
 */

/**
 * @typedef {Object} MetricEntry
 * @property {number} value
 * @property {boolean} [higherIsBetter] defaults to true; pass false for
 *   counters where a drop is good (self-diagnose findings, errors,
 *   stuck-PRs, regressions, etc.)
 * @property {(n: number) => string} [format] custom formatter for value
 *   + delta; defaults to `String(n)`
 */

/**
 * @typedef {Object} BuildChangelogEntryInput
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {ReadonlyArray<MergedPR>} mergedPRs ordered as they should appear
 * @property {Readonly<Record<string, MetricEntry>>} [metricsSnapshot] today's
 * @property {Readonly<Record<string, MetricEntry>>} [prevMetricsSnapshot] prior
 *   day's snapshot; if absent, metrics render without a Δ line
 * @property {string} [narrativeOverride] when present, replaces the auto-
 *   synthesised paragraph (this is what the daemon's claude --print fills in)
 */

/**
 * Classify a delta as improved / regressed / unchanged. The two-arg shape is
 * stable so callers can decide direction per-metric.
 *
 * @param {number} delta
 * @param {boolean} higherIsBetter
 * @returns {"improved" | "regressed" | "unchanged"}
 */
export function classifyDirection(delta, higherIsBetter) {
  if (delta === 0) return "unchanged";
  const positive = delta > 0;
  return positive === higherIsBetter ? "improved" : "regressed";
}

/**
 * Default narrative when no override is supplied. One sentence per PR title,
 * grouped — small enough to be useful, dumb enough not to lie.
 *
 * @param {ReadonlyArray<MergedPR>} mergedPRs
 * @returns {string}
 */
export function synthesizeNarrative(mergedPRs) {
  if (mergedPRs.length === 0) {
    return "No PRs merged today.";
  }
  const first = mergedPRs[0];
  if (mergedPRs.length === 1 && first !== undefined) {
    return `Single PR shipped: ${first.title}.`;
  }
  const titles = mergedPRs.map((p) => `#${p.number} (${p.title})`).join("; ");
  return `${mergedPRs.length} PRs shipped today: ${titles}.`;
}

/**
 * @param {MetricEntry} entry
 * @returns {string}
 */
function formatValue(entry) {
  return entry.format ? entry.format(entry.value) : String(entry.value);
}

/**
 * @param {number} delta
 * @param {((n: number) => string) | undefined} format
 * @returns {string}
 */
function formatDelta(delta, format) {
  const fn = format ?? String;
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}${fn(Math.abs(delta))}`;
}

/**
 * @param {MergedPR} pr
 * @returns {string}
 */
function renderPRBullet(pr) {
  const tag = pr.daemonAuthored ? " — _daemon-authored_" : "";
  const line = `- **#${pr.number}** — \`${pr.title}\` _(+${pr.additions}/-${pr.deletions})_${tag}`;
  if (!pr.summary) return line;
  return `${line}\n  > ${pr.summary}`;
}

/**
 * @param {string} name
 * @param {MetricEntry} today
 * @param {MetricEntry | undefined} prev
 * @returns {string}
 */
function renderMetricLine(name, today, prev) {
  const higherIsBetter = today.higherIsBetter ?? true;
  const todayStr = formatValue(today);
  if (prev === undefined) {
    return `- **${name}**: ${todayStr}`;
  }
  const delta = today.value - prev.value;
  const direction = classifyDirection(delta, higherIsBetter);
  const prevStr = formatValue(prev);
  const deltaStr = formatDelta(delta, today.format ?? prev.format);
  return `- **${name}**: ${prevStr} → ${todayStr} _(Δ ${deltaStr}, **${direction}**)_`;
}

/**
 * Build a markdown CHANGELOG.md section for `date`. Pure: same input → same
 * output, no I/O.
 *
 * @param {BuildChangelogEntryInput} input
 * @returns {string}
 */
export function buildChangelogEntry(input) {
  const { date, mergedPRs, metricsSnapshot, prevMetricsSnapshot, narrativeOverride } = input;

  const shippedSection =
    mergedPRs.length === 0
      ? "_No PRs merged on this date._"
      : mergedPRs.map(renderPRBullet).join("\n");

  const metricsEntries = metricsSnapshot ? Object.entries(metricsSnapshot) : [];
  const metricsSection =
    metricsEntries.length === 0
      ? "_No metrics recorded for this date._"
      : metricsEntries
          .map(([name, today]) => renderMetricLine(name, today, prevMetricsSnapshot?.[name]))
          .join("\n");

  const narrative = narrativeOverride ?? synthesizeNarrative(mergedPRs);

  return [
    `## ${date}`,
    "",
    "### What shipped",
    "",
    shippedSection,
    "",
    "### Metrics",
    "",
    metricsSection,
    "",
    "### Day's narrative",
    "",
    narrative,
    "",
  ].join("\n");
}

/**
 * Structured JSON view of the same input. CLI `--json` mode emits this so
 * downstream tooling (and the rule-#9 measurement command) can pick out
 * `.mergedPRs.length` without parsing markdown.
 *
 * @param {BuildChangelogEntryInput} input
 */
export function buildChangelogJson(input) {
  const { date, mergedPRs, metricsSnapshot, prevMetricsSnapshot, narrativeOverride } = input;
  const metricsEntries = metricsSnapshot ? Object.entries(metricsSnapshot) : [];
  return {
    date,
    mergedPRs: mergedPRs.map((p) => ({
      number: p.number,
      title: p.title,
      additions: p.additions,
      deletions: p.deletions,
      summary: p.summary ?? null,
      daemonAuthored: p.daemonAuthored ?? false,
    })),
    metrics: metricsEntries.map(([name, today]) => {
      const prev = prevMetricsSnapshot?.[name];
      const higherIsBetter = today.higherIsBetter ?? true;
      if (prev === undefined) {
        return {
          name,
          value: today.value,
          higherIsBetter,
          prev: null,
          delta: null,
          direction: null,
        };
      }
      const delta = today.value - prev.value;
      return {
        name,
        value: today.value,
        higherIsBetter,
        prev: prev.value,
        delta,
        direction: classifyDirection(delta, higherIsBetter),
      };
    }),
    narrative: narrativeOverride ?? synthesizeNarrative(mergedPRs),
    narrativeOverridden: narrativeOverride !== undefined,
  };
}

// ---- CLI thin wrapper -------------------------------------------------
//
// Reads a JSON BuildChangelogEntryInput from `--input <path>` or stdin and
// writes either the markdown section (default) or the structured JSON
// (`--json`) to stdout. Exit code is 0 on success. The operator-side
// pipeline `pnpm changelog:today` (`scripts/changelog-today.mjs`) supplies
// the gh-PR-fetching seam and pipes through this renderer.

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ json: boolean, input: string | null, date: string | null }} */
  const args = { json: false, input: null, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--input") args.input = argv[++i] ?? null;
    else if (a === "--date") args.date = argv[++i] ?? null;
  }
  return args;
}

/**
 * @param {string | null} argInput
 * @returns {Promise<string>}
 */
async function readInput(argInput) {
  if (argInput) {
    const { readFile } = await import("node:fs/promises");
    return await readFile(argInput, "utf8");
  }
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readInput(args.input);
  const parsed = JSON.parse(raw);
  if (args.date) parsed.date = args.date;
  if (args.json) {
    process.stdout.write(`${JSON.stringify(buildChangelogJson(parsed), null, 2)}\n`);
  } else {
    process.stdout.write(buildChangelogEntry(parsed));
  }
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("generate-changelog-entry.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
