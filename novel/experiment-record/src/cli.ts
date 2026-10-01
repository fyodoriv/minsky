#!/usr/bin/env node
// no-test: thin CLI wrapper — all behavior tested via validate.test.ts (the underlying validator) + record.test.ts; cli.ts is just "parse argv, call validate, print result"
/**
 * `experiment-record validate <path>` — exit 0 on valid, non-zero on invalid.
 *
 * Pattern: command-line application as a thin shell over the parser.
 * Conformance: full (no business logic in the CLI; it is the I/O boundary).
 */

import { readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";

import { parse } from "./parse.js";

function usage(): void {
  stderr.write("usage: experiment-record validate <path-to-EXPERIMENT.yaml>\n");
}

function readOrFail(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
    // rule-6: handled-locally — CLI boundary; bad file path is operator error not system fault
  } catch (e) {
    stderr.write(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}\n`);
    return null;
  }
}

function reportErrors(path: string, errors: ReturnType<typeof parse> & { ok: false }): void {
  for (const err of errors.errors) {
    const loc = err.line !== undefined ? `:${err.line}` : "";
    const field = err.field !== undefined ? ` (${err.field})` : "";
    stderr.write(`${path}${loc}: ${err.kind}${field}: ${err.message}\n`);
  }
}

function main(): number {
  const [, , cmd, ...args] = argv;
  const path = args[0];
  if (cmd !== "validate" || args.length !== 1 || path === undefined) {
    usage();
    return 2;
  }

  const raw = readOrFail(path);
  if (raw === null) return 2;

  const result = parse(raw);
  if (result.ok) {
    stdout.write(`${path}: valid (id=${result.record.id})\n`);
    return 0;
  }
  reportErrors(path, result);
  return 1;
}

exit(main());
