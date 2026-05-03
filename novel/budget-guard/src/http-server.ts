/**
 * `@minsky/budget-guard` — HTTP envelope. A tiny Hono server on
 * `localhost:9876` exposing `GET /budget` so the dashboard, the Watch
 * shortcuts, and ad-hoc consumers can poll the current decision JSON.
 *
 * Pattern conformance (rule #8):
 *   - `BudgetServer`:        Adapter (Gamma et al. 1994) — interface lets us
 *                            swap Hono for Fastify / native http without
 *                            touching callers. Conformance: full.
 *   - `HonoBudgetServer`:    Strategy (Gamma et al. 1994) — concrete
 *                            implementation behind the adapter.
 *   - JSON shape:            documented in `ARCHITECTURE.md` § "Token economy"
 *                            (`{ remaining: { tokens, minutes, cost },
 *                            weekly_headroom_pct, recommended_action }`).
 *                            Conformance: full. `cost` is `null` until the
 *                            Maciek `TokenMonitor` strategy ships
 *                            (`budget-guard-maciek-impl`).
 */

import { type ServerType, serve } from "@hono/node-server";
import { Hono } from "hono";

import type { BudgetAction, BudgetDecision } from "./index.js";

/** Wire shape returned by `GET /budget`. Mirrors `ARCHITECTURE.md` § "Token economy". */
export interface BudgetJson {
  readonly remaining: {
    readonly tokens: number;
    readonly minutes: number;
    /** Filled in by the Maciek strategy (budget-guard-maciek-impl). */
    readonly cost: number | null;
  };
  readonly weekly_headroom_pct: number;
  readonly recommended_action: BudgetAction;
  readonly observed_at: string;
  readonly decided_at: string;
}

export function budgetResponse(decision: BudgetDecision): BudgetJson {
  return {
    remaining: {
      tokens: decision.snapshot.tokensRemainingInWindow,
      minutes: Math.floor(decision.snapshot.secondsUntilWindowReset / 60),
      cost: null,
    },
    weekly_headroom_pct: decision.snapshot.weeklyHeadroomFraction * 100,
    recommended_action: decision.action,
    observed_at: decision.snapshot.observedAt,
    decided_at: decision.decidedAt,
  };
}

export type DecisionGetter = () => BudgetDecision | undefined;

export interface BudgetServer {
  start(opts?: { port?: number; host?: string }): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
}

/** Default port. Overridden by `MINSKY_BUDGET_GUARD_PORT` or by an explicit `start({ port })`. */
export const DEFAULT_PORT = 9876;

function resolvePort(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  const env = process.env["MINSKY_BUDGET_GUARD_PORT"];
  if (env !== undefined && env !== "") {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_PORT;
}

export class HonoBudgetServer implements BudgetServer {
  private readonly app: Hono;
  private node: ServerType | undefined;

  constructor(private readonly getDecision: DecisionGetter) {
    this.app = new Hono();
    this.app.get("/budget", (c) => {
      const d = this.getDecision();
      if (d === undefined) {
        return c.json({ error: "no decision recorded yet" }, 503);
      }
      return c.json(budgetResponse(d));
    });
  }

  async start(opts: { port?: number; host?: string } = {}): Promise<{ port: number; url: string }> {
    const port = resolvePort(opts.port);
    const host = opts.host ?? "127.0.0.1";

    return await new Promise((resolve, reject) => {
      try {
        this.node = serve({ fetch: this.app.fetch, port, hostname: host }, (info) => {
          resolve({ port: info.port, url: `http://${host}:${info.port}` });
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async stop(): Promise<void> {
    const node = this.node;
    if (node === undefined) return;
    this.node = undefined;
    await new Promise<void>((resolve, reject) => {
      node.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
