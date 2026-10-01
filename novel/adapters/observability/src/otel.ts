/**
 * OpenTelemetry-backed Observability adapter — Strategy implementation
 * (Gamma et al., *Design Patterns*, 1994) of the {@link Observability}
 * interface defined in ./index.ts.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index, row 24):
 *   - This module:           Strategy of `Observability`. Conformance: full.
 *   - Three-signal emission: traces (span = unit of work), metrics
 *                            (counter = countable event), logs (record =
 *                            structured event) per the OpenTelemetry
 *                            specification (CNCF, 2020+).
 *
 * Constructor accepts optional exporters via dependency injection so tests
 * can substitute `InMemorySpanExporter` / `InMemoryMetricExporter` /
 * `InMemoryLogRecordExporter` and verify `selfTest()` behaviour without a
 * docker collector. Defaults are OTLP HTTP exporters pointing at
 * `OTEL_EXPORTER_OTLP_ENDPOINT` (env var; default `http://localhost:4318`).
 *
 * v0 deviation declared per rule #8: this adapter does *not* register its
 * providers globally via `trace.setGlobalTracerProvider` /
 * `metrics.setGlobalMeterProvider` / `logs.setGlobalLoggerProvider`. Why
 * acceptable: the only consumer in v0 is the adapter's own `selfTest()`;
 * setting globals from a constructor causes test-isolation pollution and
 * gives no value yet. What would restore the conventional OTEL global
 * registration: a single explicit call site (e.g., `setup.sh`'s adapter
 * bootstrap) that registers the chosen instance once at process start.
 * Tracked as future task `register-otel-globals-at-bootstrap`.
 */

