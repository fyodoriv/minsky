// <!-- scope: human-approved minsky-claude-exhaustion-persisted-state slice 4 (operator 2026-05-08 — "I ran minsky and it happily started claude even though it's out of tokens. It shouldn't have happened, it should have quickly detected that & switched to local model") -->
/**
 * `@minsky/tick-loop/claude-exhaustion-state` — pure read/write
 * helpers for the persisted `last_claude_hard_limit` field in
 * `.minsky/state.json`. Slice 4 of P0 task
 * `minsky-claude-exhaustion-persisted-state` per `TASKS.md`.
 *
 * Why: the `claude --print "ping"` startup probe (slice 4 of
 * `minsky-cli-auto-bootstrap-local-llm`) is a 1-token query.
 * Anthropic's quota metering hits at the multi-K-token level (an
 * iteration is typically 5-15K input tokens). When the operator's
 * quota is exhausted, the 1-token probe can still return exit 0 —
 * false-positive `healthy`. The daemon then spawns claude on
 * iteration 1, which fails with hard-limit; the existing
 * per-iteration `decideProvider` correctly switches to local on
 * iteration 2 — but the operator already saw the wasted spawn and
 * the local-LLM stack might not be installed yet (so iteration 2
 * lands in `hold`).
 *
 * The persistence layer composes with — does not replace — the
 * existing in-process per-iteration logic:
 *   - In-process per-iteration (`LlmProviderSpawnStrategy`) catches
 *     hard-limit on iteration N+1.
 *   - Cross-process / cross-restart (this module) catches it on
 *     iteration 1 of the NEXT `minsky` invocation, so the operator
 *     never sees iteration 1 spawn claude wastefully.
 *
 * The contract:
 *
 *   1. {@link readLastHardLimit} — pure-over-injection read of
 *      `.minsky/state.json::last_claude_hard_limit`. Returns
 *      `{ exhausted: true, ageMs, reason, ts }` when the field is
 *      present AND its `ts` is within `ttlMs`. Returns
 *      `{ exhausted: false }` for any of:
 *        - state file absent
 *        - field absent
 *        - field present but `ts` is stale (beyond TTL)
 *        - JSON corrupt
 *        - `ts` not parseable as a date
 *      Graceful-degrade per rule #6 — a corrupt state file should
 *      not crash the CLI.
 *
 *   2. {@link writeLastHardLimit} — pure-over-injection
 *      read-modify-write of the field. Preserves all other state
 *      fields (schema_version, ntfy, ledger, etc.). Creates a
 *      minimal fresh state.json if the file is absent.
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision function** — Hughes 1989. Conformance: full
 *     (over the injected file-system seams).
 *   - **Loud-crash boundary** — Armstrong 2007. Conformance: full
 *     for write (a state.json write failure does crash the daemon's
 *     iteration; the right boundary is "log + retry on next tick").
 *     Read is graceful-degrade (corrupt JSON returns `exhausted:
 *     false` rather than crashing the CLI startup).
 *   - **Build-measure-learn** — Ries 2011 (*The Lean Startup*). The
 *     persisted state IS the measurement layer; the live probe is
 *     the build layer; the operator's next decision is the learn
 *     layer.
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | state.json absent | Fresh repo / first run | `{ exhausted: false }` | "state file absent" |
 * | 2 | field absent | Existing state.json with no hard-limit hits | `{ exhausted: false }` | "field absent" |
 * | 3 | recent hit | Daemon recently caught hard-limit | `{ exhausted: true, ... }` | "within TTL" |
 * | 4 | stale hit | Quota window has rolled over | `{ exhausted: false }` | "stale beyond TTL" |
 * | 5 | corrupt JSON | Disk corruption / partial write | `{ exhausted: false }` | "corrupt JSON" |
 * | 6 | invalid ts | Manually-edited state.json with bad ts | `{ exhausted: false }` | "invalid ts" |
 *
 * @module tick-loop/claude-exhaustion-state
 */

