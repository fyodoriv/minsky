# OpenObserve — Minsky's v0 observability backend

Per [`research.md` § "Lighter OTEL backend"](../../research.md#lighter-otel-backend) (resolved 2026-05-03, PR #43), OpenObserve is the chosen v0 OTLP receiver: single binary, parquet-on-disk, PromQL-compatible read API, ~250–800 MB / month at v0 emission rates.

This subdirectory holds the installer + per-platform unit-file templates that lay it down as a per-user daemon.

## What lives here

```text
distribution/openobserve/
├── README.md                       # this file (install + verify runbook)
├── com.openobserve.daemon.plist    # macOS LaunchAgent (permanent restart)
└── openobserve.service             # Linux systemd user unit (permanent restart)
```

The actual installer is one level up: [`distribution/install-openobserve.sh`](../install-openobserve.sh). The binary itself is *not* bundled in the repo (size + license); the installer downloads the pinned release from upstream.

## Install (one command)

```bash
bash distribution/install-openobserve.sh
```

This:

1. Detects platform (`darwin-arm64` / `darwin-amd64` / `linux-amd64` / `linux-arm64`).
2. Downloads OpenObserve `v0.80.2` (pinned) from the upstream openobserve.ai CDN (`downloads.openobserve.ai/releases/o2-enterprise/v0.80.2/`).
3. Installs the binary at `${HOME}/.local/bin/openobserve`.
4. Creates the data directory at `${HOME}/.openobserve/data`.

To pick a different version: `OO_VERSION=v0.81.0 bash distribution/install-openobserve.sh` — but the **pinned** version is what the chaos-coverage / measurement claims are anchored to; bumping is a deliberate quarterly-review act, not a drive-by. Note: upstream stopped publishing `darwin-amd64` binaries; the installer errors with a focused message on Intel macOS.

To smoke-test the script without downloading: `bash distribution/install-openobserve.sh --dry-run`.

## Register the daemon

### macOS (launchd)

```bash
mkdir -p ~/Library/LaunchAgents
# envsubst keeps ${HOME} stable in case the LaunchAgent is moved between machines
envsubst '${HOME}' \
  < distribution/openobserve/com.openobserve.daemon.plist \
  > ~/Library/LaunchAgents/com.openobserve.daemon.plist
launchctl bootstrap gui/"$(id -u)" ~/Library/LaunchAgents/com.openobserve.daemon.plist
```

### Linux (systemd user unit, no root)

```bash
mkdir -p ~/.config/systemd/user
envsubst '${HOME}' \
  < distribution/openobserve/openobserve.service \
  > ~/.config/systemd/user/openobserve.service
systemctl --user daemon-reload
systemctl --user enable --now openobserve.service
```

## Verify

```bash
# Health probe — must return 200 within ~5 s of daemon start.
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/healthz

# PromQL instant query — replace `up` with whatever you want to scrape.
curl -sS \
  -u 'root@minsky.local:Complexpass#123' \
  --data-urlencode 'query=up' \
  http://127.0.0.1:5080/api/default/prometheus/api/v1/query
```

The PromQL endpoint follows the [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/#instant-queries) shape (`status: "success" | "error"`, `data.resultType`, `data.result[]`). That's the contract `OpenObserveStrategy` (`novel/dashboard-web/src/strategy.ts`) reads against.

## Wire up the OTEL adapter

`@minsky/observability`'s `OtelObservability` constructor accepts an `endpoint` opt:

```ts
import { OtelObservability } from "@minsky/observability/otel";

const obs = new OtelObservability({
  endpoint: "http://127.0.0.1:5080/api/default/v1",
});
await obs.selfTest(); // → { status: "green", … }
```

When `endpoint` is omitted, the adapter falls back to `OTEL_EXPORTER_OTLP_ENDPOINT` (env var, OpenTelemetry default).

## Wire up the dashboard

```bash
OBSERVABILITY_BACKEND=openobserve \
  OPENOBSERVE_BASE_URL=http://127.0.0.1:5080 \
  pnpm --filter @minsky/dashboard-web start
```

When `OBSERVABILITY_BACKEND=openobserve`, `dashboard-web/src/start.ts` plumbs `OpenObserveStrategy` into `createServer({ getValue })`, replacing the cold-start `(stub)` placeholders with live PromQL reads.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: `curl http://127.0.0.1:5080/healthz` returns 200 continuously; the daemon respawns on crash within `RestartSec` / `ThrottleInterval`.
- **Blast radius**: OpenObserve's failure does not cascade — the dashboard's `OpenObserveStrategy` returns `null` on any HTTP / parse error (rule-#7 graceful-degrade), and the dashboard then falls back to the `(stub)` sentinel.
- **Operator escape hatch**: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.openobserve.daemon.plist` (macOS) / `systemctl --user stop openobserve.service` (Linux).

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | OpenObserve binary missing | install never ran | `loud-crash-supervisor-restart` — daemon fails to start; dashboard `(stub)` | unit `is-failed`; dashboard renders `(stub)` |
| 2 | OpenObserve crashes mid-query | `kill -9 $(pgrep openobserve)` | `loud-crash-supervisor-restart` — daemon respawns within `ThrottleInterval` (10 s) | kill PID; assert `curl /healthz` returns 200 within 30 s |
| 3 | dashboard query while OO down | dashboard polls during respawn | `graceful-degrade` — `OpenObserveStrategy` returns `null` per metric → `(stub)` rendered | stop daemon; assert `/` still 200; rows show `(stub)` |
| 4 | malformed PromQL response (downstream version drift) | hand-crafted bad payload | `graceful-degrade` — Strategy returns `null`; one log line; dashboard unaffected | `OpenObserveStrategy` unit test with malformed-fetch fixture |

## Pivot threshold

Per `EXPERIMENT.yaml` (filed alongside this directory): if OpenObserve install proves unreliable on macOS Sequoia (signing / sandbox policies refuse the binary) OR if the upstream tarball naming changes such that `install-openobserve.sh` cannot fetch a working binary for two consecutive quarterly reviews → fall back to VictoriaMetrics triad per `research.md` § "Lighter OTEL backend" (PR #43, named runner-up). The migration cost is low (MetricsQL is a near-superset of PromQL).

## Anchor

- `research.md` § "Lighter OTEL backend" (PR #43, 2026-05-03): chose OpenObserve as the v0 backend.
- OpenTelemetry specification (CNCF, 2020+): the OTLP HTTP receiver contract OpenObserve implements.
- Prometheus HTTP API (Prometheus 2.x docs): the read-side query contract OpenObserve mirrors.
- rule #4 (vision.md § 4): every measurement queryable — the PromQL endpoint is the queryability surface.
