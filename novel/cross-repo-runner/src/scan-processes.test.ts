// Paired tests for `scan-processes.ts` — the machine-wide running-minsky
// enumerator shared by runany-retro-tui-dashboard / runany-multitenant-
// no-conflict / runany-zero-arg-entrypoint. rule #3 (test-first), rule
// #10 (pure parse — no I/O in the decision).

import { describe, expect, test } from "vitest";

import { type MinskyProc, parseMinskyProcs, scanMinskyProcesses } from "./scan-processes.js";

/** Strict-safe lookup: a missing pid is a test failure, not `undefined`. */
function pick(procs: readonly MinskyProc[], pid: number): MinskyProc {
  const p = procs.find((x) => x.pid === pid);
  if (!p) throw new Error(`expected a proc with pid ${pid}`);
  return p;
}

const PS_FIXTURE = [
  " 12251 node /Users/x/apps/tooling/minsky/scripts/orchestrate.mjs",
  " 66003 node /Users/x/apps/tooling/minsky/novel/tick-loop/bin/tick-loop.mjs --worker-id=0 --workers-total=1 --tick-interval-ms=300000",
  " 70010 node /Users/x/apps/other-proj/novel/tick-loop/bin/tick-loop.mjs --worker-id=2 --workers-total=4",
  " 80200 node /Users/x/apps/tooling/minsky/scripts/local-gate-merge.mjs --limit=2",
  " 99001 node /private/tmp/minsky-gate-AbC/scripts/run-pre-pr-lint-stack.mjs --stage=full --json",
  " 41121 zsh (qterm)",
  "  7258 /Users/x/.local/bin/claude --resume abc",
].join("\n");

describe("parseMinskyProcs (pure)", () => {
  test("enumerates only top-level minsky processes, classifies kind", () => {
    const procs = parseMinskyProcs(PS_FIXTURE);
    expect(procs.map((p) => [p.pid, p.kind])).toEqual([
      [12251, "orchestrator"],
      [66003, "worker"],
      [70010, "worker"],
      [80200, "gate"],
    ]);
  });

  test("derives the repo root from the script path (multi-tenant: distinct repos)", () => {
    const procs = parseMinskyProcs(PS_FIXTURE);
    expect(pick(procs, 12251).repo).toBe("/Users/x/apps/tooling/minsky");
    expect(pick(procs, 66003).repo).toBe("/Users/x/apps/tooling/minsky");
    expect(pick(procs, 70010).repo).toBe("/Users/x/apps/other-proj");
  });

  test("extracts worker run-id; non-worker is 'main'", () => {
    const procs = parseMinskyProcs(PS_FIXTURE);
    expect(pick(procs, 66003).runId).toBe("w0");
    expect(pick(procs, 70010).runId).toBe("w2");
    expect(pick(procs, 12251).runId).toBe("main");
  });

  test("excludes the run-pre-pr-lint vet child + non-minsky noise", () => {
    const pids = parseMinskyProcs(PS_FIXTURE).map((p) => p.pid);
    expect(pids).not.toContain(99001); // gate vet child, not a top-level run
    expect(pids).not.toContain(41121); // zsh
    expect(pids).not.toContain(7258); // claude
  });

  test("empty / garbage input ⇒ empty list (fail-safe, deterministic)", () => {
    expect(parseMinskyProcs("")).toEqual([]);
    expect(parseMinskyProcs("not a ps line\n???")).toEqual([]);
  });
});

describe("scanMinskyProcesses (injected exec seam)", () => {
  test("delegates to the injected ps probe and parses", () => {
    const procs = scanMinskyProcesses({ ps: () => PS_FIXTURE });
    expect(procs.map((p) => p.pid)).toEqual([12251, 66003, 70010, 80200]);
  });

  test("a failing ps probe ⇒ empty list, never throws (rule #6 graceful-degrade)", () => {
    const procs = scanMinskyProcesses({
      ps: () => {
        throw new Error("ps unavailable");
      },
    });
    expect(procs).toEqual([]);
  });
});
