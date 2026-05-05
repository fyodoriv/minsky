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
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { TokenMonitor, TokenSnapshot } from "./index.js";

/**
 * Plan token caps — heuristic 5h-window chargeable-token ceilings per
 * Anthropic plan tier. Diverges from Maciek upstream `PLAN_LIMITS`,
 * which still reflects 2024 estimates calibrated against ~500-1500-token
 * messages. On 1M-context Claude Code, per-message chargeable averages
 * ~3k tokens, so an active 5h dogfood block burns 4M+ chargeable tokens
 * (empirical: 4,107,313 on the operator's session 2026-05-04).
 *
 * Numbers below are derived from:
 *   (a) the empirical 4.1M-chargeable-in-5h observation on a Max-tier
 *       1M-context session that wasn't being throttled,
 *   (b) Anthropic's public messaging that Max20 is "~20× a typical
 *       Pro user" (https://www.anthropic.com/pricing — ratios, not
 *       absolute numbers, since absolutes aren't published),
 *   (c) headroom of ~10× over the empirical observation so that
 *       BudgetGuard's 85% circuit-break threshold (≈ 34M for max20)
 *       still leaves room for genuine over-spend signals.
 *
 * Override per-deployment with the `cap` constructor opt or, for
 * supervisor wiring, the `MINSKY_PLAN_CAP_OVERRIDE` env var (parsed by
 * the CLI bootstrap, not by this module).
 *
 * Pivot (rule #9): if heuristic caps still cause false circuit-breaks
 * during normal operator usage (≥10% iterations budget-paused over a
 * 7-day window), pivot to a separate `TokenMonitor` Strategy that
 * reads `anthropic-ratelimit-tokens-remaining` from response headers
 * — the principled solution. Heuristic-caps is the v0 unblock.
 *
 * - `pro`     —  2 000 000 chargeable tokens / 5 h window
 * - `max5`    — 10 000 000 chargeable tokens / 5 h window (default — most common Max tier)
 * - `max20`   — 40 000 000 chargeable tokens / 5 h window
 * - `custom`  —  5 000 000 chargeable tokens / 5 h window (operator's escape hatch)
 */
export const PLAN_CAPS = {
  pro: 2_000_000,
  max5: 10_000_000,
  max20: 40_000_000,
  custom: 5_000_000,
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
