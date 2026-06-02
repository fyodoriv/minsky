#!/usr/bin/env node
// Fixture for the TRACEPARENT subagent-propagation chaos test.
//
// Pattern: minimal subprocess that emits one OTEL span and writes the
// resulting `traceparent` carrier value to stdout as JSON.
//
// Source: rule #7 (vision.md § 7 — chaos engineering); Basiri et al.,
// "Principles of Chaos Engineering", *IEEE Software* 2016 (steady-state
// hypothesis); OpenTelemetry specification (CNCF 2020+, propagator
// contract — `OTEL_PROPAGATORS` env var); W3C Trace Context,
// Recommendation, 2021 (the `traceparent` header carrier).
//
// Behaviour (mirrors the OTEL SDK's auto-instrumentation contract):
//   - If `OTEL_PROPAGATORS` is unset OR contains "tracecontext", install
//     the W3C tracecontext propagator (the steady state).
//   - If `OTEL_PROPAGATORS=""` (empty), leave the no-op propagator in
//     place (the chaos branch — the failure mode this test surfaces).
//
// Steps (both branches):
//   1. Read parent's `TRACEPARENT` env var (if any) into a carrier.
//   2. Extract a context from the carrier via the configured propagator.
//   3. Start an active span on that context.
//   4. Inject the active context into a fresh carrier and emit
//      `{"traceparent":"…"}` to stdout.

import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

// Honour `OTEL_PROPAGATORS` exactly the way the OTEL auto-instrumentation
// would: empty string ⇒ keep the no-op default; unset or non-empty ⇒
// install the W3C tracecontext propagator (the conventional default).
const propagatorsEnv = process.env["OTEL_PROPAGATORS"];
if (propagatorsEnv === undefined || /\btracecontext\b/.test(propagatorsEnv)) {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
}

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer = provider.getTracer("traceparent-fixture");

const parentCarrier = {};
if (typeof process.env["TRACEPARENT"] === "string") {
  parentCarrier.traceparent = process.env["TRACEPARENT"];
}

const extracted = propagation.extract(ROOT_CONTEXT, parentCarrier);

const span = tracer.startSpan("fixture.child", undefined, extracted);
const activeContext = trace.setSpan(extracted, span);

const out = {};
context.with(activeContext, () => {
  propagation.inject(activeContext, out);
});
span.end();

await provider.forceFlush();

process.stdout.write(`${JSON.stringify({ traceparent: out.traceparent ?? null })}\n`);

await provider.shutdown();
