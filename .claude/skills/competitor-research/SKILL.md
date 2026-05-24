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

Optional flags:

- `--refresh` — updating an existing competitor's readings (id already in `COMPETITORS`). This is the canonical flag used by the auto-refresh pipeline's filed `corpus-refresh-<id>` tasks (see "How the auto-refresh loop calls this skill" below).
- `--deep` — run the **Five Pivot Questions framework** (Phase 7 below) in addition to the standard corpus + research-file workflow. Use for ≥500-star competitors and any time the operator says "deep research", "what can we learn", "should we pivot", or "could this replace part of Minsky?". `--deep` is implicit when the URL is on the deep-dive watchlist in `competitors/README.md` § "Deep-dive watchlist" (forthcoming).
- `--post-mortem` — the competitor is dead (archived, no commits >180d, vendor pivoted away). Run the standard workflow PLUS a "Why it died" section sourced from GitHub issues, HN/Reddit threads, and the project's own changelog. Pair with `--deep` for full strategic value.

```
/competitor-research https://www.cognition.ai --refresh
/competitor-research https://github.com/cline/cline --deep
/competitor-research https://github.com/sweepai/sweep --deep --post-mortem
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

### Phase 6 — file follow-up tasks for every actionable finding (iron rule)

**Research findings → tasks. Every time.** Discoveries from a deep dive are not notes for later — they are work to file in TASKS.md in the same PR as the research itself. The operator's standing rule (2026-05-22): *"all discoveries made by Minsky during any research must immediately be taken into consideration and lead to actual changes. They should be converted to tasks."*

Concrete trigger inventory — file ONE task per item found, in the same PR:

| Finding shape | Default priority | Task ID prefix |
|---|---|---|
| Competitor covers fewer than 3 metrics in the corpus (the existing thin-coverage case) | P2 | `corpus-refresh-<id>` |
| **Architectural pattern worth borrowing** (Docker sandbox, hierarchical memory, manager-agent delegation, event-driven Flows, pluggable sandbox layer, etc.) | P3 | `research-finding-<descriptor>` |
| **Roadmap threat** (competitor launching a feature that overlaps a Minsky moat) | P2 | `monitor-<competitor>-<feature>-launch` |
| **Gap that operators ask about** (competitor publishes X, Minsky doesn't — e.g., headline benchmark, enterprise distribution, multi-agent ensembling) | P2 | `<gap-descriptor>` |
| **Visibility / framing fix** (the gap is buried in a research file but should surface at README-table level) | P2 | `<surface>-<gap>-comparison-row` |
| **Forward-tracking invariant** (when X ships, sweep N files to flip the framing — e.g., when MAPE-K closed loop ships, the moats table needs a coherence sweep) | P3 | `research-finding-<x>-shipping-status-banner` |
| **Honesty fix** (a current Minsky claim doesn't match the underlying user-story status) | P1 | `<claim>-honesty-fix` |

**The skill is to FILE THE TASK, not write the implementation.** A good research-followup task names the finding, the source competitor file/line, the hypothesis (will adopting this help?), the success criterion (what does "done" look like?), and the pivot (what makes us reject this?).

Common shapes for the canonical thin-coverage case:

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

Shape for an architectural-pattern finding (use this as the template for "X has Y, we should evaluate"):

```md
- [ ] `research-finding-<descriptor>` — research <competitor>'s <pattern>; <one-sentence on why Minsky cares>
  - **ID**: research-finding-<descriptor>
  - **Tags**: p3, research-followup, observed-<YYYY-MM-DD>, <competitor>-deep-dive, <milestone-tag>
  - **Milestone**: <M1|M2|M3|M4>
  - **Competitive-goal**: closes the "<gap acknowledged in competitors/<id>.md>" gap.
  - **Touches**: <file paths the research output produces / informs>.
  - **Details**: <which file/line surfaced the finding; what to read; what 3-5 questions to answer>.
  - **Hypothesis**: <will the pattern help / hurt Minsky's specific call graph>.
  - **Success**: <a research file at research/<descriptor>.md or a spike implementation that runs the existing tests>.
  - **Pivot**: <what makes us reject this pattern>.
  - **Measurement**: <runnable shell command that produces exit 0 when Success is met>.
  - **Anchor**: rule #1 (don't reinvent — vendor X shipped this, evaluate before building); competitors/<competitor>.md § <section>; <vendor maintainer + file path + URL>.
