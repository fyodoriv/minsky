# `distribution/` — Process supervision unit-file templates

Holds the OS-level service definitions that supervise Minsky's runtime processes (the autonomous Claude Code loop, the budget-guard watchdog, and forthcoming dashboard / notifier-relay units).

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../vision.md#pattern-conformance-index) row 4:

- **Supervision tree** — OTP supervision behaviour (Armstrong, *Programming Erlang*, 2007). Conformance: **partial.** Restart strategies match — `Restart=on-failure` (systemd) / `KeepAlive={SuccessfulExit:false}` (launchd) ≅ OTP "transient"; `Restart=always` / `KeepAlive=true` ≅ OTP "permanent". Supervisor primitive is systemd / launchd, not BEAM.
- **Why partial.** Erlang spawns processes in microseconds; systemd respawn is ~100 ms. **Why acceptable:** tick cadence is minutes-to-hours so 100 ms respawn is invisible to the metric in `vision.md` § "Success criteria" #5 (MTTR < 5 min p95).
- **What restoration to full conformance would require.** A BEAM-based supervisor (e.g., write the supervisor in Erlang or Elixir and have it spawn `claude -p` subprocesses). Out of scope for solo-dev tier.

## Files

```text
distribution/
├── systemd/                                 # Linux
│   ├── minsky-supervisor.target             # groups the others (Wants=)
│   ├── minsky-tick-loop.service             # transient (Restart=on-failure + backoff)
│   └── minsky-budget-guard.service          # permanent (Restart=always)
├── launchd/                                 # macOS LaunchAgents
│   ├── com.minsky.tick-loop.plist           # transient (KeepAlive: SuccessfulExit=false)
│   └── com.minsky.budget-guard.plist        # permanent (KeepAlive=true)
├── openobserve/                             # OTLP receiver (v0 backend per research.md PR #43)
│   ├── com.openobserve.daemon.plist         # macOS LaunchAgent (permanent restart)
│   ├── openobserve.service                  # Linux systemd user unit (permanent restart)
│   └── README.md                            # install + verify runbook
├── install-openobserve.sh                   # one-shot installer (downloads pinned binary)
├── lint-units.sh                            # smoke-tests templates pre-deploy
└── state.example.json                       # reference schema for setup.sh
```

Future units (`minsky-dashboard-web`, `minsky-notifier-relay`) land in the corresponding adapter / package PRs — see `dashboard-web-v0` and the notifier-relay scout task in `TASKS.md`.

## Parameterisation

Templates use shell-style `${VAR}` placeholders that `setup.sh` (P0 `setup-sh-rewrite`, shipped) will substitute via `envsubst` at install time. Currently the only placeholder is:

| Variable | Meaning | Example |
| --- | --- | --- |
| `${MINSKY_HOME}` | absolute path to the cloned minsky repo | `$HOME/apps/minsky` |

Any new placeholder added to a template must be (a) added to the table above and (b) accepted by `lint-units.sh`'s placeholder-hygiene check (which allows only the documented set).

## Install (one command — Minsky dogfooding itself)

```bash
pnpm dogfood       # canonical
./setup.sh --dogfood  # equivalent shell-script form
```

Detects the OS, renders the unit-file templates with `${MINSKY_HOME}` substituted, drops them in the user-scope unit dir (`~/.config/systemd/user/` on Linux, `~/Library/LaunchAgents/` on macOS), idempotently loads the supervisor target, and prints the operator's tail-logs / pause / status commands. Re-running is idempotent — re-renders the templates (catches drift) and re-loads the supervisor; no-op on an already-active unit. This is the canonical "start Minsky on this repo" invocation per `vision.md` § "What Minsky is" + rule #12 (Scope discipline) + `user-stories/001-loop-runs-overnight.md`.

A read-only health probe lives at `pnpm dogfood:doctor` (equivalent to `./setup.sh --doctor`) — verifies prereqs without touching state.

