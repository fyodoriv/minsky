# `@minsky/observability`

OpenTelemetry-backed `Observability` adapter for Minsky.

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index) row 24:

- **`Observability` interface** — Adapter (structural) per Gamma et al., *Design Patterns*, 1994. **Conformance: full.**
- **`OtelObservability` class** — Strategy (behavioral) implementation of the same. **Conformance: full.**
- **`SelfTestResult` / `selfTest()`** — health probe per Avizienis, *IEEE TSE* 1985 / Burns et al. *ACM Queue* 2016 (Kubernetes liveness probe). **Conformance: full.**
- **`aggregateStatus()`** — worst-status lattice meet per Avizienis et al. *IEEE TDSC* 2004. **Conformance: full.**

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `selfTest()` returns `green` and emits exactly one span, one log, and ≥1 metric on every invocation against a healthy collector.
- **Blast radius**: a single self-test cycle. The adapter holds no shared state across calls.
- **Operator escape hatch**: shut down the adapter (`OtelObservability.shutdown()`); the parent process continues.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | OTEL collector unreachable (default OTLP exporters have no live endpoint) | `iptables -A OUTPUT -p tcp --dport 4318 -j DROP` (network) | `graceful-degrade` — `selfTest()` still returns `green` because the SDK queues + drops async; future `WARN` log from the SDK is the surface signal | apply DROP; assert `selfTest()` resolves within 5 s with `status="green"`; SDK warns to stderr |
| 2 | Provider already shut down | call `selfTest()` after `shutdown()` (process-state) | `loud-crash-supervisor-restart` *or* `red` SelfTestResult | covered by `otel.test.ts` — assert `result.message` is informative |
| 3 | Out-of-memory while exporting | inject a large attributes payload (resource exhaustion) | `loud-crash-supervisor-restart` | (manual) attach 10 MiB attribute; assert process crashes loudly, supervisor restarts |
| 4 | TRACEPARENT propagation broken across subagent boundary | run a subprocess that doesn't honor `OTEL_PROPAGATORS` (upstream-malformed) | `circuit-break-and-notify` (future) | covered by `novel/adapters/observability/test/traceparent-subagent.test.ts` — asserts trace-id divergence under `OTEL_PROPAGATORS=""` and convergence under the default propagator |
| 5 | Exporter throws synchronously on a malformed metric value (e.g., `Number.NaN`) | `counter.add(Number.NaN, ...)` (upstream-malformed) | `red` SelfTestResult — caught by the try / catch in `selfTest()` | unit test injects a stub exporter that throws on add |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: an OTEL-backed `Observability` strategy can emit one trace + one metric + one log under 100 ms p95 with a real exporter on a localhost collector.
- **Success threshold**: `selfTest()` returns `green` and `latencyMs < 100` (in-memory exporter); manual integration test against `docker run otel/opentelemetry-collector-contrib` shows all three signals in collector stdout within 5 s.
- **Pivot threshold**: if any of (a) the SDK can't emit logs (the API is still maturing as of 2025), (b) latency p95 > 500 ms even in-memory, (c) the SDK adds incompatible breaking changes more than once a year — pivot to a different observability backend (Honeycomb SDK, custom exporter).
- **Measurement**: `pnpm vitest run novel/adapters/observability/src/otel.test.ts --reporter=json | jq '.testResults[0].assertionResults[].duration'`
- **Literature anchor**: OpenTelemetry specification (CNCF 2020+); Burns et al., "Borg, Omega, and Kubernetes" *ACM Queue* 2016 (liveness-probe pattern).

## Usage

```ts
import { OtelObservability } from "@minsky/observability/otel";

// Default: exporters point at OTEL_EXPORTER_OTLP_ENDPOINT (env, default http://localhost:4318)
const obs = new OtelObservability({ serviceName: "minsky-tick-loop" });
const result = await obs.selfTest();
console.log(result); // { status: "green", message: "...", latencyMs: ..., lastCheck: "..." }

await obs.shutdown(); // graceful
```

For unit tests, inject in-memory exporters:

```ts
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { InMemoryMetricExporter, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";

const traceExporter = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const logExporter = new InMemoryLogRecordExporter();
const obs = new OtelObservability({ traceExporter, metricExporter, logExporter });
```

## Pointing the adapter at a deployed backend (`endpoint` opt)

