/**
 * Paired tests for `local-llm-server-start-decision.ts`. Slice 12 of P0
 * task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from {@link decideStartAction}'s JSDoc:
 *   1. No PID file              → fresh-start
 *   2. PID file unparseable     → fresh-start (caller unlinks)
 *   3. PID dead (ESRCH)         → stale-pid-then-start
 *   4. PID alive + reachable    → already-running
 *   5. PID alive + unreachable  → pid-conflict
 */

import { describe, expect, it } from "vitest";
import {
  type StartAction,
  type StartDecisionInput,
  decideStartAction,
} from "./local-llm-server-start-decision.js";

const URL = "http://127.0.0.1:8080/v1/models";

function input(overrides: Partial<StartDecisionInput>): StartDecisionInput {
  return {
    pidPresent: false,
    parsedPid: undefined,
    pidAlive: false,
    serverReachable: false,
    serverUrl: URL,
    ...overrides,
  };
}

describe("decideStartAction", () => {
  it("no pid file → fresh-start (chaos row 1)", () => {
    const action = decideStartAction(input({ pidPresent: false }));
    expect(action).toEqual<StartAction>({ kind: "fresh-start" });
  });

  it("pid file present but unparseable → fresh-start (chaos row 2)", () => {
    // The wiring layer reads the file; if `parseInt` fails the value is
    // undefined and we treat it the same as no-pid-file. The caller may
    // unlink the bogus file as a tidiness gesture during dispatch.
    const action = decideStartAction(input({ pidPresent: true, parsedPid: undefined }));
    expect(action).toEqual<StartAction>({ kind: "fresh-start" });
  });

  it("pid file present + parsed but PID dead → stale-pid-then-start (chaos row 3)", () => {
    const action = decideStartAction(
      input({ pidPresent: true, parsedPid: 99999, pidAlive: false }),
    );
    expect(action).toEqual<StartAction>({ kind: "stale-pid-then-start", stalePid: 99999 });
  });

  it("pid alive AND server reachable → already-running (chaos row 4 — happy idempotent)", () => {
    const action = decideStartAction(
      input({
        pidPresent: true,
        parsedPid: 12345,
        pidAlive: true,
        serverReachable: true,
        serverUrl: URL,
      }),
    );
    expect(action).toEqual<StartAction>({ kind: "already-running", pid: 12345, url: URL });
  });

  it("pid alive but server unreachable → pid-conflict (chaos row 5)", () => {
    // Operator scenario: server crashed but PID is recycled by an
    // unrelated process; OR server is mid-load (probe times out).
    // Either way, refuse to double-spawn — the operator's recovery is
    // `minsky stop-mlx-server` first.
    const action = decideStartAction(
      input({
        pidPresent: true,
        parsedPid: 7777,
        pidAlive: true,
        serverReachable: false,
        serverUrl: URL,
      }),
    );
    expect(action).toEqual<StartAction>({ kind: "pid-conflict", pid: 7777, url: URL });
  });

  it("returns a closed-set kind for representative inputs", () => {
    // Lightweight property sanity over a hand-picked sample. The five
    // explicit chaos-row tests above cover the decision tree exhaustively;
    // this one just guards against future refactors silently widening
    // the return shape.
    const closedKinds = new Set<StartAction["kind"]>([
      "already-running",
      "pid-conflict",
      "stale-pid-then-start",
      "fresh-start",
    ]);
    const samples: Partial<StartDecisionInput>[] = [
      { pidPresent: false },
      { pidPresent: true, parsedPid: undefined },
      { pidPresent: true, parsedPid: 1, pidAlive: false },
      { pidPresent: true, parsedPid: 1, pidAlive: true, serverReachable: true },
      { pidPresent: true, parsedPid: 1, pidAlive: true, serverReachable: false },
    ];
    for (const cell of samples) {
      const action = decideStartAction(input(cell));
      expect(closedKinds.has(action.kind)).toBe(true);
    }
  });
});
