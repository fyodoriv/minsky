/**
 * `@minsky/dashboard-web` — Hono SSR server scaffold.
 * Three routes: `GET /` returns the HTML produced by `render(...)`,
 * `GET /watch.json` returns the JSON envelope shaped for the iOS /
 * watchOS Apple-Shortcuts surface (`distribution/shortcuts/`), and
 * `POST /control` accepts a `{paused: boolean}` body and applies it
 * through the injected `setPaused` Strategy (the operator-escape-hatch
 * seam — Beyer SRE 2016 Ch. 17). The JSON route reuses the same
 * `getValue` Strategy as the HTML route — a single value source feeds
 * both surfaces (rule #2 — adapter seam). Returns `app.fetch` so tests
 * can drive routes without a real port.
 *
 * `getValue` is the Strategy seam (rule #2) opened by
 * `dashboard-web-otel-wiring`: callers inject a synchronous lookup
 * `(m: SuccessMetric) => string | null`. `null` renders the `(stub)`
 * sentinel (backward-compatible default); a string is HTML-escaped and
 * displayed in place of `(stub)`. Async snapshot work happens upstream
 * (`start.ts` + the runner) so the per-render path stays synchronous and
 * fast — the parent task's 500-ms per-render budget is enforced by
 * keeping I/O off the request hot-path entirely.
 *
 * `setPaused` is the writer half of the pause seam; in v0 the default
 * pair `getPauseState` + `setPaused` close over a single in-memory
 * boolean (`createMemoryPauseState`) so `POST /control` round-trips into
 * the next `GET /watch.json` body. Production supervisors inject their
 * own pair to write a sentinel file the loop honors.
 */

import { Hono } from "hono";

import type { ActivityEntry } from "./activity.js";
import { type SetPaused, parseControlBody } from "./control.js";
import { createMemoryPauseState } from "./control.js";
import { SUCCESS_METRICS, type SuccessMetric } from "./metrics.js";
import { type GetValue, STUB_GET_VALUE, render } from "./render.js";
import { type PauseReasonState, type PauseState, watchEnvelope } from "./watch.js";

/**
 * Strategy seam (rule #2) for the activity feed — a synchronous read
 * that returns the most recent N iteration spans, youngest-first.
 * `start.ts` injects a `loadRecentSpans(MINSKY_HOME/.minsky/tick-loop.out.log, 20)`
 * implementation; tests inject a fixed array. `null` / unset → no
 * activity section is rendered (the feed is opt-in).
 */
export type GetActivity = () => readonly ActivityEntry[];

/** Server handle: `app` for tests, `fetch` for embedding. */
export interface DashboardServer {
  readonly app: Hono;
  readonly fetch: Hono["fetch"];
}

/**
 * Build a fresh Hono app with the three routes wired. Does not bind a
 * port — caller decides whether to embed via `fetch` or `serve()`.
 * `metrics` defaults to `SUCCESS_METRICS` (the 10 vision.md success
 * criteria); `getValue` defaults to `STUB_GET_VALUE` (every row →
 * `(stub)`); `getPauseState` + `setPaused` default to an in-memory pair
 * (`createMemoryPauseState`) so `POST /control` round-trips through
 * `GET /watch.json` without any caller wiring. Tests inject custom
 * Strategies to exercise the live-value / sentinel-write paths.
 *
 * @otel dashboard-web.create-server
 */
export function createServer(args?: {
  readonly metrics?: readonly SuccessMetric[];
  readonly getValue?: GetValue;
  readonly getPauseState?: PauseState;
  readonly setPaused?: SetPaused;
  readonly getPauseReason?: PauseReasonState;
  readonly getActivity?: GetActivity;
}): DashboardServer {
  const metrics = args?.metrics ?? SUCCESS_METRICS;
  const getValue = args?.getValue ?? STUB_GET_VALUE;
  const memory = createMemoryPauseState();
  const getPauseState = args?.getPauseState ?? memory.getPauseState;
  const setPaused = args?.setPaused ?? memory.setPaused;
  const getPauseReason = args?.getPauseReason;
  const getActivity = args?.getActivity;
  const app = new Hono();
  app.get("/", (c) => {
    const activity = getActivity?.() ?? [];
    return c.html(render({ metrics, getValue, activity }));
  });
  app.get("/watch.json", (c) =>
    c.json(
      watchEnvelope(
        getPauseReason === undefined
          ? { metrics, getValue, getPauseState }
          : { metrics, getValue, getPauseState, getPauseReason },
      ),
    ),
  );
  app.post("/control", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const parsed = parseControlBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    setPaused(parsed.paused);
    return c.json({ ok: true, paused: parsed.paused });
  });
  return { app, fetch: app.fetch };
}

/**
 * Read the request body as JSON, returning `null` on any parse / I/O
 * failure so the pure validator (`parseControlBody`) sees a uniform
 * "missing body" shape (rule #7 graceful-degrade — explicit not silent).
 *
 * @otel-exempt thin I/O helper — the route handler carries the
 *   dashboard-web.control span; this helper exists only to keep the
 *   route's try/catch nesting at depth 1 (rule #6).
 */
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
    // rule-6: handled-locally — empty / malformed body graceful-degrades to 400 (chaos row 5)
  } catch {
    return null;
  }
}
