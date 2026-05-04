# `@minsky/notifier`

`Notifier` adapter — interface (Adapter pattern, Gamma 1994) over push
channels, plus a `StubNotifier` test fake (Meszaros 2007) and an
`NtfyNotifier` HTTP Strategy posting to [ntfy.sh](https://ntfy.sh) (or
self-hosted ntfy).

The (future) tick-loop daemon uses this surface to send (a) one
morning summary at ~07:00 local with a roll-up of the prior N ticks
(story-001 acceptance #6 — "a morning notification summarizes work
done"), and (b) circuit-break-and-notify alerts for budget-guard PAUSE
events / supervisor restarts (rule-#7 chaos table).

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index):

- **`Notifier` interface** — Adapter (structural) per Gamma, Helm,
  Johnson, Vlissides, *Design Patterns*, 1994. **Conformance: full.**
- **`StubNotifier`** — test fake / spy hybrid per Meszaros, *xUnit Test
  Patterns*, 2007 — records calls in-memory, returns `{ ok: true }`.
  **Conformance: full.**
- **`NtfyNotifier`** — Strategy (behavioral) per Gamma 1994 + thin HTTP
  POST to ntfy's documented publish surface. **Conformance: full.**

## Usage

```ts
import { NtfyNotifier, StubNotifier } from "@minsky/notifier";

// Production: ntfy.sh public tier.
const ntfy = new NtfyNotifier({
  topic: process.env.MINSKY_NTFY_TOPIC ?? "minsky-fyodor",
  // Caller is responsible for keychain lookup; the adapter never shells
  // out to `security`. Mirrors the `MaciekTokenMonitor` pattern.
  authToken: process.env.MINSKY_NTFY_TOKEN,
});

const r = await ntfy.push({
  title: "morning summary",
  body: "4 P2 tasks completed; 12_000 tokens consumed",
  priority: "low",
  tags: ["sunrise"],
});
if (!r.ok) console.warn(`push failed: ${r.reason}`);

// Tests: drop-in fake.
const stub = new StubNotifier();
await daemon.run({ notifier: stub });
expect(stub.calls).toHaveLength(1);
```

### Constructor opts

- `topic` (required) — ntfy topic name (e.g. `"minsky-fyodor"`).
- `serverBaseUrl?` — defaults to `"https://ntfy.sh"`. Pass a self-hosted
  base URL if you run your own ntfy. Trailing slash is normalised.
- `authToken?` — optional bearer token; sent as
  `Authorization: Bearer <token>`. Caller is responsible for resolving
  this from the OS keychain — same pattern as the `MaciekTokenMonitor`'s
  `configDir` opt.
- `fetchFn?` — injectable `fetch` for testability. Defaults to the
  global `fetch` (Node 18+). We do **not** add a `node-fetch` dep
  (rule #1 — don't reinvent the wheel; the global is already there).

### Priority mapping

Our transport-agnostic `NotificationPriority` maps to ntfy's documented
numeric priority (1 = min, 5 = max):

| Our value | ntfy `Priority` header | Client behaviour |
|---|---|---|
| `'low'` | `2` | quiet but visible |
| `'normal'` (default) | `3` | default sound/vibration |
| `'high'` | `5` | urgent sound; bypasses iOS DND |

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `push()` returns `{ ok: true }` against a
  reachable, unrate-limited ntfy server within 2 s p95.
- **Blast radius**: a single push call. The adapter holds no shared
  state across calls; the daemon's pacing (max 3 pushes/day at default)
  is the rate limit on this surface.
- **Operator escape hatch**: callers swap `NtfyNotifier` for
  `StubNotifier` (or any other `Notifier` Strategy) without touching
  downstream code; the interface is the contract. The daemon's morning
  summary will fall back to the dashboard's `(stub)` rendering — the
  push channel is best-effort, not load-bearing for safety.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | ntfy.sh down (planned maintenance, regional outage) | server returns 5xx for the topic | `graceful-degrade` — `push()` returns `{ ok: false, reason: 'http 503' }`; daemon logs and continues; the missed morning summary surfaces in the dashboard `last-notification` field instead | `ntfy.test.ts` "returns { ok: false } on a 5xx without throwing" |
| 2 | Network partition (DNS fail, captive-portal Wi-Fi, offline laptop) | `fetch` rejects with `ENOTFOUND` / `ECONNREFUSED` / `ETIMEDOUT` | `graceful-degrade` — `push()` returns `{ ok: false, reason: 'network: <message>' }`; never throws; daemon loop continues. `selfTest()` flips to `red` so the dashboard surfaces the outage | `ntfy.test.ts` "returns { ok: false, reason: 'network: …' } when fetch rejects (network partition)" + `ntfy.test.ts` "selfTest returns red on a network error" |
| 3 | Rate-limited (free-tier ntfy.sh enforces a per-IP quota; abusive topic auto-throttles) | server returns 429 | `circuit-break-and-notify` (graceful-degrade variant) — `push()` returns `{ ok: false, reason: 'http 429' }`; `selfTest()` flips to `yellow` (service is up, we're throttled) so the operator sees a soft-fail rather than a red, distinguishing "ntfy is broken" from "we're being too noisy" | `ntfy.test.ts` "returns { ok: false, reason: 'http 429' } on rate-limited response" + `ntfy.test.ts` "selfTest returns yellow on rate-limit (429)" |
| 4 | Auth token revoked / expired (self-hosted) | server returns 401 / 403 | `graceful-degrade` — `push()` returns `{ ok: false, reason: 'http 401' }` (or 403); operator sees the failure in the dashboard's `last-notification` field and rotates the keychain entry. The adapter does not auto-retry — the keychain is operator-owned. | shares the non-2xx code path asserted by `ntfy.test.ts` "returns { ok: false } on a 5xx without throwing" (any non-2xx maps to `{ ok: false, reason: 'http <status>' }`); manual end-to-end test: set `MINSKY_NTFY_TOKEN=invalid` and assert the same shape on a real server |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: A stub-backed `Notifier` interface + a thin
  `NtfyNotifier` HTTP Strategy gives the daemon a push channel without
  coupling business logic to ntfy.sh; tests assert request shape via an
  injected fetch-mock so no network is touched in CI.
- **Success threshold**: ≥6 paired tests pass (stub + ntfy);
  `selfTest()` returns `green` against a mock 200; the chaos table has
  ≥3 rows; `pnpm vitest run novel/adapters/notifier --reporter=json |
  jq -e '.numPassedTests >= 6 and .numFailedTests == 0'` exits 0.
- **Pivot threshold**: if ntfy.sh proves unreliable (≥1 outage / week
  sustained over 4 weeks, OR rate-limits free-tier minsky topics within
  the documented 3-pushes/day budget), pivot the Strategy to APNs (via
  a webhook bridge) or self-hosted ntfy on the user's Tailnet. The
  pivot is *Strategy-level*: the interface and consumers are unchanged.
- **Measurement**:
  `pnpm vitest run novel/adapters/notifier --reporter=json | jq -e '.numPassedTests >= 6 and .numFailedTests == 0'`
- **Literature anchor**: Gamma et al., *Design Patterns*, 1994 (Adapter
  + Strategy); Hunt-Thomas, *The Pragmatic Programmer*, 1999, Tip 32
  ("Crash Early — but the crash needs to reach the operator");
  Meszaros, *xUnit Test Patterns*, 2007 (test fake); rule #2.

## Manual smoke test against ntfy.sh

```bash
# Subscribe to the topic in another terminal (or the ntfy iOS app):
curl -s "https://ntfy.sh/minsky-smoke-$(date +%s)/json"

# Send a push from the adapter:
node -e "
import('@minsky/notifier').then(async (m) => {
  const n = new m.NtfyNotifier({ topic: 'minsky-smoke-${TOPIC}' });
  const r = await n.push({
    title: 'manual smoke',
    body: 'hello from @minsky/notifier',
    priority: 'low',
  });
  console.log(r);
});
"
```

The subscriber should receive the push within ~1 s; the printed
`{ ok: true }` confirms the round-trip.
