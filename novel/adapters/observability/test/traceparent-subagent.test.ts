/**
 * TRACEPARENT subagent-propagation chaos test.
 *
 * Pattern conformance (rule #7 / vision.md § 7 — chaos engineering):
 *   - Steady-state hypothesis: a child subprocess spawned with no propagator
 *     override inherits the parent's W3C `traceparent` trace-id (convergence).
 *   - Fault axis: `OTEL_PROPAGATORS=""` in the child's env — the API
 *     installs a no-op propagator, breaking the carrier extract step.
 *   - Failure mode being surfaced: TRACEPARENT propagation broken across the
 *     subagent boundary (row 4 of `novel/adapters/observability/README.md`).
 *   - Blast radius: a single subprocess. The fixture exits within a turn.
 *   - Operator escape hatch: the test runs only on non-Windows; the
 *     subprocess inherits its own filesystem and is reaped on exit.
 *
 * Anchor: Basiri et al., "Principles of Chaos Engineering", *IEEE Software*
 * 2016; OpenTelemetry specification (CNCF 2020+, propagator contract);
 * W3C Trace Context, Recommendation, 2021 (the `traceparent` header carrier).
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ROOT_CONTEXT, context, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { beforeAll, describe, expect, it } from "vitest";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/emit-traceparent.mjs", import.meta.url));

// W3C traceparent format: `00-<trace-id (32 hex)>-<span-id (16 hex)>-<flags (2 hex)>`.
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function parentTraceparent(): string {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("traceparent-test-parent");

  const span = tracer.startSpan("test.parent");
  const active = trace.setSpan(ROOT_CONTEXT, span);
  const carrier: Record<string, string> = {};
  context.with(active, () => {
    propagation.inject(active, carrier);
  });
  span.end();
  void provider.shutdown();

  const tp = carrier["traceparent"];
  if (typeof tp !== "string" || !TRACEPARENT_RE.test(tp)) {
    throw new Error(`failed to inject parent traceparent (got ${String(tp)})`);
  }
  return tp;
}

function traceIdOf(traceparent: string): string {
  const match = TRACEPARENT_RE.exec(traceparent);
  if (match === null || match[1] === undefined) {
    throw new Error(`malformed traceparent: ${traceparent}`);
  }
  return match[1];
}

function runFixture(env: NodeJS.ProcessEnv): { traceparent: string | null; stderr: string } {
  const res = spawnSync(process.execPath, [FIXTURE_PATH], {
    env,
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (res.status !== 0) {
    throw new Error(
      `fixture exited with status ${String(res.status)} signal ${String(res.signal)}; stderr=${res.stderr}`,
    );
  }
  const trimmed = res.stdout.trim();
  const parsed = JSON.parse(trimmed) as { traceparent: string | null };
  return { traceparent: parsed.traceparent, stderr: res.stderr };
}

describe.skipIf(process.platform === "win32")("TRACEPARENT subagent propagation", () => {
  // Install W3C tracecontext globally for the parent side. The child runs in
  // its own subprocess and sets up its own propagator per `OTEL_PROPAGATORS`.
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  it("diverges (no inherited trace-id) when the child has OTEL_PROPAGATORS empty — the failure mode", () => {
    const parent = parentTraceparent();
    const parentId = traceIdOf(parent);

    const { traceparent: child } = runFixture({
      ...process.env,
      TRACEPARENT: parent,
      OTEL_PROPAGATORS: "",
    });

    // Divergence is the failure-mode signal. With a no-op propagator the
    // carrier is broken in one of two ways: either nothing was injected
    // (child is null — the no-op propagator emits no fields) or the child
    // started a fresh trace-id (extract returned ROOT_CONTEXT). Both prove
    // the parent's trace-id did NOT propagate, which is the rule-#7
    // failure mode this test surfaces.
    if (child === null) {
      expect(child).toBeNull();
      return;
    }
    expect(child).toMatch(TRACEPARENT_RE);
    const childId = traceIdOf(child);
    expect(childId).not.toBe(parentId);
  });

  it("converges (same trace-id) when the child uses the default propagator — the steady state", () => {
    const parent = parentTraceparent();
    const parentId = traceIdOf(parent);

    // Pass parent's TRACEPARENT but do NOT set OTEL_PROPAGATORS — the
    // fixture installs the W3C tracecontext propagator when the env var is
    // unset, extracts the carrier, and the active span inherits the
    // parent's trace-id.
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== "OTEL_PROPAGATORS"),
    );
    const childEnv: NodeJS.ProcessEnv = { ...baseEnv, TRACEPARENT: parent };

    const { traceparent: child } = runFixture(childEnv);

    expect(child).not.toBeNull();
    if (child === null) throw new Error("unreachable — guarded above");
    expect(child).toMatch(TRACEPARENT_RE);
    const childId = traceIdOf(child);

    expect(childId).toBe(parentId);
  });
});
