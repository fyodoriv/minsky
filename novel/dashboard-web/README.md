<!-- rule-1: existing dashboard frameworks (Grafana, Apache Superset, Metabase, Retool) rejected because: each ships a heavyweight runtime (JVM / Python+JS bundle / multi-MB SPA) that violates the ≤300-LoC pivot threshold in `dashboard-web-v0`'s task brief; their data model also assumes a SQL-shaped metric source whereas Minsky's source is OTEL signals through `@minsky/observability`. Hono is a thin HTTP shell — it is the routing primitive, not a competing dashboard framework. -->

# `@minsky/dashboard-web`

SSR web dashboard for Minsky's 14 success metrics (vision.md § "Success criteria"; the 11th tile `cross-repo-pr-rate` was added 2026-05-24 to close the M1 P0 `cross-repo-iteration-ship-rate-ci-gate` task — see `novel/cross-repo-runner/README.md` § "Ship-rate gate" for the threshold constants; the 12th-14th tiles `fleet-stability-aggregated` / `session-converts-repo` / `baseline-delta-per-cycle` were added 2026-05-25 in PR `feat/m1-2-m1-7-collectors-from-transform-ledger` to close M1.2 / M1.5 / M1.7 by wrapping the `.minsky/transform-runs.jsonl` ledger via `scripts/transform_trend.py` / `scripts/transform_knowledge.py` — see `scripts/collect-metrics.mjs` § "Ledger-backed collectors" for the no-reinvent wire-up rationale). v0 sub-task 1/4 ships the skeleton: a Hono v4 app with a single `GET /` route, a pure `render({ metrics })` function, and a `SuccessMetric` shape with one placeholder entry. Sub-tasks 2-4 (filed in TASKS.md) populate the metrics, wire the OTEL backend through `@minsky/observability`, and add the Lighthouse Mobile ≥0.85 CI gate (threshold pivoted from 0.9 → 0.85 on 2026-05-04 — see § "Sub-task 4" below for the rationale).

The HTML carries an inlined `<style>` block (Card & Mackinlay 1999 — glanceable display): system font stack, dark slate background, responsive grid of metric cards (`auto-fill, minmax(280px, 1fr)`), muted styling for the `(stub)` not-wired-yet state so an unwired backend is visibly distinct from a real value. Inlined CSS keeps the dashboard a single SSR response (no extra fetch round-trip; works offline) and stays well within the parent `dashboard-web-v0` 300-LoC pivot cap.

## Recent activity feed

Below the metric grid, a "Recent activity" section streams the latest 20 tick-loop iteration spans from `.minsky/tick-loop.out.log` (youngest-first), each rendered as a colored status pill (completed = green; budget-paused = amber; failed = red; no-task / missing-tasks-md = slate-grey) plus the task ID or daemon reason. The page auto-refreshes every 5s. Source: pure `parseSpan` / `takeRecentSpans` in `src/activity.ts`; I/O at the edge in `loadRecentSpans` (the `dashboard-web.activity.load-recent` OTEL span). Surfaces the supervisor's live state without requiring `tail -f` against the log file.

