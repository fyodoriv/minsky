## What & why

`runany-self-restart-bounded-timelimit` (TASKS.md P0): the run-anywhere
conductor must auto-restart on any crash with **escalating, capped,
reset-on-health backoff**, repeatedly, until a configured wall-clock
ceiling — then stop **cleanly** (no zombie, no infinite restart past the
deadline).

The pure decision core + chaos measurement + in-process deadline guard
were authored on a sibling daemon branch (PR #601) but that branch is
based on stale `main` — its diff reverts merged work (#597/#598/#600).
This PR **cherry-picks the two clean supervisor commits forward onto
current `main`** (no revert of merged work) and then adds the layer that
sibling PR was missing:

- **OS-supervision wrapper** (the task's `distribution/launchd/**` +
  wrapper Files, absent from #601): `com.minsky.runany.plist`
  (`KeepAlive{SuccessfulExit:false}` so a clean exit 0 at the deadline is
  **not** respawned; flat `ThrottleInterval` floor) →
  `distribution/systemd/run-runany.sh` → `scripts/orchestrate.mjs`. This
  is the OS half of the two-layer supervisor; the escalation half is the
  conductor's in-process startup self-throttle (cherry-picked).
- **`MINSKY_HEALTHY_RESET` wired** in `scripts/orchestrate.mjs`: the
  sustained-health reset window is now operator-tunable via
  `parseDurationSec` (same graceful-degrade contract as
  `MINSKY_RUN_TIME_LIMIT`), where before it was a hard-coded 20m default
  with no env path. Makes the documented control surface real.
- **`docs/run-anywhere.md`**: operator runbook (two-layer model, backoff
  ladder, ceiling semantics, env control surface, install, chaos verify).

### Filename deviation (intentional, documented)

The task Files string says `com.minsky.runany.plist.tmpl`. `setup.sh`'s
Darwin glob is `*.plist` (`setup.sh:409`) and its load loop is
`com.minsky.*.plist` (`setup.sh:451`) — a `.tmpl` suffix would make the
unit **inert** (never rendered, never bootstrapped). The existing
`com.minsky.*.plist` units are themselves `${MINSKY_HOME}` templates yet
named `.plist`. Named `.plist` to actually compose with the dogfood
install path (the task's stated intent: "Composes launchd
ThrottleInterval"). Rationale is in the plist header + the doc.

## Measurement

Task `**Measurement**` — `node scripts/chaos-restart-schedule.mjs --json`:

```json
{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}
```

All four observables true (Acceptance #4). `vitest run
scripts/restart-supervisor.test.mjs scripts/chaos-restart-schedule.test.mjs`
→ 22/22 pass. `plutil -lint` on the rendered plist → OK. `bash -n` on
both shell files → OK.

Acceptance: (1) escalating capped ladder `[5,30,300]` implemented +
tested ✅ (2) resets after sustained health ✅ (3) hard time-limit clean
stop, 0 restarts after ✅ (4) chaos measurement all-true ✅.

## Optimization (operator directive 2026-05-05 — one measurable/iteration)

**Duplication elimination (rule #1).** The ~40-line launchd PATH-
resolution block (node-manager globs + `gh`/`claude`/`opencode`) is
factored into a single sourced helper
`distribution/systemd/lib-launchd-path.sh`. `run-runany.sh` sources it
(~15 lines) instead of carrying its own copy (~55 lines) — ~1.5 KB of
avoided duplication and one source of truth, so the new runner can't
drift from the documented PATH-resolution behaviour. (`run-tick-loop.sh`
keeps its inline copy this iteration — surgical-changes rule, not
refactoring the production tick-loop runner here; migrating it onto the
helper is a low-risk follow-up.)

## Security & privacy

vision.md § 13 reviewed. New surface: a launchd LaunchAgent that
`exec node`s the conductor, and a sourced shell helper that prepends
operator-local install dirs to `PATH`. Threat: PATH-prepend could shadow
a system binary if an attacker controls `~/.local/bin` etc. Mitigation:
the helper only prepends **operator-owned home dirs and standard
Homebrew/usr-local prefixes** (identical to the long-running
`run-tick-loop.sh` resolution), gated on `-x` existence; no network, no
secrets, no PII, no privilege change (runs as the same uid as the
existing agents). The plist runs `/bin/bash` on a repo-local script
substituted only with `${MINSKY_HOME}` via `envsubst`. No new
supply-chain or credential surface.

## Hypothesis self-grade

- **Predicted**: with the supervisor landed on clean main + the launchd OS layer wired, an injected crash-loop backs off on the documented `[5,30,300]` ladder, resets to base after a sustained-healthy window, and the run stops cleanly at `MINSKY_RUN_TIME_LIMIT` with zero restarts after — i.e. `node scripts/chaos-restart-schedule.mjs --json` is all-true.
- **Observed**: `{"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}`; 22/22 unit tests pass; plist lints OK.
- **Match**: yes
- **Lesson**: cherry-picking the clean commits off a stale sibling branch avoids dragging its merged-work reverts into the PR — the next iteration's wrapper layer composes cleanly on top.
