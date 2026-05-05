import { describe, expect, it } from "vitest";

import {
  CHANGELOG_PROMPT_HEADER,
  type ChangelogSpawn,
  hasDateSection,
  runChangelog,
  shouldRunChangelog,
} from "./changelog-runner.js";

describe("hasDateSection", () => {
  it("returns true when an H2 section header for the date exists", () => {
    const content = "# Header\n\n## 2026-05-05\n\n### What shipped\n";
    expect(hasDateSection(content, "2026-05-05")).toBe(true);
  });

  it("returns false when the date is absent", () => {
    const content = "# Header\n\n## 2026-05-04\n\n### What shipped\n";
    expect(hasDateSection(content, "2026-05-05")).toBe(false);
  });

  it("does not match the date inside body prose (must be H2)", () => {
    const content = "# Header\n\nMentioned 2026-05-05 in passing but no section.\n";
    expect(hasDateSection(content, "2026-05-05")).toBe(false);
  });

  it("does not match a different heading level (### not ##)", () => {
    const content = "# Header\n\n### 2026-05-05\n";
    expect(hasDateSection(content, "2026-05-05")).toBe(false);
  });

  it("matches the second of multiple H2 dates", () => {
    const content = "## 2026-05-04\n\nstuff\n\n## 2026-05-05\n\nmore stuff\n";
    expect(hasDateSection(content, "2026-05-05")).toBe(true);
  });

  it("returns false for an empty CHANGELOG (fresh checkout)", () => {
    expect(hasDateSection("", "2026-05-05")).toBe(false);
  });

  it("does not partial-match a date prefix", () => {
    const content = "## 2026-05-051\n";
    expect(hasDateSection(content, "2026-05-05")).toBe(false);
  });
});