The under-the-hood snippets below remain as the reference for operators who need to debug the install (e.g., custom unit dir, sandboxed shell without `setup.sh`'s lock).

### Install (Linux, systemd user units — no root needed)

```bash
mkdir -p ~/.config/systemd/user
for f in distribution/systemd/*.service distribution/systemd/*.target; do
  envsubst '${MINSKY_HOME}' < "$f" > ~/.config/systemd/user/$(basename "$f")
done
systemctl --user daemon-reload
systemctl --user enable --now minsky-supervisor.target
```

### Install (macOS, launchd LaunchAgents)

```bash
mkdir -p ~/Library/LaunchAgents
for f in distribution/launchd/*.plist; do
  envsubst '${MINSKY_HOME}' < "$f" > ~/Library/LaunchAgents/$(basename "$f")
done
for f in ~/Library/LaunchAgents/com.minsky.*.plist; do
  launchctl bootstrap gui/"$(id -u)" "$f"
done
```

## Install the observability backend (OpenObserve)

Per [`research.md` § "Lighter OTEL backend"](../research.md#lighter-otel-backend) (resolved 2026-05-03, PR #43), Minsky's v0 OTLP receiver is OpenObserve — single binary, parquet-on-disk, PromQL-compatible read API. The installer + per-platform unit-file templates live in [`distribution/openobserve/`](openobserve/README.md); the short version:

```bash
# 1. Download + install the pinned OpenObserve binary into ~/.local/bin/.
bash distribution/install-openobserve.sh

# 2. Register the daemon with launchd (macOS) or systemctl --user (Linux).
#    Full commands in distribution/openobserve/README.md § "Register the daemon".

# 3. Verify: health probe + a sample PromQL query.
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/healthz
```

Wire the OTEL adapter at the OTLP HTTP endpoint:

```ts
import { OtelObservability } from "@minsky/observability/otel";
const obs = new OtelObservability({ endpoint: "http://127.0.0.1:5080/api/default/v1" });
await obs.selfTest(); // → { status: "green", … }
```

Wire the dashboard at the PromQL read endpoint by setting `OBSERVABILITY_BACKEND=openobserve` + `OPENOBSERVE_BASE_URL=http://127.0.0.1:5080`. See [`distribution/openobserve/README.md`](openobserve/README.md) for the verify runbook + chaos-table failure modes.

## Smoke-test the templates locally

```bash
./distribution/lint-units.sh
```

Validates: launchd plists are well-formed XML (`plutil -lint` — macOS only); systemd unit files contain `[Unit]` / `Description=` / `[Service]` / `ExecStart=` / `Restart=`; only documented placeholders are referenced. Exits non-zero on any failure.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: the supervisor target reports `active` continuously; its child services restart per their respective policies on simulated crashes.
- **Blast radius**: a single child service per fault — never the supervisor target itself, never another sibling. systemd's `PartOf=` keeps the cascade contained.
- **Operator escape hatch**: `systemctl --user stop minsky-supervisor.target` (Linux) / `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.minsky.tick-loop.plist` (macOS) immediately halts the loop.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | tick-loop process dies non-zero | `systemctl --user kill -s SIGKILL minsky-tick-loop` (process death) | `loud-crash-supervisor-restart` (transient) — respawn within `RestartSec` | kill PID; assert `is-active` returns to `active` within 10 s; respawn count visible in journal |
| 2 | tick-loop dies cleanly (exit 0) | `kill -s SIGTERM minsky-tick-loop` (graceful exit) | `graceful-degrade` — supervisor does *not* respawn (transient policy) | issue SIGTERM; assert `is-active` reports `inactive` |
| 3 | budget-guard process dies (any reason) | `systemctl --user kill minsky-budget-guard` (process death) | `loud-crash-supervisor-restart` (permanent) — respawn always | kill PID; assert respawn within 15 s |
| 4 | tick-loop crashes 11 times in 5 min (StartLimit hit) | continuous SIGKILL loop (rate-limit fault) | `circuit-break-and-notify` — systemd refuses further restarts; budget-guard still alive; emit notification | scripted kill loop; assert `is-failed` and budget-guard remains `active` |
| 5 | machine reboot mid-tick | `reboot` (cold restart) | `loud-crash-supervisor-restart` — supervisor target re-enabled by `WantedBy=default.target` on next login | reboot test machine; assert services come up; in-flight tick recovered via lease (`tasks-mcp`) |
| 6 | placeholder substitution fails (e.g., MINSKY_HOME unset) | mis-installed template (config drift) | `loud-crash-supervisor-restart` — service fails to start; clear journal log | unset MINSKY_HOME and reinstall; assert `journalctl --user -u minsky-tick-loop` shows the missing-path error |

## Integration test

`./distribution/test-supervisor.sh [linux|macos]` is the empirical driver for rows 1–4 of the failure-mode table above. It runs in two CI matrix jobs (`linux-supervisor-integration` / `macos-supervisor-integration` in `.github/workflows/ci.yml`) and can be run locally with the same arguments.

What it does, per platform:

- **Linux (`systemctl --user`)**: renders the templates with `envsubst`, drops them under `~/.config/systemd/user/`, writes stub `run-tick-loop.sh` / `run-budget-guard.sh` runners (an `exec sleep 86400` is sufficient because we're testing the supervisor's restart policy, not the runner's logic), then `enable --now minsky-supervisor.target`. Asserts: row 1 (SIGKILL respawn ≤ 10 s), row 3 (budget-guard permanent restart), row 2 weak form (clean stop deactivates), row 4 (rapid kill loop trips the start-limit and budget-guard survives).
- **macOS (`launchctl bootstrap gui/$(id -u)`)**: same shape with the launchd LaunchAgents.

CI workaround for the user-bus on Ubuntu runners. GitHub Actions Ubuntu runners run as a non-login user; `systemctl --user` requires either lingering (`loginctl enable-linger`) or a wrapping ephemeral bus (`dbus-run-session`). The driver tries linger first, then re-execs itself under `dbus-run-session` if needed; the CI job also installs `dbus-user-session` so the second fallback exists. If neither works, the driver exits **77** (skipped) — the CI gate accepts `skipped` to preserve the merge path while still surfacing the signal when the runner cooperates. The escape-hatch follow-up is `supervisor-integration-self-hosted-runner` in `TASKS.md`.

Caveats per row:

- **Row 2** (graceful SIGTERM / no respawn). systemd's transient policy keys off the unit's exit code; `sleep` interrupted by SIGTERM exits non-zero, which would still respawn under `Restart=on-failure`. The driver verifies the weaker but unambiguous property: `systemctl stop` (which sends SIGTERM and waits) cleanly deactivates the unit. The behavioural intent in the table is preserved by the policy choice itself, not by this assertion.
- **Row 4** (StartLimitBurst). systemd's start-limit accounting is kernel-rate-limited; some CI sandboxes relax it. The load-bearing assertion for row 4 is the **blast-radius** check — budget-guard remains active when tick-loop circuit-breaks. The driver logs a warning (not a failure) if the start-limit doesn't trip in the 10 s observation window.

The pre-deploy structural lint (`./distribution/lint-units.sh`) is the cheaper check that runs on every PR; this driver complements it with empirical behaviour verification.

## Hypothesis-driven development (rule #9)

- **Hypothesis**: per-platform unit-file templates parameterised by a single `${MINSKY_HOME}` envsubst variable are sufficient to install Minsky's supervisor on systemd and launchd without root.
- **Success threshold**: `./distribution/lint-units.sh` exits 0; `envsubst < template` produces a syntactically valid unit / plist on a fresh macOS or Linux user account; `systemctl --user enable` / `launchctl bootstrap` succeed.
- **Pivot threshold**: if more than one additional placeholder becomes load-bearing (e.g., a `USER` / `NODE_BIN` / `TICK_INTERVAL_SEC` set) — pivot from envsubst to a real templating tool (Helm-style or shell-script template engine).
- **Measurement**: `./distribution/lint-units.sh && for f in distribution/systemd/* distribution/launchd/*; do envsubst < "$f" >/dev/null; done`
- **Literature anchor**: systemd manual (Poettering, "systemd.service(5)" and "systemd.unit(5)"); Apple "Daemons and Services Programming Guide" (deprecated but launchd's plist schema is unchanged); 12-factor config (Wiggins 2011, factor III).
