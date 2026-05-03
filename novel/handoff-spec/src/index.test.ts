import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isValid, parseHandoffs } from "./index.js";

const fixtureDir = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
const fixture = (name: string): string => readFileSync(join(fixtureDir, name), "utf-8");

describe("parseHandoffs — happy paths (the 5 reference fixtures)", () => {
  it("parses a simple ok handoff", () => {
    const result = parseHandoffs(fixture("01-ok.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.handoffs).toHaveLength(1);
    const h = result.handoffs[0];
    expect(h?.from).toBe("executor");
    expect(h?.to).toBe("qa-tester");
    expect(h?.status).toBe("ok");
    expect(h?.artifacts).toHaveLength(2);
    expect(h?.createdAt).toBe("2026-05-03T18:00:00.000Z");
  });

  it("parses a blocked handoff with blockers", () => {
    const result = parseHandoffs(fixture("02-blocked.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0]?.status).toBe("blocked");
    expect(result.handoffs[0]?.blockers).toHaveLength(2);
  });

  it("parses a needs-rework handoff with pushback", () => {
    const result = parseHandoffs(fixture("03-needs-rework.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.handoffs[0]?.status).toBe("needs-rework");
    expect(result.handoffs[0]?.pushback).toHaveLength(2);
  });

  it("parses a handoff with multiple suggested-next addressees and no To", () => {
    const result = parseHandoffs(fixture("04-multiple-suggested-next.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.handoffs[0]?.to).toBeUndefined();
    expect(result.handoffs[0]?.suggestedNext).toEqual(["qa-tester", "architect"]);
  });

  it("parses a handoff with both pushback and suggested-next", () => {
    const result = parseHandoffs(fixture("05-with-pushback-and-suggested-next.md"));
    expect(result.errors).toHaveLength(0);
    const h = result.handoffs[0];
    expect(h?.status).toBe("needs-rework");
    expect(h?.pushback.length).toBeGreaterThanOrEqual(2);
    expect(h?.suggestedNext.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseHandoffs — invalid fixtures yield specific errors", () => {
  it("rejects a handoff missing required Status", () => {
    const result = parseHandoffs(fixture("invalid-01-missing-status.md"));
    expect(result.handoffs).toHaveLength(0);
    expect(result.errors.some((e) => e.kind === "missing-required-field")).toBe(true);
  });

  it("rejects Status=blocked without Blockers", () => {
    const result = parseHandoffs(fixture("invalid-02-blocked-without-blockers.md"));
    expect(result.handoffs).toHaveLength(0);
    expect(result.errors.some((e) => e.kind === "blockers-required-when-blocked")).toBe(true);
  });

  it("rejects non-kebab-case persona IDs", () => {
    const result = parseHandoffs(fixture("invalid-03-bad-persona-id.md"));
    expect(result.handoffs).toHaveLength(0);
    expect(result.errors.some((e) => e.kind === "invalid-persona-id")).toBe(true);
  });
});

describe("parseHandoffs — structural error cases", () => {
  it("returns missing-heading when no `# Handoff:` is present", () => {
    const result = parseHandoffs("this is not a handoff document");
    expect(result.handoffs).toHaveLength(0);
    expect(result.errors[0]?.kind).toBe("missing-heading");
  });

  it("rejects an unknown Status value", () => {
    const src = `# Handoff: bad status

- **From**: executor
- **To**: qa-tester
- **Status**: maybe
- **Summary**: invalid status
- **Created-at**: 2026-05-03T18:00:00Z
`;
    const result = parseHandoffs(src);
    expect(result.errors.some((e) => e.kind === "invalid-status")).toBe(true);
  });

  it("rejects an invalid Created-at format", () => {
    const src = `# Handoff: bad date

- **From**: executor
- **To**: qa-tester
- **Status**: ok
- **Summary**: bad date format
- **Created-at**: yesterday afternoon
`;
    const result = parseHandoffs(src);
    expect(result.errors.some((e) => e.kind === "invalid-created-at")).toBe(true);
  });

  it("rejects when neither To nor Suggested-next is present", () => {
    const src = `# Handoff: no addressee

- **From**: executor
- **Status**: ok
- **Summary**: no recipient anywhere
- **Created-at**: 2026-05-03T18:00:00Z
`;
    const result = parseHandoffs(src);
    expect(result.errors.some((e) => e.kind === "to-or-suggested-next-required")).toBe(true);
  });

  it("parses multiple handoffs in one document", () => {
    const src = `${fixture("01-ok.md")}\n\n${fixture("04-multiple-suggested-next.md")}`;
    const result = parseHandoffs(src);
    expect(result.handoffs).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("isValid returns true for a clean parse", () => {
    const result = parseHandoffs(fixture("01-ok.md"));
    expect(isValid(result)).toBe(true);
  });

  it("isValid returns false for a parse with errors", () => {
    const result = parseHandoffs("not a handoff");
    expect(isValid(result)).toBe(false);
  });

  it("rejects non-kebab-case IDs inside Suggested-next", () => {
    const src = `# Handoff: bad suggested-next id

- **From**: planner
- **Status**: ok
- **Summary**: one of the suggested-next entries is PascalCase
- **Suggested next**:
  - qa-tester
  - QA-Tester
- **Created-at**: 2026-05-03T18:00:00Z
`;
    const result = parseHandoffs(src);
    expect(result.handoffs).toHaveLength(0);
    const idErr = result.errors.find((e) => e.kind === "invalid-persona-id");
    expect(idErr?.message).toContain("Suggested next");
  });
});
