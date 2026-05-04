<!-- rule-1: existing dashboard frameworks (Grafana, Apache Superset, Metabase, Retool) rejected because: each ships a heavyweight runtime (JVM / Python+JS bundle / multi-MB SPA) that violates the ≤300-LoC pivot threshold in `dashboard-web-v0`'s task brief; their data model also assumes a SQL-shaped metric source whereas Minsky's source is OTEL signals through `@minsky/observability`. Hono is a thin HTTP shell — it is the routing primitive, not a competing dashboard framework. -->

# `@minsky/dashboard-web`

SSR web dashboard for Minsky's 10 success metrics (vision.md § "Success criteria"). v0 sub-task 1/4 ships the skeleton: a Hono v4 app with a single `GET /` route, a pure `render({ metrics })` function, and a `SuccessMetric` shape with one placeholder entry. Sub-tasks 2-4 (filed in TASKS.md) populate the 10 metrics, wire the OTEL backend through `@minsky/observability`, and add the Lighthouse Mobile ≥0.9 CI gate.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 57:

- **`createServer({ metrics })`** — Adapter shape (Gamma et al. 1994) over Hono v4. The HTTP runtime is one Strategy; native `http.createServer` or Fastify would be alternatives. **Conformance: full** for the routing contract.
- **`render({ metrics })`** — Pure-function HTML renderer (Martin, *Clean Architecture*, 2017). Every input is data; output is a string. Cold-start safe (empty `metrics` yields a well-formed document with an empty `<ul>`). **Conformance: full**.
- **`SuccessMetric`** — Information-visualization atom (Card & Mackinlay, *Readings in Information Visualization*, 1999): id + label + formula + unit; nothing else. Glanceable per Wilkie 2018 (RED Method) at the service-level lens. **Conformance: partial** — the v0 ships one placeholder; sub-task 2 (`dashboard-web-metrics-enum`) lifts the 10 from vision.md.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `createServer({ metrics }).fetch(GET /)` returns `200` with HTML containing one `data-metric-id` attribute per element of `metrics`; `render({ metrics: [] })` returns a well-formed document with an empty `<ul class="metrics">`; metric labels with HTML metacharacters are escaped before reaching the client.
- **Blast radius**: a single in-process Hono app. No shared state across instances; no I/O at the renderer boundary; Hono's `fetch` is synchronous over the route table.
- **Operator escape hatch**: the renderer is pure — corrupt metric inputs produce a well-formed (if empty-ish) document instead of throwing; the server returns 404 on unknown routes and lets Hono's default handler emit the response.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Missing OTEL backend at the upstream `@minsky/observability` boundary (no metric data available yet — sub-tasks 2-3 wire the real signals) | missing-input (resource) | `graceful-degrade` — `createServer({ metrics: [] })` still returns 200 on `/` with a well-formed document; the dashboard shows an empty list rather than crashing | covered by `novel/dashboard-web/test/server.test.ts` "renders zero metric rows when given an empty array (cold-start contract)" assertion |
| 2 | Configured port already bound by another process at `serve()` time | resource-contended (network) | `let-it-crash` — `@hono/node-server` surfaces an `EADDRINUSE` from `serve()`; the wrapping supervisor (one-for-one per ARCHITECTURE.md § "Process supervision tree") restarts on a configurable port | the v0 skeleton intentionally returns `{ app, fetch }` without binding a port so the failure mode is owned by the wrapping `distribution/run-dashboard-web.sh` (deferred — covered when `dashboard-web-render-all-10` ships); meanwhile the `server.test.ts` "returns 200 + HTML body for GET /" assertion exercises the in-process `fetch` path that has no port-binding concern |
| 3 | HTML injection via a metric label containing `<script>` / `"` / `'` / `&` / `>` (upstream-malformed — a future OTEL label could carry attacker-influenced text) | upstream-malformed (XSS) | `graceful-degrade` — `escapeHtml` rewrites every metacharacter; the rendered string contains no live `<script>` tag and no broken-attribute boundary | covered by `novel/dashboard-web/test/render.test.ts` "escapes HTML in label / id / formula / unit (rule #7 — XSS guard)" assertion |
| 4 | Unknown route requested (`GET /admin`, `GET /api/secret`) | adversarial input | `graceful-degrade` — Hono's default 404 handler returns `404 Not Found`; the SSR surface is intentionally minimal (one route) so there is no surface to enumerate | covered by `novel/dashboard-web/test/server.test.ts` "returns 404 for an unknown route (Hono default — let-it-crash equivalent)" assertion |

## Hypothesis-driven development (rule #9)

### Sub-task 1 (this PR — skeleton)

- **Hypothesis**: A Hono SSR skeleton at ≤100 LoC of TS source under `novel/dashboard-web/src/` provides a deterministic substrate sub-tasks 2-4 can extend without exceeding the parent `dashboard-web-v0`'s 300-LoC pivot cap. The renderer is a pure function — no I/O, no global state — so the Lighthouse Mobile gate (sub-task 4) measures static-render performance, not runtime variance.
- **Success threshold**: `pnpm typecheck` exits 0; `pnpm vitest run novel/dashboard-web/` passes ≥4 tests with 0 failures; `wc -l novel/dashboard-web/src/*.ts | tail -1 | awk '{print $1}'` ≤ 100; the `dashboard-web-skeleton` task block is removed from `TASKS.md` in the same PR.
- **Pivot threshold**: if Hono cold-start adds significant complexity (the 100-LoC cap is breached >50 % to satisfy the SSR contract — i.e., >150 LoC), pivot to plain `node:http` + template literals. The `createServer` Adapter shape is the seam: only `server.ts` would change.
- **Measurement**: `pnpm typecheck && pnpm vitest run novel/dashboard-web/ && [ "$(wc -l novel/dashboard-web/src/*.ts | tail -1 | awk '{print $1}')" -le 100 ]`.
- **Literature anchor**: Card & Mackinlay, *Readings in Information Visualization*, Morgan Kaufmann, 1999 (the dashboard-as-glanceable-display pattern); Wilkie, "RED Method", 2018 (rate / errors / duration as the service-level lens); Martin, *Clean Architecture*, Pearson, 2017 (pure decision module + thin I/O boundary — the renderer is pure, the server is the I/O); rule #2 (vision.md § 2 — every dep behind interface; `createServer` is the Hono adapter).

### Sub-task 2 (metrics-enum — filed)

See TASKS.md `dashboard-web-metrics-enum`.

### Sub-task 3 (render-all-10 — filed, blocked)

See TASKS.md `dashboard-web-render-all-10`.

### Sub-task 4 (Lighthouse CI — filed, blocked)

See TASKS.md `dashboard-web-lighthouse-ci`.

## Usage

```ts
import { createServer, PLACEHOLDER_METRICS } from "@minsky/dashboard-web";
import { serve } from "@hono/node-server";

const { fetch } = createServer({ metrics: PLACEHOLDER_METRICS });
serve({ fetch, port: 8080 }); // distribution/run-dashboard-web.sh owns the port choice
```
