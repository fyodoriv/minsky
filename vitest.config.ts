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
      "@minsky/observability": r("./novel/adapters/observability/src/index.ts"),
      "@minsky/prompt-optimizer": r("./novel/adapters/prompt-optimizer/src/index.ts"),
      "@minsky/token-monitor": r("./novel/adapters/token-monitor/src/index.ts"),
      "@minsky/budget-guard": r("./novel/budget-guard/src/index.ts"),
      "@minsky/experiment-record": r("./novel/experiment-record/src/index.ts"),
      "@minsky/handoff-spec": r("./novel/handoff-spec/src/index.ts"),
    },
  },
  test: {
    globals: false,
    include: ["novel/**/src/**/*.test.ts", "scripts/**/*.test.mjs"],
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
