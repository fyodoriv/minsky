import { defineConfig } from "vitest/config";

// Vitest config scoped to the `scripts/` directory. The repo-root
// `vitest.config.ts` covers `novel/**/src/**` only; CI scripts live under
// `scripts/` and need their own include glob. Invoked explicitly from CI:
//   pnpm exec vitest run --config scripts/vitest.config.mjs
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs"],
  },
});
