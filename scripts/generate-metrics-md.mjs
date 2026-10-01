#!/usr/bin/env node
// Pattern: pure builder / strategy seam — same shape as
// `generate-changelog-entry.mjs` (rule #2). Daemon-side I/O wrapper +
// CI freshness lint compose with this renderer; this module never
// reads OTEL, files, or env.
// Source: 2026-05-05 user request — "every minsky repo must have a
//   list of important metrics … always be visible and updated …
//   super critical not to have wrong data or useless metrics."
// Anchor: Card & Mackinlay 1999 (10-metric glanceable display);
//   Ries 2011 (vanity-metric anti-pattern); rule #2 (one source of
//   truth — `SUCCESS_METRICS` is canonical, this renderer projects);
//   rule #10 (deterministic).
// Pivot (rule #9): if the static render's mean operator-glance time
//   exceeds 10s for 10 metrics, restructure to a table — don't retire.
// Conformance: full — pure data-in/string-out. The CLI wrapper at the
//   bottom is the only I/O surface.

/**
 * @typedef {Object} SuccessMetricLike
 * @property {string} id
 * @property {string} label
 * @property {string} unit
 * @property {string} formula
 * @property {number} freshnessBudgetMs
 * @property {"ok"} [monotonic]
 * @property {string} goal     verbatim from vision.md § "Success criteria" success-threshold cell
 * @property {string} pivot    verbatim from vision.md § "Success criteria" pivot-threshold cell
 * @property {string} anchor   literature anchor for the metric choice
 * @property {string} [milestone] which milestone gates this metric to "must-be-observed"
 */

/**
 * @typedef {Object} ProposedMetricLike
 * @property {string} id
 * @property {string} label
 * @property {string} rationale  why this metric belongs on the dashboard
 * @property {string} milestone  which milestone introduces it
 * @property {string} [blockedBy] task id that lands the collector
 * @property {string} formula    sketch of the future collection formula
 */

/**
 * @typedef {Object} Observation
 * @property {string | number} value
 * @property {number} timestampMs  epoch ms — the moment the observation
 *   was captured (not generation time)
 * @property {string} [source]     short pointer (script path / OTEL query)
 *   shown in the `_Updated:` line
 * @property {boolean} [previouslyObserved] for monotonic check: was this
 *   metric ever observed at a lower value? Pure builder leaves this
 *   field for the no-vanity lint to verify; absent here.
 */

/**
 * @typedef {Object} BuildMetricsMdInput
 * @property {ReadonlyArray<SuccessMetricLike>} metrics
 * @property {Readonly<Record<string, Observation>>} [observations] keyed by metric id
 * @property {number} [nowMs] for staleness — pure: caller supplies the clock
 * @property {string} [stubFollowUp] task id or PR pointer rendered next to
 *   each `(stub)` so an unobserved metric never reads as a silent zero;
 *   defaults to `canonical-metric-list-per-repo follow-up`
 * @property {ReadonlyArray<ProposedMetricLike>} [proposedMetrics] metrics
 *   that should exist on the dashboard but don't yet — rendered in a
 *   trailing `## Metrics to add` section so the reader sees the gap
 *   explicitly. Operator directive 2026-05-21.
 * @property {Readonly<Record<string, string>>} [priorRawValues]
 *   Map of metric id → the verbatim `**Value:**` text from a prior
 *   rendered `METRICS.md`. When a metric has no fresh observation but
 *   `priorRawValues[id]` is a NON-stub value, render the prior value
 *   with a carry-forward annotation instead of overwriting it with
 *   `(stub)`. A genesis-mode all-stub render against a real
 *   `docs/METRICS.md` would otherwise downgrade committed values to
 *   stubs, which flips the pre-push milestone-alignment gate red and
 *   wedges every contributor.
 *   Same input → same output (rule #10): the prior values are an
 *   explicit input, not implicit on-disk state.
 */

/** ms in one day */
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_STUB_FOLLOW_UP = "wired in canonical-metric-list-per-repo follow-up";

/**
 * Decide whether `obs` is fresh given `metric.freshnessBudgetMs` and the
 * caller-supplied `nowMs`. Pure: same input → same output.
 *
 * @param {SuccessMetricLike} metric
 * @param {Observation | undefined} obs
 * @param {number} nowMs
 * @returns {"missing" | "stale" | "fresh"}
 */
export function classifyFreshness(metric, obs, nowMs) {
  if (obs === undefined) return "missing";
  const ageMs = nowMs - obs.timestampMs;
  if (ageMs < 0) return "fresh"; // future timestamp — treat as fresh, lint flags absurd values
  return ageMs <= metric.freshnessBudgetMs ? "fresh" : "stale";
}

