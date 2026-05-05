// <!-- scope: human-approved 2026-05-05 user request "implement a meaningful changelog for humans … as a part of the minsky loop." (acceptance criterion (3): "I/O wrapper fires daily" — CLI-side construction so the production supervisor actually injects the seam) -->
/**
 * `@minsky/tick-loop/changelog-cli-wiring` — CLI-side construction of the
 * `ChangelogSeam` `runDaemon` dispatches into. Twin of `cto-audit-cli-wiring`:
 * the bin script (`bin/tick-loop.mjs`) is the I/O boundary; this module is
 * the smallest unit-testable surface above it.
 *
 * One primitive:
 *   - `createFileBackedChangelogReader(path)` — returns a `ReadChangelog` that
 *     reads CHANGELOG.md and graceful-degrades ENOENT to `""` so a fresh
 *     checkout pre-genesis still fires the runner (the runner authors the
 *     genesis entry — rule #7 graceful-degrade on resource-absent).
 *
 * Pattern (rule #2): pure factory above the file-system primitive. The
 * `ReadChangelog` type lives in `changelog-runner.ts` so this module only
 * supplies the I/O implementation; tests drive a temp-dir CHANGELOG.md.
 *
 * Pivot (rule #9): if ENOENT-as-empty masks a real misconfiguration (the
 * operator points at a missing CHANGELOG.md and the daemon silently fires
 * the genesis runner every iteration), tighten to require the file present
 * AND let-it-crash on any other read error. Don't retire the empty-on-ENOENT
 * contract — a brand-new repo legitimately has no CHANGELOG.md yet.
 *
 * @module tick-loop/changelog-cli-wiring
 */

import { readFileSync } from "node:fs";

import type { ReadChangelog } from "./changelog-runner.js";

/**
 * Build a `ReadChangelog` that reads the file at `path` synchronously and
 * returns `""` when the file does not exist (ENOENT). All other errors
 * propagate so the supervisor (`Restart=on-failure`) sees them — rule #6
 * let-it-crash at the right boundary.
 *
 * The returned function captures `path` so the daemon can call it every
 * tick without re-resolving. Synchronous read is intentional: CHANGELOG.md
 * is bounded (one section per day) and the daemon already does sync reads
 * for `tasksMdReader` — staying consistent with the existing I/O shape.
 *
 * @otel-exempt pure factory; the read itself is one-shot file I/O whose
 *   call site (`runChangelog` → `tick-loop.changelog` span) carries the
 *   observability surface.
 */
export function createFileBackedChangelogReader(path: string): ReadChangelog {
  return async () => {
    try {
      return readFileSync(path, "utf-8");
      // rule-6: handled-locally — ENOENT on CHANGELOG.md is the documented graceful-degrade contract (fresh checkout pre-genesis); any other error propagates to the supervisor (Armstrong 2007 — let it crash AT the right boundary)
    } catch (err) {
      if (isEnoent(err)) return "";
      throw err;
    }
  };
}

/**
 * Discriminate ENOENT from other read errors. Node's fs throws an
 * `Error & { code: "ENOENT" }` for missing-file; any other shape (EACCES,
 * EISDIR, …) propagates.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === "string" &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
