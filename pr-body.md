## runany: bounded self-restart supervisor core + chaos measurement (slice 1)

P0 `runany-self-restart-bounded-timelimit` — keystone slice.

### Why needed

Today launchd restarts the conductor indefinitely with a flat
`ThrottleInterval` and **no wall-clock ceiling**: a systematic
crash-loop hammers at a fixed cadence forever, and there is no clean
terminal stop — the run can never bound itself (violates rule #6 "stay
alive, but bounded"). This slice lands the pure decision substrate that
makes the supervision *escalating, capped, health-resetting, and
deadline-bounded*, plus the deterministic measurement that pins it.

### What this slice ships

- `scripts/restart-supervisor.mjs` — pure (rule #10) decision core:
  - `decideRestart` — precedence is **limit-wins** → escalating-capped
    backoff → reset-to-base after a sustained-healthy window.
  - `backoffMsFor` — Nth-restart delay, capped at the last ladder entry.
  - `parseDurationSec` — `<n>s|m|h` env parse with graceful fallback
    (rule #7: a typo'd `MINSKY_RUN_TIME_LIMIT` must not disable the
    deadline).
  - Default ladder **composes** the existing tick-loop-backoff anchor
    `[5,30,300]` (ARCHITECTURE.md L215, pinned by
    `scripts/check-tick-loop-backoff-schedule.mjs`) — no second drifting
    schedule constant (rule #1).
- `scripts/chaos-restart-schedule.mjs` — the task **Measurement**: a
  deterministic virtual-clock chaos sim (Basiri 2016) that asserts the
  four observables without spawning a process.
- `scripts/orchestrate.mjs` — surgical in-process deadline guard: at
  `MINSKY_RUN_TIME_LIMIT` the tick chain stops rescheduling so Node
  drains and exits 0 cleanly (no zombie, no restart past the deadline).
- Paired vitest suites for both new modules (15 tests).

Acceptance coverage: (1) escalating backoff schedule implemented +
tested ✓ — (2) backoff resets after sustained health ✓ — (3) hard
time-limit clean stop / 0 restarts after ✓ (decision core + orchestrate
guard; launchd plist + `bin/minsky` wrapper wiring is the follow-up
slice) — (4) chaos measurement all-true ✓.

Cherry-picked forward from sibling `worktree-daemon-0` onto current
`main` (sibling-slice-reuse, not re-derived).

### Measurement (reviewer-relevant)

```console
$ node scripts/chaos-restart-schedule.mjs --json
{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}

$ npx vitest run scripts/restart-supervisor.test.mjs scripts/chaos-restart-schedule.test.mjs
 ✓ scripts/chaos-restart-schedule.test.mjs (3 tests)
 ✓ scripts/restart-supervisor.test.mjs (12 tests)
 Test Files  2 passed (2)   Tests  15 passed (15)
```

### Optimization (per-iteration discipline)

Schedule-constant dedup: the default backoff ladder reuses the existing
`[5,30,300]` tick-loop anchor instead of declaring a second schedule
literal. Eliminates a drift-prone duplicate definition (>10 bytes; one
canonical schedule surface instead of two).

## Hypothesis self-grade

- **Predicted**: today launchd restarts indefinitely with a flat throttle and no time ceiling; after this, an injected crash-loop backs off on the documented `[5,30,300]` schedule, resets backoff after a sustained-healthy window, and stops cleanly at the time limit with 0 restarts after.
- **Observed**: `node scripts/chaos-restart-schedule.mjs --json` → `{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}`; 15/15 unit tests pass.
- **Match**: yes
- **Lesson**: the pure-core + virtual-clock-sim split makes the bounded-restart contract falsifiable without process spawning; next slice wires the launchd plist + `bin/minsky` wrapper against this same core.

## Security & privacy

vision.md § 13 reviewed. Minimal new surface: `parseDurationSec` reads
the `MINSKY_RUN_TIME_LIMIT` env var. Threat — a malformed/hostile value
disabling the deadline (unbounded run). Mitigation — the parser is
regex-bounded to `^\d+(\.\d+)?\s*(s|m|h)?$`, rejects non-positive /
non-finite values, and falls back to the 10h default on any parse
failure, so the deadline cannot be silently removed. No auth, secrets,
sandbox, PII, or supply-chain surface added.
