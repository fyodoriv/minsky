// Tests for the pure function in check-no-hardcoded-user-paths.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures
// (Meszaros, *xUnit Test Patterns*, 2007).
//
// Source: rule #17 (vision.md § Proactive healing — observation IS the
// fix); rule #1 (don't hand-maintain what should be derived); operator
// directive 2026-05-19.

import { describe, expect, test } from "vitest";

import { checkNoHardcodedUserPaths } from "./check-no-hardcoded-user-paths.mjs";

function asFiles(entries) {
  return new Map(Object.entries(entries));
}

describe("no-hardcoded-user-paths lint", () => {
  test("clean source ⇒ no violations", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/orchestrate.mjs": [
          "import { dirname, resolve } from 'node:path';",
          "import { fileURLToPath } from 'node:url';",
          "const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');",
        ].join("\n"),
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations).toEqual([]);
  });

  test("hardcoded /Users/cbrwizard/... in executable code ⇒ violation", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/foo.mjs": "const REPO = '/Users/cbrwizard/apps/tooling/minsky';",
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]?.match).toBe("/Users/cbrwizard");
  });

  test("hardcoded /home/someone in executable code ⇒ violation", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/foo.mjs": "const HOME = '/home/somebody/repo';",
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]?.match).toBe("/home/somebody");
  });

  test("comment with hardcoded path ⇒ allowed (audit trail)", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/foo.mjs": [
          "// The previous version was hardcoded to /Users/cbrwizard/...",
          "const REPO = process.env.HOME;",
        ].join("\n"),
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations).toEqual([]);
  });

  test("hash-comment (bash) with hardcoded path ⇒ allowed", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "bin/foo.sh": [
          "#!/bin/bash",
          "# History: was /Users/cbrwizard/... before 2026-05-19",
          "echo $HOME",
        ].join("\n"),
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations).toEqual([]);
  });

  test("current-user is exempt (no false-positive on local-machine self-reference)", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/foo.mjs": "const SELF = '/Users/fivanishche/apps/tooling/minsky';",
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations).toEqual([]);
  });

  test("'ubuntu' and 'runner' are exempt (CI runner usernames)", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/foo.mjs": [
          "const A = '/home/ubuntu/repo';",
          "const B = '/Users/runner/work';",
        ].join("\n"),
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations).toEqual([]);
  });

  test("/Users/.../ glob-shape (doc example) ⇒ allowed", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/foo.mjs": "throw new Error('expected /Users/.../.gitconfig')",
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations).toEqual([]);
  });

  test("multiple violations in one file ⇒ all reported", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/multi.mjs": [
          "const A = '/Users/alice/repo';",
          "const B = '/Users/bob/repo';",
          "const C = '/home/carol/repo';",
        ].join("\n"),
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations.length).toBe(3);
    expect(r.violations.map((v) => v.match).sort()).toEqual([
      "/Users/alice",
      "/Users/bob",
      "/home/carol",
    ]);
  });

  test("violation reports the line number (1-based) and content", () => {
    const r = checkNoHardcodedUserPaths({
      files: asFiles({
        "scripts/multi.mjs": [
          "// header",
          "const A = 'ok';",
          "const B = '/Users/alice/repo';",
        ].join("\n"),
      }),
      currentUser: "fivanishche",
    });
    expect(r.violations[0]?.line).toBe(3);
    expect(r.violations[0]?.content).toContain("/Users/alice/repo");
  });
});
