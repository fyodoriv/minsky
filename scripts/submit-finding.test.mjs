// Tests for scripts/submit-finding.mjs — the remote-task-submission CLI's
// pure core (parseArgs, buildRawFinding, buildGhIssueArgs, promptApproval) and
// its privacy invariant (anonymize → containsPii fail-closed). I/O (gh issue
// create) is exercised via the pure arg builder, not by spawning gh.

import { PassThrough } from "node:stream";
import { anonymizeFinding, containsPii } from "@minsky/tick-loop";
import { describe, expect, it } from "vitest";

import {
  buildGhIssueArgs,
  buildRawFinding,
  FINDING_REPO,
  FINDING_TYPES,
  parseArgs,
  promptApproval,
} from "./submit-finding.mjs";

const env = { minskyVersion: "0.1.0", os: "darwin", agent: "claude" };

describe("parseArgs", () => {
  it("defaults to preview mode and bug type", () => {
    const a = parseArgs(["--title", "x"]);
    expect(a.mode).toBe("preview");
    expect(a.type).toBe("bug");
    expect(a.error).toBeNull();
  });

  it("parses --submit and --type", () => {
    const a = parseArgs(["--submit", "--type", "crash", "--title", "boom"]);
    expect(a.mode).toBe("submit");
    expect(a.type).toBe("crash");
  });

  it("accepts --key=value form", () => {
    const a = parseArgs(["--type=flaky-test", "--title=flake"]);
    expect(a.type).toBe("flaky-test");
    expect(a.title).toBe("flake");
  });

  it("collects repeated --repro steps in order", () => {
    const a = parseArgs(["--title", "x", "--repro", "step1", "--repro", "step2"]);
    expect(a.reproSteps).toEqual(["step1", "step2"]);
  });

  it("errors when --title is missing", () => {
    const a = parseArgs(["--submit"]);
    expect(a.error).toMatch(/--title/);
  });

  it("errors on an invalid --type", () => {
    const a = parseArgs(["--title", "x", "--type", "nonsense"]);
    expect(a.error).toMatch(/--type must be one of/);
  });

  it("flags unknown arguments", () => {
    const a = parseArgs(["--title", "x", "--bogus"]);
    expect(a.error).toMatch(/unknown argument/);
  });

  it("sets help without requiring a title", () => {
    const a = parseArgs(["--help"]);
    expect(a.help).toBe(true);
    expect(a.error).toBeNull();
  });

  it("exposes the full FindingType vocabulary", () => {
    expect(FINDING_TYPES).toContain("bug");
    expect(FINDING_TYPES).toContain("flaky-test");
    expect(FINDING_TYPES.length).toBe(5);
  });
});

describe("buildRawFinding", () => {
  it("merges parsed args with injected env facts", () => {
    const a = parseArgs(["--title", "spawn failed", "--repro", "run minsky"]);
    const raw = buildRawFinding(a, env);
    expect(raw.title).toBe("spawn failed");
    expect(raw.reproSteps).toEqual(["run minsky"]);
    expect(raw.minskyVersion).toBe("0.1.0");
    expect(raw.os).toBe("darwin");
    expect(raw.agent).toBe("claude");
  });
});

describe("buildGhIssueArgs", () => {
  it("targets the canonical repo with a typed title and labeled body", () => {
    const finding = anonymizeFinding(buildRawFinding(parseArgs(["--title", "boom"]), env));
    const ghArgs = buildGhIssueArgs(finding);
    expect(ghArgs).toContain("issue");
    expect(ghArgs).toContain("create");
    const repoIdx = ghArgs.indexOf("--repo");
    expect(ghArgs[repoIdx + 1]).toBe(FINDING_REPO);
    const titleIdx = ghArgs.indexOf("--title");
    expect(ghArgs[titleIdx + 1]).toBe("[finding:bug] boom");
    expect(ghArgs).toContain("submitted-finding");
  });
});

describe("privacy invariant (anonymize → containsPii)", () => {
  it("a finding built from secret-bearing input is clean after anonymize", () => {
    const a = parseArgs([
      "--title",
      "key sk-abcdefabcdefabcdefabcdef1234",
      "--repro",
      "at /Users/eve/x.ts",
    ]);
    const finding = anonymizeFinding(buildRawFinding(a, env));
    expect(containsPii(finding)).toBe(false);
    expect(finding.title).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(finding.reproSteps[0]).not.toContain("/Users/eve");
  });
});

describe("promptApproval", () => {
  /**
   * @param {string} answer
   * @returns {Promise<boolean>}
   */
  function run(answer) {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = promptApproval(input, output);
    input.write(`${answer}\n`);
    return p;
  }

  it("approves on an explicit yes", async () => {
    expect(await run("y")).toBe(true);
    expect(await run("yes")).toBe(true);
    expect(await run("Y")).toBe(true);
  });

  it("declines on anything else (opt-in default)", async () => {
    expect(await run("")).toBe(false);
    expect(await run("n")).toBe(false);
    expect(await run("maybe")).toBe(false);
  });
});
