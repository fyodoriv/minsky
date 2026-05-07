# `@minsky/token-monitor`

`TokenMonitor` adapter — Strategy interface over Claude token-usage
trackers, plus a real implementation backed by the same data Maciek's
[`claude-monitor`](https://pypi.org/project/claude-monitor/) reads.

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index)
rows 25 (interface) and 60 (`MaciekTokenMonitor` Strategy):

- **`TokenMonitor` interface** — Adapter (structural) per Gamma et al.,
  *Design Patterns*, 1994. **Conformance: full.**
- **`StubTokenMonitor`** — test fake per Meszaros, *xUnit Test Patterns*,
  2007. **Conformance: full.**
- **`MaciekTokenMonitor`** — Strategy (behavioral) per Gamma 1994 +
  recursive-descent line-by-line JSON parser per Aho-Sethi-Ullman,
  *Compilers*, 1986 + windowed-aggregation (5h SessionBlock) mirrored
  from Maciek's `data/analyzer.py`. **Conformance: full.**

## `MaciekTokenMonitor` Strategy

```ts
import { MaciekTokenMonitor } from "@minsky/token-monitor";
import { homedir } from "node:os";
import { join } from "node:path";

const tm = new MaciekTokenMonitor({
  configDir: join(homedir(), ".claude"),
  plan: "max5",  // optional; defaults to "max5"
});
const snap = await tm.snapshot();
console.log(snap);
// { tokensRemainingInWindow: 85_000, windowSizeTokens: 88_000,
//   secondsUntilWindowReset: 14_400, weeklyHeadroomFraction: 0,
//   observedAt: "2026-05-04T12:00:00.000Z" }
```

**Constructor opts**:

- `configDir` (required) — Claude Code's project-log root (e.g.
  `~/.claude` — NOT `~/.config/claude/`, despite the env-var name
  `CLAUDE_CONFIG_DIR`; see "Why this changed" below).
- `now?` — clock seam; defaults to `() => new Date()`. Tests inject a
  fixed `Date` so block selection is deterministic.
