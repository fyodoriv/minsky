// @ts-check
// Paired test for the stale-tasks-md-marker sweep — pins the pure
// detector functions against the known-stale-marker shape that surfaced
// 6+ times in the 2026-05-28 session (PRs #946 #947 #948 #951 #952 #955).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractFilePaths,
  findCitations,
  isBlocked,
  isClaimed,
  parseTaskBlocks,
  sweepStaleTasksMdMarkers,
} from "./tasks-md-stale-sweep.mjs";

describe("parseTaskBlocks", () => {
  it("splits a multi-task TASKS.md into per-task blocks with IDs", () => {
    const md = `# Tasks

## P1

- [ ] \`task-one\` — first task summary
  - **ID**: task-one
  - **Tags**: p1, foo

- [ ] \`task-two\` — second task summary
  - **ID**: task-two
  - **Tags**: p1, bar
`;
    const blocks = parseTaskBlocks(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.id).toBe("task-one");
    expect(blocks[1]?.id).toBe("task-two");
  });
});

describe("extractFilePaths", () => {
  it("extracts backtick-wrapped path-like strings", () => {
    const body = "  - **Files**: `scripts/foo.mjs`, `novel/bar/src/baz.ts`";
    const paths = extractFilePaths(body);
    expect(paths).toContain("scripts/foo.mjs");
    expect(paths).toContain("novel/bar/src/baz.ts");
  });

  it("skips non-path backtick refs like identifiers", () => {
    const body = "  - **Files**: `scripts/foo.mjs` (calls `renderBrief`)";
    const paths = extractFilePaths(body);
    expect(paths).toContain("scripts/foo.mjs");
    expect(paths).not.toContain("renderBrief");
  });

  it("returns [] when no **Files** field", () => {
    const body = "  - **ID**: foo";
    expect(extractFilePaths(body)).toEqual([]);
  });

  it("handles continuation lines", () => {
    const body = `  - **Files**: \`a.mjs\`,
    \`b.mjs\``;
    const paths = extractFilePaths(body);
    expect(paths).toContain("a.mjs");
    expect(paths).toContain("b.mjs");
  });
});

describe("isBlocked", () => {
  it("returns true when **Blocked**: has a value", () => {
    expect(isBlocked("  - **Blocked**: needs-user-approval")).toBe(true);
  });
  it("returns true when **Blocked by**: has a value", () => {
    expect(isBlocked("  - **Blocked by**: other-task")).toBe(true);
  });
  it("returns false when neither field appears", () => {
    expect(isBlocked("  - **ID**: foo")).toBe(false);
  });
});

describe("isClaimed", () => {
  it("returns true when first line has (@agent)", () => {
    expect(isClaimed("- [ ] `foo` — bar (@claude-code)")).toBe(true);
  });
  it("returns false on unclaimed first line", () => {
    expect(isClaimed("- [ ] `foo` — bar")).toBe(false);
  });
});

describe("findCitations", () => {
  /** @type {string} */
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweep-stale-citations-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds inline citations matching the task ID", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(
      join(tmpDir, "scripts/foo.mjs"),
      "// see TASKS.md `my-stale-task` for context\nconst x = 1;\n",
    );
    const hits = findCitations("my-stale-task", ["scripts/foo.mjs"], tmpDir);
    expect(hits.length).toBe(1);
    expect(hits[0]?.path).toBe("scripts/foo.mjs");
    expect(hits[0]?.line).toBe(1);
  });

  it("returns [] when no citation appears", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(join(tmpDir, "scripts/foo.mjs"), "const x = 1;\n");
    expect(findCitations("my-stale-task", ["scripts/foo.mjs"], tmpDir)).toEqual([]);
  });

  it("skips missing files", () => {
    expect(findCitations("foo", ["nonexistent.mjs"], tmpDir)).toEqual([]);
  });

  it("strips trailing :N line refs from path entries", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(join(tmpDir, "scripts/bar.mjs"), "// my-id ref\n");
    const hits = findCitations("my-id", ["scripts/bar.mjs:48"], tmpDir);
    expect(hits.length).toBe(1);
  });

  it("filters out citations on lines containing 'filed as follow-up' (negative signal)", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(
      join(tmpDir, "scripts/foo.mjs"),
      `// filed as a follow-up: \`my-task\` per the parent task's pivot\n`,
    );
    expect(findCitations("my-task", ["scripts/foo.mjs"], tmpDir)).toEqual([]);
  });

  it("filters out citations on lines containing 'TODO' or 'FIXME' (negative signal)", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(join(tmpDir, "scripts/foo.mjs"), "// TODO: my-task needs the substrate port\n");
    expect(findCitations("my-task", ["scripts/foo.mjs"], tmpDir)).toEqual([]);
  });

  it("KEEPS citations on lines containing only positive-signal text", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(
      join(tmpDir, "scripts/foo.mjs"),
      "// rule #17 fix per TASKS.md `my-task` — shipped 2026-05-28\n",
    );
    const hits = findCitations("my-task", ["scripts/foo.mjs"], tmpDir);
    expect(hits.length).toBe(1);
  });
});

