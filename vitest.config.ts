import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Resolve workspace package names to source TS so vitest doesn't need a
  // pre-build step in CI. Each `@minsky/<name>` → `novel/.../<name>/src/index.ts`.
  // Production consumers import from `dist/` per each package.json's `main`;
  // this alias is dev / CI only.
  resolve: {
    alias: {
      "@minsky/adapter-types": r("./novel/adapters/types/src/index.ts"),
      "@minsky/agent-runtime-openhands": r("./novel/adapters/agent-runtime-openhands/src/index.ts"),
      "@minsky/observability": r("./novel/adapters/observability/src/index.ts"),
      "@minsky/prompt-optimizer": r("./novel/adapters/prompt-optimizer/src/index.ts"),
      "@minsky/token-monitor": r("./novel/adapters/token-monitor/src/index.ts"),
      "@minsky/competitive-benchmark": r("./novel/competitive-benchmark/src/index.ts"),
      "@minsky/dashboard-web": r("./novel/dashboard-web/src/index.ts"),
      "@minsky/experiment-record": r("./novel/experiment-record/src/index.ts"),
      "@minsky/handoff-spec": r("./novel/handoff-spec/src/index.ts"),
      "@minsky/mape-k-loop": r("./novel/mape-k-loop/src/index.ts"),
      "@minsky/notifier": r("./novel/adapters/notifier/src/index.ts"),
      "@minsky/observer-heals": r("./novel/observer/heals/src/index.ts"),
      "@minsky/omc-tasksmd-bridge": r("./novel/bridges/omc-tasksmd/src/index.ts"),
    },
  },
  test: {
    globals: false,
    // The local merge-gate vets PRs in a scratch clone while the worker
    // daemon + orchestrator run concurrently — the host is routinely 2-3x
    // oversubscribed (load ~25 on 10 cores). Under that contention a
    // timing-sensitive test can flake, which previously failed the gate's
    // `vitest` step and made the conductor SKIP an otherwise-green PR
    // (the residual merge-rate-0 tail after #590/#592/#593). Retry
    // distinguishes a load flake (fails then passes) from a real failure
    // (fails every attempt) — Fowler 2011 "Eradicating Non-Determinism in
    // Tests".
    // retry: 2 masks flaky tests. Target: 0 once all tests are deterministic.
    // Current justification: vitest under host oversubscription (daemon +
    // multiple agents) produces timing flakes on slow tests. Integration
    // tests use cleanEnv() + mkdtemp isolation to prevent state leaks.
    // Track: when retry:0 produces 100% green over 7d CI, remove the retry.
    retry: 2,
    include: [
      "novel/**/src/**/*.test.ts",
      "novel/**/test/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "user-stories/**/*.test.ts",
      "test/**/*.test.ts",
      "distribution/shortcuts/test/**/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      all: true,
      // Coverage thresholds apply to novel/ packages only — that is where
      // the constitutional 90 %/85 % discipline lives. Scripts under
      // scripts/ are CI lints (rule #10): their correctness is enforced by
      // their paired test files plus the lint's own exit-code contract,
      // not by a coverage gate over a single .mjs file.
      include: ["novel/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.mjs", "**/*.d.ts"],
      reporter: process.env["CI"] ? ["text", "lcov", "json-summary"] : ["text"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
