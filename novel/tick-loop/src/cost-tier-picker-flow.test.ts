// Tests for `cost-tier-picker-flow.ts`. Slice 3a of `interactive-model-cost-picker`.
// Paired positive/negative fixtures over every branch of the
// {@link decidePickerFlow} verdict-union: skip, use-default (×2 reasons),
// prompt.

import { describe, expect, test } from "vitest";

import {
  type FlowDecision,
  type FlowEnvironment,
  decidePickerFlow,
} from "./cost-tier-picker-flow.js";
import { DEFAULT_TIER_ID } from "./cost-tier-picker.js";

describe("decidePickerFlow — skip branch", () => {
  test("config has a known tier id → kind=skip + tier + summary", () => {
    const env: FlowEnvironment = { existingCostTier: "opus-opus", isTty: true };
    const d = decidePickerFlow(env);
    expect(d.kind).toBe("skip");
    if (d.kind === "skip") {
      expect(d.tier.id).toBe("opus-opus");
      expect(d.summaryLine).toContain("Using tier:");
      expect(d.summaryLine).toContain("Opus brain + Opus workers");
      expect(d.summaryLine).toContain("~$40/hr");
      expect(d.summaryLine).toContain("minsky config");
    }
  });

  test("config has the DEFAULT tier id → skip even though it's the default", () => {
    const env: FlowEnvironment = { existingCostTier: DEFAULT_TIER_ID, isTty: false };
    const d = decidePickerFlow(env);
    expect(d.kind).toBe("skip");
    // Note: the (DEFAULT) suffix is stripped from the summary so the
    // operator doesn't see "Opus+Sonnet workers (DEFAULT)" — that suffix
    // belongs to the menu, not the steady-state summary.
    if (d.kind === "skip") {
      expect(d.summaryLine).not.toContain("(DEFAULT)");
    }
  });

  test("skip branch IGNORES isTty (config wins)", () => {
    const ttyEnv: FlowEnvironment = { existingCostTier: "local-local", isTty: true };
    const noTtyEnv: FlowEnvironment = { existingCostTier: "local-local", isTty: false };
    expect(decidePickerFlow(ttyEnv).kind).toBe("skip");
    expect(decidePickerFlow(noTtyEnv).kind).toBe("skip");
  });

  test("local-local tier shows $0/hr in the summary (no ~ prefix on zero)", () => {
    const d = decidePickerFlow({ existingCostTier: "local-local", isTty: false });
    if (d.kind === "skip") {
      expect(d.summaryLine).toContain("$0/hr");
      expect(d.summaryLine).not.toContain("~$0/hr");
    }
  });
});

describe("decidePickerFlow — use-default + no-tty branch", () => {
  test("no config + no TTY → kind=use-default + reason=no-tty", () => {
    const env: FlowEnvironment = { existingCostTier: null, isTty: false };
    const d = decidePickerFlow(env);
    expect(d.kind).toBe("use-default");
    if (d.kind === "use-default") {
      expect(d.reason).toBe("no-tty");
      expect(d.tier.id).toBe(DEFAULT_TIER_ID);
      expect(d.noteLine).toContain("No TTY detected");
      expect(d.noteLine).toContain("default tier:");
    }
  });

  test("DEFAULT tier in the note line strips the (DEFAULT) suffix", () => {
    const env: FlowEnvironment = { existingCostTier: null, isTty: false };
    const d = decidePickerFlow(env);
    if (d.kind === "use-default") {
      expect(d.noteLine).not.toContain("(DEFAULT)");
    }
  });
});

describe("decidePickerFlow — use-default + unknown-tier branch", () => {
  test("config has unknown tier id → kind=use-default + reason=config-has-unknown-tier", () => {
    const env: FlowEnvironment = { existingCostTier: "ancient-tier-name", isTty: true };
    const d = decidePickerFlow(env);
    expect(d.kind).toBe("use-default");
    if (d.kind === "use-default") {
      expect(d.reason).toBe("config-has-unknown-tier");
      expect(d.tier.id).toBe(DEFAULT_TIER_ID);
      expect(d.noteLine).toContain('cost_tier="ancient-tier-name"');
      expect(d.noteLine).toContain("falling back to default:");
    }
  });

  test("empty-string tier id (corrupted config) → use-default", () => {
    // Empty string is non-null but unknown; the use-default branch
    // catches both unknown ids and empty-string corruption.
    const env: FlowEnvironment = { existingCostTier: "", isTty: true };
    const d = decidePickerFlow(env);
    expect(d.kind).toBe("use-default");
    if (d.kind === "use-default") {
      expect(d.reason).toBe("config-has-unknown-tier");
    }
  });

  test("unknown-tier branch IGNORES isTty (corruption is the same regardless)", () => {
    const ttyEnv: FlowEnvironment = { existingCostTier: "bogus", isTty: true };
    const noTtyEnv: FlowEnvironment = { existingCostTier: "bogus", isTty: false };
    expect(decidePickerFlow(ttyEnv).kind).toBe("use-default");
    expect(decidePickerFlow(noTtyEnv).kind).toBe("use-default");
  });
});

describe("decidePickerFlow — prompt branch", () => {
  test("no config + TTY → kind=prompt + default reference", () => {
    const env: FlowEnvironment = { existingCostTier: null, isTty: true };
    const d = decidePickerFlow(env);
    expect(d.kind).toBe("prompt");
    if (d.kind === "prompt") {
      expect(d.default.id).toBe(DEFAULT_TIER_ID);
    }
  });

  test("prompt verdict carries the DEFAULT tier for the [default: ...] menu hint", () => {
    const env: FlowEnvironment = { existingCostTier: null, isTty: true };
    const d = decidePickerFlow(env);
    if (d.kind === "prompt") {
      // Slice 3b's CLI renders the menu and uses d.default.id in the
      // prompt suffix; verify the default is what {@link getDefaultTier}
      // returns so the prompt and the no-tty path stay aligned.
      expect(d.default.id).toBe(DEFAULT_TIER_ID);
      expect(d.default.label).toContain("(DEFAULT)");
    }
  });
});

describe("decidePickerFlow — verdict shape invariants", () => {
  test("every verdict carries a tier (or 'default') reference", () => {
    /** @type {FlowEnvironment[]} */
    const envs: FlowEnvironment[] = [
      { existingCostTier: "opus-opus", isTty: true },
      { existingCostTier: null, isTty: false },
      { existingCostTier: "bogus", isTty: true },
      { existingCostTier: null, isTty: true },
    ];
    for (const env of envs) {
      const d: FlowDecision = decidePickerFlow(env);
      // The TS union guarantees at compile time that every branch has a
      // CostTier reference (either `tier` or `default`). The runtime
      // assertion below is the test-time equivalent.
      if (d.kind === "prompt") {
        expect(d.default).toBeDefined();
        expect(typeof d.default.id).toBe("string");
      } else {
        expect(d.tier).toBeDefined();
        expect(typeof d.tier.id).toBe("string");
      }
    }
  });
});
