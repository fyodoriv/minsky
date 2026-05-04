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
      "@minsky/observability": r("./novel/adapters/observability/src/index.ts"),
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
      include: ["novel/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
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
