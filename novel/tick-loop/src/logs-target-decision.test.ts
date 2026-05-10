/**
 * Paired tests for `logs-target-decision.ts`. Slice 13 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from {@link decideLogsTarget}'s JSDoc:
 *   1. No arg                  → worker 0 (default)
 *   2. Numeric arg             → that worker
 *   3. `mlx-server` literal    → mlx-server
 *   4. `mlx` shorthand         → mlx-server
 *   5. Unknown non-numeric arg → worker 0 (default fall-through)
 */

import { describe, expect, it } from "vitest";
import { type LogsTarget, decideLogsTarget } from "./logs-target-decision.js";

describe("decideLogsTarget", () => {
  it("no arg → worker 0 (chaos row 1)", () => {
    expect(decideLogsTarget(undefined)).toEqual<LogsTarget>({ kind: "worker", workerId: 0 });
  });

  it("numeric arg → that worker (chaos row 2)", () => {
    expect(decideLogsTarget("1")).toEqual<LogsTarget>({ kind: "worker", workerId: 1 });
    expect(decideLogsTarget("42")).toEqual<LogsTarget>({ kind: "worker", workerId: 42 });
  });

  it("`mlx-server` keyword → mlx-server (chaos row 3)", () => {
    expect(decideLogsTarget("mlx-server")).toEqual<LogsTarget>({ kind: "mlx-server" });
  });

  it("`mlx` shorthand → mlx-server (chaos row 4)", () => {
    expect(decideLogsTarget("mlx")).toEqual<LogsTarget>({ kind: "mlx-server" });
  });

  it("unknown non-numeric arg falls through to worker 0 (chaos row 5)", () => {
    // The pre-slice-13 `runLogs` resolved any non-numeric arg to worker 0
    // via `parsePositionalAndForward`; this preserves that behaviour for
    // unrecognised words so existing operator scripts don't break.
    expect(decideLogsTarget("frob")).toEqual<LogsTarget>({ kind: "worker", workerId: 0 });
    expect(decideLogsTarget("")).toEqual<LogsTarget>({ kind: "worker", workerId: 0 });
  });

  it("returns a closed-set kind for representative inputs", () => {
    // Lightweight property sanity over the explicit chaos sample.
    const closedKinds = new Set<LogsTarget["kind"]>(["worker", "mlx-server"]);
    const samples: (string | undefined)[] = [undefined, "0", "7", "mlx-server", "mlx", "frob", ""];
    for (const arg of samples) {
      const target = decideLogsTarget(arg);
      expect(closedKinds.has(target.kind)).toBe(true);
    }
  });
});