Slice 5 of `local-llm-fallback-on-budget-pause` adds an optional LLM provider badge per row — when `iteration.provider` is set in the iteration span (claude / local / hold), the badge surfaces alongside the status pill. claude-blue, local-amber, hold-red. Legacy iterations (no provider field, the supervisor wasn't running with `MINSKY_LOCAL_LLM=1`) render no badge so existing dashboards stay visually identical. The grid template extends from 3 to 4 columns; the mobile breakpoint promotes the badge to a full-width row to keep the layout readable. `parseSpan` reads `iteration.provider` with empty-string default, preserving back-compat with span logs predating the local-LLM wrapper.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 57:

- **`createServer({ metrics })`** — Adapter shape (Gamma et al. 1994) over Hono v4. The HTTP runtime is one Strategy; native `http.createServer` or Fastify would be alternatives. **Conformance: full** for the routing contract.
- **`render({ metrics })`** — Pure-function HTML renderer (Martin, *Clean Architecture*, 2017). Every input is data; output is a string. Cold-start safe (empty `metrics` yields a well-formed document with an empty `<ul>`). **Conformance: full**.
- **`SuccessMetric`** — Information-visualization atom (Card & Mackinlay, *Readings in Information Visualization*, 1999): id + label + formula + unit + `freshnessBudgetMs` + optional `monotonic: "ok"` + **goal + pivot + anchor** (operator directive 2026-05-21 — every metric explicitly carries its success threshold, pivot threshold, and literature anchor verbatim from vision.md § "Success criteria") + optional **milestone** tag (which MILESTONES.md milestone gates this metric to "must be observed"); nothing else. Glanceable per Wilkie 2018 (RED Method) at the service-level lens. **Conformance: full** — the 10 vision.md success criteria are typed as `SUCCESS_METRICS: readonly SuccessMetric[]` (sub-task 2/4 — `dashboard-web-metrics-enum`). The `freshnessBudgetMs` field (Munafò et al. 2017 — pre-registration of the staleness threshold *before* observation) is consumed by `scripts/generate-metrics-md.mjs` and the planned `scripts/check-metric-freshness.mjs` lint to decide whether each metric reads as a fresh value or an explicit `(stub)` (canonical-metric-list-per-repo, vision.md row 82); the optional `monotonic: "ok"` flag is the explicit opt-in for lifetime-inventory metrics where monotonic increase is intentional (Ries 2011 vanity-metric escape valve — currently set only on `extraction-count`).
- **`ProposedMetric`** — Same module exports a separate `ProposedMetric` interface + `PROPOSED_METRICS` constant for metrics that *should* exist on the dashboard but don't yet (M1.1 stability ratio, M1.13 self-heal MTTR top-level, M2.7 SWE-bench resolve rate, etc.). Each row carries id + label + rationale + milestone + optional blocker task + sketch of the future collection formula. Rendered in METRICS.md's trailing `## Metrics to add` section so the gap is surfaced explicitly (operator directive 2026-05-21).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `createServer({ metrics }).fetch(GET /)` returns `200` with HTML containing one `data-metric-id` attribute per element of `metrics`; `render({ metrics: [] })` returns a well-formed document with an empty `<ul class="metrics">`; metric labels with HTML metacharacters are escaped before reaching the client.
- **Blast radius**: a single in-process Hono app. No shared state across instances; no I/O at the renderer boundary; Hono's `fetch` is synchronous over the route table.
- **Operator escape hatch**: the renderer is pure — corrupt metric inputs produce a well-formed (if empty-ish) document instead of throwing; the server returns 404 on unknown routes and lets Hono's default handler emit the response.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Missing OTEL backend at the upstream `@minsky/observability` boundary (no metric data available yet — sub-tasks 2-3 wire the real signals) | missing-input (resource) | `graceful-degrade` — `createServer({ metrics: [] })` still returns 200 on `/` with a well-formed document; the dashboard shows an empty list rather than crashing | covered by `novel/dashboard-web/test/server.test.ts` "renders zero metric rows when given an empty array (cold-start contract)" assertion |
| 2 | Configured port already bound by another process at `serve()` time | resource-contended (network) | `graceful-degrade` (operator-side) — `start.ts`'s `server.on("error", ...)` handler intercepts `EADDRINUSE` and prints a 4-line operator hint (other dashboard already running; pick a different port; or `lsof -ti :PORT` then `xargs kill`) before `process.exit(1)`. Other server errors still throw (rule #6 let-it-crash for the unanticipated cases). The wrapping supervisor (one-for-one per ARCHITECTURE.md § "Process supervision tree") sees the exit-1 and applies its restart policy unchanged | smoke test: `( PORT=8181 bash distribution/run-dashboard-web.sh & ); sleep 3; PORT=8181 bash distribution/run-dashboard-web.sh` — the second invocation asserts the hint and exits 1 instead of dumping the node stack trace |
| 3 | HTML injection via a metric label containing `<script>` / `"` / `'` / `&` / `>` (upstream-malformed — a future OTEL label could carry attacker-influenced text) | upstream-malformed (XSS) | `graceful-degrade` — `escapeHtml` rewrites every metacharacter; the rendered string contains no live `<script>` tag and no broken-attribute boundary | covered by `novel/dashboard-web/test/render.test.ts` "escapes HTML in label / id / formula / unit (rule #7 — XSS guard)" assertion |
| 4 | Unknown route requested (`GET /admin`, `GET /api/secret`) | adversarial input | `graceful-degrade` — Hono's default 404 handler returns `404 Not Found`; the SSR surface is intentionally minimal (one route) so there is no surface to enumerate | covered by `novel/dashboard-web/test/server.test.ts` "returns 404 for an unknown route (Hono default — let-it-crash equivalent)" assertion |
| 5 | Malformed control payload (missing body, missing `paused` key, non-boolean `paused`, non-JSON body) on `POST /control` | upstream-malformed (adversarial / rule #7) | `graceful-degrade` — `parseControlBody` returns a discriminated `{ok:false, error}` and the route handler maps it to `400` with `{error}`; the `setPaused` Strategy is *never* called on the malformed branch (verified by call-counter assertions) | covered by `novel/dashboard-web/test/server.test.ts` "400 on missing body", "400 on body without `paused` key", "400 on non-boolean `paused`", and "400 on malformed JSON body (graceful-degrade per rule #7)" assertions |

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: any HTTP request reaching the listening socket; metric labels / formulas that travel through the renderer (could carry HTML metacharacters from a future OTEL backend); the `LAN` itself when the operator opts into `0.0.0.0` bind.
- **Trusted state**: the server-rendered HTML carries zero third-party JS (rule #13.7); the renderer is pure (no I/O); route table is constants in source; `escapeHtml` is the single sanitiser before any user-influenced string reaches the wire (Failure mode #3 above).
- **Trust boundary**: `start.ts` defaults `host` to `127.0.0.1` per rule #13.4 (NIST SP 800-53 SC-7 boundary protection); LAN exposure requires explicit `--host 0.0.0.0` (operator opt-in) and is documented with the implications. Anything past the loopback interface is outside Minsky's control.
- **STRIDE focus**: **S**poofing — no auth in v0 because localhost-only; once `0.0.0.0` is enabled the operator must front it with a Tailscale ACL or equivalent (filed as `dashboard-tailscale-acl` follow-up). **I**nformation disclosure — page payloads carry only USE/RED-shaped numbers + tick state, never raw `claude --print` output, session JSONL paths, or operator filesystem layout. **T**ampering — `escapeHtml` blocks XSS at the render boundary (Failure mode #3).
- **Performance-first carve-out** (rule #13's relief valve): none declared. SSR + zero-JS keeps Lighthouse Mobile in-budget *and* removes the entire client-side attack surface — security and performance reinforce here, they don't compete.

## Hypothesis-driven development (rule #9)

### Sub-task 1 (this PR — skeleton)

- **Hypothesis**: A Hono SSR skeleton at ≤100 LoC of TS source under `novel/dashboard-web/src/` provides a deterministic substrate sub-tasks 2-4 can extend without exceeding the parent `dashboard-web-v0`'s 300-LoC pivot cap. The renderer is a pure function — no I/O, no global state — so the Lighthouse Mobile gate (sub-task 4) measures static-render performance, not runtime variance.
- **Success threshold**: `pnpm typecheck` exits 0; `pnpm vitest run novel/dashboard-web/` passes ≥4 tests with 0 failures; `wc -l novel/dashboard-web/src/*.ts | tail -1 | awk '{print $1}'` ≤ 100; the `dashboard-web-skeleton` task block is removed from `TASKS.md` in the same PR.
- **Pivot threshold**: if Hono cold-start adds significant complexity (the 100-LoC cap is breached >50 % to satisfy the SSR contract — i.e., >150 LoC), pivot to plain `node:http` + template literals. The `createServer` Adapter shape is the seam: only `server.ts` would change.
- **Measurement**: `pnpm typecheck && pnpm vitest run novel/dashboard-web/ && [ "$(wc -l novel/dashboard-web/src/*.ts | tail -1 | awk '{print $1}')" -le 100 ]`.
- **Literature anchor**: Card & Mackinlay, *Readings in Information Visualization*, Morgan Kaufmann, 1999 (the dashboard-as-glanceable-display pattern); Wilkie, "RED Method", 2018 (rate / errors / duration as the service-level lens); Martin, *Clean Architecture*, Pearson, 2017 (pure decision module + thin I/O boundary — the renderer is pure, the server is the I/O); rule #2 (vision.md § 2 — every dep behind interface; `createServer` is the Hono adapter).

### Sub-task 2 (metrics-enum — shipped)

The 10 vision.md success criteria are typed in `src/metrics.ts` as `SUCCESS_METRICS: readonly SuccessMetric[]`. Three invariants are enforced in `test/metrics.test.ts`: count = 10, all kebab-case, no duplicate ids. Renamed from `PLACEHOLDER_METRICS` (sub-task 1's stub).

### Sub-task 3 (render-all-10 — shipped)

`createServer()` now defaults `metrics` to `SUCCESS_METRICS`, so `GET /` renders all 10 vision.md success criteria as `<li data-metric-id="…">` rows. Each row's value is rendered as the `(stub)` sentinel — the operator-visible signal that the OTEL backend is not yet wired (rule #7 graceful-degrade, explicit not silent). The follow-up `dashboard-web-otel-wiring` (P3 in TASKS.md) replaces the sentinel with `@minsky/observability` reads.

### Sub-task 4 (Lighthouse CI — shipped)

`.github/workflows/lighthouse.yml` runs Lighthouse Mobile against `http://localhost:8080/` on every PR + `push: branches: [main]`. Pinned `lighthouse@12.4.0`; explicit `--throttling.cpuSlowdownMultiplier=4` (Lighthouse Mobile default — making it explicit pins the throttling envelope so a future upstream default change does not silently move the gate). Asserts `jq -e '.categories.performance.score >= 0.85' lighthouse.json`; uploads `lighthouse.json` as the `lighthouse-report` workflow artifact (`if: always()` survives the assertion's non-zero exit so a regression carries an inspectable `.audits` payload).

**Threshold pivot (2026-05-04, 0.9 → 0.85):** the original 0.9 threshold (PR #66) proved flaky on GH-hosted runners — observed 0.91 / 0.83 / 0.89 across 3 runs (2 fails / 3 runs = 67 %), well above the original task's documented pivot trigger (≥1 false-positive / 10 runs sustained over 30 days). Per that task's documented Pivot ("drop the threshold to 0.85 and document the deviation in vision.md § Pattern conformance index"), the threshold was lowered to 0.85; the gate's semantic is preserved (still catches a real performance regression that drops the score below 0.85). vision.md row 58 carries the full deviation note; the next-tier pivot (move to a self-hosted runner if 0.85 also proves flaky — ≥2 fails / 10 runs at the new threshold over 30 days) is filed as `lighthouse-self-hosted-runner-pivot` (P3 in TASKS.md). Anchor: rule #9 pre-registration discipline (Munafò et al. 2017) — the pre-registered pivot threshold fired exactly as designed, which is the rule-#9 success-mode, not its failure-mode.

`distribution/run-dashboard-web.sh` is the runner the workflow invokes — it builds the package idempotently and `exec`s into `node novel/dashboard-web/dist/start.js` so the OS supervisor / Lighthouse harness sees the node PID directly (a SIGTERM reaches it without a shell-wrapper detour). The runner forwards `OTEL_*` env vars unmodified, opening the seam for `dashboard-web-otel-wiring` (P3) to wire real backend reads at start-time without touching this script.

The parent `dashboard-web-v0` epic closes with this sub-task: all 4 sub-tasks shipped; the parent's prose-only "Lighthouse Mobile score ≥90 in CI" verification cell now has a machine-readable counterpart at `.github/workflows/lighthouse.yml`.

### Sub-task 5 (otel-wiring Strategy seam — shipped)

`createServer({ getValue })` and `render({ getValue })` accept an optional synchronous Strategy `getValue: (m: SuccessMetric) => string | null` (rule #2 — value source is data, not a hard import). `null` renders the existing `(stub)` sentinel (backward-compatible default — `STUB_GET_VALUE`); a returned string is HTML-escaped (rule #7 XSS guard) and shown in place of `(stub)`. Async backend reads happen upstream of `render`: the runner pre-fetches a JSON snapshot, `start.ts` reads it once, `snapshotGetValue` does in-memory lookup per request — the per-render hot-path stays synchronous and well within the 500-ms budget.

Property name is `getValue`, not `valueOf`: `valueOf` is inherited from `Object.prototype`, so `args.valueOf ?? defaultFn` would silently pick up `Object.prototype.valueOf` and crash with "Cannot convert undefined or null to object" at call time. The deliberate rename costs four characters and avoids a class of latent bug.

`distribution/run-dashboard-web.sh` exposes two opt-in env-vars:

- `DASHBOARD_METRICS_SNAPSHOT` — path to a JSON file shaped `Record<metric-id, string>`. When present and readable at start-time, `start.ts` constructs a `snapshotGetValue` Strategy and `(stub)` count drops to 0.
- `DASHBOARD_METRICS_SNAPSHOT_CMD` — shell command producing the snapshot file before `exec`. Async I/O lives here; failure is non-fatal (the runner falls back to the null Strategy → `(stub)` per rule #7 graceful-degrade).

Concrete Strategies live in `src/strategy.ts`: `snapshotGetValue(snapshot)` (the production shape) and `constantGetValue(value)` (a smoke-test Strategy for end-to-end seam validation without a backend). Real OTEL-backed live-query Strategies (Prometheus / OpenObserve adapters) are a follow-up — the snapshot indirection is the simplest shape that satisfies the parent task's per-render budget.

### Sub-task 6 (`/watch.json` route — Apple-Shortcuts surface — shipped)

`createServer({ ..., getPauseState })` adds a second route `GET /watch.json` returning a small JSON envelope shaped exactly for the iOS / watchOS Apple-Shortcuts manifests in [`distribution/shortcuts/`](../../distribution/shortcuts/README.md). The envelope exposes four keys: three watch readings (`tokens-remaining` / `last-task-status` / `constraint-of-the-week` — the 3-value glanceable cap from Card & Mackinlay 1999 + user-story 005) and a `paused` boolean for the pause/resume Shortcut pair (Beyer SRE 2016 Ch. 17 — operator escape hatch). Field names are kebab-case, matching `SuccessMetric.id` shape and the contract advertised in the Shortcuts README.

`watchEnvelope({ metrics, getValue, getPauseState })` is a pure data transformation in `src/watch.ts`; the route handler is the I/O boundary in `src/server.ts`. The same `getValue` Strategy seam (sub-task 5) feeds both `/` and `/watch.json` — a single value source, two surfaces. The mapping from envelope key to `SuccessMetric.id` lives in the typed constant `WATCH_METRIC_IDS` (rule #4 — every constant in source); the smoke test in `distribution/shortcuts/test/shortcuts-json.test.mjs` asserts each Shortcut's `extract.metric_id` matches that constant (no drift between Shortcut and dashboard).

The pivot path here is documented in `distribution/shortcuts/README.md` § "Why this pivot": Apple's `.shortcut` is signed binary plist since iOS 15, so the brief's authorised pivot was taken — JSON config files + on-device build runbook, not native importable manifests. The autonomously-verifiable upstream half (URL / port / path consistency, schema fidelity, metric-id mapping, server route shape) is enforced by the smoke test + the 5 new server tests (`/watch.json` returns 200 + JSON, exposes the four canonical keys, the live `getValue` Strategy flows through, the `paused` Strategy=true surfaces on the envelope).

#### `pauseReason` field (P1 `daemon-budget-pause-observability`)

`/watch.json` carries a fifth field: `pauseReason: "operator" | "budget" | null` alongside the existing `paused: boolean`. Surfaced by the first 2h live-on-itself self-run on 2026-05-04 — the daemon's `iteration.status: "budget-paused"` (real `BudgetGuard.decide()` circuit-break) emitted a span and log line but no operator-facing signal; the user had to `tail` the log to know the daemon was self-paused. The new field lets richer renderers (the dashboard HTML route, future Shortcut tiles) distinguish *why* the daemon paused — `operator` (someone tapped the pause Shortcut) vs `budget` (the daemon paused itself on the 5h Anthropic window cap). The boolean stays for backwards compat with the v0 Apple Shortcuts; the field is additive (rule-#8 conformance: stable WatchEnvelope shape, field-add only). Server seam: `createServer({ ..., getPauseReason })` threads a `PauseReasonState` Strategy through to `watchEnvelope`. Default Strategy returns `null` (unknown / not paused). Pairs with the daemon's new `notifier?: NotifierLike` debounce that fires exactly one Ntfy push per *transition* into `budget-paused` (see `novel/tick-loop/README.md` for the daemon side).

### Sub-task 7 (`OpenObserveStrategy` — live PromQL read path — shipped)

`OpenObserveStrategy` (`fetchOpenObserveSnapshot` / `queryOpenObservePromql` / `parsePromqlInstantResponse` / `openObserveGetValue` in `src/strategy.ts`) is the live-read implementation of the `GetValue` seam — issues read-only HTTP GETs against an OpenObserve daemon's PromQL instant-query endpoint (`/api/<org>/prometheus/api/v1/query`). Closes the P0 task `observability-backend-deploy`; vision.md row 66.

When `OBSERVABILITY_BACKEND=openobserve` is set, `start.ts` plumbs the Strategy in and `/watch.json` returns live values for the OTEL-backed success criteria (rows 1, 2, 5, 6, 9 — uptime, tokens/story, MTTR, wrist-dwell, token-budget) instead of `(stub)`. **Read-only by construction**: the Strategy never POSTs to OpenObserve — the OTLP write side is handled by `@minsky/observability` via OTLP HTTP exporters. `OPENOBSERVE_BASE_URL` (default `http://127.0.0.1:5080`), `OPENOBSERVE_USER` + `OPENOBSERVE_PASSWORD` (optional HTTP Basic auth) configure the connection. See [`distribution/openobserve/README.md`](../../distribution/openobserve/README.md) for install + verify.

```ts
import { openObserveGetValue, createServer } from "@minsky/dashboard-web";
const getValue = await openObserveGetValue({ baseUrl: "http://127.0.0.1:5080" });
createServer({ getValue }); // every row that has a PromQL mapping renders live
```

Failed reads (network down, malformed response, non-2xx) graceful-degrade to `null` per metric → the dashboard then renders `(stub)` for those rows.

### Sub-task 8 (`POST /control` — pause/resume Shortcut endpoint — shipped)

`createServer({ ..., setPaused })` adds a third route `POST /control` that closes the round-trip on the Apple-Shortcuts pause/resume pair (`distribution/shortcuts/{pause,resume}.shortcut.json`). The handler validates `{paused: boolean}` (rule #7 — upstream-malformed graceful-degrade) and applies the value through the injected `setPaused: (v: boolean) => void` Strategy (rule #2 — adapter seam, mirroring the existing `getPauseState` shape).

`parseControlBody(unknown) => {ok:true, paused} | {ok:false, error}` is the pure validator in `src/control.ts`; the route handler in `src/server.ts` is the I/O boundary. The default `getPauseState` + `setPaused` pair (`createMemoryPauseState`) closes over a single in-memory boolean so a `POST /control {paused:true}` round-trips into the next `GET /watch.json` body without any caller wiring — production supervisors that own the canonical sentinel inject their own pair.

| Body | Status | Response |
| --- | --- | --- |
| `{paused: true}` | 200 | `{ok: true, paused: true}` (Strategy called once with `true`) |
| `{paused: false}` | 200 | `{ok: true, paused: false}` (Strategy called once with `false`) |
| missing / non-JSON | 400 | `{error: "missing body"}` |
| `{}` / `{other:1}` | 400 | `{error: "missing paused field"}` |
| `{paused: "true"}` / `{paused: 1}` / `{paused: null}` | 400 | `{error: "paused must be boolean"}` |

The smoke test in `distribution/shortcuts/test/shortcuts-json.test.mjs` was tightened in the same PR to assert that every `post-control` shortcut targets `:8080/control` with a `request_body` whose `paused` field is a boolean — the schema half of the dashboard ⇄ Shortcut contract is now deterministically gated on both sides (the dashboard route returns 400 for anything else; the Shortcut JSON cannot ship anything else).

### Spec-alignment fix (`dashboard-web-task-throughput-formula-drift`)

`src/metrics.ts`'s `task-throughput` formula now matches `vision.md` § "Success criteria" row 10 exactly: the 30-day commit count is divided by 30 (`… | wc -l / 30`) to produce the unit `tasks/day`. Earlier the divisor was missing while the unit cell still read `tasks/day` — a silent 30× over-read once `dashboard-web-otel-wiring`'s Strategy executes the formula. A new test in `test/metrics.test.ts` string-matches `/ 30` against the formula so the drift cannot recur silently.

## Usage

```ts
import { createServer, snapshotGetValue, SUCCESS_METRICS } from "@minsky/dashboard-web";
import { serve } from "@hono/node-server";

// Default: every row renders `(stub)` (backward-compatible).
const { fetch } = createServer({ metrics: SUCCESS_METRICS });
serve({ fetch, port: 8080 }); // distribution/run-dashboard-web.sh owns the port choice

// With a snapshot Strategy: `(stub)` count drops to 0 for every metric
// the snapshot covers; uncovered metrics fall back to `(stub)` per row.
const snapshot = { "loop-uptime": "0.99", "tokens-per-story": "12345" };
createServer({ getValue: snapshotGetValue(snapshot) });
```

## Localhost-only by default (security)

Per vision.md rule #13.4 (security minimum bar — boundary protection, NIST SP 800-53 SC-7), the dashboard binds to `127.0.0.1` by default. LAN exposure requires explicit operator opt-in via `MINSKY_DASHBOARD_BIND=0.0.0.0`. The bind decision lives in `src/bind.ts` (pure helper) consumed by `src/start.ts`. See `test/bind.test.ts` for the paired tests.

The full threat model — STRIDE focus, recommended remote-access patterns (SSH local-forward / Tailscale ACL / reverse-proxy with auth), and the verification commands — lives in [`docs/security/dashboard-exposure.md`](../../docs/security/dashboard-exposure.md).

### `POST /control` requires a per-run token (slices 1–3 shipped)

Even when the operator opts into LAN exposure, the `POST /control` endpoint must still gate on a per-run secret so a curious neighbor on the WiFi can't pause the supervisor. Slice 1 (PR #276) ships the three pure helpers in `src/control-auth.ts`:

- `resolveControlToken(env, generateRandom)` reads `MINSKY_CONTROL_TOKEN` if set, falling back to `generateRandom()` (production: `crypto.randomBytes(32).toString("hex")`). Empty-string env is treated as unset (mirrors `bind.ts`).
- `validateControlAuth(headers, expectedToken)` does a length-then-byte-XOR constant-time compare of the `X-Minsky-Token` header against the expected token (NIST SP 800-63B "Memorized Secret" comparison; OWASP ASVS 2.10).
- `controlTokenStartupHint(resolved)` formats the stderr line the operator reads after server start. The env-source variant deliberately does NOT echo the secret; the generated-source variant does (operator must be able to copy it).

Slice 2 (PR #277) wires `validateControlAuth` into the `POST /control` route via a new `createServer({ controlToken })` arg. The auth check runs before body parse — bad/missing `X-Minsky-Token` header returns `401 Unauthorized` regardless of body shape (fail-fast), and the `setPaused` Strategy is never called on the unauthenticated branch (verified by call-counter assertions).

Slice 3 (this PR) closes the `controlToken=undefined` fail-open default for production. `src/start.ts` now resolves the token at boot via `resolveControlToken(process.env, () => randomBytes(32).toString("hex"))`, writes `controlTokenStartupHint(...)` to stderr immediately after the bind warning (so the operator sees the token verbatim when it was generated, or the env-source confirmation when it was supplied), and forwards the resolved token verbatim into `createServer({ controlToken })`. The previous backward-compat path (`controlToken=undefined`) survives in `createServer`'s signature so existing test wiring keeps working without per-test ceremony, but the production binary always binds a real token. Setting `MINSKY_CONTROL_TOKEN` pins the value across restarts (so the operator's saved curl scripts and Apple-Shortcut bodies keep working); leaving it unset rotates the token on every boot (defense-in-depth — a leaked token expires the next time the supervisor restarts the dashboard). Paired tests live in `test/control-auth.test.ts` (15 cases) and `test/server.test.ts` (11 cases — missing header / wrong token / case-insensitive header lookup / `controlToken=undefined` preserves v0 behavior / constant-time wiring / `setPaused` never called on 401); `start.ts` itself is the thin I/O boundary that composes the already-tested pure helpers.

### Sub-task 8 (Path A scoreboard metrics — shipped)

PR #873 adds three rows to `SUCCESS_METRICS` that track Path A's deletion progress as the canonical scoreboard:

- `path-a-loc-novel-tree` — total LOC under `novel/` (TS+TSX, tests excluded). Budget: ≤10K. Today (~27K after phase-7b deletion) is 2.7× over and stays red until phase-11b deletion lands.
- `path-a-loc-tick-loop` — `novel/tick-loop/` LOC. Phase-11b deletion target. Today (~17K) → 0 post-supervisor-parity. Largest single tree in `novel/`.

> `path-a-loc-cross-repo-runner` was retired in PR #883 (phase-7b step 6/7); `novel/cross-repo-runner/` was deleted, the metric's terminal value is 0.

The collectors live in `scripts/collect-metrics.mjs` as `collectPathALoc(subtree)` (single helper, three CLI bindings — one per metric ID). Each runs `fd -e ts -e tsx --type f --exclude '*.test.*' . <subtree>/ | xargs wc -l | tail -1 | awk '{print $1}'` under bash pipefail so a fd / xargs / wc failure returns null rather than a misleading 0. The renderer (`scripts/metrics-render.mjs` → `scripts/generate-metrics-md.mjs`) picks them up from the daily snapshot just like every other `SUCCESS_METRICS` entry — no per-metric wiring.

Anchor: `docs/plans/2026-05-24-path-a-aggressive-cut.md` § "Scoreboard"; Goodhart's Law (the 2026-05-25 retro found 72 PRs / +14K LOC delta over 24h — vanity green, strategic red, exactly the failure mode this metric makes impossible to hide); Ries 2011 (no vanity metrics); Forsgren/Humble/Kim 2018 (measure what matters). Closes TASKS.md `path-a-loc-scoreboard-metric` (P1, M1).