describe("shouldRunChangelog", () => {
  const baseArgs = {
    date: "2026-05-05",
    changelogContent: "# Empty\n",
    env: {},
  };

  it("runs when the date is absent and env is unset", () => {
    expect(shouldRunChangelog(baseArgs)).toBe(true);
  });

  it("skips when MINSKY_CHANGELOG=off", () => {
    expect(shouldRunChangelog({ ...baseArgs, env: { MINSKY_CHANGELOG: "off" } })).toBe(false);
  });

  it("ignores MINSKY_CHANGELOG values other than 'off'", () => {
    expect(shouldRunChangelog({ ...baseArgs, env: { MINSKY_CHANGELOG: "on" } })).toBe(true);
    expect(shouldRunChangelog({ ...baseArgs, env: { MINSKY_CHANGELOG: "" } })).toBe(true);
  });

  it("skips when the date already has an H2 section", () => {
    expect(
      shouldRunChangelog({ ...baseArgs, changelogContent: "# CL\n\n## 2026-05-05\n\nshipped\n" }),
    ).toBe(false);
  });

  it("env-off takes precedence over the date-section check (no read needed)", () => {
    expect(
      shouldRunChangelog({
        date: "2026-05-05",
        changelogContent: "## 2026-05-05\n",
        env: { MINSKY_CHANGELOG: "off" },
      }),
    ).toBe(false);
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
        return { exitCode: 0, durationMs: 5, stdoutTail: "ok", stderrTail: "" };
      },
    };
    return { spawn, calls };
  }

  it("skips when MINSKY_CHANGELOG=off without reading the file", async () => {
    const { spawn, calls } = makeSpawn();
    let readCount = 0;
    const result = await runChangelog({
      date: "2026-05-05",
      env: { MINSKY_CHANGELOG: "off" },
      readChangelog: async () => {
        readCount += 1;
        return "";
      },
      spawn,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "env-off" });
    expect(calls).toHaveLength(0);
    expect(readCount).toBe(0);
  });

  it("skips when the date is already authored in CHANGELOG.md", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: "2026-05-05",
      env: {},
      readChangelog: async () => "# CL\n\n## 2026-05-05\n\nshipped\n",
      spawn,
    });
    expect(result).toEqual({ outcome: "skipped", reason: "already-authored" });
    expect(calls).toHaveLength(0);
  });

  it("spawns with the changelog brief on the happy path", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: "2026-05-05",
      env: {},
      readChangelog: async () => "# CL\n\n## 2026-05-04\n\nold\n",
      spawn,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.taskId).toBe("changelog:2026-05-05");
    expect(calls[0]?.brief.startsWith(CHANGELOG_PROMPT_HEADER)).toBe(true);
    expect(calls[0]?.brief).toContain("2026-05-05");
  });

  it("returns the spawn result fields when the runner ran", async () => {
    const spawn: ChangelogSpawn = {
      spawn: async () => ({
        exitCode: 9,
        durationMs: 4242,
        stdoutTail: "stdout-tail",
        stderrTail: "stderr-tail",
      }),
    };
    const result = await runChangelog({
      date: "2026-05-05",
      env: {},
      readChangelog: async () => "",
      spawn,
    });
    expect(result).toEqual({
      outcome: "ran",
      exitCode: 9,
      durationMs: 4242,
      stdoutTail: "stdout-tail",
      stderrTail: "stderr-tail",
    });
  });

  it("treats a missing/empty CHANGELOG.md as 'date absent' (fires)", async () => {
    const { spawn, calls } = makeSpawn();
    const result = await runChangelog({
      date: "2026-05-05",
      env: {},
      readChangelog: async () => "",
      spawn,
    });
    expect(result.outcome).toBe("ran");
    expect(calls).toHaveLength(1);
  });

  it("propagates env into the spawn invocation", async () => {
    const calls: Record<string, string | undefined>[] = [];
    const spawn: ChangelogSpawn = {
      spawn: async (input) => {
        calls.push(input.env);
        return { exitCode: 0, durationMs: 0, stdoutTail: "", stderrTail: "" };
      },
    };
    await runChangelog({
      date: "2026-05-05",
      env: { FOO: "bar" },
      readChangelog: async () => "",
      spawn,
    });
    expect(calls[0]).toEqual({ FOO: "bar" });
  });

  it("is idempotent — second run on the same date after first authored is a skip", async () => {
    const { spawn, calls } = makeSpawn();
    let stored = "# CL\n";
    const readChangelog = async (): Promise<string> => stored;
    const first = await runChangelog({
      date: "2026-05-05",
      env: {},
      readChangelog,
      spawn,
    });
    expect(first.outcome).toBe("ran");

    // Simulate the spawned run authoring today's section.
    stored = `${stored}\n## 2026-05-05\n\nshipped\n`;

    const second = await runChangelog({
      date: "2026-05-05",
      env: {},
      readChangelog,
      spawn,
    });
    expect(second).toEqual({ outcome: "skipped", reason: "already-authored" });
    expect(calls).toHaveLength(1);
  });
});

describe("CHANGELOG_PROMPT_HEADER", () => {
  it("references the operator CLI by name (canonical pipeline)", () => {
    expect(CHANGELOG_PROMPT_HEADER).toContain("pnpm changelog:today");
  });

  it("references the renderer script for narrative-override path", () => {
    expect(CHANGELOG_PROMPT_HEADER).toContain("scripts/generate-changelog-entry.mjs");
  });

  it("instructs the model to refuse vanity metrics", () => {
    expect(CHANGELOG_PROMPT_HEADER).toContain("vanity-metric");
  });

  it("specifies the noop-exit shape (matching the daemon brief contract)", () => {
    expect(CHANGELOG_PROMPT_HEADER).toContain("noop, exiting");
  });

  it("does not duplicate the gh-fetch step inline (collapsed into pnpm changelog:today)", () => {
    expect(CHANGELOG_PROMPT_HEADER).not.toContain('gh pr list --state merged --search "merged:>=');
  });
});
