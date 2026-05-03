import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StubTokenMonitor } from "@minsky/token-monitor";

import {
  BudgetGuard,
  type BudgetJson,
  DEFAULT_THRESHOLDS,
  HonoBudgetServer,
  budgetResponse,
  decide,
} from "./index.js";

const snapshot = (overrides: Partial<Parameters<typeof decide>[0]> = {}) => ({
  tokensRemainingInWindow: 1_000_000,
  windowSizeTokens: 1_000_000,
  secondsUntilWindowReset: 5 * 60 * 60,
  weeklyHeadroomFraction: 1,
  observedAt: "2026-05-03T00:00:00Z",
  ...overrides,
});

describe("budgetResponse", () => {
  it("renders a normal decision into the documented JSON shape", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 800_000 }));
    const json = budgetResponse(d);
    expect(json).toMatchObject({
      remaining: { tokens: 800_000, minutes: 300, cost: null },
      weekly_headroom_pct: 100,
      recommended_action: "normal",
    } satisfies Partial<BudgetJson>);
    expect(json.observed_at).toBe(snapshot().observedAt);
    expect(typeof json.decided_at).toBe("string");
  });

  it("renders a circuit-break decision with action=circuit-break-and-notify", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 50_000 }));
    expect(budgetResponse(d).recommended_action).toBe("circuit-break-and-notify");
  });

  it("renders a graceful-degrade decision with action=graceful-degrade", () => {
    const d = decide(snapshot({ tokensRemainingInWindow: 250_000 }));
    expect(budgetResponse(d).recommended_action).toBe("graceful-degrade");
  });

  it("renders a weekly-cap-warn decision and reflects the headroom percentage", () => {
    const d = decide(snapshot({ weeklyHeadroomFraction: 0.1 }));
    const json = budgetResponse(d);
    expect(json.recommended_action).toBe("weekly-cap-warn");
    expect(json.weekly_headroom_pct).toBeCloseTo(10);
  });

  it("computes minutes_remaining as floor(seconds / 60)", () => {
    const d = decide(snapshot({ secondsUntilWindowReset: 119 }));
    expect(budgetResponse(d).remaining.minutes).toBe(1);
  });

  it("cost is null until the Maciek strategy ships (budget-guard-maciek-impl)", () => {
    const d = decide(snapshot());
    expect(budgetResponse(d).remaining.cost).toBeNull();
  });
});

describe("HonoBudgetServer", () => {
  let server: HonoBudgetServer;
  let lastDecision: ReturnType<typeof decide> | undefined;
  let monitor: StubTokenMonitor;

  beforeEach(() => {
    monitor = new StubTokenMonitor();
    lastDecision = undefined;
  });

  afterEach(async () => {
    await server?.stop();
  });

  it("starts on an ephemeral port, GET /budget returns the documented JSON shape", async () => {
    monitor.set({ tokensRemainingInWindow: 50_000 });
    const guard = new BudgetGuard(
      monitor,
      (d) => {
        lastDecision = d;
      },
      DEFAULT_THRESHOLDS,
      60_000,
    );
    await guard.tick();

    server = new HonoBudgetServer(() => lastDecision);
    const { port, url } = await server.start({ port: 0 });
    expect(port).toBeGreaterThan(0);
    expect(url).toContain(`:${port}`);

    const res = await fetch(`${url}/budget`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BudgetJson;
    expect(body.recommended_action).toBe("circuit-break-and-notify");
    expect(body.remaining.tokens).toBe(50_000);
  });

  it("returns 503 with a reason when no decision has been recorded yet", async () => {
    server = new HonoBudgetServer(() => undefined);
    const { url } = await server.start({ port: 0 });

    const res = await fetch(`${url}/budget`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no decision/i);
  });

  it("stop() releases the port — a follow-up start() on the same port succeeds", async () => {
    server = new HonoBudgetServer(() => undefined);
    const { port } = await server.start({ port: 0 });
    await server.stop();

    const next = new HonoBudgetServer(() => undefined);
    const second = await next.start({ port });
    expect(second.port).toBe(port);
    await next.stop();
  });

  it("respects MINSKY_BUDGET_GUARD_PORT when no explicit port is given", async () => {
    const old = process.env["MINSKY_BUDGET_GUARD_PORT"];
    process.env["MINSKY_BUDGET_GUARD_PORT"] = "0";
    try {
      server = new HonoBudgetServer(() => undefined);
      const started = await server.start();
      expect(started.port).toBeGreaterThan(0);
    } finally {
      if (old === undefined) {
        Reflect.deleteProperty(process.env, "MINSKY_BUDGET_GUARD_PORT");
      } else {
        process.env["MINSKY_BUDGET_GUARD_PORT"] = old;
      }
    }
  });
});
