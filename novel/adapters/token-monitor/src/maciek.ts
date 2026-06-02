/**
 * Maciek-backed `TokenMonitor` Strategy — derives a deterministic
 * {@link TokenSnapshot} by re-implementing the parser shape of Maciek's
 * `claude-monitor` (PyPI `claude-monitor==3.1.0`) directly against
 * Anthropic's session-log directory `~/.claude/projects/<cwd>/<session>.jsonl`.
 *
 * Why not shell out to Maciek: claude-monitor 3.1.0 has no `--json` mode
 * (only `--view {realtime,daily,monthly}` and `--version`). Parsing the
 * data Maciek itself reads is the only deterministic option until the
 * upstream feature request lands (rule #1 — push upstream first).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Strategy of `TokenMonitor` (Gamma et al.,
 *                            *Design Patterns*, 1994). Conformance: full.
 *   - Parser:                Recursive-descent line-by-line JSON parser
 *                            (Aho-Sethi-Ullman, *Compilers*, 1986).
 *                            Conformance: full.
 *   - Windowed aggregation:  5h `SessionBlock` rounding rule mirrored
 *                            from Maciek's `data/analyzer.py` (windowed
 *                            sum literature; Beyer SRE 2016 Ch. 3 —
 *                            error-budget framing applied to tokens).
 *                            Conformance: full.
 *
 * Anchors:
 *   - Maciek's upstream: `claude_monitor/data/reader.py`
 *     (`~/.claude/projects/<cwd>/<session>.jsonl` glob);
 *     `claude_monitor/core/data_processors.py` (`TokenExtractor.extract_tokens`);
 *     `claude_monitor/data/analyzer.py` (5h SessionBlock rounding rule);
 *     `claude_monitor/core/plans.py` (`PLAN_LIMITS` token caps).
 *   - Beyer et al., *Site Reliability Engineering*, Ch. 3, 2016 (tokens
 *     as the error budget you spend).
 *   - Meszaros, *xUnit Test Patterns*, 2007 (real-implementation
 *     contract test against committed fixtures).
 */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { TokenMonitor, TokenSnapshot } from "./index.js";

/**
 * Plan token caps — set ABOVE Anthropic's actual 5h-window ceiling so
 * that BudgetGuard's circuit-break is advisory-only and the real
 * rate-limit is enforced by Anthropic itself (the 429 response on
 * over-spend). Operator philosophy 2026-05-05: "if Anthropic doesn't
 * have a problem, neither should we" — preemptive circuit-breaking at
 * a heuristic threshold below Anthropic's actual ceiling just leaves
 * headroom on the table. The daemon handles 429 as a rule-#7
 * graceful-degrade (iteration fails, retry next tick).
 *
 * Anthropic does not publish exact 5h token ceilings. The numbers
 * below are derived from:
 *   (a) prior empirical 4.1M-chargeable-in-5h observation on a Max20
 *       session that was NOT being throttled (PR #155 / 2026-05-04);
 *   (b) Anthropic's public messaging that Max20 is "~20× a typical
 *       Pro user";
 *   (c) ~50× headroom over the empirical observation, well above any
 *       plausible Anthropic ceiling for the published plans — the
 *       intent is that BudgetGuard never circuit-breaks before
 *       Anthropic 429s.
 *
 * If Anthropic eventually starts 429ing the operator at a known
 * threshold, set `cap` (constructor opt) or `MINSKY_PLAN_CAP_OVERRIDE`
 * (env) to that threshold; the per-deployment override wins.
 *
 * Pivot (rule #9): if BudgetGuard never circuit-breaks during normal
 * operation (i.e., we are now strictly downstream of Anthropic's 429
 * — the intended state), this constant can become a single number
 * `INFINITE_CAP = Number.MAX_SAFE_INTEGER` and the four-plan keying
 * retires. Don't retire yet — operators on lower tiers may want a
 * conservative local cap to avoid surprise 429s on shared sessions.
 *
 * - `pro`     —  100 000 000 chargeable tokens / 5 h window
 * - `max5`    —  500 000 000 chargeable tokens / 5 h window (default — most common Max tier)
 * - `max20`   — 2 000 000 000 chargeable tokens / 5 h window
 * - `custom`  —  250 000 000 chargeable tokens / 5 h window (operator's escape hatch)
 */
export const PLAN_CAPS = {
  pro: 100_000_000,
  max5: 500_000_000,
  max20: 2_000_000_000,
  custom: 250_000_000,
} as const;