describe("sweepStaleTasksMdMarkers (end-to-end)", () => {
  /** @type {string} */
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweep-stale-e2e-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flags a task whose cited file contains the task ID (the canonical stale-marker shape)", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(
      join(tmpDir, "scripts/foo.mjs"),
      "// rule #17 fix per TASKS.md `my-stale-task`\nconst x = 1;\n",
    );
    const md = `# Tasks

## P1

- [ ] \`my-stale-task\` — fix the foo bug
  - **ID**: my-stale-task
  - **Files**: \`scripts/foo.mjs\`
`;
    const candidates = sweepStaleTasksMdMarkers(md, tmpDir);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.id).toBe("my-stale-task");
    expect(candidates[0]?.evidence.length).toBe(1);
  });

  it("does NOT flag tasks with **Blocked**: set", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(
      join(tmpDir, "scripts/foo.mjs"),
      "// my-task is mentioned but blocked-on-rescope\n",
    );
    const md = `# Tasks

## P1

- [ ] \`my-task\` — fix the foo bug
  - **ID**: my-task
  - **Blocked**: needs-user-approval
  - **Files**: \`scripts/foo.mjs\`
`;
    expect(sweepStaleTasksMdMarkers(md, tmpDir)).toEqual([]);
  });

  it("does NOT flag tasks claimed by another agent", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(join(tmpDir, "scripts/foo.mjs"), "// my-task ref\n");
    const md = `# Tasks

## P1

- [ ] \`my-task\` — fix the foo bug (@other-agent)
  - **ID**: my-task
  - **Files**: \`scripts/foo.mjs\`
`;
    expect(sweepStaleTasksMdMarkers(md, tmpDir)).toEqual([]);
  });

  it("does NOT flag tasks whose cited files don't mention the ID", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(join(tmpDir, "scripts/foo.mjs"), "const x = 1;\n");
    const md = `# Tasks

## P1

- [ ] \`my-task\` — fix the foo bug
  - **ID**: my-task
  - **Files**: \`scripts/foo.mjs\`
`;
    expect(sweepStaleTasksMdMarkers(md, tmpDir)).toEqual([]);
  });

  it("returns multiple candidates when multiple tasks have citations", () => {
    mkdirSync(join(tmpDir, "scripts"));
    writeFileSync(join(tmpDir, "scripts/foo.mjs"), "// task-one cite\n");
    writeFileSync(join(tmpDir, "scripts/bar.mjs"), "// task-two cite\n");
    const md = `# Tasks

## P1

- [ ] \`task-one\` — fix foo
  - **ID**: task-one
  - **Files**: \`scripts/foo.mjs\`

- [ ] \`task-two\` — fix bar
  - **ID**: task-two
  - **Files**: \`scripts/bar.mjs\`
`;
    const candidates = sweepStaleTasksMdMarkers(md, tmpDir);
    expect(candidates.length).toBe(2);
    expect(candidates.map((c) => c.id).sort()).toEqual(["task-one", "task-two"]);
  });
});
