// <!-- scope: human-approved interactive-model-cost-picker slice 2 (P0 in TASKS.md: menu rendering + selection parsing + atomic config writer over the slice-1 pure tier data). -->
/**
 * `@minsky/tick-loop/cost-tier-picker-io` — slice 2 of P0
 * `interactive-model-cost-picker`. Adds three new surfaces on top of
 * slice 1's pure {@link COST_TIERS} data:
 *
 *   1. {@link renderTierMenu} — pure: formats the 6 tiers for stdout
 *      as a numbered menu the operator picks from. Pure-string-in /
 *      pure-string-out so the rendering can be unit-tested without
 *      capturing stdout.
 *
 *   2. {@link parseUserSelection} — pure: accepts `"1"`–`"6"`, the
 *      tier id, or whitespace-padded variants. Returns the chosen
 *      {@link CostTier} or null on unrecognised input. Slice 3's CLI
 *      loops on null until valid input arrives.
 *
 *   3. {@link writeConfigPatchAtomic} — pure-with-IO-at-edge: takes
 *      the existing config object + a {@link ConfigPatch} from
 *      {@link tierToConfigPatch}, spreads the patch over the config,
 *      and atomically writes the result to disk (tmp-file + rename).
 *      `writeFile` and `rename` are injected per rule #2 so tests
 *      can drive the writer with fixture I/O.
 *
 * Slice 3 wires these into `bin/minsky.mjs`'s no-args path: TTY check,
 * loop until valid input, write atomically. Slice 4 ships
 * `docs/cost-tiers.md` documenting the prices + the pivot.
 *
 * Pattern: pure-decision-with-IO-at-edge (rule #2 — the I/O is the
 * injected seam, not embedded). Sibling: `cost-tier-picker.ts` (slice 1
 * pure data). Source: TASKS.md `interactive-model-cost-picker` § Details.
 * Anchor: Hunt & Thomas 1999 *The Pragmatic Programmer* Tip 36 (use
 * exceptions for exceptional conditions — `parseUserSelection` returns
 * null for the common "operator typed something unexpected" case, not
 * a throw); Kernighan & Pike 1999 *The Practice of Programming* Ch. 4
 * (separate the interface from the implementation — the menu renderer
 * doesn't know about stdout, the writer doesn't know about ~/.minsky).
 */

import type { ConfigPatch, CostTier, CostTierId } from "./cost-tier-picker.js";

import { COST_TIERS, DEFAULT_TIER_ID, isPendingTier, pickTierById } from "./cost-tier-picker.js";

/**
 * Format the 6-tier menu for stdout. Each line is `(N) <label> — ~$X/hr · <recommendedFor>`.
 *
 * @otel-exempt pure string transformation, no I/O — slice 3's bin layer wraps with the actual prompt-render span
 * @returns the menu text including a one-line prompt at the end
 */
export function renderTierMenu(): string {
  const lines = COST_TIERS.map((t, i) => {
    const num = i + 1;
    const price = t.estimatedUsdPerHour === 0 ? "$0/hr" : `~$${t.estimatedUsdPerHour}/hr`;
    // Tiers with a non-null `pendingExternalDep` are visible in the
    // menu but unselectable — the suffix makes the gating explicit.
    // `parseUserSelection` rejects selection of these tiers below;
    // both surfaces share the same `pendingExternalDep` field as the
    // source of truth.
    const pending =
      t.pendingExternalDep !== undefined && t.pendingExternalDep !== null
        ? ` [pending ${t.pendingExternalDep}]`
        : "";
    return `  (${num}) ${t.label} — ${price} · ${t.recommendedFor}${pending}`;
  });
  return [
    "Pick a cost tier for this machine:",
    "",
    ...lines,
    "",
    `Enter a number (1-${COST_TIERS.length}) or tier id [default: ${DEFAULT_TIER_ID}]: `,
  ].join("\n");
}