export type PlanName = keyof typeof PLAN_CAPS;

/** 5 hours in milliseconds — the rolling-window length Anthropic enforces. */
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

/**
 * Constructor options for {@link MaciekTokenMonitor}.
 */
export interface MaciekTokenMonitorOpts {
  /**
   * Claude Code's project-log root. Production callers pass
   * `path.join(homedir(), ".claude")`; tests pass a fixture path.
   */
  readonly configDir: string;
  /**
   * Clock seam — tests inject a fixed `Date` so the active-block selection
   * is deterministic. Defaults to `() => new Date()`.
   */
  readonly now?: () => Date;
  /**
   * Anthropic plan tier. Defaults to `'max5'` — the most common paid tier.
   */
  readonly plan?: PlanName;
  /**
   * Optional override for the 5h-window token cap. When set, ignores
   * {@link PLAN_CAPS}[plan] and uses this number instead. Operators wire
   * this from `MINSKY_PLAN_CAP_OVERRIDE` when the heuristic defaults
   * don't match their account's actual rate-limit (rule #2 escape hatch
   * + Beyer SRE 2016 Ch. 17 operator-control surface). Must be a
   * positive integer; non-integer / non-positive values are ignored.
   */
  readonly cap?: number;
}

/**
 * One assistant entry shape we care about, per Maciek's `TokenExtractor`.
 * Other top-level fields (e.g. `type:"user"` lines) are ignored at parse time.
 */
interface UsageEntry {
  readonly timestampMs: number;
  readonly messageId: string;
  readonly requestId: string;
  readonly tokens: number;
}

/**
 * One 5h SessionBlock — `[start, end)` half-open interval; `tokensUsed`
 * is the sum across the entries that fell inside it.
 */
interface SessionBlock {
  readonly startMs: number;
  readonly endMs: number;
  readonly tokensUsed: number;
}

/**
 * Real `TokenMonitor` Strategy backed by Maciek's data source.
 *
 * v0 leaves `weeklyHeadroomFraction` at `null` — Maciek's P90 ML predictor
 * is not exposed without invoking their CLI, and the CLI has no `--json`
 * output. The field is `0` in the {@link TokenSnapshot} for v0 (the
 * interface requires `number`); a follow-up will widen the interface to
 * accept `null` when the predictor lands as a separate Strategy.
 */
export class MaciekTokenMonitor implements TokenMonitor {
  private readonly configDir: string;
  private readonly nowFn: () => Date;
  private readonly plan: PlanName;
  private readonly capOverride: number | null;

  constructor(opts: MaciekTokenMonitorOpts) {
    this.configDir = opts.configDir;
    this.nowFn = opts.now ?? (() => new Date());
    this.plan = opts.plan ?? "max5";
    this.capOverride =
      typeof opts.cap === "number" && Number.isInteger(opts.cap) && opts.cap > 0 ? opts.cap : null;
  }

  /**
   * Read the current snapshot. Cold-start (missing config dir, no JSONL
   * files, all-malformed) returns the full plan cap as remaining — the
   * graceful-degrade path required by rule #7.
   *
   * @otel adapters.token-monitor.maciek.snapshot
   */
  async snapshot(): Promise<TokenSnapshot> {
    const now = this.nowFn();
    const cap = this.capOverride ?? PLAN_CAPS[this.plan];

    const entries = await collectUsageEntries(this.configDir);
    const deduped = dedupEntries(entries);
    const blocks = groupIntoSessionBlocks(deduped);
    const active = pickActiveBlock(blocks, now.getTime());

    if (active === null) {
      return {
        tokensRemainingInWindow: cap,
        windowSizeTokens: cap,
        secondsUntilWindowReset: FIVE_HOURS_MS / 1000,
        weeklyHeadroomFraction: 0,
        observedAt: now.toISOString(),
        // Slice 1 of `claude-usage-aware-strategic-model-router`: cold-start
        // branch — assume monthly headroom full; slice 6 will track real
        // cumulative monthly spend from the JSONL.
        monthlyHeadroomFraction: 1.0,
        secondsUntilWeekReset: secondsUntilNextMondayUtc(now),
        secondsUntilMonthReset: secondsUntilNextMonthStartUtc(now),
      };
    }

    const remaining = Math.max(0, cap - active.tokensUsed);
    const secondsUntilReset = Math.max(0, Math.floor((active.endMs - now.getTime()) / 1000));

    return {
      tokensRemainingInWindow: remaining,
      windowSizeTokens: cap,
      secondsUntilWindowReset: secondsUntilReset,
      weeklyHeadroomFraction: 0,
      observedAt: now.toISOString(),
      // Slice 1 of `claude-usage-aware-strategic-model-router`: monthly
      // tracking not yet ported from Maciek's P90 predictor; default to
      // "full headroom" so the strategic picker doesn't false-positive
      // on a missing data point. Slice 6 of that task will add cumulative
      // monthly parsing.
      monthlyHeadroomFraction: 1.0,
      secondsUntilWeekReset: secondsUntilNextMondayUtc(now),
      secondsUntilMonthReset: secondsUntilNextMonthStartUtc(now),
    };
  }
}

