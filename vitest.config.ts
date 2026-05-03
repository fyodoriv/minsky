import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["novel/**/src/**/*.test.ts"],
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
