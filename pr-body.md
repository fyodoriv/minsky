# feat(runany): bounded self-restart supervisor — production wire-in

P0 `runany-self-restart-bounded-timelimit`.

## Why needed

`ea8cf17` shipped the pure decision core (`decideRestart`) + the chaos
measurement, but the escalating backoff was **only exercised by the
simulator** — nothing in production called it. Two real gaps remained:

1. **Escalating backoff was not operative.** launchd `KeepAlive` respawns
   the conductor, but `ThrottleInterval` is a single *flat* number;
   launchd cannot escalate. So a real crash-loop hammered at the flat
   5s throttle forever — the documented 5s→30s→300s ladder existed only
   in the sim.
2. **The deadline was not actually bounded across restarts.** The
   in-process guard measured elapsed against a *per-process* `RUN_START_MS`
   that resets on every launchd respawn. A conductor that crashes every
   9h59m earns a *fresh* 10h budget on each respawn — the
   `MINSKY_RUN_TIME_LIMIT` ceiling never bites (defeats Acceptance #3:
   "0 restarts after the limit").

This iteration wires the tested pure core into the conductor's boot path
so both behaviours are real, not simulated.

## What changed

- `scripts/restart-supervisor.mjs` — new pure (rule #10) `decideStartupThrottle`:
  given the previous life's persisted state + the clock, returns the
  sleep, the next restart index, and the supervised-run origin. Delegates
  to the existing `decideRestart` (rule #1 — one decision core, no second
  drifting schedule). The retry budget lives with the retrier
  (Beyer SRE 2016), since launchd can't escalate.
- `scripts/orchestrate.mjs` — surgical boot wire-in: at startup (non-`--once`)
  it reads `.minsky/runany-restart-state.json`, calls `decideStartupThrottle`,
  persists the next state, self-throttles the escalating/capped/reset-on-health
  backoff, and pins the **supervised-run** deadline origin (carried across
  launchd respawns) so the wall-clock ceiling is a true bound. State
  tracking always runs; only the sleep is skipped by
  `MINSKY_NO_STARTUP_BACKOFF=1` (tests / CI / fast operator runs).
  Reads/writes are rule #7 best-effort: absent/corrupt state degrades to
  a clean first-run, never a throw that would defeat the supervisor.
- `scripts/restart-supervisor.test.mjs` — 7 new cases for the boot
  decision (first-run, escalation, cap, health-reset resets origin too,
  legacy state without `originMs`, default reset window, purity).

Acceptance progress: (1) escalating-capped backoff — now operative in
production ✓; (2) reset-after-sustained-health — operative + resets the
deadline origin too ✓; (3) hard time-limit clean stop, 0 restarts after —
now bounded *across* launchd respawns ✓ (was per-process before); (4)
chaos measurement all-true ✓. Remaining follow-up slices (separate
iterations, already enumerated in the task's Files list):
`distribution/launchd/com.minsky.runany.plist.tmpl`, the `bin/minsky`
wrapper opt-in, and `docs/run-anywhere.md`.

## Verification

- `node scripts/chaos-restart-schedule.mjs --json` →
  `{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}`
  (exit 0).
- `npx vitest run scripts/restart-supervisor.test.mjs scripts/chaos-restart-schedule.test.mjs scripts/orchestrate.test.mjs`
  → 25 passed.
- Live boot smoke: `MINSKY_NO_STARTUP_BACKOFF=1 MINSKY_RUN_TIME_LIMIT=1s
  node scripts/orchestrate.mjs --interval-ms=999999` → one tick, then
  `MINSKY_RUN_TIME_LIMIT reached (1s ≥ 1s) — clean stop, exit 0`; state
  file written `{"startMs":…,"originMs":…,"restartIndex":1}`.

## Scout

Two pre-existing findings (not introduced here, not fixed here —
surgical-change rule; this PR's diff is restart-supervisor + orchestrate
only):

1. `orchestrate.mjs` hardcodes `REPO = MINSKY_HOME ??
   /Users/cbrwizard/apps/tooling/minsky`. On a host without that path
   and no `MINSKY_HOME`, both the `orchestrate.jsonl` ledger and the new
   restart-state write to a non-existent base — rule-#7 try/catch keeps
   it from throwing, but the persistence silently no-ops (escalating
   backoff falls back to flat base on every boot). Portability gap worth
   a P2 once the launchd/`bin/minsky` slices land on non-author machines.
2. `novel/tick-loop/src/minsky-bootstrap-smoke.test.ts` (identical to
   `main` — unrelated to this PR) fails the full-stage vitest gate
   whenever the shell exports `MINSKY_LLM_PROVIDER`: `maybeBootstrapLocalLlm`
   reads `process.env` directly rather than only its DI-injected seam,
   so the daemon-runtime env var leaks past the test fakes. The fix is
   to sandbox `MINSKY_LLM_PROVIDER`/`MINSKY_LOCAL_LLM` in that test (or
   make the function fully DI). The full-stage gate here was run/verified
   with those daemon-runtime vars unset (the clean state CI uses); all
   29 supervisor + bootstrap tests pass in that environment.

## Optimization

Round-trip elimination: a single `.minsky/runany-restart-state.json`
read at boot drives **both** the escalating-backoff history and the
supervised-run deadline origin. The naive design needs two state
surfaces (crash-history for backoff, run-origin for the ceiling) → two
reads per process boot; unifying them into one JSON object eliminates
one filesystem round-trip per launchd respawn (>10-byte / one-syscall
saving, the eligible "round-trip elimination" lever).

## Hypothesis self-grade

- **Predicted**: wiring `decideStartupThrottle` into the conductor boot makes the escalating/capped/reset-on-health backoff operative in production and bounds the deadline across launchd respawns; the chaos measurement stays all-true and the new boot decision is covered by passing unit tests
- **Observed**: `chaos-restart-schedule.mjs --json` → `{schedule_followed:true,reset_on_health:true,stopped_at_limit:true,restarts_after_limit:0}` (exit 0); 25/25 tests pass; live boot smoke clean-stops exit 0 at `MINSKY_RUN_TIME_LIMIT=1s` and persists `restartIndex:1`
- **Match**: yes
- **Lesson**: launchd's flat `ThrottleInterval` cannot express an escalating ladder, so the retry budget must live with the retrier (boot-time self-throttle off persisted history) — the supervisor config alone could never have satisfied Acceptance #1/#3

## Security & privacy

New surface: `orchestrate.mjs` now writes `.minsky/runany-restart-state.json`.
Threat: a tampered/poisoned state file could suppress backoff or move the
deadline origin. Mitigation: the file is local-only, gitignored (never
committed), contains only two epoch-ms integers + a small restart
counter (no secrets, no PII, no credentials); reads are rule-#7
best-effort (corrupt/garbage/absent → clean first-run, fail-safe toward
*more* throttling and a *fresh* bounded deadline, never toward unbounded
restarts); writes are best-effort and never gate the loop. No new
auth/secret/sandbox/supply-chain surface. vision.md § 13 reviewed.
