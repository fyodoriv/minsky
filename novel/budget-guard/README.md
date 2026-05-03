# `@minsky/budget-guard`

Token-budget watchdog. Observes a `TokenMonitor`, decides which response category applies (`graceful-degrade` / `circuit-break-and-notify` / `weekly-cap-warn` / `normal`), and pushes the decision to a callback.

Runtime envelopes ship incrementally. **HTTP envelope** (`localhost:9876/budget`, see [HTTP envelope](#http-envelope) below) and the flag-file envelope (`${MINSKY_HOME}/.minsky/budget.flag`, lands in `budget-guard-flag-file`) cover dashboard / Watch / shell consumers. The real `TokenMonitor` Strategy against Maciek's `claude-monitor` Python tool ships in `budget-guard-maciek-impl`.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 26:

- **`BudgetGuard`** — Watchdog (hardware / OS literature; periodic-deadline check loop). **Conformance: full.** Identifier matches the pattern's canonical name per rule #8.
- **`decide`** — Error-budget thresholding (Beyer et al., *SRE*, Ch. 3, 2016): treat tokens as the budget you spend, fire burn-rate alerts at relative thresholds. **Conformance: full.**
- **Decision categories** — Failure-mode response labels per rule #7 (`graceful-degrade`, `circuit-break-and-notify`). **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `BudgetGuard.tick()` returns a `BudgetDecision` whose `action` is one of `{normal, graceful-degrade, circuit-break-and-notify, weekly-cap-warn}` for every legitimate `TokenSnapshot`.
- **Blast radius**: a single tick / a single decision callback. The watchdog never makes its own outbound calls — the callback is the only side-effect surface.
- **Operator escape hatch**: `guard.stop()` halts the poll loop synchronously; the parent process continues.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | TokenMonitor.snapshot() throws | Strategy returns rejected promise (upstream-error) | `loud-crash-supervisor-restart` (the unhandled rejection bubbles to the supervisor) | (deferred — covered when `budget-guard-maciek-impl` ships and integration tests exist) |
| 2 | Snapshot has malformed numbers (NaN / Infinity / negative) | corrupted Maciek cache file (upstream-malformed) | `graceful-degrade` — `consumedFraction` clamps to `[0, 1]`; `decide()` still returns a defined action | covered by `consumedFraction` clamp tests |
| 3 | Window-reset edge causes `tokensRemainingInWindow > windowSizeTokens` | clock skew across a 5h boundary (clock) | `graceful-degrade` — clamp to 0 consumed | covered by clamp test |
| 4 | `windowSizeTokens` is 0 | TokenMonitor returns a freshly-bootstrapped value (upstream-malformed) | `graceful-degrade` — return 0 consumed (avoid div / 0) | covered by zero-window test |
| 5 | Guard started twice | misconfigured caller (process-state) | `graceful-degrade` — second `start()` is a no-op | covered by idempotency test |
| 6 | `GET /budget` before any decision recorded | server started before guard's first tick (process-state) | `graceful-degrade` — HTTP 503 with `{ "error": "no decision recorded yet" }` so consumers can distinguish "not ready" from "broken" | covered by `HonoBudgetServer` 503 test |
| 7 | Port collision on default 9876 | another process owns the port (resource-contention) | `loud-crash-supervisor-restart` — `serve()` rejects synchronously; supervisor restarts after the operator picks a free port via `MINSKY_BUDGET_GUARD_PORT` | covered manually; ephemeral-port `start({ port: 0 })` test exercises the bind path |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: a pure `decide()` function over snapshot + thresholds plus a thin `setInterval` watchdog suffices to express the entire budget-guard policy from `ARCHITECTURE.md` § "Token economy" without I / O coupling.
- **Success threshold**: 100 % branch + statement coverage on the package; `pnpm test` green; `decide()` returns the documented action for every region of the threshold space (normal / degrade / circuit-break / weekly-warn).
- **Pivot threshold**: if a real-world `TokenSnapshot` shape requires more than four BudgetAction categories — pivot to a configurable rule engine (e.g., a small DSL evaluated against the snapshot).
- **Measurement**: `pnpm vitest run novel/budget-guard --coverage --reporter=json | jq '.numTotalTests, .testResults[].assertionResults | length'`
- **Literature anchor**: Beyer et al., *Site Reliability Engineering* 2016 (error-budget burn-rate alerting); watchdog-timer literature (hardware / OS).

## Usage

```ts
import { BudgetGuard, decide, DEFAULT_THRESHOLDS } from "@minsky/budget-guard";
import { StubTokenMonitor } from "@minsky/token-monitor";

// Stub for tests / docs.
const monitor = new StubTokenMonitor();
const guard = new BudgetGuard(monitor, (d) => {
  console.log(`[budget-guard] ${d.action}: ${d.reason}`);
});

// One-shot:
const decision = await guard.tick();

// Or run continuously (60s polling by default):
guard.start();
// ...
guard.stop();
```

### Pure `decide()` for any custom loop

```ts
import { decide, DEFAULT_THRESHOLDS } from "@minsky/budget-guard";

const action = decide(snapshot, DEFAULT_THRESHOLDS).action;
```

## HTTP envelope

Dashboard, Watch shortcut, and ad-hoc consumers poll a tiny Hono server at `localhost:9876/budget`:

```sh
curl -s localhost:9876/budget | jq
# {
#   "remaining": { "tokens": 800000, "minutes": 300, "cost": null },
#   "weekly_headroom_pct": 100,
#   "recommended_action": "normal",
#   "observed_at": "2026-05-03T00:00:00Z",
#   "decided_at": "2026-05-03T00:00:00.123Z"
# }
```

Wire into a `BudgetGuard` like so:

```ts
import { BudgetGuard, HonoBudgetServer } from "@minsky/budget-guard";

let last;
const guard = new BudgetGuard(monitor, (d) => { last = d; });
guard.start();

const server = new HonoBudgetServer(() => last);
const { url } = await server.start();
console.log(`[budget-guard] listening on ${url}`);
```

Returns HTTP 503 (`{ "error": "no decision recorded yet" }`) until the guard has produced its first decision, so consumers can distinguish "not ready" from "broken".

The default port (9876) is overridden by `MINSKY_BUDGET_GUARD_PORT`, or by passing `start({ port })` directly. Pass `port: 0` to bind an ephemeral port (used by tests).

`cost` is `null` until `budget-guard-maciek-impl` lands the real `TokenMonitor` strategy that surfaces Maciek's cost prediction.

The Hono dependency is hidden behind the `BudgetServer` interface (Adapter, Gamma et al. 1994) — alternative implementations can be plugged in without touching callers.

## Flag-file envelope

> Ships in [`budget-guard-flag-file`](../../TASKS.md). Renders the same decision into `${MINSKY_HOME}/.minsky/budget.flag` for shell consumers (`setup.sh`, supervisor unit-files).

## Follow-up tasks

The full `budget-guard-v0` epic decomposes into these P1 sub-tasks (tracked in `TASKS.md`):

- **`budget-guard-flag-file`** — write `${MINSKY_HOME}/.minsky/budget.flag` so shell scripts can `cat` it. Path moved from `/var/run/minsky/` (which would need root) to the user-writable `.minsky/`; declared deviation per rule #8 — root-required paths are out of scope for solo-dev tier.
- **`budget-guard-maciek-impl`** — real `TokenMonitor` Strategy against Maciek's Python `claude-monitor` cache file. Adapter test against a live Maciek install.
- **`budget-guard-publish-dry-run`** — pre-publish smoke for `@minsky/budget-guard` and `@minsky/token-monitor`.