Constructor accepts an `endpoint` opt — when set, the OTLP HTTP exporters target `<endpoint>/{traces,metrics,logs}` per OpenTelemetry's OTLP/HTTP convention. When omitted, exporters fall back to `OTEL_EXPORTER_OTLP_ENDPOINT` per the OpenTelemetry specification.

```ts
import { OtelObservability } from "@minsky/observability/otel";

// Local OpenObserve installed via `bash distribution/install-openobserve.sh`.
const obs = new OtelObservability({
  endpoint: "http://127.0.0.1:5080/api/default/v1",
});
await obs.selfTest(); // → { status: "green", … }
```

See [`distribution/openobserve/README.md`](../../../distribution/openobserve/README.md) for the install + verify runbook. The env-gated integration test at `test/openobserve.integration.test.ts` round-trips a span through OpenObserve when `OPENOBSERVE_INTEGRATION=1` is set; skipped in CI by default.

### `emitTickSpan(event)` — per-event publish

The `Observability` interface carries an `emitTickSpan(event: ObservabilityEvent): void` method (added by `daemon-otel-pipe`, 2026-05-04). `OtelObservability` implements it via `tracer.startSpan(name) → setAttribute → end` synchronously; the OTLP exporter ships asynchronously, so the call returns immediately. Fire-and-forget per rule #7 graceful-degrade — a missed span never blocks the caller's hot loop.

This is the seam the `@minsky/tick-loop` daemon's CLI uses (`bin/tick-loop.mjs`) to forward every per-iteration `TickSpan` to OpenObserve when `MINSKY_OTEL_ENDPOINT` is set. Without the seam being callable through the `Observability` interface, the daemon would have had to import `@opentelemetry/*` directly — a rule-#2 violation. Closes the publisher half of the publish-then-read MAPE-K loop (Kephart & Chess 2003 — the *Monitor* surface must publish where the *Analyze* phase reads).

## Manual integration test against a real collector

```bash
# Terminal 1
docker run --rm -p 4318:4318 otel/opentelemetry-collector-contrib \
  --config /etc/otelcol-contrib/otel-collector-config.yaml

# Terminal 2
node -e "(async () => {
  const { OtelObservability } = await import('@minsky/observability/otel');
  const obs = new OtelObservability();
  console.log(await obs.selfTest());
  await obs.shutdown();
})();"
```

Expected: collector stdout shows the span, metric, and log within ~5 seconds.

## v0 deviation declared (rule #8)

This adapter does **not** register its providers globally via
`trace.setGlobalTracerProvider` / `metrics.setGlobalMeterProvider` /
`logs.setGlobalLoggerProvider`. The standard OTEL pattern is to register a
single global at process start so library code can call
`trace.getTracer(name)` without dependency injection. v0 skips this because
the only consumer in v0 is the adapter's own `selfTest()`; setting globals
from a constructor causes test-isolation pollution and gives no value yet.
A future task `register-otel-globals-at-bootstrap` will add a single
explicit registration call site in `setup.sh`'s adapter bootstrap.

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: `ObservabilityEvent` attribute payloads supplied by daemon callers; `OTEL_EXPORTER_OTLP_ENDPOINT` / `endpoint` opt; OTLP HTTP responses from a collector.
- **Trusted state**: SDK-managed providers (constructor-scoped, not global per the v0 deviation above); `serviceName` is constructor-set; the in-memory exporters injected by tests are deterministic.
- **Trust boundary**: OTLP/HTTP to a collector — localhost (`http://127.0.0.1:5080`) for the OpenObserve install, or a remote backend; span / metric / log payloads cross network when the endpoint is non-loopback.
- **STRIDE focus**: **I**nformation disclosure — span attributes and log bodies must never carry PII or secrets; the sibling P0 `otel-no-pii-in-spans-lint` (rule #13.5) is the deterministic gate at CI; **D**enial-of-service — the OTLP exporter queues asynchronously and drops on backpressure (chaos row 1: `iptables` DROP on 4318 still resolves `selfTest()` `green` within 5 s) so a misbehaving collector cannot stall the daemon's hot loop; **T**ampering — malformed metric values (e.g., `Number.NaN`, chaos row 5) are caught by the `selfTest()` try/catch and surfaced as `red`.
- **Performance-first carve-out** (rule #13's relief valve): the fire-and-forget exporter contract IS the carve-out — any synchronous flush before returning would couple caller latency to collector latency, violating rule #6 (stay alive). Spans are best-effort, not load-bearing for safety.
