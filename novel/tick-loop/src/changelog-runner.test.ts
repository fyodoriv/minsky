// Paired positive/negative tests for changelog-runner (Meszaros 2007),
// rule #10 — same input, same output. Mirrors `post-task-cto-audit.test.ts`
// shape so the audit + changelog seams stay reviewable side-by-side.

import { describe, expect, it } from "vitest";

import {
  type ChangelogSpawn,
  buildChangelogBrief,
  runChangelog,
  shouldFireChangelog,
} from "./changelog-runner.js";

const DATE = "2026-05-06";
const PRIOR_DAY_HEADING = "## 2026-05-05";

describe("shouldFireChangelog", () => {
  it("fires when the date heading is absent from the file", () => {
    expect(
      shouldFireChangelog({
        date: DATE,
        changelogContent: `# Changelog\n\n${PRIOR_DAY_HEADING}\n\nyesterday's stuff\n`,
        env: {},
      }),
    ).toBe(true);
  });

  it("does NOT fire when the date heading is already present (idempotent)", () => {
    expect(
      shouldFireChangelog({
        date: DATE,
        changelogContent: `# Changelog\n\n## ${DATE}\n\ntoday's stuff\n`,
        env: {},
      }),
    ).toBe(false);
  });

  it("fires on an empty file (fresh checkout)", () => {
    expect(shouldFireChangelog({ date: DATE, changelogContent: "", env: {} })).toBe(true);
  });

  it("does NOT confuse a date in narrative prose with the heading", () => {
    // The date appears, but only inside a paragraph — the gate scans for
    // `## ${date}` specifically so this still fires.
    const prose = `# Changelog\n\n${PRIOR_DAY_HEADING}\n\nthe ${DATE} stall ended at noon\n`;
    expect(shouldFireChangelog({ date: DATE, changelogContent: prose, env: {} })).toBe(true);
  });

  it("respects MINSKY_CHANGELOG=off env override", () => {
    expect(
      shouldFireChangelog({
        date: DATE,
        changelogContent: "",
        env: { MINSKY_CHANGELOG: "off" },
      }),
    ).toBe(false);
  });

  it("ignores MINSKY_CHANGELOG values other than 'off'", () => {
    expect(
      shouldFireChangelog({
        date: DATE,
        changelogContent: "",
        env: { MINSKY_CHANGELOG: "on" },
      }),
    ).toBe(true);
    expect(
      shouldFireChangelog({ date: DATE, changelogContent: "", env: { MINSKY_CHANGELOG: "" } }),
    ).toBe(true);
  });
});

describe("buildChangelogBrief", () => {
  it("includes the target date in the heading", () => {
    const brief = buildChangelogBrief({ date: DATE });
    expect(brief).toContain(`# Changelog-mode brief for ${DATE}`);
  });

  it("references the pure-renderer script path so drift surfaces in tests", () => {
    const brief = buildChangelogBrief({ date: DATE });
    expect(brief).toContain("scripts/generate-changelog-entry.mjs");
  });

  it("references the metric-snapshot path so the spawn knows where to read/write", () => {
    const brief = buildChangelogBrief({ date: DATE });
    expect(brief).toContain(`.minsky/metric-snapshots/${DATE}.json`);
  });

  it("forbids modifying an existing same-day section", () => {
    const brief = buildChangelogBrief({ date: DATE });
    expect(brief).toContain(`Do NOT modify the \`## ${DATE}\` section`);
    expect(brief).toContain("noop, exiting");
  });

  it("threads the gh search filter for today's merged PRs", () => {
    const brief = buildChangelogBrief({ date: DATE });
    expect(brief).toContain(`merged:${DATE}`);
  });
});

describe("runChangelog", () => {
  function makeSpawn(): {
    spawn: ChangelogSpawn;
    calls: Array<{ taskId: string; brief: string }>;
  } {
    const calls: Array<{ taskId: string; brief: string }> = [];
    const spawn: ChangelogSpawn = {
      spawn: async (input) => {
        calls.push({ taskId: input.taskId, brief: input.brief });
        return { exitCode: 0, durationMs: 5, stdoutTail: "wrote section", stderrTail: "" };
      },
    };
    return { spawn, calls };
  }

  it("skips with env-disabled when MINSKY_CHANGELOG=off (no read, no spawn)", async () => {
    const { spawn, calls } = makeSpawn();
    let readCount = 0;
    const result = await runChangelog({
      date: DATE,
      readChangelog: () => {
        readCount++;
        return "";
      },
      env: { MINSKY_CHANGELOG: "off" },
      spawn,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-disabled" });
    expect(calls).toHaveLength(0);
    expect(readCount).toBe(0);
  });

  it("skips with already-fired when the date heading is present", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: DATE,
      readChangelog: () => `# Changelog\n\n## ${DATE}\n\nalready written\n`,
      env: {},
      spawn,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "already-fired" });
    expect(calls).toHaveLength(0);
  });

  it("fires the spawn with the changelog-mode brief on the happy path", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: DATE,
      readChangelog: () => `# Changelog\n\n${PRIOR_DAY_HEADING}\n\nyesterday\n`,
      env: {},
      spawn,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.taskId).toBe(`changelog:${DATE}`);
    expect(calls[0]?.brief).toContain(`# Changelog-mode brief for ${DATE}`);
    expect(calls[0]?.brief).toContain("scripts/generate-changelog-entry.mjs");
  });

  it("returns the spawn result fields when the spawn ran", async () => {
    const spawn: ChangelogSpawn = {
      spawn: async () => ({
        exitCode: 3,
        durationMs: 1234,
        stdoutTail: "out",
        stderrTail: "err",
      }),
    };
    const result = await runChangelog({
      date: DATE,
      readChangelog: () => "",
      env: {},
      spawn,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 3,
      durationMs: 1234,
      stdoutTail: "out",
      stderrTail: "err",
    });
  });

  it("treats ENOENT on readChangelog as an empty file and fires", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: DATE,
      readChangelog: () => {
        const err = new Error("ENOENT: no such file or directory") as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      },
      env: {},
      spawn,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
  });

  it("propagates non-ENOENT read errors (let-it-crash)", async () => {
    const { spawn } = makeSpawn();
    await expect(
      runChangelog({
        date: DATE,
        readChangelog: () => {
          throw new Error("EACCES");
        },
        env: {},
        spawn,
      }),
    ).rejects.toThrow("EACCES");
  });

  it("env-disabled takes precedence over already-fired", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: DATE,
      readChangelog: () => `## ${DATE}\n`,
      env: { MINSKY_CHANGELOG: "off" },
      spawn,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-disabled" });
    expect(calls).toHaveLength(0);
  });

  it("threads the env into the spawn so child claude --print sees it", async () => {
    const seen: Readonly<Record<string, string | undefined>>[] = [];
    const spawn: ChangelogSpawn = {
      spawn: async (input) => {
        seen.push(input.env);
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runChangelog({
      date: DATE,
      readChangelog: () => "",
      env: { ANTHROPIC_API_KEY: "sk-test", PATH: "/usr/bin" },
      spawn,
    });
    expect(seen[0]?.["ANTHROPIC_API_KEY"]).toBe("sk-test");
    expect(seen[0]?.["PATH"]).toBe("/usr/bin");
  });
});