/**
 * Recursively walk `<configDir>/projects/` and collect every parseable
 * usage entry from every `.jsonl` file. Missing dir / unreadable file /
 * malformed line → skipped (rule #7 graceful degrade).
 *
 * @otel adapters.token-monitor.maciek.collect-usage-entries
 */
export async function collectUsageEntries(configDir: string): Promise<UsageEntry[]> {
  const projectsDir = join(configDir, "projects");
  const files = await rglobJsonl(projectsDir);
  const out: UsageEntry[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
      // rule-6: handled-locally — single unreadable JSONL file (EACCES, broken symlink) must not abort the whole snapshot; rule #7 graceful-degrade.
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const entry = parseUsageLine(line);
      if (entry !== null) out.push(entry);
    }
  }
  return out;
}

/**
 * Recursive-descent directory walk yielding all `.jsonl` files under `root`.
 * Returns `[]` if `root` does not exist or is unreadable.
 *
 * @otel adapters.token-monitor.maciek.rglob-jsonl
 */
async function rglobJsonl(root: string): Promise<string[]> {
  let dirents: Dirent[];
  try {
    dirents = (await readdir(root, { withFileTypes: true })) as Dirent[];
    // rule-6: handled-locally — missing config dir / EACCES is the cold-start path; the caller surfaces full plan cap as remaining (graceful-degrade per rule #7, table row 1).
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const dirent of dirents) {
    const full = join(root, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...(await rglobJsonl(full)));
      continue;
    }
    if (!dirent.isFile()) continue;
    if (!dirent.name.endsWith(".jsonl")) continue;
    try {
      await stat(full);
      // rule-6: handled-locally — broken-symlink defence; one unreadable file must not stop the rglob.
    } catch {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * Parse one JSONL line into a {@link UsageEntry} or `null`. Blank lines,
 * malformed JSON, or assistant entries without positive token usage all
 * return `null` (graceful degrade per rule #7).
 *
 * @otel-exempt pure parser; per-line spans would dominate the work; aggregator span covers the call site
 */
function parseUsageLine(line: string): UsageEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
    // rule-6: handled-locally — malformed JSONL line per rule #7 graceful-degrade (chaos table row 2); a single bad line must not abort the whole snapshot.
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const message = (raw as { message?: unknown }).message;
  if (!isObject(message)) return null;
  const usage = (message as { usage?: unknown }).usage;
  if (!isObject(usage)) return null;

  const inputTokens = toNonNegInt((usage as { input_tokens?: unknown }).input_tokens);
  const outputTokens = toNonNegInt((usage as { output_tokens?: unknown }).output_tokens);
  const cacheCreation = toNonNegInt(
    (usage as { cache_creation_input_tokens?: unknown }).cache_creation_input_tokens,
  );
  // cache_read_input_tokens is intentionally NOT summed. Anthropic's 5h
  // session-window throttle bills cache reads at ~0.1× a normal input token
  // (see Anthropic prompt-caching pricing); on a 1M-context Claude Code
  // session a single message can read ~1M cache tokens, so summing them
  // naively inflates the active-block total by ~10× and false-positives
  // BudgetGuard. Diverges from Maciek upstream `TokenExtractor.extract_tokens`
  // (rule #1 — fork acknowledged, behaviour validated empirically against
  // the 5h cap on 2026-05-04: pre-fix all four plans read 100%).
  const tokens = inputTokens + outputTokens + cacheCreation;
  if (tokens <= 0) return null;

  const messageId = stringOrEmpty((message as { id?: unknown }).id);
  const requestId = stringOrEmpty((raw as { requestId?: unknown }).requestId);
  if (messageId.length === 0 && requestId.length === 0) return null;

  const tsRaw = (raw as { timestamp?: unknown }).timestamp;
  if (typeof tsRaw !== "string") return null;
  const ts = Date.parse(tsRaw);
  if (Number.isNaN(ts)) return null;

  return {
    timestampMs: ts,
    messageId,
    requestId,
    tokens,
  };
}

/**
 * Drop duplicates with the same `(messageId, requestId)` — Maciek's
 * upstream rule when the same message appears in two files (e.g. a
 * resumed session writes to a fresh JSONL).
 *
 * @otel adapters.token-monitor.maciek.dedup-entries
 */
export function dedupEntries(entries: readonly UsageEntry[]): UsageEntry[] {
  const seen = new Set<string>();
  const out: UsageEntry[] = [];
  for (const e of entries) {
    const key = `${e.messageId}\0${e.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Group entries (chronologically) into 5h SessionBlocks, mirroring
 * Maciek's `data/analyzer.py` rule:
 *
 *   - Block start = floor(first-entry-timestamp, hour) UTC
 *   - Block end   = start + 5h
 *   - New block when `entry.ts >= block.end_time` OR
 *     `gap-since-last-entry >= 5h`
 *
 * @otel adapters.token-monitor.maciek.group-into-session-blocks
 */
export function groupIntoSessionBlocks(entries: readonly UsageEntry[]): SessionBlock[] {
  const sorted = [...entries].sort((a, b) => a.timestampMs - b.timestampMs);
  const first = sorted[0];
  if (first === undefined) return [];

  const blocks: SessionBlock[] = [];
  let currentStart = floorToHourUtc(first.timestampMs);
  let currentEnd = currentStart + FIVE_HOURS_MS;
  let currentTokens = 0;
  let lastTs = first.timestampMs;

  for (const e of sorted) {
    const newWindow = e.timestampMs >= currentEnd;
    const newGap = e.timestampMs - lastTs >= FIVE_HOURS_MS;
    if (newWindow || newGap) {
      blocks.push({ startMs: currentStart, endMs: currentEnd, tokensUsed: currentTokens });
      currentStart = floorToHourUtc(e.timestampMs);
      currentEnd = currentStart + FIVE_HOURS_MS;
      currentTokens = 0;
    }
    currentTokens += e.tokens;
    lastTs = e.timestampMs;
  }
  blocks.push({ startMs: currentStart, endMs: currentEnd, tokensUsed: currentTokens });
  return blocks;
}

/**
 * Pick the SessionBlock whose `[start, end)` contains `nowMs`, or `null`
 * when no block is active (the dashboard reads "remaining = full cap" in
 * that branch — fresh window, no usage yet).
 *
 * @otel adapters.token-monitor.maciek.pick-active-block
 */
export function pickActiveBlock(
  blocks: readonly SessionBlock[],
  nowMs: number,
): SessionBlock | null {
  for (const b of blocks) {
    if (nowMs >= b.startMs && nowMs < b.endMs) return b;
  }
  return null;
}

/**
 * Floor a millisecond timestamp to the start of its UTC hour.
 *
 * @otel-exempt arithmetic helper; covered by the caller's span
 */
function floorToHourUtc(ms: number): number {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * @otel-exempt type guard; trivial pure function
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @otel-exempt coercion helper; trivial pure function
 */
function toNonNegInt(v: unknown): number {
  if (typeof v !== "number") return 0;
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  return Math.floor(v);
}

/**
 * @otel-exempt coercion helper; trivial pure function
 */
function stringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Seconds until next Monday 00:00 UTC, computed from `now`.
 * Slice 1 of `claude-usage-aware-strategic-model-router` — weekly
 * window boundary for the strategic picker's per-window remaining
 * fraction. Pure function (no clock, no env).
 *
 * @otel-exempt pure arithmetic helper
 */
function secondsUntilNextMondayUtc(now: Date): number {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  // Days until next Monday: 1=Mon, ..., 0=Sun. (8 - day) % 7 → 0 if Mon, else 1..6.
  const day = d.getUTCDay();
  const daysAhead = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return Math.max(0, Math.floor((d.getTime() - now.getTime()) / 1000));
}

/**
 * Seconds until next month start (1st-of-month 00:00 UTC). Slice 1 of
 * `claude-usage-aware-strategic-model-router`. Operators on a custom
 * billing cycle can override via `MINSKY_BILLING_CYCLE_DAY` env at the
 * wiring layer (not here — adapter stays calendar-aligned).
 *
 * @otel-exempt pure arithmetic helper
 */
function secondsUntilNextMonthStartUtc(now: Date): number {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return Math.max(0, Math.floor((d.getTime() - now.getTime()) / 1000));
}