/**
 * @param {number} ms
 * @returns {string}
 */
function humanizeBudget(ms) {
  if (ms >= DAY_MS) {
    const days = ms / DAY_MS;
    return `${days}d`;
  }
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours}h`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
function isoUtc(ms) {
  // YYYY-MM-DDTHH:mm:ssZ — millisecond precision is operational noise
  // for a daily render.
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build the bracketed milestone tag for a section header, or empty string
 * if the metric has no milestone (older entries pre-2026-05-21).
 *
 * @param {SuccessMetricLike} metric
 * @returns {string}
 */
function milestoneTag(metric) {
  return metric.milestone ? ` · Milestone: ${metric.milestone}` : "";
}

/**
 * Render the three explicit-fields block (How to view / Goal / Pivot /
 * Anchor) that follows every metric's Value line. Operator directive
 * 2026-05-21 — each metric tells the reader how to view it now, what the
 * goal is, when to walk away, and why this metric was chosen.
 *
 * TypeScript already requires `goal`, `pivot`, `anchor` as non-optional
 * `string`s on the metrics.ts interface, but `string` allows `""`. This
 * runtime check rejects empty values so the operator directive
 * ("every metric tells you when to walk away") survives a future hand-
 * edit that bypasses the type. Throwing here makes the error visible at
 * render time (and in `scripts/metrics-render.test.mjs` smoke runs),
 * not at the moment a reader notices an empty section in METRICS.md.
 *
 * @param {SuccessMetricLike} metric
 * @returns {string}
 */
function renderExplicitFields(metric) {
  /** @type {ReadonlyArray<{ name: "goal" | "pivot" | "anchor", value: string }>} */
  const fields = [
    { name: "goal", value: metric.goal },
    { name: "pivot", value: metric.pivot },
    { name: "anchor", value: metric.anchor },
  ];
  for (const { name, value } of fields) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `metric '${metric.id}': empty or non-string ${name} (got ${JSON.stringify(value)}); every metric ships explicit goal + pivot + anchor (operator directive 2026-05-21; see novel/dashboard-web/src/metrics.ts type comments).`,
      );
    }
  }
  return [
    `**How to view:** \`${metric.formula}\``,
    "",
    `**Goal:** ${metric.goal}`,
    "",
    `**Pivot:** ${metric.pivot}`,
    "",
    `**Anchor:** ${metric.anchor}`,
  ].join("\n");
}

/**
 * Decide whether a prior raw value (the verbatim `**Value:**` line text
 * from a previously-rendered METRICS.md, with the leading marker
 * already stripped) represents a real observation worth carrying
 * forward. The two stub shapes the renderer emits both start with the
 * literal `(stub)` token; everything else is a real value.
 *
 * Pure — same input, same output.
 *
 * @param {string | undefined} raw
 * @returns {boolean}
 */
export function isCarryForwardCandidate(raw) {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  return !trimmed.startsWith("(stub)");
}

/**
 * @param {SuccessMetricLike} metric
 * @param {string} priorRawValue
 * @returns {string}
 */
function renderCarryForwardSection(metric, priorRawValue) {
  const monotonicTag = metric.monotonic === "ok" ? " · _monotonic: ok_" : "";
  return [
    `## ${metric.id} — ${metric.label}`,
    "",
    `_Carry-forward: prior value retained — no fresh observation today; rerun the collector to refresh · Budget: ${humanizeBudget(metric.freshnessBudgetMs)}${monotonicTag}${milestoneTag(metric)}_`,
    "",
    `**Value:** ${priorRawValue}`,
    "",
    renderExplicitFields(metric),
    "",
  ].join("\n");
}

/**
 * @param {SuccessMetricLike} metric
 * @param {Observation | undefined} obs
 * @param {number} nowMs
 * @param {string} stubFollowUp
 * @param {string | undefined} priorRawValue
 * @returns {string}
 */