```

### Phase 7 — the Five Pivot Questions framework (`--deep` mode)

Triggered by `--deep` flag, by `--post-mortem`, or by any operator phrase that implies strategic-level analysis ("what can we learn", "should we pivot", "is this a vision-threat"). The framework forces the research file past surface taxonomy into the five questions that actually inform Minsky's strategic choices.

**Append to `competitors/<id>.md`** as a `## Five pivot questions` section (after the existing "Why choose Minsky over X / Why choose X over Minsky" sections):

```md
## Five pivot questions

### 1. How is it different from Minsky?
<2-4 sentence diff focused on architecture and intent, not features. Cite ≥1 primary source (their docs / paper / blog).>

### 2. What lessons can it give to us?
<Bullet list of ≥2 architectural patterns, design decisions, or operational practices Minsky should consider absorbing. Each lesson MUST cite the exact file/blog/paper section.>

### 3. Are any of these lessons potentially vision-changing?
<If yes: name them explicitly AND append a new entry to the repo's `ask_human.md` (per the agentbrew shared rule "Async human comms — ask_human.md"; this is the adopted [ask-human-mcp](https://github.com/masony817/ask-human-mcp) convention). If no: state "no vision-changing finding" with one-sentence reasoning so the negative finding is auditable. Vision-changing means the lesson would force a rewrite of `vision.md § What Minsky is` or invalidate one of the 17 rules — not "we should add a feature".>

### 4. How can we improve our strategy based on this?
<Concrete, actionable strategy-level improvements (NOT individual feature requests). Examples of valid answers: "Tighten the 'no framework' moat by publishing comparison X." / "Accept that Y is commodity and stop building it ourselves." Each improvement MUST trace to a specific lesson from §2.>

### 5. Can and should we cut corners by replacing part of Minsky with this?
<For each Minsky surface (tick-loop, MAPE-K, adapters, sandbox, corpus, dashboard, etc.) say one of: REPLACE (with concrete migration sketch + estimated surface % cut), AUGMENT (use alongside, name the seam), KEEP (Minsky's version is superior, name why), or N/A (out of scope). Total replace % across all surfaces is the headline number for the operator.>
```

**Operator escape hatch**: the repo's `ask_human.md` (the adopted [ask-human-mcp](https://github.com/masony817/ask-human-mcp) convention — see agentbrew shared-rules.md § "Async human comms — ask_human.md") is the human-↔-agent comm channel for question #3. Every finding flagged as vision-changing MUST be appended there using the canonical Q-block format. The operator reads the file (or the `ask-human-mcp` daemon notifies them), replaces `answer: PENDING` with their decision inline, and the agent re-reads to continue.

```md
### Q<8-char-hex-id>
ts: YYYY-MM-DD HH:MM
q: vision-threat: <one-line headline>. <The specific decision the operator must make.>
ctx: competitor: <id>. vision section threatened: `vision.md § <section>` line N: "<exact quoted text>".
     what they do instead: <2-3 sentences>. source: <citation>. recommendation: <pivot | absorb pattern | reject as off-strategy>.
answer: PENDING
```

Generate the Q-id with `openssl rand -hex 4`. Never reuse an id. The Q block stays in the file even after the answer lands — it's the audit trail.

**Anti-pattern in `--deep` mode**: "lessons" that are really feature requests in disguise. Question 2's answer is "patterns and practices", not "we should add X widget". If a lesson can be reframed as a single feature ticket, it's question 4 material (strategy), not question 2 material. If you can't trace a lesson to a specific named pattern in literature OR to a specific file in the competitor's repo, it's not a lesson — drop it.

**Post-mortem mode (`--post-mortem`)**: when the competitor is dead, add this section between "What we learn / steal" and "Five pivot questions":

