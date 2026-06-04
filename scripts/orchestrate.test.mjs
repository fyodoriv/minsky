// Tests for orchestrate.mjs. The conductor's deterministic decision
// (rule #10 — no I/O in the decision) is `decideHeal`; the I/O wiring
// (pgrep / launchctl / runGateSweep) is validated by the `--once` run.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import {
  buildOnceJsonSummary,
  buildProviderModeTransition,
  buildRunanyPolicyRecords,
  buildTickLedgerLine,
  decideAgentForRole,
  decideDetachedWorkerAction,
  decideGateAdmission,
  decideHeal,
  decideWorkerPausePids,
  parseLaunchctlRunning,
  resolveSpawnRole,
} from "./orchestrate.mjs";

describe("buildProviderModeTransition (runtime token-limit auto-pivot ledger)", () => {
  it("records a remote→local forward fallback with its trigger", () => {
    const r = buildProviderModeTransition({
      from: "remote",
      to: "local",
      trigger: "local-fallback",
      ts: "2026-05-17T06:11:28Z",
    });
    expect(r["event"]).toBe("provider-mode-transition");
    expect(r["from"]).toBe("remote");
    expect(r["to"]).toBe("local");
    expect(r["trigger"]).toBe("local-fallback");
    expect(r["ts"]).toBe("2026-05-17T06:11:28Z");
  });

  it("records a local→remote recover flip-back, carrying the re-pinned model", () => {
    const r = buildProviderModeTransition({
      from: "local",
      to: "remote",
      trigger: "recover-flip-back",
      model: "claude-opus-4-7",
    });
    expect(r["from"]).toBe("local");
    expect(r["to"]).toBe("remote");
    expect(r["model"]).toBe("claude-opus-4-7");
  });

  it("omits optional fields when absent (no empty model/runId keys)", () => {
    const r = buildProviderModeTransition({ from: "remote", to: "local", trigger: "t" });
    expect("model" in r).toBe(false);
    expect("runId" in r).toBe(false);
    expect(typeof r["ts"]).toBe("string");
  });
});

describe("decideGateAdmission (self-adjusting vet-sweep load gate)", () => {
  it("defers the sweep when load1 exceeds the core budget", () => {
    const d = decideGateAdmission({ load1: 13, cpuCount: 10 });
    expect(d.admit).toBe(false);
    expect(d.reason).toContain("oversubscribed");
  });

  it("admits the sweep when the host has headroom", () => {
    expect(decideGateAdmission({ load1: 4, cpuCount: 10 }).admit).toBe(true);
  });

  it("uses the default factor 0.9 (defers at 90% of cores)", () => {
    expect(decideGateAdmission({ load1: 9.1, cpuCount: 10 }).admit).toBe(false);
    expect(decideGateAdmission({ load1: 8.9, cpuCount: 10 }).admit).toBe(true);
  });

  it("honors a custom factor", () => {
    expect(decideGateAdmission({ load1: 6, cpuCount: 10, factor: 0.5 }).admit).toBe(false);
    expect(decideGateAdmission({ load1: 4, cpuCount: 10, factor: 0.5 }).admit).toBe(true);
  });

  it("auto-recovers: the same gate admits once load drops below the ceiling", () => {
    expect(decideGateAdmission({ load1: 12, cpuCount: 10 }).admit).toBe(false);
    expect(decideGateAdmission({ load1: 3, cpuCount: 10 }).admit).toBe(true);
  });

  it("degrades safely on bad inputs (never blocks on an unreadable load)", () => {
    expect(decideGateAdmission({ load1: Number.NaN, cpuCount: 10 }).admit).toBe(true);
    expect(decideGateAdmission({ load1: 0.5, cpuCount: 0 }).admit).toBe(true); // cores floored to 1
  });
});

