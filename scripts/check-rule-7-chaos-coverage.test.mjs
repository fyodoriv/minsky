import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkChaosCoverage,
  parseClosesIdsFromGitLog,
  parseFirstTable,
  parseTaskIds,
  readGitClosedTaskIds,
  walkDir,
} from "./check-rule-7-chaos-coverage.mjs";

const HEADER_ROW = "| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |";
const SEP_ROW = "|---|---|---|---|---|";

/**
 * @param {string[]} rows
 * @param {{ withSection?: boolean, prose?: string }} [opts]
 * @returns {string}
 */
function readme(rows, opts = {}) {
  const { withSection = true, prose = "Per constitutional rule #7." } = opts;
  const sectionHeader = withSection
    ? "## Failure modes & chaos verification"
    : "## Some other heading";
  return ["# pkg", "", sectionHeader, "", prose, "", HEADER_ROW, SEP_ROW, ...rows, ""].join("\n");
}

const tasksMd = `
- [ ] some-real-task
  - **ID**: some-real-task
- [ ] another-task
  - **ID**: another-task
`;

describe("parseTaskIds", () => {
  it("extracts every kebab-case ID", () => {
    const ids = parseTaskIds(`
- **ID**: foo-bar
  - **ID**: baz-qux
- **ID**: \`backticked-id\`
`);
    expect(ids).toEqual(new Set(["foo-bar", "baz-qux", "backticked-id"]));
  });
});

