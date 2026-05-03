/**
 * `@minsky/budget-guard` — flag-file envelope. Renders a {@link BudgetDecision}
 * as a single-word token and writes it atomically to
 * `${MINSKY_HOME}/.minsky/budget.flag` so shell consumers can `cat` the file.
 *
 * Pattern conformance (rule #8):
 *   - Atomic write: tmp-file + `rename(2)` is POSIX's documented atomic-replace
 *     idiom. Same pattern as `setup.sh`'s lock file dance and observed in
 *     standard "write file atomically" recipes (e.g., Python's
 *     `os.replace` docs). Conformance: full.
 *
 * Path deviation: original task brief specified `/var/run/minsky/budget.flag`
 * which would require root. v0 uses `${MINSKY_HOME}/.minsky/` instead — declared
 * in `vision.md` § "Pattern conformance index" row 26 and the package README.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BudgetDecision } from "./index.js";

export type FlagToken = "NORMAL" | "THROTTLE" | "PAUSE" | "WEEKLY_WARN";

const ACTION_TO_TOKEN: Record<BudgetDecision["action"], FlagToken> = {
  normal: "NORMAL",
  "graceful-degrade": "THROTTLE",
  "circuit-break-and-notify": "PAUSE",
  "weekly-cap-warn": "WEEKLY_WARN",
};

export function decisionToFlagToken(decision: BudgetDecision): FlagToken {
  return ACTION_TO_TOKEN[decision.action];
}

/** Resolve the canonical flag-file path under a given Minsky home directory. */
export function flagFilePath(minskyHome: string): string {
  return join(minskyHome, ".minsky", "budget.flag");
}

/**
 * Atomically write the decision's flag token to `${minskyHome}/.minsky/budget.flag`.
 *
 * Atomicity: write to a sibling `.budget.flag.tmp.<pid>.<rand>` then `rename`
 * over the destination. POSIX guarantees `rename(2)` is atomic within a single
 * filesystem, so a concurrent reader sees either the old contents or the new —
 * never partial.
 *
 * The directory is created with `recursive: true` if it does not already exist;
 * subsequent writes are a no-op for the mkdir (idempotent per Node docs).
 */
export async function writeBudgetFlag(decision: BudgetDecision, minskyHome: string): Promise<void> {
  const dir = join(minskyHome, ".minsky");
  await mkdir(dir, { recursive: true });

  const final = join(dir, "budget.flag");
  const tmp = join(dir, `.budget.flag.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`);

  const token = decisionToFlagToken(decision);
  await writeFile(tmp, `${token}\n`, { encoding: "utf8", mode: 0o644 });
  await rename(tmp, final);
}
