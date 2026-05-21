// Tests for the spawn-plan builder. xUnit paired fixtures (Meszaros 2007).

import type { RepoConfig } from "@minsky/sidecar-bootstrap";
import { describe, expect, test } from "vitest";

import { buildSpawnPlan } from "./spawn-plan.js";
import type { ParsedTask } from "./task-finder.js";

const baseConfig: RepoConfig = {
  host_repo: "owner/repo",
  tasks_md_path: "TASKS.md",
  commit_format: "<TYPE>: <DESCRIPTION>",
  pre_commit_command: "yarn lint",
  branch_prefix: "feat/",
  default_branch: "main",
  ticket_format: null,
  lint_substrate_overrides: {},
  host_packages_path: "src/",
  ignore_mechanism: "global-ignore",
};

const baseTask: ParsedTask = {
  id: "aifn-840-slash-command-labels",
  title: "Fix the slash command labels AIFN-840",
  priority: "P0",
  tags: ["bug"],
  details: "Replace lowercase title strings.",
  hypothesis: "Replacing X with Y closes the gap.",
  success: ">= 10 percent",
  pivot: "< 5 percent",
  measurement: "yarn vitest run plugins/iep-ai-native",
  anchor: "rule #9; vision.md § 9",
};

describe("buildSpawnPlan", () => {
  test("workingDirectory is the host root", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.workingDirectory).toBe("/host");
  });

  test("branchName is `<branch_prefix><task-id>`", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.branchName).toBe("feat/aifn-840-slash-command-labels");
  });

  test("experimentYamlPath is at <host>/.minsky/experiments/<id>.yaml", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.experimentYamlPath).toBe(
      "/host/.minsky/experiments/aifn-840-slash-command-labels.yaml",
    );
  });

  test("env contains MINSKY_HOST_ROOT pointing at <host>/.minsky", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.env["MINSKY_HOST_ROOT"]).toBe("/host/.minsky");
  });

  test("env contains MINSKY_TASK_ID and MINSKY_BRANCH_NAME", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.env["MINSKY_TASK_ID"]).toBe("aifn-840-slash-command-labels");
    expect(plan.env["MINSKY_BRANCH_NAME"]).toBe("feat/aifn-840-slash-command-labels");
  });

  test("system-prompt overlay references the vision.md path", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.systemPromptOverlay).toContain("/minsky/vision.md");
    expect(plan.systemPromptOverlay).toContain("Hypothesis self-grade");
    expect(plan.systemPromptOverlay).toContain("rule #9");
  });

  test("system-prompt overlay includes pre_commit_command when set", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.systemPromptOverlay).toContain("yarn lint");
  });

  test("system-prompt overlay falls back to host's pre-commit hooks when pre_commit_command is empty", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: { ...baseConfig, pre_commit_command: "" },
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.systemPromptOverlay).toContain("host's pre-commit hooks");
  });

  test("brief contains the task's title, hypothesis, success, pivot, measurement, anchor", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.brief).toContain(baseTask.title);
    expect(plan.brief).toContain(baseTask.hypothesis as string);
    expect(plan.brief).toContain(baseTask.success as string);
    expect(plan.brief).toContain(baseTask.pivot as string);
    expect(plan.brief).toContain(baseTask.measurement as string);
    expect(plan.brief).toContain(baseTask.anchor as string);
  });

  test("preCommitCommand passed through verbatim", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: { ...baseConfig, pre_commit_command: "pnpm run check" },
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.preCommitCommand).toBe("pnpm run check");
  });

  test("brief includes system-prompt overlay with PR creation instructions", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/minsky/vision.md",
    });
    expect(plan.brief).toContain("FINAL STEP");
    expect(plan.brief).toContain("gh pr create");
    expect(plan.brief).toContain("git push");
  });

  test("brief uses fallback visionMdPath when not provided in overlay", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: baseTask,
      visionMdPath: "/custom/path/vision.md",
    });
    // The overlay in the brief falls back to .minsky/vision.md
    // but systemPromptOverlay uses the provided path
    expect(plan.systemPromptOverlay).toContain("/custom/path/vision.md");
    expect(plan.brief).toContain(".minsky/vision.md");
  });

  test("task with null optional fields renders without crashing", () => {
    const sparseTask: ParsedTask = {
      id: "sparse-task",
      title: "Minimal task",
      priority: "P1",
      tags: [],
      details: null,
      hypothesis: null,
      success: null,
      pivot: null,
      measurement: null,
      anchor: null,
    };
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: sparseTask,
      visionMdPath: "/v.md",
    });
    expect(plan.brief).toContain("Minimal task");
    expect(plan.taskId).toBe("sparse-task");
    // Should not contain "null" as a string
    expect(plan.brief).not.toContain("null");
  });

  test("task with empty tags renders without Tags line", () => {
    const noTagsTask: ParsedTask = {
      ...baseTask,
      id: "no-tags",
      tags: [],
    };
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: noTagsTask,
      visionMdPath: "/v.md",
    });
    expect(plan.brief).not.toContain("Tags:");
  });

  test("task with tags renders Tags line", () => {
    const plan = buildSpawnPlan({
      hostRoot: "/host",
      config: baseConfig,
      task: { ...baseTask, tags: ["p0", "reliability"] },
      visionMdPath: "/v.md",
    });
    expect(plan.brief).toContain("Tags: p0, reliability");
  });
});
