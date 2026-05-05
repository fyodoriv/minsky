import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MaciekTokenMonitor, PLAN_CAPS } from "./maciek.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(HERE, "..", "test", "fixtures");

describe("MaciekTokenMonitor", () => {
  it("single-block fixture: 3000 tokens used → cap−3000 remaining for max5", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "single-block"),
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5 - 3000);
    expect(s.windowSizeTokens).toBe(PLAN_CAPS.max5);
    expect(s.secondsUntilWindowReset).toBe(14_400); // 4h to block end
    expect(s.observedAt).toBe("2026-05-04T12:00:00.000Z");
  });

  it("two-blocks fixture: only the active block's tokens count (gap >5h splits clusters)", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "two-blocks"),
      now: () => new Date("2026-05-04T14:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    // Active block has 3000 tokens; the prior 10 000-token block is dropped.
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5 - 3000);
    expect(s.windowSizeTokens).toBe(PLAN_CAPS.max5);
  });

  it("empty fixture: no JSONL entries → returns full plan cap as remaining (cold start)", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "empty"),
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5);
    expect(s.windowSizeTokens).toBe(PLAN_CAPS.max5);
    expect(s.secondsUntilWindowReset).toBe(5 * 60 * 60);
  });

  it("malformed JSONL line: parser skips bad lines without throwing (rule #7)", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "malformed"),
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    // The promise must resolve (no throw on bad JSON).
    await expect(tm.snapshot()).resolves.toBeTruthy();
    const s = await tm.snapshot();
    // Two valid entries (1000 + 2000 = 3000 tokens) survive.
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5 - 3000);
  });

  it("plan-cap variance: same fixture, plan=pro vs plan=max20 yields different remaining", async () => {
    const cfg = resolve(FIXTURE_ROOT, "single-block");
    const now = () => new Date("2026-05-04T12:00:00.000Z");
    const pro = await new MaciekTokenMonitor({ configDir: cfg, now, plan: "pro" }).snapshot();
    const max20 = await new MaciekTokenMonitor({ configDir: cfg, now, plan: "max20" }).snapshot();

    expect(pro.windowSizeTokens).toBe(PLAN_CAPS.pro);
    expect(pro.tokensRemainingInWindow).toBe(PLAN_CAPS.pro - 3000);

    expect(max20.windowSizeTokens).toBe(PLAN_CAPS.max20);
    expect(max20.tokensRemainingInWindow).toBe(PLAN_CAPS.max20 - 3000);

    expect(pro.tokensRemainingInWindow).not.toBe(max20.tokensRemainingInWindow);
  });

  it("dedup: same (message.id, requestId) across two files counts once", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "dedup"),
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    // Each file contributes 3000 tokens; without dedup → 6000 used.
    // With dedup → 3000 used → cap − 3000 remaining.
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5 - 3000);
  });

  it("missing config dir: returns full plan cap (cold-start) without throwing", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: "/nonexistent/path/that/should/not/exist/anywhere",
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5);
    expect(s.windowSizeTokens).toBe(PLAN_CAPS.max5);
  });

  it("plan defaults to max5 when no plan opt is supplied", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "single-block"),
      now: () => new Date("2026-05-04T12:00:00.000Z"),
    });
    const s = await tm.snapshot();
    expect(s.windowSizeTokens).toBe(PLAN_CAPS.max5);
  });

  it("now defaults to a real Date when not injected", async () => {
    // Use a temp dir so we don't read the user's real ~/.claude.
    const tmp = mkdtempSync(`${tmpdir()}/maciek-test-`);
    const tm = new MaciekTokenMonitor({ configDir: tmp });
    const s = await tm.snapshot();
    // No fixtures → cold-start path.
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5);
    // observedAt parses as a valid ISO-8601 date.
    expect(Number.isNaN(Date.parse(s.observedAt))).toBe(false);
  });

  it("zero-token usage entries are dropped (filtered before block aggregation)", async () => {
    const tmp = mkdtempSync(`${tmpdir()}/maciek-zero-`);
    const projects = `${tmp}/projects/-x`;
    // Create directory tree.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      `${projects}/s.jsonl`,
      [
        // Zero usage — should be filtered.
        '{"type":"assistant","timestamp":"2026-05-04T12:00:00.000Z","message":{"id":"msg_z","usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"requestId":"req_z"}',
        // Real usage.
        '{"type":"assistant","timestamp":"2026-05-04T12:00:00.000Z","message":{"id":"msg_real","usage":{"input_tokens":1000,"output_tokens":2000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"requestId":"req_real"}',
      ].join("\n"),
      "utf8",
    );
    const tm = new MaciekTokenMonitor({
      configDir: tmp,
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5 - 3000);
  });

  it("cache_read_input_tokens are excluded from the 5h-window sum", async () => {
    const tmp = mkdtempSync(`${tmpdir()}/maciek-cacheread-`);
    const projects = `${tmp}/projects/-x`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      `${projects}/s.jsonl`,
      // 1k input + 2k output + 5k cache_creation + 900k cache_read.
      // Pre-fix: 908k chargeable → wraps every plan to 0 remaining.
      // Post-fix: 8k chargeable → cap − 8k remaining.
      '{"type":"assistant","timestamp":"2026-05-04T12:00:00.000Z","message":{"id":"msg_x","usage":{"input_tokens":1000,"output_tokens":2000,"cache_creation_input_tokens":5000,"cache_read_input_tokens":900000}},"requestId":"req_x"}',
      "utf8",
    );
    const tm = new MaciekTokenMonitor({
      configDir: tmp,
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
    });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max5 - 8000);
  });

  it("4M chargeable in active block does not peg max20 (cap-calibration regression)", async () => {
    // Empirical observation 2026-05-04: an active 5h block on a Max-tier
    // 1M-context Claude Code session carried 4,107,313 chargeable tokens
    // (input + output + cache_creation). Pre-calibration (max20=220k) this
    // pegged every plan to 0 remaining. Post-calibration (max20=40M),
    // remaining is in the tens-of-millions range.
    const tmp = mkdtempSync(`${tmpdir()}/maciek-cap-calibration-`);
    const projects = `${tmp}/projects/-x`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(projects, { recursive: true });
    // 4M chargeable: 1M input + 1M output + 2M cache_creation.
    writeFileSync(
      `${projects}/s.jsonl`,
      '{"type":"assistant","timestamp":"2026-05-04T12:00:00.000Z","message":{"id":"msg_4m","usage":{"input_tokens":1000000,"output_tokens":1000000,"cache_creation_input_tokens":2000000,"cache_read_input_tokens":0}},"requestId":"req_4m"}',
      "utf8",
    );
    const tm = new MaciekTokenMonitor({
      configDir: tmp,
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max20",
    });
    const s = await tm.snapshot();
    expect(s.tokensRemainingInWindow).toBeGreaterThan(0);
    expect(s.tokensRemainingInWindow).toBe(PLAN_CAPS.max20 - 4_000_000);
  });

  it("cap override wins over PLAN_CAPS[plan]", async () => {
    const tm = new MaciekTokenMonitor({
      configDir: resolve(FIXTURE_ROOT, "single-block"),
      now: () => new Date("2026-05-04T12:00:00.000Z"),
      plan: "max5",
      cap: 100_000_000,
    });
    const s = await tm.snapshot();
    expect(s.windowSizeTokens).toBe(100_000_000);
    expect(s.tokensRemainingInWindow).toBe(100_000_000 - 3000);
  });

  it("non-positive / non-integer cap override is ignored", async () => {
    const cfg = resolve(FIXTURE_ROOT, "single-block");
    const now = () => new Date("2026-05-04T12:00:00.000Z");
    const negative = await new MaciekTokenMonitor({
      configDir: cfg,
      now,
      plan: "max5",
      cap: -1,
    }).snapshot();
    const fractional = await new MaciekTokenMonitor({
      configDir: cfg,
      now,
      plan: "max5",
      cap: 100.5,
    }).snapshot();
    const zero = await new MaciekTokenMonitor({
      configDir: cfg,
      now,
      plan: "max5",
      cap: 0,
    }).snapshot();
    expect(negative.windowSizeTokens).toBe(PLAN_CAPS.max5);
    expect(fractional.windowSizeTokens).toBe(PLAN_CAPS.max5);
    expect(zero.windowSizeTokens).toBe(PLAN_CAPS.max5);
  });
});
