// Tests for the repo.yaml validator. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { parseRepoConfig } from "./schema.js";

const validInput = {
  host_repo: "owner/repo",
  tasks_md_path: "TASKS.md",
  commit_format: "<TYPE>: <DESCRIPTION>",
  pre_commit_command: "npm run lint",
  branch_prefix: "feat/",
  default_branch: "main",
  ticket_format: null,
  lint_substrate_overrides: {},
  host_packages_path: "src/",
  ignore_mechanism: "global-ignore",
};

describe("parseRepoConfig — happy path", () => {
  test("a complete valid input parses ok", () => {
    const result = parseRepoConfig(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.host_repo).toBe("owner/repo");
    expect(result.config.ignore_mechanism).toBe("global-ignore");
  });

  test("ticket_format may be a string", () => {
    const result = parseRepoConfig({ ...validInput, ticket_format: "AIFN-\\d+" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.ticket_format).toBe("AIFN-\\d+");
  });

  test("missing optional ticket_format defaults to null", () => {
    const { ticket_format: _, ...withoutTicket } = validInput;
    const result = parseRepoConfig(withoutTicket);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.ticket_format).toBeNull();
  });

  test("missing optional lint_substrate_overrides defaults to {}", () => {
    const { lint_substrate_overrides: _, ...withoutOverrides } = validInput;
    const result = parseRepoConfig(withoutOverrides);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.lint_substrate_overrides).toEqual({});
  });

  test("missing optional ignore_mechanism defaults to global-ignore", () => {
    const { ignore_mechanism: _, ...withoutIgnore } = validInput;
    const result = parseRepoConfig(withoutIgnore);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.ignore_mechanism).toBe("global-ignore");
  });

  test("empty pre_commit_command is allowed", () => {
    const result = parseRepoConfig({ ...validInput, pre_commit_command: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.pre_commit_command).toBe("");
  });
});

describe("parseRepoConfig — validation failures", () => {
  test("non-object input is rejected", () => {
    const r1 = parseRepoConfig("not an object");
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.errors[0]?.field).toBe("_root");

    const r2 = parseRepoConfig(null);
    expect(r2.ok).toBe(false);

    const r3 = parseRepoConfig([1, 2, 3]);
    expect(r3.ok).toBe(false);
  });

  test("missing host_repo is reported", () => {
    const { host_repo: _, ...withoutHostRepo } = validInput;
    const result = parseRepoConfig(withoutHostRepo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "host_repo")).toBe(true);
  });

  test("empty string host_repo is reported", () => {
    const result = parseRepoConfig({ ...validInput, host_repo: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "host_repo")).toBe(true);
  });

  test("non-string ticket_format (other than null) is reported", () => {
    const result = parseRepoConfig({ ...validInput, ticket_format: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "ticket_format")).toBe(true);
  });

  test("non-string lint_substrate_overrides value is reported", () => {
    const result = parseRepoConfig({
      ...validInput,
      lint_substrate_overrides: { "rule-6-let-it-crash": 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.field === "lint_substrate_overrides.rule-6-let-it-crash"),
    ).toBe(true);
  });

  test("invalid ignore_mechanism enum is reported", () => {
    const result = parseRepoConfig({ ...validInput, ignore_mechanism: "magic-mode" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "ignore_mechanism")).toBe(true);
  });
});
