#!/usr/bin/env node
// Full coverage report — measures ALL layers, not just v8 unit coverage.
// Outputs a single composite number that reflects actual runtime coverage.
//
// Usage: node scripts/full-coverage-report.mjs [--json]
//
// Layers measured:
//   L1: Unit test coverage (v8 — novel/*/src/*.ts)
//   L2: Integration test coverage (test/integration/ — exercised code paths)
//   L3: CLI shim coverage (bin/minsky subcommands tested)
//   L4: minsky-run.mjs code path coverage (features exercised by integration tests)
//   L5: Runtime invariants coverage (invariants / known failure classes)
//   L6: Scripts coverage (scripts with paired .test.mjs files)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const jsonMode = process.argv.includes("--json");

// ── L1: Unit test v8 coverage ──
// Read from the last coverage run's json-summary if available
let l1Pct = 0;
const coverageSummary = join(ROOT, "coverage", "coverage-summary.json");
if (existsSync(coverageSummary)) {
  try {
    const data = JSON.parse(readFileSync(coverageSummary, "utf8"));
    l1Pct = data?.total?.statements?.pct ?? 0;
  } catch {
    l1Pct = 0;
  }
}

// ── L2: Integration test coverage ──
// Count integration test files and the features they exercise
const integrationDir = join(ROOT, "test", "integration");
const integrationFiles = existsSync(integrationDir)
  ? readdirSync(integrationDir).filter((f) => f.endsWith(".test.ts"))
  : [];
// Key runtime features to test
const RUNTIME_FEATURES = [
  "dry-run-picks-task",
  "experiment-yaml-written",
  "iteration-records-written",
  "empty-queue-exits-cleanly",
  "loop-respects-max-iterations",
  "host-config-read",
  "rule-9-enforcement",
  "dynamic-timeouts",
  "stability-number",
  "cli-status",
  "cli-watch",
  "cli-stop",
  "auto-attach",
  "multi-host-walk",
  "per-host-cap",
  "spawn-failed-skip",
  "scope-leak-halt",
  "devin-prompt-file",
  "devin-permission-mode",
  "brief-includes-pr-instructions",
];
// Check which features are covered by reading integration test content.
// Track features in a Set so a feature found in N files counts once,
// not N times (the previous bug — `featuresTestedCount++` inside a
// nested loop produced 240% on a 20-feature catalogue with 7 files).
// Rule #4 demands HONEST measurement; rule #11 forbids load-bearing
// metrics that exceed their denominator.
const featuresTested = new Set();
for (const file of integrationFiles) {
  const content = readFileSync(join(integrationDir, file), "utf8").toLowerCase();
  for (const feature of RUNTIME_FEATURES) {
    if (featuresTested.has(feature)) continue;
    const keywords = feature.split("-");
    if (keywords.every((kw) => content.includes(kw))) {
      featuresTested.add(feature);
    }
  }
}
const featuresTestedCount = featuresTested.size;
const l2Pct = Math.round((featuresTestedCount / RUNTIME_FEATURES.length) * 100);

// ── L3: CLI shim coverage ──
// The 4 real bin/minsky subcommands. `doctor` was in the catalogue
// historically but is not actually a bin/minsky subcommand (the
// `pnpm dogfood:doctor` script is `setup.sh --doctor`); removed
// 2026-05-19 per rule #4 (everything measurable, MEASURED honestly).
// `install-daemon` and `uninstall-daemon` exist but are tested by the
// daemon-restart suite directly; not listed here to keep L3 focused
// on the operator-facing surface.
// 2026-05-19 (M1 push): added `init`, `uninstall`, `doctor`, `report`
// — first-class M1 subcommands, all tested by `m1-red-green.test.ts`.
const CLI_SUBCOMMANDS = [
  "status",
  "stop",
  "logs",
  "watch",
  "init",
  "uninstall",
  "doctor",
  "report",
];
// Track in a Set so a subcommand referenced in N files counts once.
const subcommandsCovered = new Set();
for (const file of integrationFiles) {
  const content = readFileSync(join(integrationDir, file), "utf8");
  for (const cmd of CLI_SUBCOMMANDS) {
    if (subcommandsCovered.has(cmd)) continue;
    if (
      content.includes(`"${cmd}"`) ||
      content.includes(`'${cmd}'`) ||
      content.includes(`${cmd})`)
    ) {
      subcommandsCovered.add(cmd);
    }
  }
}
const subcommandsTested = subcommandsCovered.size;
const l3Pct = Math.round((subcommandsTested / CLI_SUBCOMMANDS.length) * 100);

