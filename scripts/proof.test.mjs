// Tests for scripts/proof.mjs: the README Proof section must equal the
// generator output, and every metric must carry a date, a kind, and a command.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  merge,
  README_PATH,
  readMetrics,
  renderSection,
  replaceSection,
  totals,
} from "./proof.mjs";

describe("README Proof section", () => {
  it("equals what the generator writes from docs/proof/metrics.json", () => {
    const file = readMetrics();
    expect(file, "docs/proof/metrics.json is missing").toBeDefined();
    const readme = readFileSync(README_PATH, "utf8");
    if (!file) return;
    expect(replaceSection(readme, renderSection(file))).toBe(readme);
  });

  it("every metric has a value, date, data kind, command, and history", () => {
    const file = readMetrics();
    for (const [id, m] of Object.entries(file?.metrics ?? {})) {
      expect(m.date, `${id} date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.kind, `${id} kind`).toMatch(/^(real use|local run, \d{4}-\d{2}-\d{2}, .+)$/);
      expect(m.command, `${id} command`).toMatch(/^node scripts\/proof\.mjs collect/);
      expect(Number.isFinite(m.value), `${id} value`).toBe(true);
      expect(m.history.length, `${id} history`).toBeGreaterThan(0);
    }
    expect(Object.keys(file?.metrics ?? {}).length).toBeGreaterThan(0);
  });

  it("the Proof section sits right after Features and has a Mermaid chart", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const heads = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads[heads.indexOf("Features") + 1]).toBe("Proof");
    expect(readme).toContain("```mermaid");
  });
});

describe("proof totals", () => {
  it("counts runs, errors, and work rounds from usage events", () => {
    const t = totals([
      { command: "run", status: "ok" },
      { command: "solve", status: "error" },
      { command: "status", status: "ok" },
    ]);
    expect(t).toEqual({ runs: 3, ok: 2, errors: 1, work: 2, workOk: 1 });
  });

  it("appends history per date and replaces a same-day value", () => {
    const meta = { date: "2026-10-26", kind: "real use", n: 2 };
    const a = merge(undefined, totals([{ command: "run", status: "ok" }]), meta);
    const b = merge(
      a,
      totals([
        { command: "run", status: "ok" },
        { command: "run", status: "ok" },
      ]),
      meta,
    );
    const c = merge(b, totals([]), { ...meta, date: "2026-10-27" });
    expect(c.metrics["real_runs"]?.history).toEqual([
      { date: "2026-10-26", value: 2 },
      { date: "2026-10-27", value: 0 },
    ]);
  });

  it("a metric with no machines renders as not measured yet, never a number", () => {
    const file = merge(undefined, totals([]), { date: "2026-10-26", kind: "real use", n: 0 });
    expect(renderSection(file)).toContain(
      "| not measured yet (field recording on since 2026-10-26): 0 rounds |",
    );
  });
});

describe("posthog totals", () => {
  it("read counts and the distinct machine count from a fake query API", async () => {
    const { posthogTotals } = await import("./proof.mjs");
    const answers = [
      {
        results: [
          ["run", "ok", 2],
          ["run", "error", 1],
        ],
      },
      { results: [[2]] },
    ];
    const fetchImpl = async () => new Response(JSON.stringify(answers.shift()));
    const env = {
      MINSKY_POSTHOG_PERSONAL_KEY: "phx_fake",
      MINSKY_POSTHOG_PROJECT_ID: "1",
      MINSKY_POSTHOG_API: "http://fake.invalid",
    };
    const r = await posthogTotals(env, /** @type {any} */ (fetchImpl));
    expect(r?.n).toBe(2);
    expect(totals(r?.events ?? [])).toMatchObject({ runs: 3, errors: 1 });
  });

  it("returns undefined without a personal key", async () => {
    const { posthogTotals } = await import("./proof.mjs");
    expect(await posthogTotals({})).toBeUndefined();
  });
});