import { type Meter, metrics, type Tracer, trace } from "@opentelemetry/api";
import { type Logger, logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  LoggerProvider,
  type LogRecordExporter,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import type { Observability, ObservabilityEvent, SelfTestResult } from "./index.js";

export interface OtelObservabilityConfig {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  /**
   * Base URL of the OTLP HTTP receiver (e.g.,
   * `http://127.0.0.1:5080/api/default/v1` against a local OpenObserve daemon
   * installed via `distribution/install-openobserve.sh`). Per signal, the
   * adapter appends `/traces`, `/metrics`, `/logs` — matching OpenTelemetry's
   * OTLP/HTTP convention. When omitted (and no exporter is injected), the
   * exporters fall back to their standard env-var resolution
   * (`OTEL_EXPORTER_OTLP_ENDPOINT` per the OpenTelemetry specification).
   * Endpoint is ignored for any signal whose exporter is supplied directly
   * (test path — `InMemorySpanExporter` etc. take precedence).
   */
  readonly endpoint?: string;
  readonly traceExporter?: SpanExporter;
  readonly metricExporter?: PushMetricExporter;
  readonly logExporter?: LogRecordExporter;
}

/**
 * Trim a single trailing slash so the per-signal suffix concatenation
 * produces a canonical URL without double slashes. Pure helper.
 *
 * @otel-exempt pure string transform, no I/O.
 */
function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Resolve the per-signal OTLP HTTP URLs from a configured base endpoint.
 * Pure helper exposed for tests so the constructor's URL-routing shape
 * is verifiable without poking at private exporter internals.
 *
 * @otel-exempt pure string transform, no I/O.
 */
export function resolveOtlpEndpoints(endpoint: string | undefined): {
  traces?: string;
  metrics?: string;
  logs?: string;
} {
  if (endpoint === undefined) return {};
  const base = stripTrailingSlash(endpoint);
  return { traces: `${base}/traces`, metrics: `${base}/metrics`, logs: `${base}/logs` };
}

/** Strategy implementation of {@link Observability} backed by OpenTelemetry. */
export class OtelObservability implements Observability {
  private readonly tracerProvider: BasicTracerProvider;
  private readonly meterProvider: MeterProvider;
  private readonly loggerProvider: LoggerProvider;
  private readonly tracer: Tracer;
  private readonly meter: Meter;
  private readonly logger: Logger;

  constructor(config: OtelObservabilityConfig = {}) {
    const serviceName = config.serviceName ?? "minsky";
    const serviceVersion = config.serviceVersion ?? "0.0.0";
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    });

    const endpoints = resolveOtlpEndpoints(config.endpoint);

    const traceExporter =
      config.traceExporter ??
      (endpoints.traces === undefined
        ? new OTLPTraceExporter()
        : new OTLPTraceExporter({ url: endpoints.traces }));
    this.tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(traceExporter)],
    });
    this.tracer = this.tracerProvider.getTracer(serviceName);

    const metricExporter =
      config.metricExporter ??
      (endpoints.metrics === undefined
        ? new OTLPMetricExporter()
        : new OTLPMetricExporter({ url: endpoints.metrics }));
    this.meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 1000,
        }),
      ],
    });
    this.meter = this.meterProvider.getMeter(serviceName);

    const logExporter =
      config.logExporter ??
      (endpoints.logs === undefined
        ? new OTLPLogExporter()
        : new OTLPLogExporter({ url: endpoints.logs }));
    this.loggerProvider = new LoggerProvider({
      resource,
      processors: [new SimpleLogRecordProcessor(logExporter)],
    });
    this.logger = this.loggerProvider.getLogger(serviceName);
  }

  /**
   * @otel observability.emit-tick-span — synchronous per-event publish;
   *   exporter ships asynchronously, caller returns immediately.
   *
   * Closes the publisher half of the publish-then-read MAPE-K loop: the
   * daemon's `runDaemon({ emit })` callback can be `obs.emitTickSpan.bind(obs)`,
   * so every `tick-loop.iteration` event lands in OpenObserve (or whatever
   * OTLP backend the `endpoint` config points at) instead of just the
   * operator's terminal.
   *
   * Errors swallowed by the OTEL SDK's exporter — fire-and-forget per rule
   * #7 graceful-degrade; a missed span must never block the daemon's hot
   * loop.
   */
  emitTickSpan(event: ObservabilityEvent): void {
    const span = this.tracer.startSpan(event.name);
    for (const [k, v] of Object.entries(event.attributes)) {
      span.setAttribute(k, v);
    }
    span.end();
  }

  /**
   * Emits exactly one span, one metric (counter increment), and one log. Returns
   * `green` if the SDK accepted all three signals; `red` on any error.
   *
   * Health-probe contract per {@link SelfTestResult}; setup.sh's `--doctor`
   * mode aggregates across adapters via {@link aggregateStatus}.
   *
   * @otel observability.self-test
   */
  async selfTest(): Promise<SelfTestResult> {
    const start = Date.now();
    try {
      // 1. Trace — span representing the self-test as a unit of work.
      const span = this.tracer.startSpan("observability.selfTest");
      span.setAttribute("selfTest.signal", "trace");
      span.end();

      // 2. Metric — a counter increment.
      const counter = this.meter.createCounter("observability.selfTest.count", {
        description: "Number of selfTest invocations",
      });
      counter.add(1, { signal: "metric" });

      // 3. Log — a structured INFO record.
      this.logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "observability.selfTest",
        attributes: { signal: "log" },
      });

      // Flush all three pipelines so an in-memory exporter can observe them
      // (and an OTLP exporter has at least attempted to send).
      await this.tracerProvider.forceFlush();
      await this.meterProvider.forceFlush();
      await this.loggerProvider.forceFlush();

      const latencyMs = Date.now() - start;
      return {
        status: "green",
        message: "OTEL adapter emitted span, metric, log",
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
      // rule-6: handled-locally — health-probe contract returns `red` on internal failure
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        status: "red",
        message: `OTEL adapter selfTest failed: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Cleanly shut down all providers. Idempotent.
   *
   * @otel observability.shutdown
   */
  async shutdown(): Promise<void> {
    await Promise.all([
      this.tracerProvider.shutdown(),
      this.meterProvider.shutdown(),
      this.loggerProvider.shutdown(),
    ]);
  }
}

// Re-export the API namespaces so consumers can access globals if they
// register an instance themselves. v0 deviation: not registered automatically.
export { logs, metrics, trace };
