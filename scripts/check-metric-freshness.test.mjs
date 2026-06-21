// Tests for `check-metric-freshness.mjs`. Pattern: paired
// positive/negative fixtures over a pure decision (Meszaros 2007;
// rule #10 — same input, same output). Mirrors `check-pr-self-grade.test.mjs`.

import { describe, expect, test } from "vitest";

import { checkMetricFreshness } from "./check-metric-freshness.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 4, 5, 12, 0, 0);

/**
 * Helper: render one section in the canonical shape the genesis
 * `METRICS.md` uses. Mirrors `generate-metrics-md.mjs`'s output so
 * the tests pin the contract end-to-end.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} [opts.label]
 * @param {string} [opts.budget]      e.g., "7d", "1d"
 * @param {boolean} [opts.monotonic]
 * @param {string} [opts.updated]     iso-utc — when present, renders
 *   the fresh-observation shape; otherwise renders the stub shape
 * @param {string} [opts.value]       defaults to `(stub) — …` when
 *   `updated` is absent, otherwise to a real number+unit
 * @param {string} [opts.source]
 */
function section(opts) {
  const {
    id,
    label = `${id} label`,
    budget = "7d",
    monotonic = false,
    updated,
    value,
    source,
  } = opts;
  const monoTag = monotonic ? " · _monotonic: ok_" : "";
  if (updated) {
    const sourceTag = source ? ` · Source: \`${source}\`` : "";
    const renderedValue = value ?? "0.97 fraction";
    return [
      `## ${id} — ${label}`,
      "",
      `_Updated: ${updated} · Budget: ${budget}${sourceTag}${monoTag}_`,
      "",
      `**Value:** ${renderedValue}`,
      "",
      `Formula: \`echo ${id}\``,
      "",
    ].join("\n");
  }
  const renderedStub =
    value ??
    "(stub) — no observation captured yet (wired in canonical-metric-list-per-repo follow-up)";
  return [
    `## ${id} — ${label}`,
    "",
    `_Budget: ${budget}${monoTag}_`,
    "",
    `**Value:** ${renderedStub}`,
    "",
    `Formula: \`echo ${id}\``,
    "",
  ].join("\n");
}

const PREAMBLE = "# METRICS.md — canonical observability surface\n\nGenesis preamble.\n\n";

