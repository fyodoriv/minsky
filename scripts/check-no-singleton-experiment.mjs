#!/usr/bin/env node
// Pattern: deterministic CI ratchet — once-only migration enforcement.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; the ratchet
//   rule says when an advisory or transitional state is replaced by a new
//   structural answer, the old state cannot quietly come back); rule #1
//   (vision.md § 1 — don't reinvent: the singleton EXPERIMENT.yaml shape
//   was retired in favour of plural `experiments/<id>.yaml` per
//   `experiments-directory-migration`).
// Conformance: full — pure shape check on the filesystem at the repo root,
//   no LLM in the chain.
//
// Why this gate exists: `experiments-directory-migration` (closes the
// singleton-experiment gap that forced serial-experimentation in
// minsky-on-itself) deletes `EXPERIMENT.yaml` from the repo root and
// adopts `experiments/*.yaml` instead. A future PR could accidentally
// re-introduce the singleton — either by reverting the migration commit,
// by an OS file-recovery operation, or by an operator typing
// `vim EXPERIMENT.yaml` out of habit. This lint is the structural
// guarantee that the migration is one-way.
//
// The lint is strict — there is no opt-out comment. Restoring the
// singleton requires *retiring* the rule (a deliberate decision recorded
// in `vision.md` § Pattern conformance index, not a workaround).
//
// Exit codes:
//   0 — `EXPERIMENT.yaml` does not exist at the repo root.
//   1 — `EXPERIMENT.yaml` exists at the repo root; migrate it to
//       `experiments/<id>.yaml` (where `<id>` matches the file's `id:`
//       field) and remove it from the root.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SINGLETON_PATH = resolve(REPO_ROOT, "EXPERIMENT.yaml");

/**
 * Pure check: does the singleton path exist?
 *
 * @param {(path: string) => boolean} fileExists
 * @param {string} singletonPath
 * @returns {{ ok: true } | { ok: false, path: string }}
 */
export function checkNoSingletonExperiment(fileExists, singletonPath) {
  if (fileExists(singletonPath)) return { ok: false, path: singletonPath };
  return { ok: true };
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-no-singleton-experiment.mjs");
if (invokedDirectly) {
  const result = checkNoSingletonExperiment(existsSync, SINGLETON_PATH);
  if (result.ok) {
    process.stdout.write(
      "no-singleton-experiment ok: EXPERIMENT.yaml does not exist at the repo root (per experiments-directory-migration).\n",
    );
    process.exit(0);
  }
  process.stderr.write(
    `no-singleton-experiment violation:\n  - EXPERIMENT.yaml found at ${result.path}\n  - Per experiments-directory-migration (vision.md § Pattern conformance index), the singleton was retired.\n  - Migrate the file to experiments/<id>.yaml (where <id> matches the file's id: field) and remove it from the repo root.\n`,
  );
  process.exit(1);
}