describe("decideHeal (conductor self-heal decision)", () => {
  it("worker alive ⇒ ok (no heal)", () => {
    expect(decideHeal(true)).toBe("ok");
  });
  it("worker down ⇒ heal", () => {
    expect(decideHeal(false)).toBe("heal");
  });
  it("is pure / deterministic — same input, same output", () => {
    expect(decideHeal(true)).toBe(decideHeal(true));
    expect(decideHeal(false)).toBe(decideHeal(false));
  });
});

// Regression tests for `local-gate-merge-false-negative-on-worktree-bound-
// branch-delete` (TASKS.md), conductor-side. `runGateSweep` already counts a
// worktree-bound-delete soft-fail as MERGED via the `gh pr view --json state`
// oracle; these pin that the conductor's `.minsky/orchestrate.jsonl`
// `merged:[]` accounting carries that PR number through — so the autonomous
// path agrees with the manual `local-gate-merge.mjs` path.
describe("buildTickLedgerLine (conductor merge-accounting)", () => {
  const ctx = { ts: "2026-05-17T06:11:28Z", workerAlive: true, healed: false };

  it("includes a soft-fail-merged PR number in merged:[] (worktree-bound-delete)", () => {
    // The sweep counted #575 as merged despite gh's non-zero exit on the
    // post-merge local branch-delete (remote squash-merge succeeded).
    const res = { merged: [{ number: 575 }], skipped: [] };
    const line = buildTickLedgerLine(res, ctx);
    expect(line.merged).toEqual([575]);
    expect(line.skipped).toBe(0);
  });

  it("keeps a genuinely-failed merge out of merged:[] (no false positive)", () => {
    const res = { merged: [], skipped: [{ number: 999 }] };
    const line = buildTickLedgerLine(res, ctx);
    expect(line.merged).toEqual([]);
    expect(line.skipped).toBe(1);
  });

  it("records a sweep error and an empty merged:[] without throwing", () => {
    const res = { merged: [], skipped: [] };
    const line = buildTickLedgerLine(res, { ...ctx, sweepError: "boom" });
    expect(line.merged).toEqual([]);
    expect(line.sweepError).toBe("boom");
  });

  it("omits sweepError when none occurred", () => {
    const line = buildTickLedgerLine({ merged: [], skipped: [] }, ctx);
    expect("sweepError" in line).toBe(false);
  });
});

// runany-permission-scoped-writes: the conductor only ever writes to its OWN
// (home) repo, so each merged PR is a home `open-pr` write-verdict and a tick
// that observes friction (healed daemon OR sweep error) files a minsky-self
// improvement task (scout-and-record). `buildRunanyPolicyRecords` is the pure
// decision (rule #10 — no I/O); the caller appends to `.minsky/runany-policy.jsonl`.
describe("buildRunanyPolicyRecords (least-authority policy ledger)", () => {
  const ts = "2026-06-02T00:00:00.000Z";

  it("one home write-verdict per merged PR — all allowed, none foreign", () => {
    const recs = buildRunanyPolicyRecords(
      { merged: [{ number: 11 }, { number: 12 }] },
      { healed: false, ts },
    );
    const verdicts = recs.filter((r) => r["event"] === "write-verdict");
    expect(verdicts).toHaveLength(2);
    for (const v of verdicts) {
      expect(v["repoClass"]).toBe("home");
      expect(v["action"]).toBe("open-pr");
      expect(v["allowed"]).toBe(true);
    }
  });

  it("files a minsky-self task when the worker daemon was healed (friction)", () => {
    const recs = buildRunanyPolicyRecords({ merged: [] }, { healed: true, ts });
    const filed = recs.filter((r) => r["event"] === "minsky-self-task-filed");
    expect(filed).toHaveLength(1);
    expect(String(filed[0]?.["taskId"])).toContain("worker-daemon-down-healed");
  });

  it("files a minsky-self task on a sweep error (friction)", () => {
    const recs = buildRunanyPolicyRecords(
      { merged: [] },
      { healed: false, sweepError: "boom", ts },
    );
    expect(recs.filter((r) => r["event"] === "minsky-self-task-filed")).toHaveLength(1);
  });

  it("files NO minsky-self task on a clean tick (no friction)", () => {
    const recs = buildRunanyPolicyRecords({ merged: [{ number: 7 }] }, { healed: false, ts });
    expect(recs.filter((r) => r["event"] === "minsky-self-task-filed")).toHaveLength(0);
  });

  it("empty merged + no friction ⇒ no records", () => {
    expect(buildRunanyPolicyRecords({ merged: [] }, { healed: false, ts })).toEqual([]);
  });

  it("is pure / deterministic — same input, same output", () => {
    const a = buildRunanyPolicyRecords({ merged: [{ number: 1 }] }, { healed: true, ts });
    const b = buildRunanyPolicyRecords({ merged: [{ number: 1 }] }, { healed: true, ts });
    expect(a).toEqual(b);
  });
});

