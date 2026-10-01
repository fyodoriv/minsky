// End-to-end integration test for the remote-task-submission privacy contract
// (`@minsky/tick-loop` finding-reporter + scripts/submit-finding.mjs).
//
// Why this file exists (AGENTS.md §3b — integration tests; rule #3 test-first;
// TASKS.md `minsky-remote-task-submission` Success criterion: "data contains
// zero PII/code/secrets"): the co-located unit tests pin each redaction rule
// in isolation, but the constitutional guarantee is end-to-end — a finding
// scraped from a real failing iteration (with a key, a user-home path, and an
// email all in one payload) must emerge anonymized, pass the containsPii
// fail-closed re-scan, and render a preview/issue-body free of every secret
// span. This test drives the full public surface as the CLI does.

import {
  anonymizeFinding,
  containsPii,
  type RawFinding,
  renderIssueBody,
  renderPreview,
} from "@minsky/tick-loop";
import { describe, expect, it } from "vitest";

describe("finding-reporter end-to-end anonymization", () => {
  const dirty: RawFinding = {
    type: "crash",
    title:
      "crash at /Users/operator/apps/minsky/src/x.ts using key sk-abcdefabcdefabcdefabcdef1234",
    reproSteps: [
      "set GH token ghp_0123456789abcdef0123456789abcdef",
      "email the maintainer at ops@example.com",
      "from host 10.0.0.5 run minsky --once",
    ],
    minskyVersion: "0.1.0",
    os: "linux",
    agent: "devin",
  };

  it("emerges with zero secret/PII spans across every surface", () => {
    const anon = anonymizeFinding(dirty);

    // The defense-in-depth gate the CLI runs before egress.
    expect(containsPii(anon)).toBe(false);

    const surfaces = [
      anon.title,
      ...anon.reproSteps,
      renderPreview(anon),
      renderIssueBody(anon),
    ].join("\n");

    expect(surfaces).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(surfaces).not.toContain("ghp_");
    expect(surfaces).not.toContain("/Users/operator");
    expect(surfaces).not.toContain("ops@example.com");
    expect(surfaces).not.toContain("10.0.0.5");
  });

  it("preserves the structured metadata that carries no PII", () => {
    const anon = anonymizeFinding(dirty);
    expect(anon.type).toBe("crash");
    expect(anon.minskyVersion).toBe("0.1.0");
    expect(anon.os).toBe("linux");
    expect(anon.agent).toBe("devin");
    // The renderers still surface the metadata even after redaction.
    const body = renderIssueBody(anon);
    expect(body).toContain("**Finding type:** crash");
    expect(body).toContain("- agent: devin");
  });
});
