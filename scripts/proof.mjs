#!/usr/bin/env node
// @ts-check
// proof — turns field usage events into the README `## Proof` section.
//
//   node scripts/proof.mjs collect [--kind "<data kind>"]  → docs/proof/metrics.json
//   node scripts/proof.mjs render [--check]               → README.md proof block
//
// `collect` reads totals from PostHog's query API when the owner set
// MINSKY_POSTHOG_PERSONAL_KEY and MINSKY_POSTHOG_PROJECT_ID (data kind
// `real use`, n = distinct install ids). Otherwise it reads this machine's
// `usage.jsonl` (scripts/usage-events.mjs) and labels the data
// `local run, <date>, machine <hash>`; the label is a salted hash, never a
// host or user name. Only counts leave this script: never content or paths.
// Each run appends to a per-metric history, so trends survive.
//
// `render` writes the section between `<!-- proof:start -->` and
// `<!-- proof:end -->`; `--check` exits 1 when the README differs
// (scripts/proof.test.mjs runs it in the gate).
//
// Pattern: generated docs from a single source of truth (Hunt & Thomas,
// *The Pragmatic Programmer*, 1999, "DRY"); Goal-Question-Metric (Basili
// et al., 1994) for picking one outcome metric per claim.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEvents, stateDir } from "./usage-events.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const METRICS_PATH = join(REPO, "docs", "proof", "metrics.json");
export const README_PATH = join(REPO, "README.md");
export const START = "<!-- proof:start -->";
export const END = "<!-- proof:end -->";
const COLLECT = "node scripts/proof.mjs collect";
const SINCE = "field recording on since 2026-10-26";
/** Commands that do the core job: one round of work on a host. */
export const WORK = new Set(["run", "solve", "transform", "iter-once"]);

/**
 * @typedef {{ value: number, unit: string, date: string, kind: string, command: string, n: number, history: { date: string, value: number }[] }} Metric
 * @typedef {{ generated: string, metrics: Record<string, Metric> }} MetricsFile
 * @typedef {{ command: string, status: string }} Ev
 */

/** A salted machine label: never a host or user name. @param {NodeJS.ProcessEnv} [env] */
export function machineLabel(env = process.env) {
  const dir = stateDir(env);
  const saltPath = join(dir, "machine-salt");
  if (!existsSync(saltPath)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(saltPath, `${randomBytes(32).toString("base64")}\n`, { mode: 0o600 });
  }
  const salt = readFileSync(saltPath, "utf8").trim();
  return createHash("sha256").update(`${salt}:proof`).digest("hex").slice(0, 8);
}

/** Totals from usage events. @param {Ev[]} events */
export function totals(events) {
  const work = events.filter((e) => WORK.has(e.command));
  const ok = events.filter((e) => e.status === "ok").length;
  const workOk = work.filter((e) => e.status === "ok").length;
  return {
    runs: events.length,
    ok,
    errors: events.length - ok,
    work: work.length,
    workOk,
  };
}

/** @param {number} part @param {number} whole */
const pct = (part, whole) => (whole === 0 ? 0 : Math.round((1000 * part) / whole) / 10);

/**
 * Merge new totals into the metrics file, appending history.
 * @param {MetricsFile | undefined} prev @param {ReturnType<typeof totals>} t
 * @param {{ date: string, kind: string, n: number }} meta
 * @returns {MetricsFile}
 */
export function merge(prev, t, { date, kind, n }) {
  /** @type {Record<string, [number, string]>} */
  const values = {
    real_runs: [t.runs, "runs"],
    run_success: [pct(t.ok, t.runs), "%"],
    run_errors: [t.errors, "runs"],
    work_rounds: [t.work, "rounds"],
    work_success: [pct(t.workOk, t.work), "%"],
  };
  /** @type {Record<string, Metric>} */
  const metrics = {};
  for (const [id, [value, unit]] of Object.entries(values)) {
    const history = (prev?.metrics[id]?.history ?? []).filter((h) => h.date !== date);
    history.push({ date, value });
    metrics[id] = { value, unit, date, kind, command: COLLECT, n, history };
  }
  return { generated: date, metrics };
}

/**
 * Totals from PostHog's HogQL query API, or undefined when no personal key.
 * @param {NodeJS.ProcessEnv} env @param {typeof fetch} [fetchImpl]
 */
export async function posthogTotals(env, fetchImpl = fetch) {
  const key = env["MINSKY_POSTHOG_PERSONAL_KEY"];
  const project = env["MINSKY_POSTHOG_PROJECT_ID"];
  if (!key || !project) return undefined;
  const host = env["MINSKY_POSTHOG_API"] || "https://eu.posthog.com";
  const query =
    "SELECT properties.command, properties.status, count() FROM events WHERE event = 'minsky.command' GROUP BY properties.command, properties.status";
  const res = await fetchImpl(`${host}/api/projects/${project}/query/`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) throw new Error(`posthog query: http ${res.status}`);
  /** @type {{ results: [string, string, number][] }} */
  const body = /** @type {any} */ (await res.json());
  /** @type {Ev[]} */
  const events = [];
  for (const [command, status, count] of body.results) {
    for (let i = 0; i < count; i++) events.push({ command, status });
  }
  // Distinct install ids over all events: the machine count n.
  const nRes = await fetchImpl(`${host}/api/projects/${project}/query/`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query: "SELECT uniq(distinct_id) FROM events WHERE event = 'minsky.command'",
      },
    }),
  });
  if (!nRes.ok) throw new Error(`posthog query: http ${nRes.status}`);
  const n = Number(/** @type {any} */ (await nRes.json()).results?.[0]?.[0] ?? 0);
  return { events, n };
}

