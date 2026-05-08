#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved experiment-record-bin-checked-in (operator 2026-05-08 — "also on pnpm install it had a warning that it failed to create bin in experimental-record") -->

/**
 * `experiment-record validate <path>` — exit 0 on valid, non-zero on invalid.
 *
 * Checked-in launcher (mirrors `bin/minsky.mjs` from slice 8 of
 * `minsky-cli-fresh-clone-bootstrap`). Replaces the previous
 * `bin: "./dist/cli.js"` package.json field, which made `pnpm install`
 * emit `WARN Failed to create bin at .../experiment-record. ENOENT`
 * because `dist/` is gitignored and not yet built when pnpm tries to
 * symlink the bin during install. Now `bin` points at THIS file
 * (checked into git), pnpm's symlink creation succeeds on the first
 * `pnpm install`, and the dist-existence check below catches the
 * still-missing-dist case at runtime.
 *
 * The validation logic itself stays in `src/cli.ts` (which compiles to
 * `dist/cli.js`) — that's the source of truth + the test target. This
 * launcher is a thin shim that:
 *
 *   1. Pre-flight check that `dist/index.js` exists (slice 8 pattern).
 *   2. Dynamic-imports `parse` from `dist/index.js` (top-level await
 *      defers resolution until after the existsSync check).
 *   3. Runs the same validate-or-error CLI flow as `src/cli.ts`'s
 *      `main()` function.
 *
 * Pattern conformance: same as `bin/minsky.mjs` (Pre-condition check —
 * Meyer 1992; Loud-crash boundary — Armstrong 2007).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const DIST_INDEX_PATH = resolve(PKG_ROOT, "dist", "index.js");

if (!existsSync(DIST_INDEX_PATH)) {
  process.stderr.write(
    `experiment-record: dist not built (${DIST_INDEX_PATH} missing) — run \`pnpm install\` from the repo root, or \`pnpm --filter @minsky/experiment-record build\` directly\n`,
  );
  process.exit(1);
}

const { parse } = await import("../dist/index.js");

function usage() {
  process.stderr.write("usage: experiment-record validate <path-to-EXPERIMENT.yaml>\n");
}

function readOrFail(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    process.stderr.write(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}\n`);
    return null;
  }
}

const [, , cmd, ...args] = process.argv;
const path = args[0];
if (cmd !== "validate" || args.length !== 1 || path === undefined) {
  usage();
  process.exit(2);
}

const raw = readOrFail(path);
if (raw === null) process.exit(2);

const result = parse(raw);
if (result.ok) {
  process.stdout.write(`${path}: valid (id=${result.record.id})\n`);
  process.exit(0);
}

for (const err of result.errors) {
  const loc = err.line !== undefined ? `:${err.line}` : "";
  const field = err.field !== undefined ? ` (${err.field})` : "";
  process.stderr.write(`${path}${loc}: ${err.kind}${field}: ${err.message}\n`);
}
process.exit(1);
