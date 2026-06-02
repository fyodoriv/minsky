// @ts-check
import { describe, expect, it } from "vitest";
import { checkNoRepoRootInstallInTests } from "./check-no-repo-root-install-in-tests.mjs";

/**
 * Build an injected FS from a `{ relPath: contents }` map. `readText` is
 * called with `${repoRoot}/${relPath}` (repoRoot = "/repo", 6 chars + slash),
 * so we strip the leading `/repo/` (6 chars) to look up the content — same
 * shape as the sibling lints' fake FS.
 *
 * @param {Record<string, string>} fileContents
 */
function fakeFs(fileContents) {
  return {
    repoRoot: "/repo",
    files: Object.keys(fileContents),
    readText: (/** @type {string} */ p) => fileContents[p.slice(6)] ?? "",
  };
}

describe("checkNoRepoRootInstallInTests", () => {
  it("flags a bare `minsky-init <host>` spawn with no --skip-install", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": [
          'const MINSKY_INIT = join(REPO_ROOT, "bin", "minsky-init");',
          'const r = spawnSync("bash", [MINSKY_INIT, host], { encoding: "utf8" });',
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/--skip-install/);
  });

  it("flags an `install.sh <host>` spawn with no --skip-install (the 2026-06-02 incident shape)", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": [
          'const INSTALL_SH = join(REPO_ROOT, "distribution", "install.sh");',
          'const r = spawnSync("sh", [INSTALL_SH, host], { encoding: "utf8", timeout: 180000 });',
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags a literal `pnpm install` spawn with no cwd (defaults to repo root under vitest)", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "scripts/foo.test.mjs": 'const r = spawnSync("pnpm", ["install"], { encoding: "utf8" });',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/pnpm install/);
  });

  it("flags an `npm ci` spawn whose cwd is REPO_ROOT", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "scripts/foo.test.mjs": 'execSync("npm ci", { cwd: REPO_ROOT });',
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("passes a spawn that carries --skip-install", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts":
          'const r = spawnSync("bash", [MINSKY_INIT, "--skip-install", host]);',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes a bootstrap spawn against a non-repo refusal target", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": [
          'const nonRepo = mkdtempSync(join(tmpdir(), "x-nonrepo-"));',
          'const r = spawnSync("sh", [INSTALL_SH, nonRepo]);',
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes a spread-args helper spawn (flag decided at the call site)", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": 'const r = spawnSync("bash", [MINSKY_INIT, ...args]);',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes when the spawn is gated by a skipIf install-mutation env (the #1028 gate)", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": [
          'const RUN_INSTALL_MUTATION = process.env["MINSKY_RUN_INSTALL_MUTATION_TEST"] === "1";',
          "test.skipIf(!RUN_INSTALL_MUTATION)(",
          '  "real install smoke",',
          "  () => {",
          '    const r = spawnSync("sh", [INSTALL_SH, host]);',
          "  },",
          ");",
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes an inline `repo-root-install-ok:` justification marker", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": [
          "// repo-root-install-ok: spawns against an isolated mkdtemp checkout copy",
          'const r = spawnSync("sh", [INSTALL_SH, isolatedCopy]);',
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("does not flag a `pnpm` spawn that is a build, not an install", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "scripts/foo.test.mjs":
          'const r = spawnSync("pnpm", ["--filter", "@minsky/x", "build"], { cwd: REPO_ROOT });',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores `pnpm install` mentioned only in a comment", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "scripts/foo.test.mjs": "// Stub `pnpm install` by creating the expected output directly.",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores `pnpm install` mentioned in a remediation string (not a command)", () => {
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "scripts/foo.test.mjs": 'expect(report).toContain("[biome-unresolved] pnpm install");',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("does not flag incidental bootstrap-token mentions (path binding, tmpdir prefix, title, assertion)", () => {
    // Rule A fires only on lines that READ as a spawn/exec — not on a bare
    // path binding, a mkdtempSync prefix, a describe title, or a .toMatch
    // assertion. Without this, the gate false-positives once a test file
    // drops its install-mutation skipIf (the minsky-init-real-install-smoke
    // -hermetic rewrite). The real spawn here is isolated + carries the
    // inline marker, so the file is clean.
    const result = checkNoRepoRootInstallInTests(
      fakeFs({
        "test/integration/foo.test.ts": [
          'const MINSKY_INIT = join(REPO_ROOT, "bin", "minsky-init");',
          'const INSTALL_SH = join(REPO_ROOT, "distribution", "install.sh");',
          'const host = mkdtempSync(join(tmpdir(), "minsky-init-host-"));',
          'describe("bin/minsky-init — one-command bootstrap", () => {});',
          "expect(r.stdout).toMatch(/minsky-init/);",
          "// repo-root-install-ok: spawns against an isolated mkdtemp checkout copy",
          'const r = spawnSync("sh", [join(iso, "distribution", "install.sh"), host]);',
        ].join("\n"),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("real production scan passes (smoke — the current post-#1028 tree)", () => {
    const result = checkNoRepoRootInstallInTests();
    expect(result.ok).toBe(true);
  });
});