// Regression tests for `worker-liveness-detect-by-label-not-argv` (TASKS.md):
// liveness is the launchd supervisor's truth (`state = running`), not an
// argv-substring grep that breaks when the worker fans out via
// `--spawn-additional-workers=N`. `parseLaunchctlRunning` is the pure seam
// `workerDaemonAlive` feeds; `decideHeal` consumes its boolean.
describe("parseLaunchctlRunning (launchd-label liveness, not argv grep)", () => {
  // Verbatim shape of `launchctl print gui/<uid>/<label>` for a running job.
  const RUNNING = ["com.minsky.opus-sonnet-run = {", "\tstate = running", "\tpid = 4242", "}"].join(
    "\n",
  );

  it("alive when the top-level job state = running", () => {
    expect(parseLaunchctlRunning(RUNNING)).toBe(true);
  });

  it("alive regardless of worker argv shape (--spawn-additional-workers=N)", () => {
    // The whole point: the worker's argv no longer contains `--worker-id=0`,
    // yet launchd still reports the job running. The old pgrep would miss it.
    const noWorkerId0 = [
      "com.minsky.opus-sonnet-run = {",
      "\tstate = running",
      "\targuments = { tick-loop.mjs --spawn-additional-workers=3 }",
      "}",
    ].join("\n");
    expect(parseLaunchctlRunning(noWorkerId0)).toBe(true);
  });

  it("down when the job is not running (state = waiting)", () => {
    const waiting = ["com.minsky.opus-sonnet-run = {", "\tstate = waiting", "}"].join("\n");
    expect(parseLaunchctlRunning(waiting)).toBe(false);
  });

  it("down when launchctl reports the service is not loaded (empty/error)", () => {
    expect(parseLaunchctlRunning("")).toBe(false);
    expect(
      parseLaunchctlRunning('Could not find service "com.minsky.opus-sonnet-run" in domain'),
    ).toBe(false);
  });

  it("a nested sub-job `state = active` alone does NOT read as alive", () => {
    // launchctl nests endpoint sub-jobs deeper-indented; only the top-level
    // (single-tab) `state = running` is the daemon's own liveness.
    const nestedOnly = [
      "com.minsky.opus-sonnet-run = {",
      "\tstate = waiting",
      "\tendpoints = {",
      "\t\tstate = active",
      "\t}",
      "}",
    ].join("\n");
    expect(parseLaunchctlRunning(nestedOnly)).toBe(false);
  });

  it("is pure / deterministic — same input, same output", () => {
    expect(parseLaunchctlRunning(RUNNING)).toBe(parseLaunchctlRunning(RUNNING));
    expect(parseLaunchctlRunning("")).toBe(parseLaunchctlRunning(""));
  });

  it("feeds decideHeal correctly: running ⇒ ok, not-loaded ⇒ heal", () => {
    expect(decideHeal(parseLaunchctlRunning(RUNNING))).toBe("ok");
    expect(decideHeal(parseLaunchctlRunning(""))).toBe("heal");
  });
});