```md
## Post-mortem: why it died

- **Last meaningful commit**: <date>; **archived flag**: <yes/no>; **vendor pivoted to**: <name + URL or N/A>
- **Root cause** (one of: architectural-dead-end / business-model-failure / vendor-acquisition / community-collapse / model-obsoleted-the-niche): <choose + cite>
- **Evidence**: ≥3 sources — GitHub issues showing the death spiral, an HN/Reddit thread declaring it dead, the project's own README/CHANGELOG announcing the pivot.
- **Lesson for Minsky** (mandatory): name the specific Minsky rule, decision, or invariant that prevents Minsky from dying the same way. If you can't find one, file a P1 task to add the missing guardrail.
```

### Anti-pattern: research-without-tasks

If you spent ≥30 minutes reading a competitor and produced ≥1 substantive finding (architectural pattern, roadmap threat, capability gap, honesty issue), and the PR does NOT file ≥1 follow-up task, you've leaked the work into the chat and the next session has to re-derive it. This is the rule-#17 (proactive healing) failure mode in research shape — *observation IS the fix*; the fix here is "file the task". The deterministic gate at `scripts/check-research-findings-filed.mjs` (forthcoming) catches this; until it ships, the discipline is reviewer-enforced.

### Phase 7 — the "should we wrap them instead?" question (iron rule)

**Every direct-competitor research run MUST end with a written wrap-feasibility analysis.** Operator's standing rule (2026-05-22):

> *"for every direct competitor (eg crewai) you must deeply research should we replace part of minsky with that competitor's work. Eg if crewai is amazing at everything we do, why not wrap around it and let run for 24h or is it not possible? And honestly, if yes, create a P0 human blocked task where you propose the change. This must happen each time we update competitors"*

This is rule #1 (don't reinvent) at maximum scale. If a competitor is genuinely better at what Minsky does, the right move is to wrap it — keep the daemon shell + operator-machine-identity + constitution-as-CI, delegate the agent/orchestrator layer to them. The skill enforces the question explicitly because the default failure mode is "we just shipped competitor research without ever asking it".

**Which competitors get the analysis** — "direct competitors" means:

- **Orchestrator-tier**: CrewAI, MetaGPT, AutoGen, LangGraph, OpenAI Agents SDK — peers that could plausibly replace Minsky's orchestrator layer.
- **Agent-tier**: Claude Code, Devin, Aider, OpenHands, SWE-Agent, Cursor Agent, OpenAI Codex, Augment Code — already-wrapped or wrappable as Minsky backends; analyse whether we should add as a pluggable agent OR lock in to one.
- **Skip for**: pure infrastructure tools (sandboxes, vector DBs, eval harnesses) — they're not "competitors", they're potential dependencies.

**Format** — every `competitors/<id>.md` gets a `## Should we wrap <competitor> instead?` section answering five questions:

| Question | Output |
|---|---|
| 1. **Architectural fit** | Could the competitor act as a drop-in agent/orchestrator that Minsky's daemon wraps? Frame in one paragraph. |
| 2. **What we delegate** | Which Minsky layer (agent / orchestrator / fleet / queue) would the competitor own after the wrap? |
| 3. **What we keep** | Of Minsky's 6 moats (daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface), how many survive? List them. |
| 4. **Net moat after wrap** | Count of moats that survive. If ≤3 of 6, the wrap collapses Minsky's distinctiveness — verdict NO. If ≥4 of 6, the wrap is worth proposing. |
| 5. **Verdict** | YES (file P0 task) / PARTIAL YES (file P0 for the partial wrap; reject the full wrap) / NO (document why, no task). |

Plus a **trigger for re-evaluation**: under what observable conditions does this analysis flip? Examples: "if competitor publishes a self-host variant" / "if Minsky publishes a benchmark beating theirs" / "if competitor open-sources their orchestration layer". This is the pre-registered pivot per rule #9 applied at the strategic level.

**When the verdict is YES or PARTIAL YES**: file a P0 human-blocked task. Format:

