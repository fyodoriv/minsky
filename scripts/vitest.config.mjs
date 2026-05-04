// Local vitest config for scripts/*.test.mjs.
//
// The repo-root `vitest.config.ts` scopes `include` to `novel/**/src/**/*.test.ts`
// (so workspace coverage thresholds apply only to package source). The
// `scripts/` checkers are framework-y CLI helpers, not workspace packages,
// and have their own narrow test surface — so they get their own config.
//
// Usage: `pnpm exec vitest run --config scripts/vitest.config.mjs`
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["scripts/**/*.test.mjs"],
  },
});