- `plan?` — Anthropic plan tier; defaults to `'max5'`.
- `cap?` — numeric override of the 5h-window cap. When set (positive
  integer), wins over `PLAN_CAPS[plan]`. The supervisor wires this from
  the `MINSKY_PLAN_CAP_OVERRIDE` env var (rule #2 escape hatch).

**Plan caps** (above any plausible Anthropic ceiling — advisory-only;
real rate-limit is enforced by Anthropic's own 429):

| Plan | Chargeable tokens / 5h window |
|---|---|
| `pro` |  100 000 000 |
| `max5` | 500 000 000 (default) |
| `max20` | 2 000 000 000 |
| `custom` |  250 000 000 |

### Calibration note (2026-05-05 — capped above Anthropic's ceiling)

Operator philosophy 2026-05-05: "if Anthropic doesn't have a problem,
neither should we". Preemptive circuit-breaking at a heuristic threshold
*below* Anthropic's actual ceiling just leaves headroom on the table.
The numbers above are deliberately set ~50× above the empirical 4.1M
chargeable-in-5h observation on the operator's Max20 session, which
puts them well above any plausible Anthropic published-plan ceiling.

Real rate-limiting therefore happens at Anthropic's 429 — not at our
internal threshold. The daemon handles 429 as a rule-#7 graceful-
degrade (iteration fails, retry next tick); BudgetGuard's circuit-break
becomes a *belt-and-suspenders* signal (only fires if Anthropic's
ceiling moves dramatically without warning).

**Why not infinite?** Operators on lower tiers may want a conservative
local cap to avoid surprise 429s on shared sessions. The four-plan
keying gives them a per-tier dial. If a future PR reduces the tier
spread to one number, retire the keys.

**If Anthropic publishes exact ceilings** (or you observe consistent
429s at a known threshold), set `cap` (constructor opt) or
`MINSKY_PLAN_CAP_OVERRIDE` (env) to that threshold; the per-deployment
override wins.

**Pivot (rule #9)**: if BudgetGuard never circuit-breaks under normal
operation (the intended state — strictly downstream of Anthropic's
429), the four-plan keying retires and `PLAN_CAPS` becomes a single
`INFINITE_CAP = Number.MAX_SAFE_INTEGER`. Don't retire yet; lower-tier
operators may still want a local conservative cap.
That's a separate PR behind the existing rule-#2 seam.

### Algorithm (mirrored from Maciek's `data/analyzer.py`)

1. `rglob` all `.jsonl` files under `<configDir>/projects/`.
2. Stream-parse line-by-line; tolerate blank lines and `JSON.parse`
   errors per rule #7 graceful-degrade.
3. Filter to entries with `message.usage` and positive token counts.
4. Dedup by `(message.id, requestId)` — Maciek's rule when the same
   message appears in two files (resumed sessions write a fresh JSONL).
5. Group sorted entries into 5h `SessionBlock`s — block start =
   `floor(first-entry-timestamp, hour)` UTC; new block when
   `entry.ts >= block.end_time` OR `gap-since-last-entry >= 5h`.
6. Pick the active block — the one whose `[start, end)` contains `now()`.
7. `tokensUsed = sum(input + output + cache_creation)`
   over that block's entries. **Diverges from Maciek upstream's
   `TokenExtractor.extract_tokens`**, which sums `cache_read` too.
   Anthropic's prompt-cache reads are billed at ~0.1× input pricing and
   don't count fully against the 5h cap; on 1M-context Claude Code
   sessions a single message can carry ~1M cache-read tokens, so summing
   them inflated the active-block total by ~10× and false-positive-paused
   every iteration. Live verification 2026-05-04: an active block carried
   ~700M total tokens (696M of which were cache reads); chargeable was
   ~3.6M. See PR #155 + the regression test
   `cache_read_input_tokens are excluded from the 5h-window sum`.
8. `tokensRemainingInWindow = max(0, planCap − tokensUsed)`.
9. `secondsUntilWindowReset = (block.end − now)` in seconds.

### Why this changed from the prior brief

The prior `budget-guard-maciek-impl` brief assumed Maciek reads
`~/.config/claude/`. **It does not.** Filesystem inspection of
`claude-monitor==3.1.0` (the pinned upstream in `.github/workflows/ci.yml`'s
`maciek-smoke` job) shows that env var `CLAUDE_CONFIG_DIR` only governs
Maciek's own settings cache — the actual usage data lives at
`~/.claude/projects/<cwd>/<session>.jsonl`, written by Claude Code itself
(filename = session UUID; directory = cwd path with `/` → `-`).

`weeklyHeadroomFraction` is `0` in v0 — Maciek's P90 ML predictor is not
exposed without invoking their CLI, and the CLI has no `--json` mode (only
`--view {realtime,daily,monthly}`). A separate Strategy that wraps the
predictor will land when the upstream feature request for `--json` ships
(rule #1 — push upstream first).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `snapshot()` returns a `TokenSnapshot`
  whose `tokensRemainingInWindow` matches the value Maciek's
  `--view realtime` reports for the same fixture, to within 1 %.
- **Blast radius**: a single `snapshot()` call. The adapter holds no
  shared state across calls; the underlying JSONL files are read-only.
- **Operator escape hatch**: callers swap to `StubTokenMonitor` (or any
  other `TokenMonitor` Strategy) without touching downstream code; the
  interface is the contract.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Missing config dir (cold start — fresh install, no `~/.claude/projects/`) | nonexistent path passed as `configDir` | `graceful-degrade` — return full plan cap as `tokensRemainingInWindow` | `maciek.test.ts` "missing config dir: returns full plan cap" |
| 2 | Malformed JSONL line (truncated write, partial flush) | a line that fails `JSON.parse` | `graceful-degrade` — skip the bad line, sum the rest, emit no warning to stderr in v0 | `maciek.test.ts` "malformed JSONL line: parser skips bad lines without throwing" |
| 3 | Plan cap mismatch (operator configures `max5` but is actually on `max20`) | `plan: 'max5'` passed when the real account is on `max20` | derived `tokensRemainingInWindow` drifts from reality; the fix is operator-side (correct the `plan` opt). The adapter does not auto-detect — Anthropic does not expose the plan tier in the JSONL. | `maciek.test.ts` "plan-cap variance: same fixture, plan=pro vs plan=max20 yields different remaining" — the test asserts each plan returns its own cap; an operator pointing at the wrong plan would observe the wrong remaining value |
| 4 | Permission denied on `~/.claude/projects/` (e.g., dir owned by another user after a `sudo` chown) | `EACCES` from `readdir` | `graceful-degrade` — `readdir` rejection is caught; return full plan cap (caller-initiated re-investigation) | `maciek.test.ts` "missing config dir: returns full plan cap (cold-start) without throwing" — the same code path catches both ENOENT and EACCES rejections from `readdir`; the test asserts no-throw + cap-as-remaining |
| 5 | JSONL format changes upstream (Anthropic adds new `cache_creation` sub-fields) | new field in `message.usage` | `graceful-degrade` — unknown sub-fields are ignored; the four canonical token-count fields still sum. Pivot: if the format changes more than once in 90 days, file an upstream feature request for a `--json` mode in claude-monitor (rule #1). | (manual) inject a synthetic JSONL fixture with new fields; assert `snapshot()` returns the same value as without them |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: `MaciekTokenMonitor`'s parser + 5h SessionBlock
  aggregation + plan-cap subtraction matches Maciek's `--view realtime`
  reported value to within 1 % on a synthetic fixture.
- **Success threshold**: ≥6 tests pass against committed fixtures;
  parser handles all five fixture cases (single-block, two-blocks, empty,
  malformed, dedup); plan-cap variance correct.
- **Pivot threshold**: if Anthropic's JSONL format changes more than
  once in a 90-day window, file an upstream feature request for a
  `--json` mode in claude-monitor (rule #1: push upstream first), and
  only as a last resort write our own cache-tap by hooking the Claude
  Code API client.
- **Measurement**:
  `pnpm vitest run novel/adapters/token-monitor/src/maciek.test.ts --reporter=json | jq -e '.numPassedTests >= 6 and .numFailedTests == 0'`
- **Literature anchor**: Gamma et al., *Design Patterns*, 1994
  (Adapter / Strategy); Meszaros, *xUnit Test Patterns*, 2007
  (real-implementation contract test against committed fixtures);
  Aho-Sethi-Ullman, *Compilers*, 1986 (recursive-descent parser);
  rule #2.

## Synthetic fixtures

`test/fixtures/<scenario>/projects/-fixture-cwd/*.jsonl` — five scenarios,
each with a sibling `expected.json` documenting the expected snapshot.
Timestamps are crafted (`2026-05-04T12:00:00Z` and offsets); message ids
and request ids are synthetic (`msg_001`, `req_001`). **No real data from
a live `~/.claude/projects/` is committed.**

## Manual cross-check against Maciek's `--view realtime`

```bash
# Install Maciek's CLI (matches the .github/workflows/ci.yml maciek-smoke pin).
pip install claude-monitor==3.1.0

# Compare what Maciek shows against what MaciekTokenMonitor computes.
claude-monitor --view realtime &
MACIEK_PID=$!
node -e "(async () => {
  const { MaciekTokenMonitor } = await import('@minsky/token-monitor');
  const tm = new MaciekTokenMonitor({
    configDir: \`\${process.env.HOME}/.claude\`,
  });
  console.log(await tm.snapshot());
})();"
kill $MACIEK_PID
```

The two `tokensRemainingInWindow` values should be within ±1 % at any
single tick (the difference is the sub-second drift between the two
reads of the same JSONL files).

## Pre-publish dry-run

The package is `private: true` in v0 (not yet published to the npm registry); the dry-run is the release-contract smoke test (Wiggins 2011, Twelve-Factor App, factor V).

- **Tarball**: `minsky-token-monitor-0.0.0.tgz`
- **Package size**: 9.9 kB (well under the 100 kB budget)
- **Unpacked size**: 34.8 kB
- **File list (6 entries)**:
  - `README.md`
  - `dist/index.{js,d.ts}`
  - `dist/maciek.{js,d.ts}`
  - `package.json`
- **Excluded** (asserted by `files` field with `!` negation): `dist/**/*.test.{js,d.ts}`, `dist/**/*.map`, `tsconfig.json`, source, `test/fixtures/`.

Verification command (run from this directory after `pnpm build`):

```sh
npm publish --dry-run --loglevel=info
```

## Threat model

STRIDE analysis per vision.md § 13 (Security & privacy — second priority after performance; Shostack, *Threat Modeling*, Wiley, 2014). Read-only consumer of `~/.claude/projects/` JSONL; primary risk is disclosure of conversation metadata.

| Threat | Surface | Mitigation |
|---|---|---|
| Spoofing | Crafted JSONL files on a shared machine report falsely low usage, disabling circuit-breaking | `MaciekTokenMonitor` is read-only; file integrity depends on OS-level permissions on `~/.claude/` (mode 700 recommended) |
| Tampering | Injected JSONL line with an inflated token count causes premature circuit-breaking | Fail-safe: inflated counts trigger early circuit-break (pause), not bypass; `BudgetGuard` applies conservatively |
| Repudiation | JSONL token records are unsigned; an operator could dispute the counts | JSONL is written exclusively by the Claude Code process (Anthropic-controlled); the monitor is read-only and cannot alter records |
| Information Disclosure | `~/.claude/projects/<cwd>/<session>.jsonl` contains full conversation messages including any sensitive content | OS permissions on `~/.claude/` restrict access to the running user; the monitor reads only `message.usage` numeric fields, skipping content fields |
| Denial of Service | A very large JSONL file (millions of lines) exhausts memory during `readFile` | v0 buffers the whole file in RAM; operator-managed risk — avoid multi-million-line sessions; streaming parser planned as follow-up |
| Elevation of Privilege | Read access to `~/.claude/projects/` reveals all active Claude Code sessions on the machine | Restricted to the running user's home directory by OS permissions; `supervisor-sandbox-syscall-restriction` adds FS-level isolation |
