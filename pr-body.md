# feat(runany): bounded self-restart supervisor — full two-layer wire-in

P0 `runany-self-restart-bounded-timelimit`.

## Why needed

The run-anywhere conductor must auto-restart on any crash with
**escalating, capped, reset-on-health backoff**, repeatedly, until a
configured wall-clock ceiling — then stop **cleanly** (no zombie, no
infinite restart past the deadline). This branch builds that as a
two-layer supervisor across three commits, freshly based on current
`main` (merge-base `7831048`, clean 3-dot diff — no revert of merged
work):

1. **Decision core + chaos measurement** (`ea8cf17`) — the pure
   `decideRestart` ladder + the `chaos-restart-schedule.mjs` harness.
2. **Conductor boot wire-in** (`4a47198`) — `decideStartupThrottle`
   wired into `orchestrate.mjs` so the ladder is operative in production
   and the deadline is bounded *across* launchd respawns (not
   per-process).
3. **OS-supervision layer + tunable health-reset** (this iteration) —
   the launchd half the prior two commits were missing, so the supervisor
   is actually bootstrapped by the OS, not just simulated.

Without commit 3 the escalation logic existed but nothing at the OS
boundary respawned the conductor, and `MINSKY_HEALTHY_RESET` (the
documented reset-window control) had no env path — it was a hard-coded
20m default. This iteration closes both gaps and lands the operator
runbook.

## What changed (this iteration)

- **`distribution/launchd/com.minsky.runany.plist`** — the OS half of
  the two-layer supervisor. `KeepAlive{SuccessfulExit:false}` so a clean
  exit 0 at the deadline is **not** respawned (Acceptance #3); flat
  `ThrottleInterval` as a floor — the escalating ladder lives in the
  conductor's boot self-throttle (launchd `ThrottleInterval` is a single
  flat number and cannot escalate). Named `.plist` (not `.tmpl`) so
  `setup.sh`'s Darwin `*.plist` glob (`setup.sh:409`) actually renders
  it — a `.tmpl` suffix would leave the unit inert. Rationale in the
  plist header + `docs/run-anywhere.md`.
- **`distribution/systemd/run-runany.sh`** — thin runner the unit
  `exec`s; `exec node scripts/orchestrate.mjs`.