// gate-host-load-shed: the conductor SIGSTOPs the worker daemon's iteration
// processes for the duration of a gate vet so gate-vet and worker-tick never
// run vitest simultaneously under host oversubscription. `decideWorkerPausePids`
// is the pure pid-selection (rule #10 — no I/O); it MUST exclude the conductor's
// own pid so a load-shed pause can never freeze the conductor.
describe("decideWorkerPausePids (load-shed pid selection)", () => {
  it("parses pgrep output into integer pids", () => {
    expect(decideWorkerPausePids("4101\n4102\n4103\n", 9999)).toEqual([4101, 4102, 4103]);
  });

  it("excludes the conductor's own pid (never freeze self)", () => {
    expect(decideWorkerPausePids("4101\n5000\n4103\n", 5000)).toEqual([4101, 4103]);
  });

  it("drops blank lines, non-numeric, and non-positive entries", () => {
    expect(decideWorkerPausePids("4101\n\n  \nnotapid\n0\n-7\n4102\n", 1)).toEqual([4101, 4102]);
  });

  it("empty pgrep output ⇒ nothing to pause", () => {
    expect(decideWorkerPausePids("", 1)).toEqual([]);
  });

  it("is pure / deterministic — same input, same output", () => {
    expect(decideWorkerPausePids("4101\n4102\n", 1)).toEqual(
      decideWorkerPausePids("4101\n4102\n", 1),
    );
  });
});

// claude-orchestrator-local-worker-fanout: the brain-vs-hands role pin.
// The orchestrator (conductor) spends the cloud budget; a worker uses the
// cheap local agent. `resolveSpawnRole` classifies from MINSKY_ROLE,
// defaulting to the conservative orchestrator (a missing label can only make
// a process MORE conservative on cloud spend). `decideAgentForRole` maps a
// role to (agent, model).
describe("resolveSpawnRole (process role classification)", () => {
  it("MINSKY_ROLE=worker ⇒ worker", () => {
    expect(resolveSpawnRole("worker")).toBe("worker");
  });
  it("missing / unset ⇒ orchestrator (conservative default)", () => {
    expect(resolveSpawnRole(undefined)).toBe("orchestrator");
    expect(resolveSpawnRole("")).toBe("orchestrator");
  });
  it("any non-worker value ⇒ orchestrator (typo cannot leak cloud to a worker)", () => {
    expect(resolveSpawnRole("orchestrator")).toBe("orchestrator");
    expect(resolveSpawnRole("WORKER")).toBe("orchestrator");
    expect(resolveSpawnRole("brain")).toBe("orchestrator");
  });
});

describe("decideAgentForRole (role-pinned agent + model)", () => {
  const cfg = {
    cloudAgent: "claude",
    cloudModel: "claude-opus-4-7-max",
    localAgent: "aider",
    localModel: "ollama_chat/qwen3-coder:30b",
  };

  it("orchestrator ⇒ cloud agent + cloud model", () => {
    expect(decideAgentForRole("orchestrator", cfg)).toEqual({
      agent: "claude",
      model: "claude-opus-4-7-max",
      role: "orchestrator",
    });
  });

  it("worker ⇒ local agent + local model", () => {
    expect(decideAgentForRole("worker", cfg)).toEqual({
      agent: "aider",
      model: "ollama_chat/qwen3-coder:30b",
      role: "worker",
    });
  });

  it("MINSKY_STRATEGIC_PIN_MODEL hard-override wins the model slot for either role", () => {
    const pinned = { ...cfg, pinModel: "claude-opus-4-8" };
    expect(decideAgentForRole("orchestrator", pinned).model).toBe("claude-opus-4-8");
    // An operator debugging a worker against the cloud model can pin it.
    expect(decideAgentForRole("worker", pinned).model).toBe("claude-opus-4-8");
    // The agent slot is NOT overridden by the model pin.
    expect(decideAgentForRole("worker", pinned).agent).toBe("aider");
  });

  it("falls back to safe defaults when config is empty (rule #6)", () => {
    expect(decideAgentForRole("orchestrator", {})).toEqual({
      agent: "claude",
      model: "claude-opus-4-7-max",
      role: "orchestrator",
    });
    expect(decideAgentForRole("worker", {})).toEqual({
      agent: "aider",
      model: "ollama_chat/qwen3-coder:30b",
      role: "worker",
    });
  });

  it("is pure / deterministic — same input, same output", () => {
    expect(decideAgentForRole("worker", cfg)).toEqual(decideAgentForRole("worker", cfg));
  });
});

