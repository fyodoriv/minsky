import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DelegationBrief,
  DelegationContract,
  DelegationResult,
  DelegationShape,
  DelegationVerdict,
} from "./delegation.js";

// The contract is types-only — there is no runtime code to exercise. These
// tests pin the *shape* of the contract so a future implementor of
// `multi-persona-pipeline-handoff-spec` cannot silently change the handoff
// payload, and so the chaos table in README.md has a real test target.

describe("DelegationShape", () => {
  it("admits exactly the two researched shapes", () => {
    expectTypeOf<DelegationShape>().toEqualTypeOf<"manager-sync" | "subagent-async">();
  });
});

describe("DelegationVerdict", () => {
  it("covers accept / revise / redelegate / fail", () => {
    expectTypeOf<DelegationVerdict>().toEqualTypeOf<
      "accepted" | "revise" | "redelegate" | "failed"
    >();
  });
});

describe("DelegationBrief", () => {
  it("is a serializable, lintable hand-off payload (rule #10)", () => {
    const brief: DelegationBrief = {
      taskId: "write-migration",
      goal: "Add the v2 schema migration",
      context: ["schema lives in db/schema.sql", "v1 is the current head"],
      expectedOutput: "a forward + rollback migration pair",
    };
    expect(JSON.parse(JSON.stringify(brief))).toEqual(brief);
  });
});

describe("DelegationResult", () => {
  it("carries a summary, not the full trajectory (context-budget discipline)", () => {
    const result: DelegationResult = {
      taskId: "write-migration",
      verdict: "accepted",
      summary: "Added 2026_v2_up.sql + 2026_v2_down.sql",
      artifacts: ["db/migrations/2026_v2_up.sql", "db/migrations/2026_v2_down.sql"],
    };
    expect(result.verdict).toBe("accepted");
    expect(result.taskId).toBe("write-migration");
  });
});

describe("DelegationContract — cycle guard", () => {
  it("reserves maxDepth + visited so even the async shape stays acyclic", () => {
    const contract: DelegationContract = {
      shape: "manager-sync",
      maxDepth: 3,
      visited: ["root-task", "write-migration"],
      critic: false,
    };
    // A coordinator refuses to delegate to a taskId already on the path.
    const wouldCycle = (next: string) => contract.visited.includes(next);
    expect(wouldCycle("write-migration")).toBe(true);
    expect(wouldCycle("new-task")).toBe(false);
  });

  it("the subagent-async shape turns the inline critic on", () => {
    const asyncContract: DelegationContract = {
      shape: "subagent-async",
      maxDepth: 2,
      visited: [],
      critic: true,
    };
    expect(asyncContract.shape).toBe("subagent-async");
    expect(asyncContract.critic).toBe(true);
  });
});
