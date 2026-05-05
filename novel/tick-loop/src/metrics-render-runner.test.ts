import { describe, expect, it } from "vitest";

import {
  type MetricsRender,
  runMetricsRender,
  shouldRunMetricsRender,
} from "./metrics-render-runner.js";

describe("shouldRunMetricsRender", () => {
  it("runs when env is unset and METRICS.md is missing (genesis)", () => {
    expect(shouldRunMetricsRender({ env: {}, lastRenderedDate: null, today: "2026-05-05" })).toBe(
      true,
    );
  });

  it("runs when last render was yesterday", () => {
    expect(
      shouldRunMetricsRender({
        env: {},
        lastRenderedDate: "2026-05-04",
        today: "2026-05-05",
      }),
    ).toBe(true);
  });

  it("skips when last render was today", () => {
    expect(
      shouldRunMetricsRender({
        env: {},
        lastRenderedDate: "2026-05-05",
        today: "2026-05-05",
      }),
    ).toBe(false);
  });

  it("skips when MINSKY_CHANGELOG=off (umbrella opt-out)", () => {
    expect(
      shouldRunMetricsRender({
        env: { MINSKY_CHANGELOG: "off" },
        lastRenderedDate: null,
        today: "2026-05-05",
      }),
    ).toBe(false);
  });

  it("ignores MINSKY_CHANGELOG values other than 'off'", () => {
    expect(
      shouldRunMetricsRender({
        env: { MINSKY_CHANGELOG: "on" },
        lastRenderedDate: null,
        today: "2026-05-05",
      }),
    ).toBe(true);
    expect(
      shouldRunMetricsRender({
        env: { MINSKY_CHANGELOG: "" },
        lastRenderedDate: null,
        today: "2026-05-05",
      }),
    ).toBe(true);
  });

  it("env-off takes precedence over the date check", () => {
    expect(
      shouldRunMetricsRender({
        env: { MINSKY_CHANGELOG: "off" },
        lastRenderedDate: "2026-05-04",
        today: "2026-05-05",
      }),
    ).toBe(false);
  });
});

describe("runMetricsRender", () => {
  function makeRender(): {
    render: MetricsRender;
    calls: Array<{ date: string; env: Record<string, string | undefined> }>;
  } {
    const calls: Array<{ date: string; env: Record<string, string | undefined> }> = [];
    const render: MetricsRender = {
      render: async (input) => {
        calls.push({ date: input.date, env: { ...input.env } });
        return { exitCode: 0, durationMs: 7, stdoutTail: "ok", stderrTail: "" };
      },
    };
    return { render, calls };
  }

  it("skips when MINSKY_CHANGELOG=off without probing METRICS.md", async () => {
    const { render, calls } = makeRender();
    let probeCount = 0;
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      getLastRenderedDate: async () => {
        probeCount += 1;
        return null;
      },
      render,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-off" });
    expect(calls).toHaveLength(0);
    expect(probeCount).toBe(0);
  });

  it("skips when last render was already today", async () => {
    const { render, calls } = makeRender();
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => "2026-05-05",
      render,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "already-rendered" });
    expect(calls).toHaveLength(0);
  });

  it("renders when METRICS.md is missing (genesis case)", async () => {
    const { render, calls } = makeRender();
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => null,
      render,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.date).toBe("2026-05-05");
  });

  it("renders when last render was a prior date", async () => {
    const { render, calls } = makeRender();
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => "2026-05-04",
      render,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.date).toBe("2026-05-05");
  });

  it("returns the render-seam result fields when the runner ran", async () => {
    const render: MetricsRender = {
      render: async () => ({
        exitCode: 9,
        durationMs: 4242,
        stdoutTail: "stdout-tail",
        stderrTail: "stderr-tail",
      }),
    };
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => null,
      render,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 9,
      durationMs: 4242,
      stdoutTail: "stdout-tail",
      stderrTail: "stderr-tail",
    });
  });

  it("propagates env into the render invocation", async () => {
    const calls: Record<string, string | undefined>[] = [];
    const render: MetricsRender = {
      render: async (input) => {
        calls.push(input.env);
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runMetricsRender({
      today: "2026-05-05",
      env: { FOO: "bar" },
      getLastRenderedDate: async () => null,
      render,
    });
    expect(calls[0]).toEqual({ FOO: "bar" });
  });

  it("is idempotent — second run on the same date after first rendered is a skip", async () => {
    const { render, calls } = makeRender();
    let lastRenderedDate: string | null = null;
    const getLastRenderedDate = async (): Promise<string | null> => lastRenderedDate;

    const first = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate,
      render,
    });
    expect(first.outcome).toBe("ran");

    lastRenderedDate = "2026-05-05";

    const second = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate,
      render,
    });
    expect(second).toEqual({ outcome: "skipped", reason: "already-rendered" });
    expect(calls).toHaveLength(1);
  });

  it("env-off short-circuits even when METRICS.md is missing", async () => {
    const { render, calls } = makeRender();
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      getLastRenderedDate: async () => null,
      render,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-off" });
    expect(calls).toHaveLength(0);
  });

  it("propagates a non-zero render exitCode in the 'ran' outcome (rule #6 — failure is data)", async () => {
    const render: MetricsRender = {
      render: async () => ({
        exitCode: 1,
        durationMs: 12,
        stdoutTail: "",
        stderrTail: "snapshot file missing",
      }),
    };
    const result = await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => null,
      render,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 1,
      durationMs: 12,
      stdoutTail: "",
      stderrTail: "snapshot file missing",
    });
  });

  it("renders with the exact today passed in (no UTC drift)", async () => {
    const { render, calls } = makeRender();
    await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => null,
      render,
    });
    expect(calls[0]?.date).toBe("2026-05-05");
  });

  it("does not call render when MINSKY_CHANGELOG=off even if the probe stub would say missing", async () => {
    let renderCount = 0;
    const render: MetricsRender = {
      render: async () => {
        renderCount += 1;
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runMetricsRender({
      today: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      getLastRenderedDate: async () => null,
      render,
    });
    expect(renderCount).toBe(0);
  });

  it("does not call render when last render was today", async () => {
    let renderCount = 0;
    const render: MetricsRender = {
      render: async () => {
        renderCount += 1;
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runMetricsRender({
      today: "2026-05-05",
      env: {},
      getLastRenderedDate: async () => "2026-05-05",
      render,
    });
    expect(renderCount).toBe(0);
  });

  it("re-renders the morning after — yesterday's stamp does not suppress today's render", async () => {
    const { render, calls } = makeRender();
    const result = await runMetricsRender({
      today: "2026-05-06",
      env: {},
      getLastRenderedDate: async () => "2026-05-05",
      render,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.date).toBe("2026-05-06");
  });
});