// orchestrator-detached-worker-finish: a worker must never become a zombie
// holding the cloud budget when its parent brain exits. `decideDetachedWorkerAction`
// is the pure actor-model decision the chaos test + self-diagnose invariant share.
describe("decideDetachedWorkerAction (no-zombie-on-orchestrator-kill)", () => {
  it("orchestrator alive ⇒ continue", () => {
    expect(decideDetachedWorkerAction({ orchestratorAlive: true, workerBusy: true })).toBe(
      "continue",
    );
    expect(decideDetachedWorkerAction({ orchestratorAlive: true, workerBusy: false })).toBe(
      "continue",
    );
  });

  it("orchestrator dead + worker busy ⇒ finish-then-exit (don't waste committed effort)", () => {
    expect(decideDetachedWorkerAction({ orchestratorAlive: false, workerBusy: true })).toBe(
      "finish-then-exit",
    );
  });

  it("orchestrator dead + worker idle ⇒ exit-now (no zombie)", () => {
    expect(decideDetachedWorkerAction({ orchestratorAlive: false, workerBusy: false })).toBe(
      "exit-now",
    );
  });

  it("never returns continue once the orchestrator is dead (no zombie path)", () => {
    expect(decideDetachedWorkerAction({ orchestratorAlive: false, workerBusy: true })).not.toBe(
      "continue",
    );
    expect(decideDetachedWorkerAction({ orchestratorAlive: false, workerBusy: false })).not.toBe(
      "continue",
    );
  });
});

// The `--once --json` summary the task's `**Measurement**` consumes: stdout
// must carry a single object with BOTH `merged` and `skipped` defined.
describe("buildOnceJsonSummary (--once --json machine summary)", () => {
  it("emits merged[] + skipped count (the measurement's two required keys)", () => {
    const s = buildOnceJsonSummary(
      { merged: [{ number: 7 }, { number: 8 }], skipped: [{ number: 9 }] },
      { ts: "2026-06-02T00:00:00.000Z", role: "orchestrator" },
    );
    expect(s.merged).toEqual([7, 8]);
    expect(s.skipped).toBe(1);
    expect(typeof s.merged).toBe("object");
    expect(typeof s.skipped).toBe("number");
  });

  it("skipped is always a NUMBER (a downstream j.skipped never sees an array)", () => {
    const s = buildOnceJsonSummary({ merged: [], skipped: [] });
    expect(s.skipped).toBe(0);
    expect(Array.isArray(s.skipped)).toBe(false);
  });

  it("records the role (defaults to orchestrator)", () => {
    expect(buildOnceJsonSummary({ merged: [], skipped: [] }).role).toBe("orchestrator");
    expect(buildOnceJsonSummary({ merged: [], skipped: [] }, { role: "worker" }).role).toBe(
      "worker",
    );
  });

  it("carries an optional sweepError + runId without polluting the clean case", () => {
    const clean = buildOnceJsonSummary({ merged: [], skipped: [] });
    expect("sweepError" in clean).toBe(false);
    expect("runId" in clean).toBe(false);
    const withErr = buildOnceJsonSummary(
      { merged: [], skipped: [] },
      { sweepError: "boom", runId: "abc-1-deadbeef" },
    );
    expect(withErr.sweepError).toBe("boom");
    expect(withErr.runId).toBe("abc-1-deadbeef");
  });
});
