// Tests for orchestrate.mjs. The conductor's deterministic decision
// (rule #10 — no I/O in the decision) is `decideHeal`; the I/O wiring
// (pgrep / launchctl / runGateSweep) is validated by the `--once` run.
// No @ts-check (matches sibling scripts/*.test.mjs convention).
import { describe, expect, it } from "vitest";
import { decideHeal, resolveRepoRoot } from "./orchestrate.mjs";

describe("decideHeal (conductor self-heal decision)", () => {
  it("worker alive ⇒ ok (no heal)", () => {
    expect(decideHeal(true)).toBe("ok");
  });
  it("worker down ⇒ heal", () => {
    expect(decideHeal(false)).toBe("heal");
  });
  it("is pure / deterministic — same input, same output", () => {
    expect(decideHeal(true)).toBe(decideHeal(true));
    expect(decideHeal(false)).toBe(decideHeal(false));
  });
});

describe("resolveRepoRoot (conductor scope decision)", () => {
  const probe = { exists: () => false, listDir: () => [] };

  it("MINSKY_HOME env wins when set (launchd / bootstrap path)", () => {
    expect(resolveRepoRoot({ MINSKY_HOME: "/explicit/root" }, "/cwd", probe)).toBe(
      "/explicit/root",
    );
  });

  it("empty MINSKY_HOME is ignored — falls through to cwd self-detect", () => {
    expect(resolveRepoRoot({ MINSKY_HOME: "" }, "/cwd", probe)).toBe("/cwd");
  });

  it("no MINSKY_HOME ⇒ self-detects via the zero-arg precedence chain", () => {
    // plain dir (probe.exists always false) → cwd itself.
    expect(resolveRepoRoot({}, "/some/folder", probe)).toBe("/some/folder");
  });

  it("nested-repos cwd ⇒ the cwd as the multi-host sweep root", () => {
    /** @type {{exists:(p:string)=>boolean,listDir:(p:string)=>readonly string[]}} */
    const treeProbe = {
      exists: (p) => p === "/tree/a/.git" || p === "/tree/b/.git",
      listDir: (p) => (p === "/tree" ? ["a", "b"] : []),
    };
    expect(resolveRepoRoot({}, "/tree", treeProbe)).toBe("/tree");
  });
});
