import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aggregateStatus } from "./index.js";
import { OtelObservability, resolveOtlpEndpoints } from "./otel.js";

describe("OtelObservability.selfTest", () => {
  let traceExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let logExporter: InMemoryLogRecordExporter;
  let adapter: OtelObservability;

  beforeEach(() => {
    traceExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    logExporter = new InMemoryLogRecordExporter();
    adapter = new OtelObservability({
      traceExporter,
      metricExporter,
      logExporter,
    });
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  it("returns green and emits exactly one span, one log, and at least one metric", async () => {
    const result = await adapter.selfTest();

    expect(result.status).toBe("green");
    expect(result.message).toContain("emitted span, metric, log");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.lastCheck).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const spans = traceExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("observability.selfTest");
    expect(spans[0]?.attributes["selfTest.signal"]).toBe("trace");

    const metricRecords = metricExporter.getMetrics();
    expect(metricRecords.length).toBeGreaterThanOrEqual(1);

    const logRecords = logExporter.getFinishedLogRecords();
    expect(logRecords).toHaveLength(1);
    expect(logRecords[0]?.body).toBe("observability.selfTest");
  });

  it("aggregateStatus across multiple green results stays green", async () => {
    const r1 = await adapter.selfTest();
    const r2 = await adapter.selfTest();
    expect(aggregateStatus([r1, r2])).toBe("green");
  });

  it("constructs with default OTLP exporters when no config is provided (covers default-fallback branches)", async () => {
    const defaultAdapter = new OtelObservability();
    expect(defaultAdapter).toBeDefined();
    await defaultAdapter.shutdown();
  });

  it("formats non-Error throwables via String(err) in the catch path", async () => {
    // @ts-expect-error — accessing private member for negative-path coverage
    const tracer = adapter.tracer;
    const nonErrorThrowable = "primitive-throw";
    vi.spyOn(tracer, "startSpan").mockImplementation(() => {
      // Deliberately throw a non-Error to exercise the `String(err)` branch
      // in selfTest's catch. Biome's `useThrowOnlyError` is not enabled in
      // this repo (see biome.json), so this is intentional and unflagged.
      // eslint-disable-next-line — kept for future-toolchain readers
      throw nonErrorThrowable;
    });

    const result = await adapter.selfTest();

    expect(result.status).toBe("red");
    expect(result.message).toContain("primitive-throw");
  });

  it("flows the endpoint opt through resolveOtlpEndpoints to per-signal URLs (observability-backend-deploy)", () => {
    // Pure-helper white-box test: the constructor wires `endpoint` →
    // `{traces,metrics,logs}` per the OTLP/HTTP convention by routing
    // through `resolveOtlpEndpoints`.
    const endpoints = resolveOtlpEndpoints("http://127.0.0.1:5080/api/default/v1");
    expect(endpoints).toEqual({
      traces: "http://127.0.0.1:5080/api/default/v1/traces",
      metrics: "http://127.0.0.1:5080/api/default/v1/metrics",
      logs: "http://127.0.0.1:5080/api/default/v1/logs",
    });
  });

  it("trailing-slash endpoint is normalised so per-signal URLs do not double-slash", () => {
    const endpoints = resolveOtlpEndpoints("http://127.0.0.1:5080/api/default/v1/");
    for (const url of [endpoints.traces, endpoints.metrics, endpoints.logs]) {
      expect(url).toBeDefined();
      expect(url).not.toContain("//traces");
      expect(url).not.toContain("//metrics");
      expect(url).not.toContain("//logs");
    }
    expect(endpoints.traces).toBe("http://127.0.0.1:5080/api/default/v1/traces");
  });

  it("resolveOtlpEndpoints returns empty object when endpoint is undefined (env-var fallback)", () => {
    expect(resolveOtlpEndpoints(undefined)).toEqual({});
  });

  it("OtelObservability constructs without throwing when endpoint opt is supplied", async () => {
    const wired = new OtelObservability({ endpoint: "http://127.0.0.1:5080/api/default/v1" });
    expect(wired).toBeDefined();
    await wired.shutdown();
  });

  it("returns red SelfTestResult when an internal call throws", async () => {
    // Force-throw at the first SDK touchpoint inside selfTest().
    // @ts-expect-error — accessing private member for negative-path coverage
    const tracer = adapter.tracer;
    vi.spyOn(tracer, "startSpan").mockImplementation(() => {
      throw new Error("boom");
    });

    const result = await adapter.selfTest();

    expect(result.status).toBe("red");
    expect(result.message).toMatch(/boom/);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.lastCheck).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
