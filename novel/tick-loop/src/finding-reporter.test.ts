import { describe, expect, it } from "vitest";

import {
  anonymizeFinding,
  containsPii,
  type RawFinding,
  REDACTION_RULES,
  REDACTION_TOKEN,
  redact,
  renderIssueBody,
  renderPreview,
} from "./finding-reporter.js";

const baseRaw: RawFinding = {
  type: "bug",
  title: "spawn-failed in cross-repo-runner",
  reproSteps: ["run minsky --once", "observe the spawn error"],
  minskyVersion: "0.1.0",
  os: "darwin",
  agent: "claude",
};

describe("redact", () => {
  it("returns clean text unchanged", () => {
    const clean = "the spawn watchdog killed the iteration after 20 minutes";
    expect(redact(clean)).toBe(clean);
  });

  it("redacts an Anthropic/OpenAI key", () => {
    const out = redact("key is sk-abcdefabcdefabcdefabcdef1234 here");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("redacts a GitHub PAT", () => {
    const out = redact("token ghp_0123456789abcdef0123456789abcdef end");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("ghp_");
  });

  it("redacts a GitHub fine-grained PAT", () => {
    const out = redact("github_pat_11ABCDE0123456789abcdefABCDEF token");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("github_pat_");
  });

  it("redacts a Slack token", () => {
    const out = redact("xoxb-1234567890-abcdefghijkl was leaked");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("xoxb-");
  });

  it("redacts an AWS access key id", () => {
    const out = redact("AKIAIOSFODNN7EXAMPLE in the env");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("AKIA");
  });

  it("redacts a macOS user-home path", () => {
    const out = redact("error at /Users/alice/apps/minsky/src/x.ts:10");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("/Users/alice");
  });

  it("redacts a Linux user-home path", () => {
    const out = redact("error at /home/bob/work/minsky/y.ts");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("/home/bob");
  });

  it("redacts an email address", () => {
    const out = redact("contact dev@example.com for details");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("dev@example.com");
  });

  it("redacts a bare IPv4 address", () => {
    const out = redact("connection refused from 192.168.1.42 host");
    expect(out).toContain(REDACTION_TOKEN);
    expect(out).not.toContain("192.168.1.42");
  });

  it("redacts every occurrence (global flag), not just the first", () => {
    const out = redact("first sk-aaaaaaaaaaaaaaaaaaaaaa then sk-bbbbbbbbbbbbbbbbbbbbbb");
    expect(out).not.toMatch(/sk-[A-Za-z0-9]/);
    const tokenCount = out.split(REDACTION_TOKEN).length - 1;
    expect(tokenCount).toBe(2);
  });

  it("is stateless across calls (no leaked regex lastIndex)", () => {
    const input = "leaked sk-abcdefabcdefabcdefabcdef1234";
    const first = redact(input);
    const second = redact(input);
    expect(first).toBe(second);
  });

  it("every redaction rule uses the global flag", () => {
    for (const [name, pattern] of REDACTION_RULES) {
      expect(pattern.flags, `rule ${name} must be global`).toContain("g");
    }
  });
});

describe("anonymizeFinding", () => {
  it("passes structured metadata through unchanged", () => {
    const a = anonymizeFinding(baseRaw);
    expect(a.type).toBe("bug");
    expect(a.minskyVersion).toBe("0.1.0");
    expect(a.os).toBe("darwin");
    expect(a.agent).toBe("claude");
  });

  it("redacts the title and every repro step", () => {
    const a = anonymizeFinding({
      ...baseRaw,
      title: "crash at /Users/carol/x.ts",
      reproSteps: ["set token sk-aaaaaaaaaaaaaaaaaaaaaa", "rerun minsky"],
    });
    expect(a.title).not.toContain("/Users/carol");
    expect(a.reproSteps[0]).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(a.reproSteps[1]).toBe("rerun minsky");
  });

  it("preserves repro-step ordering and count", () => {
    const a = anonymizeFinding({ ...baseRaw, reproSteps: ["a", "b", "c"] });
    expect(a.reproSteps).toEqual(["a", "b", "c"]);
  });

  it("handles an empty repro-step list", () => {
    const a = anonymizeFinding({ ...baseRaw, reproSteps: [] });
    expect(a.reproSteps).toEqual([]);
  });
});

describe("containsPii", () => {
  it("returns false for a fully-anonymized finding", () => {
    expect(containsPii(anonymizeFinding(baseRaw))).toBe(false);
  });

  it("returns true when a free-text field still carries a secret", () => {
    // Hand-build an AnonymizedFinding that bypassed redaction (defense-in-depth).
    const leaky = {
      type: "bug" as const,
      title: "key sk-abcdefabcdefabcdefabcdef1234 leaked",
      reproSteps: ["clean step"],
      minskyVersion: "0.1.0",
      os: "darwin",
      agent: "claude",
    };
    expect(containsPii(leaky)).toBe(true);
  });

  it("scans repro steps as well as the title", () => {
    const leaky = {
      type: "crash" as const,
      title: "clean title",
      reproSteps: ["happened at /Users/dave/x.ts"],
      minskyVersion: "0.1.0",
      os: "linux",
      agent: "devin",
    };
    expect(containsPii(leaky)).toBe(true);
  });
});

describe("renderPreview", () => {
  it("includes every metadata field and the no-other-data assurance", () => {
    const out = renderPreview(anonymizeFinding(baseRaw));
    expect(out).toContain("type:    bug");
    expect(out).toContain("version: 0.1.0");
    expect(out).toContain("os:      darwin");
    expect(out).toContain("agent:   claude");
    expect(out).toContain("Nothing else is sent.");
  });

  it("shows (none provided) when there are no repro steps", () => {
    const out = renderPreview(anonymizeFinding({ ...baseRaw, reproSteps: [] }));
    expect(out).toContain("(none provided)");
  });

  it("numbers the repro steps", () => {
    const out = renderPreview(anonymizeFinding({ ...baseRaw, reproSteps: ["first", "second"] }));
    expect(out).toContain("1. first");
    expect(out).toContain("2. second");
  });
});

describe("renderIssueBody", () => {
  it("renders markdown with type, env, and the anonymization footer", () => {
    const out = renderIssueBody(anonymizeFinding(baseRaw));
    expect(out).toContain("**Finding type:** bug");
    expect(out).toContain("- minsky version: 0.1.0");
    expect(out).toContain("- OS: darwin");
    expect(out).toContain("- agent: claude");
    expect(out).toContain("Anonymized");
  });

  it("renders (none provided) for an empty repro list", () => {
    const out = renderIssueBody(anonymizeFinding({ ...baseRaw, reproSteps: [] }));
    expect(out).toContain("- (none provided)");
  });
});