```md
- [ ] `should-we-add-<competitor>-as-pluggable-backend` OR `should-we-replace-<minsky-layer>-with-<competitor>-wrap` — <one-line description of the proposed change>
  - **ID**: should-we-...
  - **Tags**: p0, human-blocked, wrap-feasibility, <competitor>, observed-<YYYY-MM-DD>, AIFN-needed
  - **Blocked**: needs-operator-strategic-decision
  - **Milestone**: <M2|M3|M4>
  - **Competitive-goal**: <what gap this closes; reference the wrap analysis section in competitors/<id>.md>
  - **Touches**: <files that need to change>
  - **Details**: <one-paragraph summary of the wrap shape; pointer to competitors/<id>.md § "Should we wrap?" for the full analysis; unblock path (operator reviews → operator decides → AIFN ticket → PR)>
  - **Hypothesis**: <falsifiable: what does success look like?>
  - **Success**: <measurable outcome>
  - **Pivot**: <when do we revert?>
  - **Measurement**: <runnable command>
  - **Anchor**: rule #1 (don't reinvent — competitor X is amazing at Y, inherit the capability); operator directive 2026-05-22; competitors/<id>.md § "Should we wrap?"; primary citations.
  - **Surfaced-by**: <YYYY-MM-DD> wrap-feasibility analysis pass.
```

**When the verdict is NO**: document the analysis in `competitors/<id>.md` § "Should we wrap?" with the 5 questions answered + the trigger-for-re-evaluation. NO task is filed, but the analysis must exist as a written artifact so the next research pass can re-evaluate against the same questions.

**The five common verdicts and their canonical reasoning**:

1. **PARTIAL YES** (one layer wraps cleanly, another doesn't) — e.g., OpenHands: agent-layer wrap = YES (file P0); orchestrator-layer wrap = NO (collapses 3 moats). File ONE P0 for the partial wrap that works.
2. **ALREADY WRAPPED** (current architecture already delegates to this competitor at the right layer) — e.g., Devin via `cloud_agent: "devin"`. Don't file a new P0; analysis explains why the further-wrap question is NO.
3. **STRUCTURAL MISMATCH** (competitor is the wrong shape for Minsky's task distribution) — e.g., CrewAI (general-purpose, not coding-specific) / MetaGPT (greenfield, not brownfield). Document why; file P2/P3 research tasks for portable PATTERNS to steal instead of wrapping the framework.
4. **MOAT COLLAPSE** (the wrap would drop net moats below 3 of 6) — e.g., full Devin wrap kills operator-machine-identity + daemon-not-framework + cross-repo-fleet. Document why; the wrap fails the distinctiveness test from `competitors/README.md` § "What Minsky uniquely does".
5. **CLEAN YES** (rare; competitor is genuinely a drop-in replacement for a Minsky layer with no moat cost). File P0 immediately. As of 2026-05-22 this has never been the verdict — included for completeness.

### Anti-pattern: research-without-wrap-analysis

A competitor research run that updates `competitors/<id>.md` but does NOT include a `## Should we wrap <competitor> instead?` section is incomplete. The `scripts/check-competitor-has-wrap-analysis.mjs` deterministic gate (forthcoming — file as a follow-up task if you're hitting this) catches the pattern; until it ships, the discipline is reviewer-enforced. Same shape as the rule-#17 "research-without-tasks" anti-pattern above.

## Outputs

After running this skill successfully you have:

1. A new (or updated) entry in `novel/competitive-benchmark/src/competitors.ts` (if the competitor publishes ≥1 quantitative metric; skip if no primary number exists — `--deep` mode does NOT require corpus entry).
2. A new (or updated) `competitors/<id>.md` research file with the Scorecard readings table.
3. **In `--deep` mode**: a `## Five pivot questions` section at the bottom of `competitors/<id>.md` answering all 5 questions with primary-source citations.
4. **In `--deep` mode, if vision-threat found**: ≥1 Q-block appended to `ask_human.md` (repo root) per the adopted ask-human-mcp convention. The block stays in the file even after the operator answers; it's the audit trail.
5. **In `--post-mortem` mode**: a `## Post-mortem: why it died` section with ≥3 evidence sources and ≥1 named Minsky guardrail.
6. (Optional) P2/P3 follow-up TASKS.md entries per Phase 6 — for thin coverage, architectural-pattern findings, roadmap threats, capability gaps, etc.
7. Green `bin/minsky competitive` showing the competitor in the scorecard grid (only if a corpus entry was added).
8. All pre-pr-lint gates green.

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
