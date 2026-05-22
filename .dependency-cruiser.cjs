/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "warn",
      comment:
        "Circular module dependencies make a codebase harder to test, harder to reason about, and increase the blast radius of any single-file edit. Initial install: WARN. Once the existing cycle count is enumerated in TASKS.md and drained, this graduates to ERROR per the rule-#10 ratchet.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Orphan modules (no incoming dependencies) are usually dead code or missing entry points. Most of Minsky's intentional orphans are CLI scripts that bin/* invokes via shell, so this rule is at WARN. Knip is the primary dead-code detector; depcruise's orphan check is a cross-validation.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "[.]d[.]ts$",
          "(^|/)tsconfig[.]json$",
          "(^|/)(babel|webpack)[.]config[.](js|cjs|mjs|ts)$",
          "/dist/",
          "/node_modules/",
          ".test.(ts|tsx|mts|js|jsx|mjs)$",
          "scripts/.*[.]test[.]mjs$",
          ".minsky/",
          ".worktrees/",
          ".obsidian/",
          ".claude/",
          "/fixtures/",
          "scripts/lib/.*[.]test[.]mjs$",
          "scripts/.*[.]mjs$",
          "user-stories/",
          "test/integration/",
        ],
      },
      to: {},
    },
    {
      name: "no-dep-on-test",
      severity: "error",
      comment:
        "Production source must never import from a test file. Same shape as eslint-plugin-import's no-test-in-prod rule.",
      from: {
        pathNot: [".test.(ts|tsx|mts|js|jsx|mjs)$", "test/", "/fixtures/"],
      },
      to: {
        path: [".test.(ts|tsx|mts|js|jsx|mjs)$"],
      },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment:
        "Don't allow dependencies that aren't declared in package.json. Catches phantom dependencies (transitive imports that work today but break when the lockfile changes).",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
    {
      name: "not-to-deprecated",
      severity: "warn",
      comment:
        "Imports of deprecated npm packages surface as warnings. Helps catch when a transitive dep deprecates upstream.",
      from: {},
      to: {
        dependencyTypes: ["deprecated"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        "node_modules",
        "(^|/)dist/",
        "(^|/)[.]minsky/",
        "(^|/)[.]worktrees/",
        "(^|/)[.]obsidian/",
        "(^|/)[.]claude/",
        "(^|/)fixtures/",
        "[.]d[.]ts$",
        "[.]test[.](ts|mts|mjs)$",
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
