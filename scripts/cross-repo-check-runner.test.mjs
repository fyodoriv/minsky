// Tests for cross-repo-check-runner.mjs. Pattern: paired positive/negative
// fixtures (Meszaros 2007) over the four failure-mode rows in TASKS.md
// `cross-repo-ci-action` plus the happy path. The gh CLI is mocked via the
// `--gh-bin` test stub at scripts/fixtures/cross-repo-check-runner-gh-stub.mjs;
// no GitHub auth or network access is required.
//
// Coverage:
//   1. happy path (success)         — valid PR body + valid EXPERIMENT.yaml
//   2. force-pushed mid-run         — neutral with head-SHA mismatch
//   3. EXPERIMENT.yaml unreadable   — neutral (lints over experiment skip)
//   4. PR body lacks self-grade     — failure (rule-#9 gate trips)
//   5. anchor is a Medium URL       — failure (deny-list trips)
//   6. parseCliArgs validation      — pure-function unit cases
//   7. decodeContentsResponse       — pure-function unit cases
//   8. synthesiseVerdict            — pure-function unit cases

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  decodeContentsResponse,
  parseCliArgs,
  synthesiseVerdict,
} from "./cross-repo-check-runner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, "cross-repo-check-runner.mjs");
const STUB = resolve(HERE, "fixtures/cross-repo-check-runner-gh-stub.mjs");

/** @param {string} stubMode */
function runRunner(stubMode) {
  const workDir = mkdtempSync(join(tmpdir(), "cross-repo-check-test-"));
  const res = spawnSync(
    process.execPath,
    [
      RUNNER,
      "--host-repo",
      "owner/host",
      "--pr-number",
      "1",
      "--experiment-yaml-url",
      "https://api.github.com/repos/owner/host/contents/.minsky/experiments/foo.yaml?ref=abc",
      "--gh-bin",
      STUB,
      "--work-dir",
      workDir,
      "--json-only",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, MINSKY_GH_STUB_MODE: stubMode },
    },
  );
  return {
    exitCode: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    verdict: tryParseJson(res.stdout ?? ""),
  };
}

/** @param {string} s */
function tryParseJson(s) {
  try {
    return JSON.parse(s.trim());
  } catch {
    return null;
  }
}

describe("cross-repo-check-runner end-to-end (gh stub)", () => {
  test("happy path → conclusion=success, head_sha set, four lint rows present", () => {
    const r = runRunner("happy");
    expect(r.exitCode).toBe(0);
    expect(r.verdict).not.toBeNull();
    if (r.verdict.conclusion !== "success") {
      console.error(
        "happy-path diagnostic — checks:",
        JSON.stringify(r.verdict.checks, null, 2),
        "\nstderr:\n",
        r.stderr,
      );
    }
    expect(r.verdict.conclusion).toBe("success");
    expect(r.verdict.head_sha).toBe("AAA");
    const ids = r.verdict.checks.map(
      /** @param {{id: string}} c */
      (c) => c.id,
    );
    expect(ids).toContain("anchor-primary-source");
    expect(ids).toContain("measurement-inspects-output");
    expect(ids).toContain("pivot-success-margin");
    expect(ids).toContain("pr-self-grade");
  });

  test("PR body missing self-grade → conclusion=failure, pr-self-grade row is fail", () => {
    const r = runRunner("missing-self-grade");
    expect(r.exitCode).toBe(0);
    expect(r.verdict.conclusion).toBe("failure");
    const psg = r.verdict.checks.find(
      /** @param {{id: string}} c */
      (c) => c.id === "pr-self-grade",
    );
    expect(psg).toBeDefined();
    expect(psg.result).toBe("fail");
  });

  test("anchor is a Medium URL → conclusion=failure, anchor row is fail", () => {
    const r = runRunner("bad-anchor");
    expect(r.exitCode).toBe(0);
    expect(r.verdict.conclusion).toBe("failure");
    const aps = r.verdict.checks.find(
      /** @param {{id: string}} c */
      (c) => c.id === "anchor-primary-source",
    );
    expect(aps.result).toBe("fail");
  });

  test("EXPERIMENT.yaml unreadable → experiment-rooted lints skip; pr-self-grade still passes", () => {
    const r = runRunner("experiment-unreadable");
    expect(r.exitCode).toBe(0);
    // Three experiment-rooted lints all skip; pr-self-grade still runs.
    const skipped = r.verdict.checks.filter(
      /** @param {{id: string, result: string}} c */
      (c) =>
        ["anchor-primary-source", "measurement-inspects-output", "pivot-success-margin"].includes(
          c.id,
        ) && c.result === "skip",
    );
    expect(skipped.length).toBe(3);
    const psg = r.verdict.checks.find(
      /** @param {{id: string}} c */
      (c) => c.id === "pr-self-grade",
    );
    expect(psg.result).toBe("pass");
    // Conclusion is success (1 pass, 0 fail, rest skipped).
    expect(r.verdict.conclusion).toBe("success");
  });

  test("force-pushed mid-run → conclusion=neutral, head SHA mismatch surfaced", () => {
    const r = runRunner("force-pushed");
    expect(r.exitCode).toBe(0);
    expect(r.verdict.conclusion).toBe("neutral");
    expect(r.verdict.summary).toMatch(/head SHA mismatch/i);
  });
});

