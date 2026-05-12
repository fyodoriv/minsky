// Paired tests for `resolveMinskyRepo` (rule #3 — test-first).
//
// Pattern: table-driven + stub-injected (pure-function contract).
//   Source: Bentley 1986 — programming pearls of table-driven tests;
//   Fowler, *Refactoring*, 2nd ed., Addison-Wesley 2018 (ISBN 978-
//   0134757599 ch. 9 — extract pure functions + test them via DI).
// Coverage target: 100% of the resolution chain (env-var hit, env-var
//   miss, each fallback hit, all-miss).

import { describe, expect, it } from "vitest";
import { resolveMinskyRepo } from "./shim-resolve.js";

/**
 * Helper: construct `ShimResolveInputs` with a `Set<string>` of paths
 * that "exist" and a `Record<string, string>` env. Keeps tests short.
 */
function inputs(opts: {
  readonly existingPaths?: ReadonlySet<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly homeDir?: string;
}) {
  const existing = opts.existingPaths ?? new Set<string>();
  return {
    env: opts.env ?? {},
    exists: (p: string) => existing.has(p),
    homeDir: opts.homeDir ?? "/home/op",
  };
}

describe("resolveMinskyRepo", () => {
  it("env.MINSKY_REPO wins when the path exists", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/custom/minsky", "/home/op/apps/tooling/minsky"]),
        env: { MINSKY_REPO: "/custom/minsky" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/custom/minsky",
      source: "env:MINSKY_REPO",
    });
  });

  it("env.MINSKY_REPO set but path missing returns hint (never silently falls back)", () => {
    // Rule #7 discipline: visible-not-silent. If the operator explicitly
    // pointed at a path that isn't there, the loud crash is correct;
    // silent fallback would hide the typo.
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/apps/tooling/minsky"]),
        env: { MINSKY_REPO: "/typo/here" },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.hint).toContain("MINSKY_REPO=/typo/here");
    expect(result.hint).toContain("does not exist");
  });

  it("empty MINSKY_REPO is treated as unset (falls through to defaults)", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/apps/tooling/minsky"]),
        env: { MINSKY_REPO: "" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/home/op/apps/tooling/minsky",
      source: "default:~/apps/tooling/minsky",
    });
  });

  it("falls back to ~/apps/tooling/minsky when MINSKY_REPO unset", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/apps/tooling/minsky"]),
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/home/op/apps/tooling/minsky",
      source: "default:~/apps/tooling/minsky",
    });
  });

  it("falls back to ~/apps/minsky when ~/apps/tooling/minsky missing", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/apps/minsky"]),
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/home/op/apps/minsky",
      source: "fallback:~/apps/minsky",
    });
  });

  it("falls back to ~/code/minsky when earlier fallbacks missing", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/code/minsky"]),
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/home/op/code/minsky",
      source: "fallback:~/code/minsky",
    });
  });

  it("falls back to ~/src/minsky as the last-resort community layout", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/src/minsky"]),
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/home/op/src/minsky",
      source: "fallback:~/src/minsky",
    });
  });

  it("returns a helpful hint when no candidate exists", () => {
    const result = resolveMinskyRepo(inputs({}));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.hint).toContain("could not find the minsky repo");
    expect(result.hint).toContain("~/apps/tooling/minsky");
    expect(result.hint).toContain("Set MINSKY_REPO=");
  });

  it("ordering: ~/apps/tooling/minsky beats ~/apps/minsky when both exist", () => {
    // Protects against a regression where fallback order becomes
    // ambiguous — the canonical Example layout must always win.
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set([
          "/home/op/apps/tooling/minsky",
          "/home/op/apps/minsky",
          "/home/op/code/minsky",
        ]),
      }),
    );
    expect(result).toEqual({
      ok: true,
      repoPath: "/home/op/apps/tooling/minsky",
      source: "default:~/apps/tooling/minsky",
    });
  });

  it("home directory trailing slash is handled", () => {
    const result = resolveMinskyRepo(
      inputs({
        existingPaths: new Set(["/home/op/apps/tooling/minsky"]),
        homeDir: "/home/op/",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.repoPath).toBe("/home/op/apps/tooling/minsky");
  });
});
