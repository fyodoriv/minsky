import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StubTokenMonitor } from "@minsky/token-monitor";

import { type FlagToken, decisionToFlagToken, flagFilePath, writeBudgetFlag } from "./flag-file.js";
import { type BudgetDecision, BudgetGuard, DEFAULT_THRESHOLDS, decide } from "./index.js";

const snapshot = (overrides: Partial<Parameters<typeof decide>[0]> = {}) => ({
  tokensRemainingInWindow: 1_000_000,
  windowSizeTokens: 1_000_000,
  secondsUntilWindowReset: 5 * 60 * 60,
  weeklyHeadroomFraction: 1,
  observedAt: "2026-05-03T00:00:00Z",
  monthlyHeadroomFraction: 1,
  secondsUntilWeekReset: 604800,
  secondsUntilMonthReset: 2592000,
  ...overrides,
});

describe("decisionToFlagToken", () => {
  it.each<[BudgetDecision["action"], FlagToken]>([
    ["normal", "NORMAL"],
    ["graceful-degrade", "THROTTLE"],
    ["circuit-break-and-notify", "PAUSE"],
    ["weekly-cap-warn", "WEEKLY_WARN"],
  ])("maps %s → %s", (action, expected) => {
    const d: BudgetDecision = {
      action,
      snapshot: snapshot(),
      consumed: 0,
      reason: "",
      decidedAt: "2026-05-03T00:00:00Z",
    };
    expect(decisionToFlagToken(d)).toBe(expected);
  });
});

describe("flagFilePath", () => {
  it("resolves to ${MINSKY_HOME}/.minsky/budget.flag", () => {
    expect(flagFilePath("/repo")).toBe("/repo/.minsky/budget.flag");
  });
});

describe("writeBudgetFlag", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "budget-guard-flag-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the action token followed by a trailing newline", async () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 50_000 }));
    await writeBudgetFlag(d, dir);
    const contents = await readFile(flagFilePath(dir), "utf8");
    expect(contents).toBe("PAUSE\n");
  });

  it("creates the .minsky directory if it does not exist", async () => {
    const d = decide(snapshot());
    await writeBudgetFlag(d, dir);
    const s = await stat(join(dir, ".minsky"));
    expect(s.isDirectory()).toBe(true);
  });

  it("overwrites a prior flag on subsequent writes", async () => {
    await writeBudgetFlag(decide(snapshot()), dir);
    expect(await readFile(flagFilePath(dir), "utf8")).toBe("NORMAL\n");

    await writeBudgetFlag(decide(snapshot({ tokensRemainingInWindow: 50_000 })), dir);
    expect(await readFile(flagFilePath(dir), "utf8")).toBe("PAUSE\n");
  });

  it("writes atomically — no .tmp file is left behind on success", async () => {
    await writeBudgetFlag(decide(snapshot()), dir);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(dir, ".minsky"));
    expect(entries).toEqual(["budget.flag"]);
  });

  it("WEEKLY_WARN when only weekly headroom is low", async () => {
    const d = decide(snapshot({ weeklyHeadroomFraction: 0.1 }));
    await writeBudgetFlag(d, dir);
    expect(await readFile(flagFilePath(dir), "utf8")).toBe("WEEKLY_WARN\n");
  });

  it("THROTTLE at graceful-degrade threshold", async () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 250_000 }));
    await writeBudgetFlag(d, dir);
    expect(await readFile(flagFilePath(dir), "utf8")).toBe("THROTTLE\n");
  });
});

describe("BudgetGuard wired to writeBudgetFlag", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "budget-guard-flag-int-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("tick() with a circuit-break fixture writes PAUSE", async () => {
    const monitor = new StubTokenMonitor();
    monitor.set({ tokensRemainingInWindow: 50_000 });
    const writes: Promise<void>[] = [];
    const guard = new BudgetGuard(
      monitor,
      (d) => {
        writes.push(writeBudgetFlag(d, dir));
      },
      DEFAULT_THRESHOLDS,
      60_000,
    );
    await guard.tick();
    await Promise.all(writes);
    expect(await readFile(flagFilePath(dir), "utf8")).toBe("PAUSE\n");
  });
});