function renderSection(metric, obs, nowMs, stubFollowUp, priorRawValue) {
  const freshness = classifyFreshness(metric, obs, nowMs);
  const monotonicTag = metric.monotonic === "ok" ? " · _monotonic: ok_" : "";
  const heading = `## ${metric.id} — ${metric.label}`;

  if (freshness === "fresh" && obs !== undefined) {
    const sourceTag = obs.source ? ` · Source: \`${obs.source}\`` : "";
    return [
      heading,
      "",
      `_Updated: ${isoUtc(obs.timestampMs)} · Budget: ${humanizeBudget(metric.freshnessBudgetMs)}${sourceTag}${monotonicTag}${milestoneTag(metric)}_`,
      "",
      `**Value:** ${obs.value} ${metric.unit}`,
      "",
      renderExplicitFields(metric),
      "",
    ].join("\n");
  }

  if (isCarryForwardCandidate(priorRawValue)) {
    return renderCarryForwardSection(metric, /** @type {string} */ (priorRawValue).trim());
  }

  const reason =
    freshness === "missing"
      ? `(stub) — no observation captured yet (${stubFollowUp})`
      : `(stub) — last observation older than ${humanizeBudget(metric.freshnessBudgetMs)} budget (${stubFollowUp})`;

  return [
    heading,
    "",
    `_Budget: ${humanizeBudget(metric.freshnessBudgetMs)}${monotonicTag}${milestoneTag(metric)}_`,
    "",
    `**Value:** ${reason}`,
    "",
    renderExplicitFields(metric),
    "",
  ].join("\n");
}

/**
 * Render one row of the `## Metrics to add` section. Operator directive
 * 2026-05-21 — surface the gap explicitly. Each row carries label +
 * milestone tag + rationale + the blocker task + the future formula.
 *
 * @param {ProposedMetricLike} proposed
 * @returns {string}
 */
function renderProposedSection(proposed) {
  const blocker = proposed.blockedBy
    ? `\n\n**Blocked by:** \`${proposed.blockedBy}\` in \`TASKS.md\`.`
    : "";
  return [
    `### ${proposed.id} — ${proposed.label}`,
    "",
    `_Milestone: ${proposed.milestone}_`,
    "",
    `**Why it belongs:** ${proposed.rationale}${blocker}`,
    "",
    `**Future formula:** \`${proposed.formula}\``,
    "",
  ].join("\n");
}

/**
 * Build the markdown METRICS.md document. Pure: same input → same output.
 *
 * @param {BuildMetricsMdInput} input
 * @returns {string}
 */
export function buildMetricsMd(input) {
  const { metrics, observations, nowMs, stubFollowUp, proposedMetrics, priorRawValues } = input;
  const followUp = stubFollowUp ?? DEFAULT_STUB_FOLLOW_UP;
  const clock = nowMs ?? 0;

  const sections = metrics.map((m) =>
    renderSection(m, observations?.[m.id], clock, followUp, priorRawValues?.[m.id]),
  );

  const header = [
    "# METRICS.md — canonical observability surface",
    "",
    "> Per-metric: how to view it right now, current value (or `(stub)` reason), goal, pivot threshold, and literature anchor. Operator directive 2026-05-21 — every metric tells the reader the four things explicitly, no implicit goals.",
    "",
    "_Generated by `node scripts/generate-metrics-md.mjs` from `SUCCESS_METRICS` + `PROPOSED_METRICS` in `novel/dashboard-web/src/metrics.ts`. Each entry is either a fresh observation (within its `freshnessBudgetMs`) or an explicit `(stub)`. Never a silent zero — wrong data is worse than no data (Ries 2011)._",
    "",
    '**How to read each section:** `Value` = current observation (or stub + the task that lands the collector); `How to view` = the exact shell / OTEL / git command (copy-paste reproducible); `Goal` = success threshold from `vision.md § "Success criteria"`; `Pivot` = threshold below which the _approach_ is reconsidered (Ries 2011 build-measure-learn); `Anchor` = literature justifying the metric choice. The trailing **Metrics to add** section lists what\'s missing.',
    "",
    "---",
    "",
  ].join("\n");

  const proposedSection =
    (proposedMetrics?.length ?? 0) > 0
      ? [
          "## Metrics to add",
          "",
          `_${proposedMetrics?.length} metrics that should exist on the dashboard but don't yet. Each row names the milestone that introduces it, the task that lands the collector, and a sketch of the future formula. Operator directive 2026-05-21 — gap is surfaced explicitly so the 10-metric set above is understood as the current state, not the steady state._`,
          "",
          ...(proposedMetrics ?? []).map(renderProposedSection),
        ].join("\n")
      : "";

  return [header, ...sections, proposedSection].join("\n");
}

// ---- CLI thin wrapper -------------------------------------------------
//
// Reads a JSON `BuildMetricsMdInput` from `--input <path>` or stdin and
// writes the markdown document to stdout. Defaults `nowMs` to
// `Date.now()` when absent.

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ input: string | null, now: string | null }} */
  const args = { input: null, now: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i] ?? null;
    else if (a === "--now") args.now = argv[++i] ?? null;
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
  if (parsed.nowMs === undefined) {
    parsed.nowMs = args.now ? Number(args.now) : Date.now();
  }
  process.stdout.write(buildMetricsMd(parsed));
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("generate-metrics-md.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
