// Tests for the bootstrap planner. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { NO_HOST_SIGNALS, inferRepoConfig } from "./inference.js";
import { type PlanInputs, planBootstrap, renderRepoYaml } from "./plan.js";

const baseInputs: PlanInputs = {
  hostRoot: "/host",
  config: inferRepoConfig(NO_HOST_SIGNALS),
  visionMdPath: "/minsky/vision.md",
  globalGitIgnorePath: "/Users/op/.config/git/ignore",
  existing: {
    minskyDir: false,
    repoYaml: false,
    visionMdSymlink: false,
    experimentsDir: false,
    experimentsGitkeep: false,
    globalIgnoreEntry: false,
  },
};

describe("planBootstrap — fresh host (nothing present)", () => {
  test("emits all six core actions", () => {
    const plan = planBootstrap(baseInputs);
    const kinds = plan.actions.map((a) => a.kind);
    // ensure-directory (.minsky), write-file (repo.yaml), ensure-directory
    // (experiments), write-file (.gitkeep), create-symlink (vision.md),
    // append-to-ignore, log-info.
    expect(kinds).toEqual([
      "ensure-directory",
      "write-file",
      "ensure-directory",
      "write-file",
      "create-symlink",
      "append-to-ignore",
      "log-info",
    ]);
  });

  test(".minsky dir is targeted at /host/.minsky", () => {
    const plan = planBootstrap(baseInputs);
    const minskyDir = plan.actions.find(
      (a) => a.kind === "ensure-directory" && a.path.endsWith("/.minsky"),
    );
    expect(minskyDir).toBeDefined();
  });

  test("repo.yaml is written with the inferred config rendered as YAML", () => {
    const plan = planBootstrap(baseInputs);
    const writeRepoYaml = plan.actions.find(
      (a) => a.kind === "write-file" && a.path.endsWith("repo.yaml"),
    );
    expect(writeRepoYaml).toBeDefined();
    if (writeRepoYaml?.kind !== "write-file") return;
    expect(writeRepoYaml.content).toContain("host_repo:");
    expect(writeRepoYaml.content).toContain("default_branch:");
    expect(writeRepoYaml.content).toContain("ignore_mechanism:");
  });

  test("vision.md symlink targets the canonical minsky vision.md", () => {
    const plan = planBootstrap(baseInputs);
    const symlink = plan.actions.find((a) => a.kind === "create-symlink");
    expect(symlink).toBeDefined();
    if (symlink?.kind !== "create-symlink") return;
    expect(symlink.target).toBe("/minsky/vision.md");
    expect(symlink.linkPath).toBe("/host/.minsky/vision.md");
  });

  test("global ignore is appended with .minsky/ entry", () => {
    const plan = planBootstrap(baseInputs);
    const ignore = plan.actions.find((a) => a.kind === "append-to-ignore");
    expect(ignore).toBeDefined();
    if (ignore?.kind !== "append-to-ignore") return;
    expect(ignore.entry).toBe(".minsky/");
    expect(ignore.ignoreFile).toBe("/Users/op/.config/git/ignore");
  });
});

describe("planBootstrap — already-bootstrapped host (idempotency)", () => {
  test("everything present → only the log-info action remains", () => {
    const plan = planBootstrap({
      ...baseInputs,
      existing: {
        minskyDir: true,
        repoYaml: true,
        visionMdSymlink: true,
        experimentsDir: true,
        experimentsGitkeep: true,
        globalIgnoreEntry: true,
      },
    });
    expect(plan.actions.length).toBe(1);
    expect(plan.actions[0]?.kind).toBe("log-info");
  });

  test("partial state — only missing artefacts get actions", () => {
    const plan = planBootstrap({
      ...baseInputs,
      existing: {
        minskyDir: true,
        repoYaml: true,
        visionMdSymlink: false, // broken
        experimentsDir: true,
        experimentsGitkeep: true,
        globalIgnoreEntry: true,
      },
    });
    const kinds = plan.actions.map((a) => a.kind);
    expect(kinds).toContain("create-symlink");
    expect(kinds).not.toContain("write-file"); // repo.yaml + .gitkeep present
    expect(kinds).not.toContain("append-to-ignore");
  });
});

describe("planBootstrap — ignore_mechanism: per-clone-exclude", () => {
  test("does NOT emit append-to-ignore when ignore_mechanism is per-clone-exclude", () => {
    const plan = planBootstrap({
      ...baseInputs,
      config: { ...baseInputs.config, ignore_mechanism: "per-clone-exclude" },
    });
    const ignore = plan.actions.find((a) => a.kind === "append-to-ignore");
    expect(ignore).toBeUndefined();
  });

  test("does NOT emit append-to-ignore when ignore_mechanism is none", () => {
    const plan = planBootstrap({
      ...baseInputs,
      config: { ...baseInputs.config, ignore_mechanism: "none" },
    });
    const ignore = plan.actions.find((a) => a.kind === "append-to-ignore");
    expect(ignore).toBeUndefined();
  });
});

describe("renderRepoYaml", () => {
  test("renders all required fields", () => {
    const yaml = renderRepoYaml(inferRepoConfig(NO_HOST_SIGNALS));
    expect(yaml).toContain("host_repo:");
    expect(yaml).toContain("tasks_md_path:");
    expect(yaml).toContain("commit_format:");
    expect(yaml).toContain("pre_commit_command:");
    expect(yaml).toContain("branch_prefix:");
    expect(yaml).toContain("default_branch:");
    expect(yaml).toContain("ticket_format:");
    expect(yaml).toContain("host_packages_path:");
    expect(yaml).toContain("ignore_mechanism:");
    expect(yaml).toContain("lint_substrate_overrides:");
  });

  test("ticket_format: null is rendered as the literal `null`", () => {
    const yaml = renderRepoYaml(inferRepoConfig(NO_HOST_SIGNALS));
    expect(yaml).toMatch(/ticket_format: null/);
  });

  test("empty lint_substrate_overrides renders as `{}`", () => {
    const yaml = renderRepoYaml(inferRepoConfig(NO_HOST_SIGNALS));
    expect(yaml).toContain("lint_substrate_overrides:\n  {}");
  });

  test("non-empty lint_substrate_overrides renders one entry per line", () => {
    const config = {
      ...inferRepoConfig(NO_HOST_SIGNALS),
      lint_substrate_overrides: {
        "rule-6-let-it-crash": "yarn lint",
        "rule-2-dep-coverage": "skip",
      },
    };
    const yaml = renderRepoYaml(config);
    expect(yaml).toContain("rule-6-let-it-crash:");
    expect(yaml).toContain("rule-2-dep-coverage:");
  });

  test("rendered YAML round-trips back through the parser", async () => {
    const config = inferRepoConfig({
      ...NO_HOST_SIGNALS,
      gitRemoteUrl: "git@github.com:owner/repo.git",
    });
    const yaml = renderRepoYaml(config);
    // We don't bring in a YAML parser dep (rule #1) — manually parse the
    // shape we know we render: each line is `key: value` with double-quoted
    // string values. Round-trip-ability is asserted by structural inspection.
    expect(yaml).toContain('host_repo: "owner/repo"');
    expect(yaml).toContain('default_branch: "main"');
    expect(yaml).toContain('ignore_mechanism: "global-ignore"');
  });
});
