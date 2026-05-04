// Tests for the repo-config loader.

import { describe, expect, test } from "vitest";

import { loadRepoConfig, parseFlatYaml } from "./repo-config-loader.js";

const sidecarBootstrapRendered = `# .minsky/repo.yaml — per-host overlay for the cross-repo-runner.
# This file is gitignored from the host's git history (decision A2).
# Edit values here to match your host repo's actual conventions.

host_repo: "owner/repo"
tasks_md_path: "TASKS.md"
commit_format: "<TYPE>: <DESCRIPTION>"
pre_commit_command: "yarn lint"
branch_prefix: "feat/"
default_branch: "main"
ticket_format: null
host_packages_path: "src/"
ignore_mechanism: "global-ignore"
lint_substrate_overrides:
  {}
`;

describe("parseFlatYaml — sidecar-bootstrap shape", () => {
  test("parses each top-level key as a string", () => {
    const parsed = parseFlatYaml(sidecarBootstrapRendered);
    expect(parsed["host_repo"]).toBe("owner/repo");
    expect(parsed["tasks_md_path"]).toBe("TASKS.md");
  });

  test("ticket_format: null parses to null", () => {
    const parsed = parseFlatYaml(sidecarBootstrapRendered);
    expect(parsed["ticket_format"]).toBeNull();
  });

  test("empty {} map parses to {}", () => {
    const parsed = parseFlatYaml(sidecarBootstrapRendered);
    expect(parsed["lint_substrate_overrides"]).toEqual({});
  });

  test("nested-map keys parse with their values", () => {
    const yaml = `lint_substrate_overrides:
  rule-6-let-it-crash: "yarn lint"
  rule-2-dep-coverage: "skip"
`;
    const parsed = parseFlatYaml(yaml);
    const overrides = parsed["lint_substrate_overrides"] as Record<string, string>;
    expect(overrides["rule-6-let-it-crash"]).toBe("yarn lint");
    expect(overrides["rule-2-dep-coverage"]).toBe("skip");
  });

  test("comments and blank lines are skipped", () => {
    const yaml = `# top comment

host_repo: "x/y"

# trailing comment
default_branch: "master"
`;
    const parsed = parseFlatYaml(yaml);
    expect(parsed["host_repo"]).toBe("x/y");
    expect(parsed["default_branch"]).toBe("master");
  });
});

describe("loadRepoConfig — end-to-end (parse + validate)", () => {
  test("a valid sidecar-bootstrap rendering loads cleanly", () => {
    const result = loadRepoConfig(sidecarBootstrapRendered);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.host_repo).toBe("owner/repo");
    expect(result.config.ignore_mechanism).toBe("global-ignore");
  });

  test("a missing required field is reported", () => {
    const yaml = `host_repo: "owner/repo"
tasks_md_path: "TASKS.md"
commit_format: "<TYPE>: <DESCRIPTION>"
pre_commit_command: ""
branch_prefix: "feat/"
host_packages_path: "src/"
ignore_mechanism: "global-ignore"
lint_substrate_overrides:
  {}
`; // missing default_branch
    const result = loadRepoConfig(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "default_branch")).toBe(true);
  });
});
