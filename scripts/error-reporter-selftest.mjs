#!/usr/bin/env node
// @ts-check
// CLI self-test for the ErrorReporter adapter (task `obs-error-capture-and-
// reporter`). Exits 0 when the default (file) strategy round-trips a probe
// error, 1 otherwise. The adapter lives in `scripts/lib/error-reporter.mjs`
// (not a built workspace package), so this replaces the `dist/selftest.js`
// the task originally named — for stability + zero new monorepo deps.
import { selfTestFileReporter } from "./lib/error-reporter.mjs";

async function main() {
  const ok = await selfTestFileReporter();
  process.stdout.write(ok ? "error-reporter selftest: ok\n" : "error-reporter selftest: FAIL\n");
  process.exit(ok ? 0 : 1);
}

main();