describe("parseCliArgs", () => {
  test("missing required flag → throws", () => {
    expect(() => parseCliArgs([])).toThrow(/host-repo/);
  });
  test("--self-test sets selfTest=true and supplies defaults", () => {
    const inputs = parseCliArgs(["--self-test"]);
    expect(inputs.selfTest).toBe(true);
    expect(inputs.hostRepo).toBe("owner/host");
  });
  test("flags + --json-only round-trip", () => {
    const inputs = parseCliArgs([
      "--host-repo",
      "x/y",
      "--pr-number",
      "7",
      "--experiment-yaml-url",
      "https://example.com/foo.yaml",
      "--json-only",
    ]);
    expect(inputs.hostRepo).toBe("x/y");
    expect(inputs.prNumber).toBe(7);
    expect(inputs.jsonOnly).toBe(true);
  });
});

describe("decodeContentsResponse", () => {
  test("base64 contents envelope decodes to YAML", () => {
    const yaml = "id: foo\nhypothesis: bar\n";
    const envelope = JSON.stringify({
      content: Buffer.from(yaml, "utf8").toString("base64"),
      encoding: "base64",
    });
    expect(decodeContentsResponse(envelope)).toBe(yaml);
  });
  test("404-shaped JSON envelope returns null (unreadable)", () => {
    expect(decodeContentsResponse(JSON.stringify({ message: "Not Found" }))).toBeNull();
  });
  test("raw YAML body passes through unchanged", () => {
    const yaml = "id: foo\nhypothesis: bar\n";
    expect(decodeContentsResponse(yaml)).toBe(yaml);
  });
});

describe("synthesiseVerdict", () => {
  const fetched = {
    prBodyPath: "/tmp/x/pr-body.md",
    experimentYamlPath: "/tmp/x/experiment.yaml",
    diffPath: "/tmp/x/pr.diff",
    headSha: "SHA1",
    experimentYamlReadable: true,
  };

  test("any fail row → failure", () => {
    const v = synthesiseVerdict({
      fetched,
      rows: [
        { id: "a", result: "pass", reason: "ok" },
        { id: "b", result: "fail", reason: "bad" },
      ],
      postRunHeadSha: "SHA1",
    });
    expect(v.conclusion).toBe("failure");
  });

  test("all pass / skip → success when ≥1 pass", () => {
    const v = synthesiseVerdict({
      fetched,
      rows: [
        { id: "a", result: "pass", reason: "ok" },
        { id: "b", result: "skip", reason: "scope" },
      ],
      postRunHeadSha: "SHA1",
    });
    expect(v.conclusion).toBe("success");
  });

  test("all skip → neutral", () => {
    const v = synthesiseVerdict({
      fetched,
      rows: [{ id: "a", result: "skip", reason: "scope" }],
      postRunHeadSha: "SHA1",
    });
    expect(v.conclusion).toBe("neutral");
  });

  test("head SHA mismatch wins over lint results → neutral", () => {
    const v = synthesiseVerdict({
      fetched,
      rows: [{ id: "a", result: "pass", reason: "ok" }],
      postRunHeadSha: "SHA2",
    });
    expect(v.conclusion).toBe("neutral");
    expect(v.summary).toMatch(/head SHA mismatch/i);
  });
});