/**
 * Parse the operator's reply to the menu prompt. Accepts:
 *   - A numeric pick `"1"` through `"6"` (1-indexed, matches the menu
 *     numbering in {@link renderTierMenu}).
 *   - A tier id, e.g. `"opus-sonnet"`.
 *   - Whitespace-padded variants of the above.
 *   - Empty / whitespace-only input → returns the DEFAULT tier (the
 *     menu prompt explicitly says "[default: opus-sonnet]" so blank
 *     input means "accept the default").
 *
 * Returns null on unrecognised input. The CLI shell loops on null.
 *
 * @otel-exempt pure parser, no I/O — slice 3's bin layer wraps the read-loop with a span if needed
 * @param input the raw operator reply (no trim required — function trims)
 * @returns the chosen {@link CostTier}, or null on unrecognised input
 */
export function parseUserSelection(input: string): CostTier | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    // Blank reply → DEFAULT (the prompt advertises this).
    return pickTierById(DEFAULT_TIER_ID);
  }
  let candidate: CostTier | null = null;
  // Numeric pick: "1" through `COST_TIERS.length`.
  if (/^\d+$/.test(trimmed)) {
    const idx = Number.parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < COST_TIERS.length) {
      candidate = COST_TIERS[idx] ?? null;
    }
  } else {
    // Tier id lookup.
    candidate = pickTierById(trimmed);
  }
  if (candidate === null) return null;
  // Pending tiers (e.g. openhands-claude before 2026-06-01) are visible
  // in the menu but unselectable. Returning null routes the CLI shell
  // back into the prompt loop with an actionable diagnostic.
  if (isPendingTier(candidate)) return null;
  return candidate;
}

/**
 * Existing config.json shape that slice 3's reader passes in. Only the
 * fields {@link writeConfigPatchAtomic} cares about; other fields pass
 * through untouched via spread.
 */
export type ExistingConfig = {
  readonly cost_tier?: CostTierId;
  readonly cloud_agent?: string | null;
  readonly cloud_agent_model?: string | null;
  readonly local_agent?: string | null;
  readonly local_agent_model?: string | null;
  readonly [other: string]: unknown;
};

/**
 * Injected I/O surface for {@link writeConfigPatchAtomic}. The
 * production wiring uses `node:fs/promises` (`writeFile` + `rename`);
 * tests inject in-memory fakes. Rule #2 — the I/O is the seam.
 */
export type ConfigWriteIo = {
  /** Writes `data` to `path`. Production: `fs.writeFile(path, data, opts)`. */
  readonly writeFile: (path: string, data: string, opts?: { mode?: number }) => Promise<void>;
  /** Atomically renames `from` to `to`. Production: `fs.rename(from, to)`. */
  readonly rename: (from: string, to: string) => Promise<void>;
};

/**
 * Atomically write the existing config + tier patch to `configPath`.
 *
 * Writes to `<configPath>.tmp` first, then renames over the target
 * (the rename is atomic on POSIX). On crash mid-write the operator
 * sees their pre-existing config untouched, never a half-written file.
 *
 * @otel-exempt slice 3's bin layer owns the span over the full picker flow; this leaf is only the writer step (~milliseconds)
 * @param configPath absolute path to the operator's config.json
 * @param existing the parsed existing config (or `{}` on fresh install)
 * @param patch the tier patch from {@link tierToConfigPatch}
 * @param io injected writer + rename functions (rule #2)
 * @returns Promise that resolves once the rename completes
 */
export async function writeConfigPatchAtomic(
  configPath: string,
  existing: ExistingConfig,
  patch: ConfigPatch,
  io: ConfigWriteIo,
): Promise<void> {
  const merged = { ...existing, ...patch };
  const json = `${JSON.stringify(merged, null, 2)}\n`;
  const tmpPath = `${configPath}.tmp`;
  // 0o600 — config.json may carry secrets later (slice 4 follow-up);
  // start with operator-only read/write so we don't have to lower
  // permissions later.
  await io.writeFile(tmpPath, json, { mode: 0o600 });
  await io.rename(tmpPath, configPath);
}