describe("checkMetricFreshness — happy paths", () => {
  test("all-stub document → ok (visible-not-silent default)", () => {
    const md = PREAMBLE + section({ id: "loop-uptime" }) + section({ id: "mttr", budget: "1d" });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  test("fresh observation within budget → ok", () => {
    const md =
      PREAMBLE +
      section({
        id: "loop-uptime",
        budget: "7d",
        updated: "2026-05-05T11:00:00Z",
        value: "0.97 fraction",
      });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  test("observation taken exactly at the budget edge → ok (inclusive)", () => {
    const sevenDaysAgo = new Date(NOW - 7 * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const md =
      PREAMBLE +
      section({ id: "loop-uptime", budget: "7d", updated: sevenDaysAgo, value: "0.95 fraction" });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  test("monotonic-tagged stub section → ok (extraction-count shape)", () => {
    const md = PREAMBLE + section({ id: "extraction-count", budget: "30d", monotonic: true });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  test("expectedIds matches rendered ids exactly → ok", () => {
    const md = PREAMBLE + section({ id: "a" }) + section({ id: "b" });
    const result = checkMetricFreshness({
      markdown: md,
      nowMs: NOW,
      expectedIds: ["a", "b"],
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkMetricFreshness — failure paths", () => {
  test("real value without `_Updated:` → fails (unannotated)", () => {
    const md = [
      PREAMBLE,
      "## loop-uptime — Loop uptime",
      "",
      "_Budget: 7d_",
      "",
      "**Value:** 0.97 fraction",
      "",
      "Formula: `echo loop-uptime`",
      "",
    ].join("\n");
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.includes("loop-uptime") && e.includes("no `_Updated:")),
    ).toBe(true);
  });

  test("observation older than budget → fails (stale)", () => {
    const eightDaysAgo = new Date(NOW - 8 * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const md =
      PREAMBLE +
      section({ id: "loop-uptime", budget: "7d", updated: eightDaysAgo, value: "0.91 fraction" });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /stale/.test(e) && e.includes("loop-uptime"))).toBe(true);
  });

  test("run-relative: nowMs=null → the same stale observation is NOT flagged (minsky not always-on)", () => {
    const eightDaysAgo = new Date(NOW - 8 * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const md =
      PREAMBLE +
      section({ id: "loop-uptime", budget: "7d", updated: eightDaysAgo, value: "0.91 fraction" });
    // null clock = no run history / no marker → staleness skipped, structural checks still run.
    const result = checkMetricFreshness({ markdown: md, nowMs: null });
    expect(result.ok).toBe(true);
  });

  test("run-relative: nowMs=null still flags a real value missing `_Updated:` (structural)", () => {
    const md = PREAMBLE + section({ id: "loop-uptime", budget: "7d", value: "0.91 fraction" });
    const result = checkMetricFreshness({ markdown: md, nowMs: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.includes("loop-uptime") && e.includes("no `_Updated:")),
    ).toBe(true);
  });

  test("`Budget:` annotation missing entirely → fails (malformed)", () => {
    const md = [
      PREAMBLE,
      "## loop-uptime — Loop uptime",
      "",
      "_Updated: 2026-05-05T11:00:00Z_",
      "",
      "**Value:** 0.97 fraction",
      "",
      "Formula: `echo loop-uptime`",
      "",
    ].join("\n");
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Budget"))).toBe(true);
  });

  test("`**Value:**` line missing → fails", () => {
    const md = [
      PREAMBLE,
      "## loop-uptime — Loop uptime",
      "",
      "_Updated: 2026-05-05T11:00:00Z · Budget: 7d_",
      "",
      "Formula: `echo loop-uptime`",
      "",
    ].join("\n");
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /Value:/.test(e))).toBe(true);
  });

  test("duplicate section ids → fails", () => {
    const md = PREAMBLE + section({ id: "loop-uptime" }) + section({ id: "loop-uptime" });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /duplicate id/.test(e))).toBe(true);
  });

  test("expectedIds contains an id not rendered → fails (missing)", () => {
    const md = PREAMBLE + section({ id: "loop-uptime" });
    const result = checkMetricFreshness({
      markdown: md,
      nowMs: NOW,
      expectedIds: ["loop-uptime", "mttr"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => /missing from .*METRICS\.md/.test(e) && e.includes("mttr")),
    ).toBe(true);
  });

  test("rendered id absent from expectedIds → fails (drift)", () => {
    const md = PREAMBLE + section({ id: "loop-uptime" }) + section({ id: "rogue-metric" });
    const result = checkMetricFreshness({
      markdown: md,
      nowMs: NOW,
      expectedIds: ["loop-uptime"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /drift/.test(e) && e.includes("rogue-metric"))).toBe(true);
  });

  test("multiple violations are collected, not short-circuited", () => {
    const eightDaysAgo = new Date(NOW - 8 * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const md =
      PREAMBLE +
      section({ id: "a", budget: "7d", updated: eightDaysAgo, value: "0.5 fraction" }) +
      section({ id: "b", budget: "7d", updated: eightDaysAgo, value: "0.7 fraction" });
    const result = checkMetricFreshness({ markdown: md, nowMs: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("checkMetricFreshness — current METRICS.md", () => {
  test("the actual METRICS.md file (mix of real observations + gaps) verifies clean", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "..");
    const md = await readFile(resolve(repoRoot, "docs/METRICS.md"), "utf8");
    const result = checkMetricFreshness({ markdown: md, nowMs: Date.now() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // METRICS.md renders the SUCCESS_METRICS array. The literal count
    // (currently 11 — 10 vision.md success criteria + `cross-repo-pr-rate`
    // added in PR #790) is read from the live source so this test never
    // freezes the count when a new metric ships.
    const { SUCCESS_METRICS } = await import("../novel/dashboard-web/dist/metrics.js");
    expect(result.sections.length).toBe(SUCCESS_METRICS.length);
  });

  test("expectedIds against the live SUCCESS_METRICS ids → ok", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "..");
    const md = await readFile(resolve(repoRoot, "docs/METRICS.md"), "utf8");
    // Read `expectedIds` from the live `SUCCESS_METRICS` source so any
    // metric added in `novel/dashboard-web/src/metrics.ts` is auto-
    // included here. Previously this test hand-listed 10 ids; the
    // `cross-repo-pr-rate` metric (PR #790) drifted out of sync until
    // the freshness lint surfaced it after PR
    // `fix/metrics-render-default-output-docs-path` refreshed the
    // canonical `docs/METRICS.md`.
    const { SUCCESS_METRICS } = await import("../novel/dashboard-web/dist/metrics.js");
    const expectedIds = SUCCESS_METRICS.map((m) => m.id);
    const result = checkMetricFreshness({
      markdown: md,
      nowMs: Date.now(),
      expectedIds,
    });
    expect(result.ok).toBe(true);
  });
});