/** Result of {@link readLastHardLimit}. */
export type ReadHardLimitOutcome =
  | { readonly exhausted: false }
  | {
      readonly exhausted: true;
      readonly ts: string;
      readonly ageMs: number;
      readonly reason: string;
    };

/**
 * Read the persisted hard-limit timestamp from
 * `.minsky/state.json::last_claude_hard_limit`. Returns
 * `{ exhausted: false }` for any of: file absent, field absent, ts
 * stale, JSON corrupt, ts unparseable. Returns
 * `{ exhausted: true, ts, ageMs, reason }` only when the field is
 * present AND its ts is within `ttlMs` of `nowFn()`.
 *
 * @otel-exempt pure decision function — caller's spawn carries the
 *   span if needed.
 */
export function readLastHardLimit(opts: {
  readonly stateFilePath: string;
  readonly readFileSyncFn: (path: string, encoding: "utf8") => string;
  readonly existsSyncFn: (path: string) => boolean;
  readonly nowFn: () => number;
  readonly ttlMs: number;
}): ReadHardLimitOutcome {
  if (!opts.existsSyncFn(opts.stateFilePath)) {
    return { exhausted: false };
  }
  const raw = readSafe(opts);
  if (raw === undefined) return { exhausted: false };
  const field = parseField(raw);
  if (field === undefined) return { exhausted: false };
  const tsMs = Date.parse(field.ts);
  if (Number.isNaN(tsMs)) return { exhausted: false };
  const ageMs = opts.nowFn() - tsMs;
  if (ageMs > opts.ttlMs) return { exhausted: false };
  return { exhausted: true, ts: field.ts, ageMs, reason: field.reason };
}

function readSafe(opts: {
  readonly stateFilePath: string;
  readonly readFileSyncFn: (path: string, encoding: "utf8") => string;
}): string | undefined {
  try {
    return opts.readFileSyncFn(opts.stateFilePath, "utf8");
    // rule-6: handled-locally — readFileSync failure (ENOENT / EACCES) is the chaos-table row 1 case; graceful-degrade per Beyer SRE Ch. 6 (corrupt/unreadable state file should not crash CLI startup).
  } catch {
    return undefined;
  }
}

function parseField(raw: string): { readonly ts: string; readonly reason: string } | undefined {
  /** @type {unknown} */
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // rule-6: handled-locally — corrupt JSON is the chaos-table row 5 case; returning undefined falls through to exhausted=false rather than crashing the CLI startup.
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const field = (parsed as { last_claude_hard_limit?: unknown }).last_claude_hard_limit;
  if (typeof field !== "object" || field === null) return undefined;
  const { ts, reason } = field as { ts?: unknown; reason?: unknown };
  if (typeof ts !== "string" || typeof reason !== "string") return undefined;
  return { ts, reason };
}

/**
 * Write `last_claude_hard_limit` to `.minsky/state.json`. Preserves
 * all other top-level state.json fields. Creates a minimal fresh
 * state.json if the file is absent.
 *
 * Caller is the daemon's per-iteration loop, called from the spawn
 * strategy's `persistHardLimit` injected seam when
 * `isClaudeHardLimit(failure) === true`.
 *
 * @otel-exempt pure I/O wrapper.
 */
export function writeLastHardLimit(opts: {
  readonly stateFilePath: string;
  readonly readFileSyncFn: (path: string, encoding: "utf8") => string;
  readonly writeFileSyncFn: (path: string, content: string) => void;
  readonly ts: string;
  readonly reason: string;
}): void {
  /** @type {Record<string, unknown>} */
  let state: Record<string, unknown>;
  try {
    const raw = opts.readFileSyncFn(opts.stateFilePath, "utf8");
    const parsed = JSON.parse(raw);
    state =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    // rule-6: handled-locally — file absent OR corrupt JSON: start from empty state. The write below produces a minimal schema-version=1 doc that future reads can extend.
  } catch {
    state = {};
  }
  if (!("schema_version" in state)) state["schema_version"] = "1";
  state["last_claude_hard_limit"] = { ts: opts.ts, reason: opts.reason };
  opts.writeFileSyncFn(opts.stateFilePath, JSON.stringify(state, null, 2));
}