describe("parseFirstTable", () => {
  it("returns headers + rows for a simple pipe table", () => {
    const txt = ["intro", "| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |", "outro"].join("\n");
    expect(parseFirstTable(txt)).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("returns null when no table is present", () => {
    expect(parseFirstTable("just prose, no pipes")).toBeNull();
  });
});

describe("checkChaosCoverage", () => {
  const testFiles = new Set(["novel/foo/src/index.test.ts", "novel/bar/src/parse.test.ts"]);

  it("(a) row referencing an existing test file → 0 errors", () => {
    const content = readme([
      "| 1 | something fails | trigger | graceful-degrade | covered by `novel/foo/src/index.test.ts` |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toEqual([]);
  });

  it("(b) row referencing a non-existent test → 1 error", () => {
    const content = readme([
      "| 1 | something fails | trigger | graceful-degrade | covered by `novel/foo/src/missing.test.ts` |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/does not exist/);
    expect(errors[0]?.row).toBe(1);
  });

  it("(c) deferred form pointing to a real TASKS.md ID → 0 errors", () => {
    const content = readme([
      "| 1 | bigness | trigger | loud-crash | (deferred — covered when some-real-task ships) |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toEqual([]);
  });

  it("(d) deferred form pointing to an unknown task-id → 1 error", () => {
    const content = readme([
      "| 1 | bigness | trigger | loud-crash | (deferred — covered when ghost-task ships) |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/unknown task-id/);
  });

  it("(e) README missing the section entirely → 1 error", () => {
    const content = readme(["| 1 | x | y | z | covered by test |"], { withSection: false });
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.row).toBeNull();
    expect(errors[0]?.message).toMatch(/missing/);
  });

  it("(f) row with empty Chaos test cell → 1 error", () => {
    const content = readme(["| 1 | bigness | trigger | loud-crash |  |"]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/empty/);
  });

  it("rejects malformed deferred prose (no task-id)", () => {
    const content = readme([
      "| 1 | bigness | trigger | loud-crash | (deferred to budget-guard / mape-k integration tests) |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/strict form/);
  });

  it("accepts lenient prose that mentions a test", () => {
    const content = readme([
      "| 1 | x | y | z | covered manually; ephemeral-port test exercises the bind path |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toEqual([]);
  });

  it("accepts an assertion-only prose cell (lenient)", () => {
    const content = readme([
      "| 1 | x | y | z | apply DROP; assert selfTest resolves with status=green |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toEqual([]);
  });

  it("rejects a cell with no test / fixture / assertion words", () => {
    const content = readme(["| 1 | x | y | z | will figure out later |"]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/no recognizable/);
  });

  it("flags a section without a markdown table", () => {
    const content = [
      "# pkg",
      "",
      "## Failure modes & chaos verification",
      "",
      "Just prose, no table here.",
      "",
    ].join("\n");
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/no markdown table/);
  });

  it("flags a table missing a Chaos test column", () => {
    const content = [
      "## Failure modes & chaos verification",
      "",
      "| # | Failure mode | Expected behavior |",
      "|---|---|---|",
      "| 1 | x | y |",
      "",
    ].join("\n");
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/Chaos test/);
  });

  it("accepts a deferred form whose task-id is in git log (closes <id>)", () => {
    const content = readme([
      "| 1 | x | y | z | (deferred — covered when shipped-via-git-log ships) |",
    ]);
    const { errors } = checkChaosCoverage({
      readmes: [{ path: "novel/foo/README.md", content }],
      tasksMdContent: "no IDs here",
      testFiles,
      gitClosedTaskIds: new Set(["shipped-via-git-log"]),
    });
    expect(errors).toEqual([]);
  });

  it("checks every README independently (multi-readme accumulation)", () => {
    const ok = readme(["| 1 | x | y | z | covered by `novel/foo/src/index.test.ts` |"]);
    const broken = readme(["| 1 | x | y | z |  |"]);
    const { errors } = checkChaosCoverage({
      readmes: [
        { path: "novel/foo/README.md", content: ok },
        { path: "novel/bar/README.md", content: broken },
      ],
      tasksMdContent: tasksMd,
      testFiles,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.readme).toBe("novel/bar/README.md");
  });
});

describe("parseClosesIdsFromGitLog", () => {
  it("extracts every closes <task-id> reference, lower-cased and deduped", () => {
    const log = [
      "feat: do stuff",
      "",
      "closes some-task",
      "Closes Other-Task",
      "fix: things",
      "",
      "closes some-task", // duplicate
      "closes third-task-id-2",
    ].join("\n");
    expect(parseClosesIdsFromGitLog(log)).toEqual(
      new Set(["some-task", "other-task", "third-task-id-2"]),
    );
  });

  it("returns an empty set for a log with no `closes` references", () => {
    expect(parseClosesIdsFromGitLog("feat: things\n\nno markers here\n")).toEqual(new Set());
  });
});

describe("readGitClosedTaskIds — runner injection", () => {
  it("invokes git with --grep='closes ' and parses the synthetic log", () => {
    /** @type {{ file: string, args: string[] } | null} */
    let captured = null;
    /** @type {(file: string, args: string[]) => string} */
    const fakeRunner = (file, args) => {
      captured = { file, args };
      return "feat: x\n\ncloses synthetic-task\ncloses another-id\n";
    };
    const ids = readGitClosedTaskIds("/tmp/no-such-repo", fakeRunner);
    expect(ids).toEqual(new Set(["synthetic-task", "another-id"]));
    expect(captured).not.toBeNull();
    if (captured === null) return;
    /** @type {{ file: string, args: string[] }} */
    const c = captured;
    expect(c.file).toBe("git");
    expect(c.args).toContain("--grep=closes ");
    expect(c.args).toContain("--all");
    expect(c.args[0]).toBe("log");
  });

  it("returns an empty set when the runner throws (git unavailable)", () => {
    /** @type {(file: string, args: string[]) => string} */
    const throwingRunner = () => {
      throw new Error("git: command not found");
    };
    expect(readGitClosedTaskIds("/tmp/no-such-repo", throwingRunner)).toEqual(new Set());
  });
});

describe("walkDir — symlink-loop guard", () => {
  it("terminates on a pathological a->b/, b->a/ loop within 100ms with no files", () => {
    const root = mkdtempSync(join(tmpdir(), "rule-7-walk-loop-"));
    const a = join(root, "a");
    const b = join(root, "b");
    mkdirSync(a);
    mkdirSync(b);
    symlinkSync(b, join(a, "loop"), "dir");
    symlinkSync(a, join(b, "loop"), "dir");

    const t0 = Date.now();
    const collected = [];
    for (const f of walkDir(root)) collected.push(f);
    const elapsedMs = Date.now() - t0;

    expect(elapsedMs).toBeLessThan(100);
    expect(collected).toEqual([]);
  });

  it("still yields regular files when no loops are present", () => {
    const root = mkdtempSync(join(tmpdir(), "rule-7-walk-ok-"));
    const sub = join(root, "sub");
    mkdirSync(sub);
    writeFileSync(join(root, "a.ts"), "export {};\n");
    writeFileSync(join(sub, "b.test.ts"), "export {};\n");

    const collected = [];
    for (const f of walkDir(root)) collected.push(f);
    expect(collected.sort()).toEqual([join(root, "a.ts"), join(sub, "b.test.ts")].sort());
  });
});