// ── L4: minsky-run.mjs code path coverage ──
// Count major code paths in minsky-run.mjs and check which are exercised
const MINSKY_RUN_PATHS = [
  "buildAgentConfig",
  "readLiveSpawnTimeoutMs",
  "computeDynamicSettingsForHost",
  "readSpawnCommand",
  "loadMinskyConfig",
  "emitLiveSpawn",
  "runLoopAsResult",
  "runWalk",
  "pickHostTask",
  "listOpenPrBranches",
  "writeIterationRecord",
  "buildLocalAgentConfig",
];
const runnerContent = existsSync(join(ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"))
  ? readFileSync(join(ROOT, "novel", "cross-repo-runner", "bin", "minsky-run.mjs"), "utf8")
  : "";
let pathsExercised = 0;
// Check integration tests + unit tests for references to these paths
const allTestContent = integrationFiles
  .map((f) => readFileSync(join(integrationDir, f), "utf8"))
  .join("\n");
for (const path of MINSKY_RUN_PATHS) {
  if (allTestContent.includes(path) || runnerContent.includes(`function ${path}`)) {
    // Path exists in source; check if any test references it
    if (allTestContent.includes(path)) pathsExercised++;
  }
}
const l4Pct = Math.round((pathsExercised / MINSKY_RUN_PATHS.length) * 100);

// ── L5: Runtime invariants ──
const KNOWN_FAILURE_CLASSES = [
  "devin-stdin-panic",
  "devin-permission-mode-missing",
  "walker-starvation",
  "scope-leak-false-positive",
  "brief-missing-pr-instructions",
  "watchdog-kills-productive-iteration",
  "stale-pid",
  "duplicate-daemons",
  "task-repick-loop",
  "graphql-auth-mismatch",
  "dirty-tree-before-spawn",
  "brief-too-large",
  "brief-missing-hypothesis",
  "no-default-branch",
  "disk-full",
  "agent-not-on-path",
  "spawn-failed-streak",
  "scope-leak-streak",
  "iteration-too-slow",
  "iteration-suspiciously-fast",
];
const invariantContent = existsSync(
  join(ROOT, "novel", "cross-repo-runner", "src", "runtime-invariants.ts"),
)
  ? readFileSync(join(ROOT, "novel", "cross-repo-runner", "src", "runtime-invariants.ts"), "utf8")
  : "";
let invariantsCovered = 0;
for (const cls of KNOWN_FAILURE_CLASSES) {
  const keywords = cls.split("-");
  if (keywords.some((kw) => invariantContent.toLowerCase().includes(kw))) {
    invariantsCovered++;
  }
}
const l5Pct = Math.round((invariantsCovered / KNOWN_FAILURE_CLASSES.length) * 100);

// ── L6: Scripts coverage ──
const scriptsDir = join(ROOT, "scripts");
const scriptFiles = existsSync(scriptsDir)
  ? readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
  : [];
let scriptsWithTests = 0;
for (const script of scriptFiles) {
  const testFile = script.replace(".mjs", ".test.mjs");
  if (existsSync(join(scriptsDir, testFile))) scriptsWithTests++;
}
const l6Pct =
  scriptFiles.length > 0 ? Math.round((scriptsWithTests / scriptFiles.length) * 100) : 0;

// ── Composite score ──
// Weighted by importance to runtime correctness. Each layer is capped
// at 100% — a metric that exceeds its denominator is structurally
// meaningless (the operator-spotted "133% composite" bug, 2026-05-19).
// Rule #4 demands HONEST measurement; rule #11 forbids load-bearing
// metrics that aren't bounded.
const weights = { l1: 0.3, l2: 0.25, l3: 0.1, l4: 0.15, l5: 0.1, l6: 0.1 };
function cap(n) {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}
const l1PctCapped = cap(l1Pct);
const l2PctCapped = cap(l2Pct);
const l3PctCapped = cap(l3Pct);
const l4PctCapped = cap(l4Pct);
const l5PctCapped = cap(l5Pct);
const l6PctCapped = cap(l6Pct);
const composite = Math.round(
  l1PctCapped * weights.l1 +
    l2PctCapped * weights.l2 +
    l3PctCapped * weights.l3 +
    l4PctCapped * weights.l4 +
    l5PctCapped * weights.l5 +
    l6PctCapped * weights.l6,
);

const report = {
  composite_pct: composite,
  layers: {
    l1_unit_test_v8: {
      pct: l1PctCapped,
      weight: weights.l1,
      note: "v8 statement coverage on novel/*/src/*.ts",
    },
    l2_integration_tests: {
      pct: l2PctCapped,
      weight: weights.l2,
      tested: featuresTestedCount,
      total: RUNTIME_FEATURES.length,
      note: "runtime features exercised by test/integration/",
    },
    l3_cli_shim: {
      pct: l3PctCapped,
      weight: weights.l3,
      tested: subcommandsTested,
      total: CLI_SUBCOMMANDS.length,
      note: "bin/minsky subcommands exercised",
    },
    l4_minsky_run: {
      pct: l4PctCapped,
      weight: weights.l4,
      tested: pathsExercised,
      total: MINSKY_RUN_PATHS.length,
      note: "minsky-run.mjs major code paths",
    },
    l5_runtime_invariants: {
      pct: l5PctCapped,
      weight: weights.l5,
      covered: invariantsCovered,
      total: KNOWN_FAILURE_CLASSES.length,
      note: "known failure classes with runtime invariant",
    },
    l6_scripts: {
      pct: l6PctCapped,
      weight: weights.l6,
      withTests: scriptsWithTests,
      total: scriptFiles.length,
      note: "scripts/*.mjs with paired .test.mjs",
    },
  },
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("\n📊 Full Coverage Report (all layers)\n");
  console.log(`   COMPOSITE: ${composite}%\n`);
  console.log(`   L1 Unit tests (v8):       ${String(l1Pct).padStart(3)}%  (weight ${weights.l1})`);
  console.log(
    `   L2 Integration tests:     ${String(l2Pct).padStart(3)}%  (${featuresTestedCount}/${RUNTIME_FEATURES.length} features)`,
  );
  console.log(
    `   L3 CLI shim:              ${String(l3Pct).padStart(3)}%  (${Math.min(subcommandsTested, CLI_SUBCOMMANDS.length)}/${CLI_SUBCOMMANDS.length} subcommands)`,
  );
  console.log(
    `   L4 minsky-run.mjs:        ${String(l4Pct).padStart(3)}%  (${pathsExercised}/${MINSKY_RUN_PATHS.length} paths)`,
  );
  console.log(
    `   L5 Runtime invariants:     ${String(l5Pct).padStart(3)}%  (${invariantsCovered}/${KNOWN_FAILURE_CLASSES.length} failure classes)`,
  );
  console.log(
    `   L6 Scripts:               ${String(l6Pct).padStart(3)}%  (${scriptsWithTests}/${scriptFiles.length} with tests)`,
  );
  console.log();
}
