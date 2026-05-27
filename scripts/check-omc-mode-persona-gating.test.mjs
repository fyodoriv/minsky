// @ts-check
import { describe, expect, it } from "vitest";
import { checkOmcModePersonaGating, extractTaskBlocks } from "./check-omc-mode-persona-gating.mjs";

describe("extractTaskBlocks", () => {
  it("parses basic task block", () => {
    const md = [
      "- [ ] `task-id` — title",
      "  - **Tags**: p0, foo",
      "  - **Details**: stuff",
      "",
      "- [ ] `another` — title",
      "  - **Tags**: p1",
    ].join("\n");
    const blocks = extractTaskBlocks(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.id).toBe("task-id");
    expect(blocks[0]?.tags).toBe("p0, foo");
    expect(blocks[1]?.id).toBe("another");
  });

  it("returns empty on no task blocks", () => {
    expect(extractTaskBlocks("# Header\n\nsome text")).toEqual([]);
  });
});

describe("checkOmcModePersonaGating (persona-gate)", () => {
  it("passes when no gated persona is referenced", () => {
    const md = "- [ ] `foo` — bar\n  - **Tags**: p0";
    const result = checkOmcModePersonaGating({ tasksMdContent: md });
    expect(result.ok).toBe(true);
  });

  it("flags gated persona on a task without allowed tag", () => {
    const md = ["- [ ] `foo` — bar", "  - **Tags**: p0", "  - **Persona**: product-manager"].join(
      "\n",
    );
    const result = checkOmcModePersonaGating({ tasksMdContent: md });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/product-manager/);
  });

  it("passes gated persona when business tag is present", () => {
    const md = [
      "- [ ] `foo` — bar",
      "  - **Tags**: p0, business",
      "  - **Persona**: product-manager",
    ].join("\n");
    const result = checkOmcModePersonaGating({ tasksMdContent: md });
    expect(result.ok).toBe(true);
  });

  it("flags gated persona referenced via @claim", () => {
    const md = ["- [ ] `foo` (@product-analyst) — bar", "  - **Tags**: p0"].join("\n");
    const result = checkOmcModePersonaGating({ tasksMdContent: md });
    expect(result.ok).toBe(false);
  });

  it("passes when @claim is for a non-gated persona", () => {
    const md = ["- [ ] `foo` (@worker-claude) — bar", "  - **Tags**: p0"].join("\n");
    const result = checkOmcModePersonaGating({ tasksMdContent: md });
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkOmcModePersonaGating();
    expect(result.ok).toBe(true);
  });
});

describe("checkOmcModePersonaGating (OMC-mode strict)", () => {
  it("strict mode flags missing OMC-Mode for parallel-tagged task", () => {
    const md = ["- [ ] `foo` — bar", "  - **Tags**: p0, parallel"].join("\n");
    const result = checkOmcModePersonaGating({ tasksMdContent: md, strict: true });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/ultrawork/);
  });

  it("strict mode passes when correct OMC-Mode is declared", () => {
    const md = [
      "- [ ] `foo` — bar",
      "  - **Tags**: p0, parallel",
      "  - **OMC-Mode**: /ultrawork",
    ].join("\n");
    const result = checkOmcModePersonaGating({ tasksMdContent: md, strict: true });
    expect(result.ok).toBe(true);
  });

  it("default (non-strict) does not flag missing OMC-Mode", () => {
    const md = ["- [ ] `foo` — bar", "  - **Tags**: p0, parallel"].join("\n");
    const result = checkOmcModePersonaGating({ tasksMdContent: md, strict: false });
    expect(result.ok).toBe(true);
  });
});
