import { describe, expect, it } from "vitest";

import {
  type AuditPassDecision,
  buildAuditPassTickEvent,
  chooseAuditScope,
  DEFAULT_EMPTY_QUEUE_CADENCE,
  normalizeCadence,
  STABILITY_DEBT_VERDICTS,
  shouldTriggerAuditPass,
} from "./audit-pass-trigger.js";

describe("shouldTriggerAuditPass — queue non-empty", () => {
  it("does not trigger when a task was picked", () => {
    const d = shouldTriggerAuditPass({ pickedTaskId: "some-task", consecutiveEmptyTicks: 0 });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("queue-non-empty");
  });
});

describe("shouldTriggerAuditPass — empty queue, default cadence", () => {
  it("triggers on the first empty tick (idle→audit latency is one tick)", () => {
    const d = shouldTriggerAuditPass({ pickedTaskId: null, consecutiveEmptyTicks: 1 });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("empty-queue-cadence-reached");
  });

  it("triggers on every empty tick at the default cadence of 1", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const d = shouldTriggerAuditPass({ pickedTaskId: null, consecutiveEmptyTicks: n });
      expect(d.trigger, `empty tick ${n}`).toBe(true);
    }
  });

  it("never triggers on a zero empty-tick count (defensive)", () => {
    const d = shouldTriggerAuditPass({ pickedTaskId: null, consecutiveEmptyTicks: 0 });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("cadence-not-reached");
  });
});

describe("shouldTriggerAuditPass — larger cadence spaces re-audits", () => {
  it("triggers on tick 1 then every 3rd with cadence 3", () => {
    const triggered = [1, 2, 3, 4, 5, 6, 7].map(
      (n) =>
        shouldTriggerAuditPass({ pickedTaskId: null, consecutiveEmptyTicks: n, cadence: 3 })
          .trigger,
    );
    expect(triggered).toEqual([true, false, false, true, false, false, true]);
  });
});

describe("chooseAuditScope — rule-#12 Pivot clause", () => {
  it("is broad when no recent verdicts are provided", () => {
    expect(chooseAuditScope()).toBe("broad");
  });

  it("is broad when recent verdicts are all healthy", () => {
    expect(chooseAuditScope(["validated", "no-change", "pr-open"])).toBe("broad");
  });

  it("narrows to stability-only when a stability-debt verdict is present", () => {
    expect(chooseAuditScope(["validated", "scope-leak"])).toBe("stability-only");
  });

  it("narrows on every stability-debt verdict in the frozen set", () => {
    for (const v of STABILITY_DEBT_VERDICTS) {
      expect(chooseAuditScope([v]), `verdict ${v}`).toBe("stability-only");
    }
  });

  it("propagates the scope decision through shouldTriggerAuditPass", () => {
    const d = shouldTriggerAuditPass({
      pickedTaskId: null,
      consecutiveEmptyTicks: 1,
      recentVerdicts: ["spawn-failed"],
    });
    expect(d.trigger).toBe(true);
    expect(d.scope).toBe("stability-only");
  });
});

describe("normalizeCadence — rule-#6 never crash on a bad cadence", () => {
  it("defaults when undefined", () => {
    expect(normalizeCadence()).toBe(DEFAULT_EMPTY_QUEUE_CADENCE);
  });

  it("clamps non-positive / non-finite to the default", () => {
    expect(normalizeCadence(0)).toBe(DEFAULT_EMPTY_QUEUE_CADENCE);
    expect(normalizeCadence(-5)).toBe(DEFAULT_EMPTY_QUEUE_CADENCE);
    expect(normalizeCadence(Number.NaN)).toBe(DEFAULT_EMPTY_QUEUE_CADENCE);
    expect(normalizeCadence(Number.POSITIVE_INFINITY)).toBe(DEFAULT_EMPTY_QUEUE_CADENCE);
  });

  it("floors a fractional cadence", () => {
    expect(normalizeCadence(3.9)).toBe(3);
  });
});

describe("STABILITY_DEBT_VERDICTS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(STABILITY_DEBT_VERDICTS)).toBe(true);
  });
});

describe("buildAuditPassTickEvent", () => {
  const triggered: AuditPassDecision = {
    trigger: true,
    reason: "empty-queue-cadence-reached",
    scope: "broad",
  };
  const notTriggered: AuditPassDecision = {
    trigger: false,
    reason: "queue-non-empty",
    scope: "broad",
  };

  it("records the tasks produced when the audit was invoked", () => {
    const e = buildAuditPassTickEvent({
      ts: "2026-01-01T00:00:00.000Z",
      decision: triggered,
      emptyQueue: true,
      newTasksProduced: 3,
      idleToNextTaskMinutes: 2.5,
    });
    expect(e.auditPassInvoked).toBe(true);
    expect(e.newTasksProduced).toBe(3);
    expect(e.idleToNextTaskMinutes).toBe(2.5);
    expect(e.emptyQueue).toBe(true);
  });

  it("zeroes newTasksProduced when the audit was NOT invoked", () => {
    const e = buildAuditPassTickEvent({
      ts: "2026-01-01T00:00:00.000Z",
      decision: notTriggered,
      emptyQueue: false,
      newTasksProduced: 99,
    });
    expect(e.auditPassInvoked).toBe(false);
    expect(e.newTasksProduced).toBe(0);
    expect(e.idleToNextTaskMinutes).toBeNull();
  });

  it("defaults idleToNextTaskMinutes to null when omitted", () => {
    const e = buildAuditPassTickEvent({
      ts: "2026-01-01T00:00:00.000Z",
      decision: triggered,
      emptyQueue: true,
    });
    expect(e.idleToNextTaskMinutes).toBeNull();
    expect(e.newTasksProduced).toBe(0);
  });
});
