/**
 * Paired tests for `git-config-path-checks.ts` — slice 3 of
 * `minsky-cross-machine-dotfile-checks`.
 *
 * The helper detects git config keys (across system / global / local
 * scopes) that point at filesystem paths that don't exist on the
 * current machine — the multi-machine pattern from PRs #394/#395
 * (different username on a different machine, dotfiles' hardcoded
 * `/Users/fivanishche/...` path is wrong here).
 *
 * Pure-over-injection: the test layer simulates `git config
 * --show-origin --get <key>` results; the helper inspects each
 * returned path with `existsSyncFn`.
 */

import { describe, expect, it } from "vitest";
import {
  type BrokenGitConfigPath,
  type GitConfigCheckOutcome,
  PATH_CONFIG_KEYS,
  checkGitConfigPaths,
  formatBrokenPathMessage,
} from "./git-config-path-checks.js";

const FAKE_PATH_KEY_SET = ["core.hooksPath", "core.attributesfile", "core.excludesfile"] as const;

describe("checkGitConfigPaths — all unset", () => {
  it("returns empty brokenPaths when every key is unset", () => {
    const result = checkGitConfigPaths({
      keysToCheck: FAKE_PATH_KEY_SET,
      getGitConfigFn: () => undefined,
      existsSyncFn: () => true,
    });
    expect(result).toEqual<GitConfigCheckOutcome>({ brokenPaths: [] });
  });
});

describe("checkGitConfigPaths — set + valid", () => {
  it("returns empty brokenPaths when every set key points at an existing path", () => {
    const result = checkGitConfigPaths({
      keysToCheck: FAKE_PATH_KEY_SET,
      getGitConfigFn: (k) => {
        if (k === "core.hooksPath") return { value: "/tmp", origin: "global" };
        return undefined;
      },
      existsSyncFn: () => true,
    });
    expect(result.brokenPaths).toHaveLength(0);
  });
});

describe("checkGitConfigPaths — set + path missing", () => {
  it("flags the broken path with origin + recoveryCommand", () => {
    const result = checkGitConfigPaths({
      keysToCheck: FAKE_PATH_KEY_SET,
      getGitConfigFn: (k) => {
        if (k === "core.hooksPath") {
          return { value: "/Users/nonexistent-user-xyz/dotfiles/git-hooks", origin: "global" };
        }
        return undefined;
      },
      existsSyncFn: () => false,
    });
    expect(result.brokenPaths).toHaveLength(1);
    const broken = result.brokenPaths[0] as BrokenGitConfigPath;
    expect(broken.configKey).toBe("core.hooksPath");
    expect(broken.configValue).toBe("/Users/nonexistent-user-xyz/dotfiles/git-hooks");
    expect(broken.origin).toBe("global");
    expect(broken.recoveryCommand).toMatch(/git config --global --unset core\.hooksPath/);
  });

  it("flags multiple broken paths when more than one key is invalid", () => {
    const result = checkGitConfigPaths({
      keysToCheck: FAKE_PATH_KEY_SET,
      getGitConfigFn: (k) => {
        if (k === "core.hooksPath") {
          return { value: "/Users/nonexistent/hooks", origin: "global" };
        }
        if (k === "core.attributesfile") {
          return { value: "/Users/nonexistent/.gitattributes", origin: "local" };
        }
        return undefined;
      },
      existsSyncFn: () => false,
    });
    expect(result.brokenPaths).toHaveLength(2);
    const local = result.brokenPaths.find((p) => p.origin === "local");
    expect(local?.recoveryCommand).toMatch(/git config --local --unset/);
  });
});

describe("checkGitConfigPaths — set + EACCES (permission denied)", () => {
  it("treats EACCES as broken (existsSync returns false on permission-denied paths, same as missing)", () => {
    // existsSync returns false on EACCES, not throws — treat as broken path
    const result = checkGitConfigPaths({
      keysToCheck: FAKE_PATH_KEY_SET,
      getGitConfigFn: (k) => {
        if (k === "core.hooksPath") {
          return { value: "/root/.git-hooks", origin: "global" };
        }
        return undefined;
      },
      existsSyncFn: () => false,
    });
    expect(result.brokenPaths).toHaveLength(1);
    expect(result.brokenPaths[0]?.configKey).toBe("core.hooksPath");
    expect(result.brokenPaths[0]?.recoveryCommand).toMatch(/--global --unset/);
  });
});

describe("checkGitConfigPaths — different scopes produce different recovery commands", () => {
  it("system origin → `git config --system --unset`", () => {
    const result = checkGitConfigPaths({
      keysToCheck: ["core.hooksPath"] as const,
      getGitConfigFn: () => ({ value: "/missing", origin: "system" }),
      existsSyncFn: () => false,
    });
    expect(result.brokenPaths[0]?.recoveryCommand).toMatch(/--system --unset/);
  });

  it("unknown origin → recovery falls back to `--unset` (no scope flag)", () => {
    const result = checkGitConfigPaths({
      keysToCheck: ["core.hooksPath"] as const,
      getGitConfigFn: () => ({ value: "/missing", origin: "unknown" }),
      existsSyncFn: () => false,
    });
    expect(result.brokenPaths[0]?.recoveryCommand).toMatch(/git config --unset/);
  });
});

describe("PATH_CONFIG_KEYS — exported default key set", () => {
  it("includes core.hooksPath, core.attributesfile, core.excludesfile", () => {
    expect(PATH_CONFIG_KEYS).toContain("core.hooksPath");
    expect(PATH_CONFIG_KEYS).toContain("core.attributesfile");
    expect(PATH_CONFIG_KEYS).toContain("core.excludesfile");
  });
});

describe("formatBrokenPathMessage", () => {
  // Wording contract — operator must be able to find:
  //   1. which config key is broken
  //   2. the broken value (so they can sanity-check)
  //   3. the recovery command (copy-paste-able)

  it("mentions the config key", () => {
    const msg = formatBrokenPathMessage({
      configKey: "core.hooksPath",
      configValue: "/missing",
      origin: "global",
      recoveryCommand: "git config --global --unset core.hooksPath",
    });
    expect(msg).toContain("core.hooksPath");
  });

  it("mentions the broken value", () => {
    const msg = formatBrokenPathMessage({
      configKey: "core.hooksPath",
      configValue: "/Users/nonexistent/hooks",
      origin: "global",
      recoveryCommand: "git config --global --unset core.hooksPath",
    });
    expect(msg).toContain("/Users/nonexistent/hooks");
  });

  it("mentions the recovery command", () => {
    const msg = formatBrokenPathMessage({
      configKey: "core.hooksPath",
      configValue: "/missing",
      origin: "global",
      recoveryCommand: "git config --global --unset core.hooksPath",
    });
    expect(msg).toContain("git config --global --unset core.hooksPath");
  });
});