/**
 * A result cell; "not measured yet" when no machine or no event backs it.
 * @param {Metric | undefined} m @param {Metric | undefined} base @param {string} what
 */
function result(m, base, what) {
  const count = base?.value ?? 0;
  if (!m || m.n === 0 || count === 0) return `not measured yet (${SINCE}): 0 ${what}`;
  return `${m.value} ${m.unit} of ${count} ${what}`;
}

/** @param {Metric | undefined} m */
function source(m) {
  return m ? `\`docs/proof/metrics.json\`, ${m.kind}, n=${m.n}` : "none";
}

/**
 * The README proof block, from the metrics file.
 * @param {MetricsFile} file
 */
export function renderSection(file) {
  const m = file.metrics;
  const rows = [
    [
      "Works through `TASKS.md` unattended",
      "Unattended rounds must finish ok; MTBF thinking (Nygard, *Release It!*, 2018)",
      "Share of work rounds (`run`, `solve`, `transform`) that exit 0",
      result(m["work_success"], m["work_rounds"], "rounds"),
      source(m["work_success"]),
    ],
    [
      "Reports stability (restarts not measured yet)",
      "Errors per real run should stay low (Google SRE, 2016, error budgets)",
      "Share of all real `minsky` runs that exit 0",
      result(m["run_success"], m["real_runs"], "runs"),
      source(m["run_success"]),
    ],
    [
      "Ships each result as a **draft PR**",
      "A reviewable PR per round is the product (Forsgren et al., *Accelerate*, 2018)",
      "Draft PRs opened per work round",
      `not measured yet (${SINCE}); task \`proof-draft-prs-per-round\``,
      "none",
    ],
    [
      "Blocks destructive operations",
      "Guardrails must fire, not only exist (Reason, *Human Error*, 1990)",
      "Destructive commands blocked per work round",
      `not measured yet (${SINCE}); task \`proof-destructive-blocks\``,
      "none",
    ],
  ];
  const table = [
    "| Claim | Theory | Metric | Result | Source |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
  const ok = (m["real_runs"]?.value ?? 0) - (m["run_errors"]?.value ?? 0);
  const chart = [
    "```mermaid",
    `pie title Real minsky runs by exit (${m["real_runs"]?.kind ?? "no data"})`,
    `  "ok" : ${ok}`,
    `  "error" : ${m["run_errors"]?.value ?? 0}`,
    "```",
  ].join("\n");
  return [
    START,
    "Numbers come from content-free usage counts ([how and privacy](docs/proof/README.md)). Until field data arrives, a row shows a local run and names it.",
    "",
    table,
    "",
    chart,
    END,
  ].join("\n");
}

/** Replace the block in a README text. @param {string} readme @param {string} section */
export function replaceSection(readme, section) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error("README.md has no proof:start/proof:end block");
  return readme.slice(0, a) + section + readme.slice(b + END.length);
}

/** @param {string} path @returns {MetricsFile | undefined} */
export function readMetrics(path = METRICS_PATH) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** @param {string[]} argv @param {string} flag */
function arg(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [verb, ...rest] = process.argv.slice(2);
  // The local date, so an evening run is dated the day the owner sees.
  const date = new Date().toLocaleDateString("en-CA");
  if (verb === "collect") {
    const field = await posthogTotals(process.env);
    const events = field ? field.events : /** @type {Ev[]} */ (readEvents());
    const kind = field
      ? "real use"
      : (arg(rest, "--kind") ?? `local run, ${date}, machine ${machineLabel()}`);
    const n = field ? field.n : events.length > 0 ? 1 : 0;
    const out = merge(readMetrics(), totals(events), { date, kind, n });
    mkdirSync(dirname(METRICS_PATH), { recursive: true });
    writeFileSync(METRICS_PATH, `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `proof: ${out.metrics["real_runs"]?.value} runs, n=${n}, ${kind} → docs/proof/metrics.json`,
    );
  } else if (verb === "render") {
    const file = readMetrics();
    if (!file) {
      console.error(
        "proof: docs/proof/metrics.json is missing; run `node scripts/proof.mjs collect` first",
      );
      process.exit(1);
    }
    const readme = readFileSync(README_PATH, "utf8");
    const next = replaceSection(readme, renderSection(file));
    if (rest.includes("--check")) {
      if (next !== readme) {
        console.error(
          "proof: the README Proof section is stale; run `node scripts/proof.mjs render`",
        );
        process.exit(1);
      }
      console.log("proof: README Proof section is current");
    } else {
      writeFileSync(README_PATH, next);
      console.log("proof: README Proof section written");
    }
  } else {
    console.error("usage: proof.mjs collect [--kind <kind>] | render [--check]");
    process.exit(2);
  }
}
