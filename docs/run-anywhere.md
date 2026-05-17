# Run-anywhere: bounded self-restarting conductor

The run-anywhere conductor (`scripts/orchestrate.mjs`) is supervised so
that **any crash auto-restarts with escalating backoff, repeatedly, until
a configured wall-clock ceiling — then it stops cleanly**. Task:
`runany-self-restart-bounded-timelimit`.

## Two-layer supervisor (compose, don't duplicate — rule #1)

| Layer | Where | Responsibility |
| --- | --- | --- |
| OS supervisor | `distribution/launchd/com.minsky.runany.plist` → `distribution/systemd/run-runany.sh` | `KeepAlive{SuccessfulExit:false}` respawns the conductor **only on non-zero exit**; a flat `ThrottleInterval` (5s) is the minimum respawn gap. launchd cannot escalate. |
| In-process self-throttle | `decideStartupThrottle` in `scripts/restart-supervisor.mjs`, wired in `scripts/orchestrate.mjs` | At boot the conductor reads its own persisted crash history (`.minsky/runany-restart-state.json`) and sleeps the **escalating, capped, reset-on-sustained-health** backoff before resuming. The same read pins the supervised-run deadline origin. |

A clean exit `0` at the deadline is **not** respawned by
`KeepAlive{SuccessfulExit:false}`, so the wall-clock ceiling is a true
terminal stop (no zombie, no infinite restart past the deadline).

## Backoff schedule

Escalating, capped ladder (seconds), reused from the tick-loop anchor
(`ARCHITECTURE.md` L215, `[5, 30, 300]`) rather than a second drifting
schedule:

```text
restart #1 → 5s   restart #2 → 30s   restart #3+ → 300s (cap)
```

After a **sustained-healthy window** (`MINSKY_HEALTHY_RESET`, default
20m) the ladder resets to base — a recovered run is not penalised for a
long-past crash-loop, and it earns a fresh wall-clock budget.

## Wall-clock ceiling

`MINSKY_RUN_TIME_LIMIT` (default `10h`) is the hard ceiling. It is
measured against the **persisted supervised-run origin** (carried across
launchd restarts), not the current process life — a crash-loop cannot
earn a fresh 10h every respawn. At the limit the conductor stops
scheduling, Node drains, and the process exits `0`. Accepts `<n>s|m|h`;
an unset/typo'd value falls back to the default (rule #7 graceful
degrade — a typo must not disable the deadline).

## Control surface

| Env var | Default | Effect |
| --- | --- | --- |
| `MINSKY_RUN_TIME_LIMIT` | `10h` | Hard wall-clock ceiling. `<n>s\|m\|h`. |
| `MINSKY_HEALTHY_RESET` | `20m` | Sustained-health window that resets the backoff ladder. |
| `MINSKY_ORCH_INTERVAL_MS` | `1200000` | Conductor tick period. |
| `MINSKY_NO_STARTUP_BACKOFF` | unset | `1` skips the boot self-throttle sleep (CI / fast operator runs). State is still tracked. |

## Install

`pnpm dogfood` (or `setup.sh`) renders the `${MINSKY_HOME}` placeholder
via `envsubst` and bootstraps the LaunchAgent. The unit file is a
template but is named `com.minsky.runany.plist` (not `.plist.tmpl`) so
setup.sh's Darwin `*.plist` glob (`setup.sh:409`) picks it up — a
`.tmpl` suffix would make it inert.

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.minsky.runany.plist
launchctl enable  gui/$(id -u)/com.minsky.runany
```

Logs: `.minsky/runany.out.log`, `.minsky/runany.err.log`.

## Chaos verification

```sh
node scripts/chaos-restart-schedule.mjs --json
# → {"schedule_followed":true,"reset_on_health":true,"stopped_at_limit":true,"restarts_after_limit":0}
```

A deterministic virtual-clock chaos sim (Basiri 2016): kill the
conductor repeatedly, assert the restart intervals follow the escalating
schedule, that a sustained-healthy window resets the ladder, that the
run stops at `MINSKY_RUN_TIME_LIMIT`, and that **zero** restarts fire
after the deadline.

## Anchors

Armstrong 2007 (supervised restart / let-it-crash); Beyer, Jones,
Petoff et al., *Site Reliability Engineering*, O'Reilly 2016 (capped
escalating backoff, retry budget); Basiri et al. 2016 (chaos
engineering); rule #6 (stay alive, but bounded).