- **`distribution/systemd/lib-launchd-path.sh`** — single sourced
  PATH-resolution helper (rule #1, see Optimization).
- **`scripts/orchestrate.mjs`** — wire `MINSKY_HEALTHY_RESET` through
  `parseDurationSec` (same graceful-degrade contract as
  `MINSKY_RUN_TIME_LIMIT`: a typo'd value falls back to the 20m default,
  rule #7), making the documented reset-window control real.
- **`docs/run-anywhere.md`** — operator runbook: two-layer model,
  backoff ladder, ceiling semantics, env control surface, install,
  chaos-verify (rule-3 doc-first for the new `distribution/**` units).
- **pattern-index not-applicable markers** on the 3 new supervisor units
  (already covered by the Supervisor transient-restart row in vision.md's
  Pattern conformance index — same convention as
  `com.minsky.watchdog.plist` / `run-budget-guard.sh`).

The decision core, boot wire-in, and 22 supervisor/chaos unit tests from
commits 1–2 are unchanged. OS layer + tunable-reset cherry-picked
forward from canonical sibling `worktree-daemon-4` (`376807e`,
`bd43449`) — slice reuse, not re-derive.

Acceptance: (1) escalating-capped ladder `[5,30,300]` implemented +
tested + operative in production ✅ (2) resets after sustained health,
now operator-tunable via `MINSKY_HEALTHY_RESET` ✅ (3) hard time-limit
clean stop, 0 restarts after — bounded across launchd respawns +
`KeepAlive{SuccessfulExit:false}` so the OS does not respawn the clean
exit ✅ (4) chaos measurement all-true ✅. (`bin/minsky` opt-in flag is
an optional cosmetic follow-up — the launchd unit is the supervising
wrapper the task Details/Touches direct; not load-bearing for any
Acceptance criterion.)

## Verification

- `node scripts/chaos-restart-schedule.mjs --json` →
  `{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}`
  (exit 0) — Acceptance #4, all four observables true.
- `npx vitest run scripts/restart-supervisor.test.mjs scripts/chaos-restart-schedule.test.mjs`
  → 22/22 pass.
- `plutil -lint distribution/launchd/com.minsky.runany.plist` → OK;
  `bash -n` on both shell files → OK.
- Live boot smoke: `MINSKY_NO_STARTUP_BACKOFF=1 MINSKY_RUN_TIME_LIMIT=1s
  node scripts/orchestrate.mjs --interval-ms=999999` → one tick, then
  `MINSKY_RUN_TIME_LIMIT reached — clean stop, exit 0`; state file
  persisted `{"startMs":…,"originMs":…,"restartIndex":1}`.

## Scout

Pre-existing findings (not introduced here, not fixed here —
surgical-change rule):

1. `orchestrate.mjs` hardcodes `REPO = MINSKY_HOME ??
   <minsky-repo>`. On a host without that path
   and no `MINSKY_HOME`, the restart-state write rule-#7 no-ops silently
   (escalating backoff falls back to flat base on every boot). Worth a
   P2 for non-author-machine portability now the launchd unit lands.
2. `novel/tick-loop/src/minsky-bootstrap-smoke.test.ts` (identical to
   `main`) fails the full-stage vitest gate whenever the shell exports
   `MINSKY_LLM_PROVIDER` — `maybeBootstrapLocalLlm` reads `process.env`
   directly past its DI seam, leaking the daemon-runtime env var into the
   test. Fix = sandbox `MINSKY_LLM_PROVIDER`/`MINSKY_LOCAL_LLM` in that
   test (or full DI). Full-stage here verified with those vars unset
   (clean-state CI environment).

## Optimization (operator directive — one measurable/iteration)

**Duplication elimination (rule #1).** The launchd PATH-resolution block
(node-manager globs + `gh`/`claude`/`opencode`) is factored into one
sourced helper `distribution/systemd/lib-launchd-path.sh`.
`run-runany.sh` sources it (~15 lines) instead of carrying its own copy
(~55 lines) — ~1.5 KB (≫ 10-byte floor) of avoided duplication and one
source of truth, so the new runner can't drift from the documented
PATH-resolution behaviour. (`run-tick-loop.sh` keeps its inline copy —
surgical-changes rule; migrating it onto the helper is a low-risk
follow-up, not in scope here.)

## Hypothesis self-grade

- **Predicted**: landing the launchd OS layer + wiring `MINSKY_HEALTHY_RESET` makes the escalating/capped/reset-on-health backoff operative end-to-end with an OS supervisor that does not respawn the clean deadline exit; the chaos measurement stays all-true and the supervisor unit tests + plist lint pass
- **Observed**: `chaos-restart-schedule.mjs --json` → `{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}` (exit 0); 22/22 supervisor+chaos tests pass; `plutil -lint` OK; live boot smoke clean-stops exit 0 and persists `restartIndex:1`
- **Match**: yes
- **Lesson**: launchd's flat `ThrottleInterval` cannot express an escalating ladder and `KeepAlive` would respawn even a clean exit, so the retry budget must live with the retrier and the OS layer needs `SuccessfulExit:false` — the supervisor config alone could never satisfy Acceptance #1/#3

## Security & privacy

vision.md § 13 reviewed. New surface: a launchd LaunchAgent that
`exec node`s the conductor, a sourced shell helper that prepends
operator-local install dirs to `PATH`, and the existing
`.minsky/runany-restart-state.json` write. Threats + mitigations:
PATH-prepend could shadow a system binary — the helper only prepends
operator-owned home dirs + standard Homebrew/usr-local prefixes
(identical to long-running `run-tick-loop.sh`), gated on `-x` existence,
no network/secrets/PII, same uid as existing agents. A tampered
restart-state file could suppress backoff — it is local-only, gitignored,
two epoch-ms ints + a counter, rule-#7 best-effort reads fail safe
toward *more* throttling and a *fresh* bounded deadline. No new
auth/secret/sandbox/supply-chain/credential surface.
