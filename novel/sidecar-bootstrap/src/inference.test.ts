// Tests for the inference function. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { NO_HOST_SIGNALS, inferRepoConfig } from "./inference.js";

describe("inferRepoConfig — defaults under no signals", () => {
  test("returns conservative defaults for all fields when no signals present", () => {
    const config = inferRepoConfig(NO_HOST_SIGNALS);
    expect(config.host_repo).toBe("unknown/unknown");
    expect(config.tasks_md_path).toBe("TASKS.md");
    expect(config.commit_format).toBe("<TYPE>: <DESCRIPTION>");
    expect(config.pre_commit_command).toBe("");
    expect(config.branch_prefix).toBe("feat/");
    expect(config.default_branch).toBe("main");
    expect(config.ticket_format).toBeNull();
    expect(config.lint_substrate_overrides).toEqual({});
    expect(config.host_packages_path).toBe("src/");
    expect(config.ignore_mechanism).toBe("global-ignore");
  });
});

describe("inferRepoConfig — host_repo from git remote URL", () => {
  test("HTTPS remote URL", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      gitRemoteUrl: "https://github.com/owner/repo.git",
    });
    expect(config.host_repo).toBe("owner/repo");
  });

  test("SSH remote URL", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      gitRemoteUrl: "git@github.com:owner/repo.git",
    });
    expect(config.host_repo).toBe("owner/repo");
  });

  test("HTTPS without .git suffix", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      gitRemoteUrl: "https://github.com/owner/repo",
    });
    expect(config.host_repo).toBe("owner/repo");
  });

  test("malformed URL falls back to unknown/unknown", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      gitRemoteUrl: "not a real url",
    });
    expect(config.host_repo).toBe("unknown/unknown");
  });
});

describe("inferRepoConfig — pre_commit_command from package.json", () => {
  test("yarn project with lint script", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { scripts: { lint: "eslint ." }, packageManager: "yarn@4.0.0" },
    });
    expect(config.pre_commit_command).toBe("yarn lint");
  });

  test("pnpm project with lint script", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { scripts: { lint: "biome check" }, packageManager: "pnpm@9.0.0" },
    });
    expect(config.pre_commit_command).toBe("pnpm lint");
  });

  test("npm project with lint script (no packageManager field)", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { scripts: { lint: "eslint ." } },
    });
    expect(config.pre_commit_command).toBe("npm run lint");
  });

  test("project without lint script returns empty", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { scripts: { build: "tsc" } },
    });
    expect(config.pre_commit_command).toBe("");
  });

  test("no package.json returns empty", () => {
    const config = inferRepoConfig({ ...NO_HOST_SIGNALS, packageJson: null });
    expect(config.pre_commit_command).toBe("");
  });
});

describe("inferRepoConfig — host_packages_path from workspaces", () => {
  test("yarn workspaces array → packages/", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { workspaces: ["packages/*"] },
    });
    expect(config.host_packages_path).toBe("packages/");
  });

  test("npm workspaces object → packages/", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { workspaces: { packages: ["packages/*"] } },
    });
    expect(config.host_packages_path).toBe("packages/");
  });

  test("no workspaces field → src/", () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      packageJson: { name: "single-pkg" },
    });
    expect(config.host_packages_path).toBe("src/");
  });
});

describe("inferRepoConfig — default_branch from git config", () => {
  test("git config provides the default branch", () => {
    const config = inferRepoConfig({ ...NO_HOST_SIGNALS, gitDefaultBranch: "master" });
    expect(config.default_branch).toBe("master");
  });

  test("missing git default branch falls back to main", () => {
    const config = inferRepoConfig({ ...NO_HOST_SIGNALS, gitDefaultBranch: null });
    expect(config.default_branch).toBe("main");
  });
});
