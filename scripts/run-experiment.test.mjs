// Tests for the pure function in run-experiment.mjs. The pure function is
// `runExperiment(...)` — no real shelling out; the test injects an `exec`
// stub and inspects the returned record / errors.
//
// Pattern: rule #10 deterministic gate; xUnit test doubles (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { runExperiment } from "./run-experiment.mjs";

const VALID_YAML = [
  "id: example-experiment",
  'hypothesis: "A forty-character hypothesis lorem ipsum dolor."',
  'success: "≥1 unit"',
  'pivot: "<0 units"',
  'measurement: "echo 42"',
  'anchor: "rule #9"',
].join("\n");

/**
 * @param {Partial<import("./run-experiment.mjs").ExecResult>} [overrides]
 * @returns {import("./run-experiment.mjs").ExecResult}
 */
function execResult(overrides = {}) {
  return {
    exitCode: 0,
    stdout: "42\n",
    stderr: "",
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

/**
 * @param {(import("./run-experiment.mjs").ExecResult)[]} returns
 */
function execStub(returns) {
  /** @type {{ calls: { cmd: string, opts: object }[], fn: import("./run-experiment.mjs").Exec }} */
  const stub = {
    calls: [],
    fn: (cmd, opts) => {
      stub.calls.push({ cmd, opts });
      const r = returns[stub.calls.length - 1];
      if (r === undefined) {
        throw new Error(
          `exec stub exhausted; got ${stub.calls.length} calls but only ${returns.length} returns`,
        );
      }
      return r;
    },
  };
  return stub;
}

describe("runExperiment — gate mode", () => {
  test("(a) valid YAML + runnable measurement → gate ok", () => {
    const stub = execStub([execResult()]);
    const result = runExperiment({
      mode: "gate",
      recordContent: VALID_YAML,
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("gate");
    if (result.kind !== "gate") return;
    expect(result.experimentId).toBe("example-experiment");
    expect(stub.calls.length).toBe(1);
    expect(stub.calls[0]?.cmd).toBe("echo 42");
  });

  test("(b) missing YAML (recordContent null) → exit 1 with 'missing EXPERIMENT.yaml'", () => {
    const stub = execStub([]);
    const result = runExperiment({
      mode: "gate",
      recordContent: null,
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("missing EXPERIMENT.yaml"))).toBe(true);
    expect(stub.calls.length).toBe(0);
  });

  test("(c) malformed YAML → exit 1 with parse error", () => {
    const stub = execStub([]);
    const result = runExperiment({
      mode: "gate",
      recordContent: "id: foo\nhypothesis: [unbalanced",
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /bad-yaml|EXPERIMENT\.yaml/.test(e))).toBe(true);
    expect(stub.calls.length).toBe(0);
  });

  test("(d) non-runnable command (exec returns non-zero) → exit 1", () => {
    const stub = execStub([execResult({ exitCode: 1, stderr: "command not found: foo" })]);
    const result = runExperiment({
      mode: "gate",
      recordContent: VALID_YAML,
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("not runnable"))).toBe(true);
    expect(result.errors[0]).toContain("command not found: foo");
  });

  test("(e) trivial-labelled PR with exemption comment → no-op (ok, kind=trivial-exempt)", () => {
    const stub = execStub([]);
    const result = runExperiment({
      mode: "gate",
      recordContent: null, // trivial PRs may not have an EXPERIMENT.yaml at all
      prTrivialLabel: true,
      prBody: "Tiny typo. <!-- experiment: trivial — see exemption.md -->",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("trivial-exempt");
    expect(stub.calls.length).toBe(0);
  });

  test("(f) timeout exceeded → exit 1 with timeout message", () => {
    const stub = execStub([execResult({ timedOut: true, exitCode: 124 })]);
    const result = runExperiment({
      mode: "gate",
      recordContent: VALID_YAML,
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /timed out/.test(e))).toBe(true);
  });

  test("trivial label without exemption comment → fail (two-factor)", () => {
    const result = runExperiment({
      mode: "gate",
      recordContent: VALID_YAML,
      prTrivialLabel: true,
      prBody: "no exemption comment here",
      exec: execStub([]).fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /missing the exemption comment/i.test(e))).toBe(true);
  });

  test("exemption comment without trivial label → fail (two-factor)", () => {
    const result = runExperiment({
      mode: "gate",
      recordContent: VALID_YAML,
      prTrivialLabel: false,
      prBody: "<!-- experiment: trivial — see exemption.md -->",
      exec: execStub([]).fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /not labelled `trivial`/.test(e))).toBe(true);
  });

  test("vanity-metric in success → exit 1 (parse error surfaces)", () => {
    const yaml = [
      "id: vain-experiment",
      'hypothesis: "A forty-character hypothesis lorem ipsum dolor."',
      'success: "more commits made"',
      'pivot: "<0 units"',
      'measurement: "echo 42"',
      'anchor: "rule #9"',
    ].join("\n");
    const result = runExperiment({
      mode: "gate",
      recordContent: yaml,
      prTrivialLabel: false,
      prBody: "",
      exec: execStub([]).fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /vanity-metric/.test(e))).toBe(true);
  });

  test("explicit timeout_seconds is forwarded to exec", () => {
    const yaml = `${VALID_YAML}\ntimeout_seconds: 30`;
    const stub = execStub([execResult()]);
    runExperiment({
      mode: "gate",
      recordContent: yaml,
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(stub.calls.length).toBe(1);
    /** @type {{ timeoutSeconds: number }} */
    const opts = /** @type {any} */ (stub.calls[0]?.opts);
    expect(opts.timeoutSeconds).toBe(30);
  });

  test("default timeout_seconds is 60 when omitted", () => {
    const stub = execStub([execResult()]);
    runExperiment({
      mode: "gate",
      recordContent: VALID_YAML,
      prTrivialLabel: false,
      prBody: "",
      exec: stub.fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    /** @type {{ timeoutSeconds: number }} */
    const opts = /** @type {any} */ (stub.calls[0]?.opts);
    expect(opts.timeoutSeconds).toBe(60);
  });
});

describe("runExperiment — record mode", () => {
  test("valid record + two successful exec calls → StoreRecord with both numbers", () => {
    const stub = execStub([
      execResult({ stdout: "100\n", durationMs: 50 }),
      execResult({ stdout: "120\n", durationMs: 60 }),
    ]);
    const result = runExperiment({
      mode: "record",
      recordContent: VALID_YAML,
      exec: stub.fn,
      ts: "2026-05-03T12:00:00.000Z",
      baseRef: "abc123",
      headRef: "def456",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("record");
    if (result.kind !== "record") return;
    expect(result.record.experiment_id).toBe("example-experiment");
    expect(result.record.baseline).toBe("100\n");
    expect(result.record.treatment).toBe("120\n");
    expect(result.record.ref).toBe("def456");
    expect(result.record.base_ref).toBe("abc123");
    expect(result.record.ts).toBe("2026-05-03T12:00:00.000Z");
    expect(result.record.baseline_duration_ms).toBe(50);
    expect(result.record.treatment_duration_ms).toBe(60);
    expect(stub.calls.length).toBe(2);
  });

  test("baseline timeout → exit 1 with named ref", () => {
    const stub = execStub([execResult({ timedOut: true, exitCode: 124 })]);
    const result = runExperiment({
      mode: "record",
      recordContent: VALID_YAML,
      exec: stub.fn,
      ts: "2026-05-03T12:00:00.000Z",
      baseRef: "abc123",
      headRef: "def456",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /baseline.*timed out.*abc123/.test(e))).toBe(true);
  });

  test("treatment failure → exit 1 with named ref", () => {
    const stub = execStub([
      execResult({ stdout: "100\n" }),
      execResult({ exitCode: 7, stderr: "boom" }),
    ]);
    const result = runExperiment({
      mode: "record",
      recordContent: VALID_YAML,
      exec: stub.fn,
      ts: "2026-05-03T12:00:00.000Z",
      baseRef: "abc123",
      headRef: "def456",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /treatment.*def456/.test(e))).toBe(true);
    expect(result.errors[0]).toContain("boom");
  });

  test("record mode without both refs → error", () => {
    const result = runExperiment({
      mode: "record",
      recordContent: VALID_YAML,
      exec: execStub([]).fn,
      ts: "2026-05-03T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("baseRef");
  });
});
