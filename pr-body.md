## What & why

Task `self-metrics-competitive-benchmark` slice **(b)** — the competitor
corpus — on top of the slice-(a) cited metric substrate.

Minsky has no measured notion of how it compares to competitor agentic-SWE
systems, so direction is vibes-driven. Slice (a) (open PR #616) ships the
pure cited metric catalogue; slice (b) ships the other half the scorecard
runner needs: **who** Minsky compares against, as *data, not code*.

`novel/competitive-benchmark/src/competitors.ts` adds:

- `Competitor` / `CompetitorKind` / `ResultSource` — a competitor is a data
  record carrying a pluggable `ResultSource` discriminated union
  (`published` dated cited SWE-bench-Verified snapshot **or**
  `local-harness` descriptor the slice-c runner executes). The runner
  depends on the union, never on a vendor (Open/Closed — Martin 2017).
- `COMPETITORS` — 6 systems (Claude Code, OpenHands, SWE-agent, Aider,
  Devin, Cursor agent): 5 `published` snapshots + 1 `local-harness`
  descriptor, exercising both adapter arms.
- `competitorById`, `publishedValue` — pure accessors; `undefined` over a
  coerced zero (visible-not-silent — Helland 2007).
- `EXCLUDED_VENDOR_SUBSTRINGS` / `isExcludedVendor` — operator
  vendor-exclusion guard (no Groq/xAI/Elon-affiliated entrants),
  test-enforced over the shipped corpus so a future add cannot smuggle one
  in silently.

### Why this PR carries slice (a) too

The slice-(a) PR #616 is `MERGEABLE` but `BEHIND` (stale base, merge-base
2026-05-17 vs `origin/main` 2026-05-18). Slice (b) cannot exist without the
slice-(a) `metrics.ts` on the branch. Per the documented "port proven
resolver forward" pattern for stale sibling PRs, the slice-(a) package was
ported onto current `origin/main` **zero-conflict** (the
`novel/competitive-benchmark/` directory is new), so this PR delivers
(a)+(b) on a current base and supersedes the stale #616.

## Optimization (per-iteration discipline)

`round-trip elimination`: slice (b)'s tests import through the package
barrel (`./index.js`) rather than the concrete modules — the slice-(a)
`metrics.test.ts` already established this so `index.ts` is covered by the
same suite. No second test file, no separate barrel-coverage shim: one
suite covers both leaf modules + the re-export. Net: the corpus tests reuse
the existing barrel round-trip instead of adding a new one (≥10-byte
savings: one fewer import path + no `index.test.ts`).

## Manual test deltas

- `npx vitest run novel/competitive-benchmark/` → 30 passed (15 metrics +
  15 competitors).
- `node -e "import('@minsky/competitive-benchmark').then(m=>console.log(m.METRICS.length, m.COMPETITORS.length))"`
  → `11 6`.

## Hypothesis self-grade

- **Predicted**: a single zero-dependency cited metric catalogue (a) + competitor corpus (b), consumed by the slice-c runner/dashboard/meta-rule, removes divergent definitions of "who we compare against" and makes the scorecard buildable with ≥4 competitors × ≥5 shared metrics.
- **Observed**: `pnpm typecheck` exit 0; `npx vitest run novel/competitive-benchmark/` → 30/30 green; `COMPETITORS.length` = 6 (≥4) across both `ResultSource` arms; `METRICS.length` = 11 (≥5) across all three families.
- **Match**: yes
- **Lesson**: the published-corpus shape is the parent-task Pivot's data-only fallback already realised — slice (c) can build the scorecard on this substrate without a live closed-competitor harness blocking it.

## Security & privacy

vision.md § 13 reviewed. New surface is a pure, zero-I/O, zero-secret,
zero-PII data leaf. The one relevant STRIDE vector is **Tampering**: a
future corpus edit enrolling an operator-excluded vendor
(Groq/xAI/Elon-affiliated). Mitigation: the `isExcludedVendor` pure
predicate + a test-enforced corpus invariant (`competitors.test.ts`) fail
the gate before merge — visible-not-silent, not a silent drop. Untrusted
numeric/string inputs are propagated, never coerced, so a malformed corpus
surfaces in the scorecard rather than masking as a false parity. No
auth/network/filesystem/supply-chain surface added.
