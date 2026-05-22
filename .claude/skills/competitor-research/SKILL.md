---
name: competitor-research
description: Research an autonomous-coding competitor end-to-end from a single URL, extract primary-cited metric readings for the M1.10 scorecard, write the corpus entry + research file + follow-up tasks, then verify with `bin/minsky competitive`. Use when adding a new competitor to `novel/competitive-benchmark/src/competitors.ts` or refreshing an existing one with new published numbers. Don't use for fixing the scorecard runner itself (edit `scripts/benchmark-run.mjs` directly) or generic competitive analysis (this skill is scoped to the M1.10 corpus).
allowed-tools: WebSearch, WebFetch, Bash, Read, Edit, Write, Grep
---

# Competitor research

Lift a competitor URL into a fully-cited entry in the M1.10 scorecard corpus (`@minsky/competitive-benchmark`). The output is a working PR: corpus diff + research file + follow-up tasks + green `bin/minsky competitive`. Adapted from the 2026-05-22 corpus-expansion run (PR #717) which closed M1.10 by adding 5 metrics × 5 competitors from Cognition's 2025 annual review, the AIDev arXiv study, OpenHands' blog, and Anthropic's release notes.

## Args

One required argument: the competitor's URL — usually a vendor homepage, blog post, paper, or leaderboard. Examples:

```
/competitor-research https://www.cognition.ai
/competitor-research https://www.openhands.dev/blog/sota-on-swe-bench-verified
/competitor-research https://arxiv.org/abs/2406.01304
```

Optional flag: `--refresh` — pass this when updating an existing competitor's readings (id already in `COMPETITORS`). This is the canonical flag used by the auto-refresh pipeline's filed `corpus-refresh-<id>` tasks (see "How the auto-refresh loop calls this skill" below).

```
/competitor-research https://www.cognition.ai --refresh
```

## When to use

**Use competitor-research when:**

- Adding a new competitor to the corpus (Cursor, OpenAI Codex, GitHub Copilot Coding Agent, etc.)
- Refreshing an existing competitor's readings (vendor published a new SWE-bench number, a new study came out)
- The operator hands you a URL and says "research this" / "add this to the scorecard"
- The auto-refresh loop filed a `corpus-refresh-<id>` task and the tick-loop picked it up

**Don't use when:**

- The scorecard CLI is broken — edit `scripts/benchmark-run.mjs` and its tests directly.
- The lint catches a missing `**Competitive-goal**:` field — fix the task block directly.
- Doing generic competitive analysis for strategy work — that's not in scope (M1.10 corpus is narrow).

## How the auto-refresh loop calls this skill

The corpus is **self-refreshing** via two scheduled fires (see vision.md row 95):

1. **Per-vendor reading freshness** — `distribution/launchd/com.minsky.corpus-refresh-check.plist` (macOS) and `distribution/systemd/minsky-corpus-refresh-check.{service,timer}` (Linux) run weekly. The shell pipeline is:

   ```bash
   node scripts/check-corpus-freshness.mjs --json \
     | node scripts/auto-file-corpus-refresh-tasks.mjs --tasks-path TASKS.md
   ```

   The freshness checker classifies each competitor's `asOf` date as `fresh` (≤90 days), `stale` (91–180 days), or `very-stale` (>180 days) using the thresholds in `scripts/check-corpus-freshness.mjs`. The autofile runner inserts a P2 `corpus-refresh-<id>` task block for every `very-stale` competitor (idempotent — never re-files an id already in TASKS.md). The tick-loop's `/next-task` then picks up that task and the worker invokes `/competitor-research <homepage-url> --refresh`.

2. **Corpus-list discovery** — quarterly recurring task `corpus-discover-quarterly` (TASKS.md P2) drives the operator (or the tick-loop) to scan the autonomous-coding landscape for NEW vendors and invoke `/competitor-research <url>` (no `--refresh`) for each surviving candidate. This closes the loop on the LIST half — without it, the corpus refreshes existing readings forever but never adds Codex, GitHub Copilot Coding Agent, MetaGPT v2, etc. as those launch.

**The flow** the skill participates in:

```
weekly launchd / systemd  →  check-corpus-freshness.mjs (very-stale set)
                              ↓
                          auto-file-corpus-refresh-tasks.mjs
                              ↓
                          TASKS.md P2 + `corpus-refresh-<id>`
                              ↓
                          tick-loop /next-task
                              ↓
                          /competitor-research <url> --refresh   ← THIS SKILL
                              ↓
                          updated competitors.ts + competitors/<id>.md
                              ↓
                          asOf refreshed → next weekly fire is a no-op
```

When invoked with `--refresh`:

- The skill SHOULD prefer the same primary source the existing entry cites (continuity); if the vendor has published something newer, use that instead.
- The skill MUST update the `asOf` date even if the `values` map is unchanged — operator intent on a refresh is to record "this reading is still current as of <today>". A no-numeric-change refresh is a valid outcome.
- The skill MUST delete the corresponding `corpus-refresh-<competitor-id>` task entry from TASKS.md after the corpus update lands (the task is "done"; failing to delete it makes the autofile runner re-file it on the next fire because `Anchor: …` doesn't include the `[x]` marker — TASKS.md spec is "remove completed tasks", not check them off).

## Workflow

### Phase 1 — identify the competitor

1. Read the URL with `WebFetch` to extract the competitor's canonical name + vendor + open-source vs closed-commercial status.
2. Generate a kebab-case `id` (e.g., `openai-codex`, `github-copilot-coding-agent`). Must match `/^[a-z0-9]+(-[a-z0-9]+)*$/`.
3. Check the vendor-exclusion guard — search the new name against `EXCLUDED_VENDOR_SUBSTRINGS` in `novel/competitive-benchmark/src/competitors.ts` (`groq`, `xai`, `x.ai`, `grok`, `elon`, `musk`). If any match, STOP — file a TASKS.md entry explaining the rejection.
4. Check if the competitor already exists in `COMPETITORS` (`grep -E "id: \"$id\"" novel/competitive-benchmark/src/competitors.ts`). If yes, this is a REFRESH, not an add.

### Phase 2 — research the published numbers

The 11 metrics in the M1.10 catalogue are at `novel/competitive-benchmark/src/metrics.ts`. Target ≥1 reading per competitor for these high-coverage metrics:

| Metric id                              | What to search for                                                         |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`      | "<competitor> SWE-bench Verified resolve rate"                            |
| `autonomous-merge-rate`                | "<competitor> PR merge rate" / "PR acceptance" / "first-pass merge"      |
| `human-intervention-rate`              | Inverse of merge rate — derive when only merge rate is published         |
| `mean-autonomous-merge-latency`        | "<competitor> per-task wall-clock" / "average runtime per issue"          |
| `cost-per-merged-pr`                   | "<competitor> cost per task" / "$ per issue" / token-cost economics      |
| `gate-pass-rate`                       | "<competitor> CI pass rate on first push" — rare, often omit            |
| `regression-escape-rate`               | "<competitor> regression rate" — rare, often omit                        |

For each candidate reading:

1. `WebSearch` for the vendor's primary publication (blog, paper, leaderboard, release notes). Avoid third-party analysis when the vendor has a primary citation.
2. `WebFetch` the source. Confirm the number on the page; extract the `asOf` date from the publication date.
3. Note the methodology — every reading needs a citation that includes the eval method (e.g., "SWE-bench Verified, pass@1, agentic harness").
4. If a competitor only publishes ONE metric (e.g., SWE-bench), accept it. Don't fabricate readings — visible-not-silent (Helland 2007).

### Phase 3 — draft the corpus entry

Write a draft JSON file at `/tmp/competitor-draft.json` matching the `Competitor` shape, then run the validator BEFORE touching `competitors.ts`:

```bash
# Add --refresh if you're updating an existing competitor (id collision is expected)
node scripts/competitor-research-validate.mjs --draft /tmp/competitor-draft.json
# Exit 0  → draft is shippable; proceed to phase 4
# Exit 1  → stderr lists each failed invariant; fix the JSON and re-run
```

The validator pins six invariants in one pass: kebab-case id, vendor-exclusion (Groq/xAI/Elon-affiliated), label/homepage/kind shape, published-source citation+asOf+values, local-harness citation+harnessId, and metric-id existence in the catalogue. The 21 paired tests at `scripts/competitor-research-validate.test.mjs` are the exhaustive contract.

Once the validator passes, open `novel/competitive-benchmark/src/competitors.ts` and add a new `Competitor` record (or update the existing one) at the end of the `COMPETITORS` array. Required fields:

```ts
{
  id: "<kebab-case-id>",
  label: "<Human-Readable Name (Vendor)>",
  kind: "closed-commercial" | "open-source",
  homepage: "https://...",
  resultSource: {
    kind: "published",
    citation:
      "<Vendor>, '<Title>', <url>, <YYYY-MM-DD> (<methodology>, <metric-value>); <second source if any>.",
    asOf: "<YYYY-MM-DD>",
    values: {
      "<metric-id>": <number>,
      // ...
    },
  },
}
```

Citation format mirrors the existing 6 competitors. Use semicolons to separate multiple sources in one `citation` string. The `asOf` is the date of the freshest reading in the `values` map.

### Phase 4 — draft the research file

Create or update `competitors/<id>.md`. Mirror the existing template:

```md
# Competitor: <Name> (<Vendor>)

> <One-sentence positioning vs Minsky>

- **URL**: <homepage>
- **Status**: <Active / Inactive>, <as-of summary>
- **Pricing**: <pricing model>
- **Relationship**: **Integration | Competitor | Research benchmark** — <one line>

## What it is
## Strengths
## Weaknesses vs Minsky's vision
## What we learn / steal
## Why choose Minsky over <competitor>
## Why choose <competitor> over Minsky

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `<metric-id>`                       | <val> | <YYYY-MM-DD> | <citation>    |

## Last reviewed

<YYYY-MM-DD>
```

Every row in the Scorecard readings table MUST match a `values` entry in `competitors.ts`. The `asOf` field in the corpus must match the freshest Date column here.

### Phase 5 — verify

Run these commands in order. Each must pass before the next:

```bash
# 1. Type-check the corpus
pnpm --filter @minsky/competitive-benchmark build

# 2. Run the package's unit tests (includes vendor-exclusion + corpus shape tests)
pnpm --filter @minsky/competitive-benchmark test

# 3. Run the CLI against the local repo — verifies the scorecard builds
bin/minsky competitive

# 4. Confirm the new competitor appears
bin/minsky competitive --json | jq '.competitors[] | select(.id == "<new-id>")'

# 5. Full lint stack — catches rule-3 (doc-first), rule-12 (scope), markdownlint, etc.
pnpm pre-pr-lint --stage=full
```

If `bin/minsky competitive` exits 1, read the `acceptance.gap` field in the JSON — the corpus is too thin. Add another reading or another competitor.

### Phase 6 — file follow-up tasks

If the new competitor covers fewer than 3 metrics, file a P2 follow-up in TASKS.md:

```md
- [ ] `corpus-refresh-<competitor-id>` — extend `<competitor>` to cover ≥3 shared scorecard metrics (currently <N>)
  - **ID**: corpus-refresh-<competitor-id>
  - **Tags**: p2, milestone-m1, m1-10, metrics, competitive, corpus-refresh
  - **Milestone**: M1
  - **Competitive-goal**: thickens the M1.10 scorecard's per-competitor cell density without changing the shape gate; deepens delta visibility for <competitor>.
  - **Details**: <competitor> currently publishes only <N> metric(s) in `competitors.ts`. Research <missing-metric-id> via <vendor blog | paper | leaderboard>. Each new reading needs a primary citation and an `asOf` date.
  - **Hypothesis**: more cells per competitor sharpens the delta signal for that vendor specifically.
  - **Success**: `bin/minsky competitive --json | jq '.competitors[] | select(.id == "<competitor-id>") | .resultSource.values | keys | length'` ≥ 3.
  - **Pivot**: if no additional metric is published within 90 days, mark the competitor as "single-metric coverage" in the research file — don't backfill with synthetic numbers.
  - **Measurement**: same shell snippet as Success.
  - **Anchor**: rule #4 (visible — every published metric narrows the comparison); rule #1 (don't reinvent — wait for the vendor to publish rather than running our own harness).
```

## Outputs

After running this skill successfully you have:

1. A new (or updated) entry in `novel/competitive-benchmark/src/competitors.ts`.
2. A new (or updated) `competitors/<id>.md` research file with the Scorecard readings table.
3. (Optional) A P2 follow-up TASKS.md entry if coverage is thin.
4. Green `bin/minsky competitive` showing the competitor in the scorecard grid.
5. All pre-pr-lint gates green.

## Anti-patterns

- **Don't fabricate readings.** If a vendor doesn't publish a number, leave the metric out. The corpus's `publishedValue()` returns `undefined` for missing keys; the scorecard renders "no data" — visible-not-silent per Helland 2007. Never coerce to 0 or to a guessed value.
- **Don't use third-party analysis as the primary citation.** Vendor blogs, papers, and leaderboards are primary; AgentMarketCap, Sacra estimates, etc. are secondary — cite them ONLY when no primary source exists, and call them "secondary" in the citation string.
- **Don't widen the shape gate just to include a thin competitor.** The M1.10 acceptance is ≥4 competitors × ≥5 metrics. If a new competitor only publishes 1 metric, that's fine — the shape gate is already met by the existing 5 competitors × 5 metrics.
- **Don't skip the vendor-exclusion check.** The operator-set deny list (`EXCLUDED_VENDOR_SUBSTRINGS`) is test-enforced in `competitors.test.ts`. A PR that adds an excluded vendor fails the build immediately; this skill catches it earlier.

## Anchor

- M1.10 milestone (`MILESTONES.md` line 24) — the scorecard's "scorecard updates weekly" criterion is what this skill maintains.
- `novel/competitive-benchmark/README.md` § "M1.10 acceptance — shape gate" — defines the gate this skill upholds.
- `vision.md` § "Pattern conformance index" row 93 — pins the substrate, lint, and schedule as `full` conformance.
- `vision.md` § "Pattern conformance index" row 95 — pins the auto-refresh loop (`check-corpus-freshness` + `auto-file-corpus-refresh-tasks` + scheduled fires) that calls this skill on a weekly cadence.
- Operator directive 2026-05-16 (TASKS.md `self-metrics-competitive-benchmark` block) — established the corpus + citation discipline this skill operationalizes.
- Operator directive 2026-05-22 ("add a mechanism so that minsky keeps competitors list updated and competitors there too") — established the self-refresh loop this skill participates in.
- 2026-05-22 corpus-expansion (PR #717) — first end-to-end run of this workflow; the skill is the codified pattern.
- Beyer, B., et al., *Site Reliability Engineering*, O'Reilly, 2016, ch. 17 — idempotent reconciliation as the design pattern for the autofile loop that calls this skill.
