---
name: reader-priority-docs
description: Structure technical docs by reader priority — what a brand-new reader needs to know RIGHT NOW, not by author chronology or feature completeness. Use when writing or restructuring READMEs, getting-started guides, contributor docs, or any operator-facing markdown that a reader unfamiliar with the project will land on. Don't use for API reference docs (alphabetical/type-based order is correct there), in-code docstrings (follow language convention), or spec docs (use `spec-driven-development` instead).
---

# reader-priority-docs

## When to invoke

Trigger phrases:

- "this doc is confusing", "wrong order", "I keep getting lost"
- "section X is in the wrong place"
- "the README leads with the wrong thing"
- "rewrite/restructure the README"
- "what does a new reader see first?"

Hard signals:

- A README that mentions maintenance / update / uninstall in the first 5 sections
- A walkthrough that requires the reader to know a niche term defined later
- Forward-references to tracker IDs (`P0 foo-bar`) inside the install or quick-start section
- Total reading time >5 min for a tool README
- An operator says they read the README and "still don't know what it does"

## When NOT to invoke

- API reference docs (`api/`, `*.api.md`, `docs/reference/`) — those follow alphabetical / type-based order
- Code docstrings — follow the language convention
- Specs and design docs — use `spec-driven-development`
- Changelogs and release notes — reverse-chronological by definition
- ADRs (architecture decision records) — chronological by definition

## The core principle

> **Order content by what the reader needs to know RIGHT NOW, not by what was easy or chronological for the author to write.**

The reader is a stranger who arrived because someone said "look at this". They have 30 seconds to decide whether to keep reading. The first 30 seconds must answer "do I care?"; the next 2 minutes must answer "can I try it?"; the next 5 minutes must answer "should I commit to it?". Anything that doesn't serve one of those three questions belongs lower in the doc — or in a separate doc entirely.

Author-chronology order (the bug this skill prevents): the author shipped feature A first, so A goes first; then B, so B goes second; etc. This produces a doc that's easy to write and useless to read.

## The 6-tier hierarchy

Every section in a tool-facing doc serves one of these tiers. Tag every section with its tier; sort by tier; the result is the correct order.

| Tier | Reader question | Time budget | What goes here |
|---|---|---|---|
| **1** | What is this and does it solve my problem? | 30 sec | One-line hook AND a 2-3 sentence concrete explanation of what the tool actually DOES (not what it competes with) |
| **2** | How do I try it? | 2 min | Install + run (≤2 commands), the minimum so the reader sees the thing work |
| **3** | What does it actually do? | 2 min | Mental-model walkthrough (numbered steps), glossary of one or two key terms the walkthrough uses |
| **4** | Should I commit to it? | 5 min | Honest capability table, known limits, edge cases (empty input, max runtime, error modes, communication channels). AND — **only when applicable** (see next section) — competitor comparison / positioning |
| **5** | How do I use it day-to-day? | reference | CLI reference, configuration, architecture overview, key files |
| **6** | How do I maintain it? | reference | Update workflow, uninstall, contribute, principles, license |

A section that doesn't fit any tier probably shouldn't be in the README — move it to a dedicated doc and link to it from the relevant tier.

**The critical sequencing rule (tier 1 ≠ positioning)**: tier 1 must establish "what IS this" — not "what it competes with". A reader who doesn't yet know what the tool does cannot judge a competitor table; the table just adds cognitive load and signals the author optimised for "marketing positioning" before "reader comprehension". Positioning is tier 4 at best, and often shouldn't be in the README at all (see the next section).

## Tier 1 paragraph — quality criteria

The tier-1 explanation paragraph that follows the tagline is the most-read piece of prose in the whole doc. It has five quality criteria — failing any one breaks the "I get it in 30 seconds" contract:

1. **Answers "why should the reader care?"** — the paragraph's first job is to tell the reader what they GET from the tool (the outcome / value), not how the tool works internally (the mechanism). A new reader doesn't yet know what your `TASKS.md` / `config.yaml` / `.foo/queue/` is; mentioning those internal artifacts in the tier-1 paragraph loads the reader with terminology they have to context-switch into before they can decide if they care. **Internal artifacts (file names, config keys, queue names, schema fields) and implementation details (event loops, watchdogs, locking, supervisor strategies) belong in the tier-3 walkthrough or the tier-5 "Key files" section — NOT in tier 1.** The tier-1 paragraph names the outcome ("the repo improves over time", "the bug gets fixed", "you get a draft PR") and at most one method-claim ("uses established / evidence-based / rigorous practices"); the reader needs zero project-specific glossary to understand it.
2. **First sentence is a standalone explanation** — a reader who reads ONLY the first sentence of the paragraph must be able to answer "what is this tool?". Subsequent sentences may add detail / mechanism / workflow, but the lede must be self-sufficient. This is the "newspaper lede" / "inverted pyramid" pattern (Williams 2007 *Style: Lessons in Clarity and Grace* Ch. 4 — old information before new; the most important fact comes first). Bad: a compound first sentence with three coordinated clauses the reader must parse together. Good: a single subject + single predicate answering "this tool runs/builds/serves/picks X".
3. **Brief** — ≤3 sentences, ≤60 words total. Anything longer feels dense and asks the reader to think hard. If you have more to say, push the details down into "What it actually does" or the tier-4 edge-case sections. The tier-1 paragraph is a sketch, not a manual.
4. **Concrete** — active verbs describing the actual behaviour (`attaches`, `improves`, `identifies`, `fixes`, `researches`, `runs`), not abstract claims (`enables`, `empowers`, `streamlines`). The reader should be able to picture exactly what the tool does after reading the paragraph.
5. **Dev voice, not marketing voice** — write like a developer's note in a Slack DM to another developer, not like a landing-page sales pitch. Specific anti-patterns: "You sleep, it ships PRs" / "Empowers developers to ship faster" / "The only X that Y" / "Built for modern teams" / "Forever" (when used dramatically rather than descriptively). Replace with descriptive verbs that say what the tool actually does.

Worked example — successive rewrites of the same tier-1 paragraph (real iteration trail from minsky's README, 2026-05-20):

```
v1 BAD (cheesy + condensed, 95 words, one paragraph):
> Minsky's daemon reads the `TASKS.md` file at the root of any git repo
> you point it at, picks the highest-priority task, spawns an AI agent
> (Devin, Claude, or a local model) to implement it on a feature branch,
> then opens a draft PR for you to review. It repeats this loop 24/7 —
> survives reboots, terminal close, and token-budget exhaustion (auto-
> fallback to a local model when the cloud agent runs dry). You add tasks
> (or let minsky audit the repo and add some for you); you wake up to
> draft PRs to merge.

v2 MEDIOCRE — brief + dev-voiced but the first sentence is COMPOUND
(three coordinated clauses), 30 words:
> Minsky reads tasks from your repo's `TASKS.md`, runs an AI agent to
> implement each one, and opens a draft PR for you to review. Then it
> picks the next task.

v3 STILL-WRONG — first sentence is standalone but LOADS the reader
with internal artifacts (TASKS.md, "tasks") before they know what
minsky DOES for them. Reader has to context-switch to figure out
what `TASKS.md` is before they can decide if they care, 39 words:
> Minsky runs AI coding agents on tasks in your repo's `TASKS.md`. It
> picks the highest-priority task, spawns an agent to implement it on
> a feature branch, and opens a draft PR for you to review.

v4 GOOD — answers "why should I care?" first (the repo improves over
time, with rigour); zero internal artifacts; no marketing voice; first
sentence is a standalone outcome statement, 41 words:
> Minsky attaches to a git repo and improves it over time, using
> established software-engineering practices. It identifies issues,
> works on each one until it's fixed, then researches what to do next
> — by default it runs until you stop it.
```

The v1 BAD version crams 8 distinct facts into one block — all those facts live in the tier-3 walkthrough / tier-4 edge-case sections already.

The v2 MEDIOCRE version is brief and dev-voiced, but the first sentence is compound (three coordinated clauses: `reads tasks ...`, `runs an AI agent ...`, `opens a draft PR ...`) so the reader has to parse all three to grasp the lede.

The v3 STILL-WRONG version has a clean standalone first sentence, but it leaks the project's internal vocabulary — `TASKS.md`, "tasks", "highest-priority task", "feature branch" — into tier 1. A stranger who's never heard of minsky doesn't know what any of those are; the paragraph asks them to learn the project's terminology before they can decide if they care. Mechanism + internal artifacts belong in the tier-3 walkthrough, not the lede.

The v4 GOOD version's first sentence — `Minsky attaches to a git repo and improves it over time, using established software-engineering practices` — answers "why should I care?" using zero project-specific terminology. The reader understands the value in 6 seconds: "this runs against a git repo, it makes the repo better, and it does so with rigour, not ad-hoc". The second sentence then describes the loop body in plain English: identifies → fixes → researches → repeats. The reader can decide whether they care before they learn what `TASKS.md` is (which they learn in "What it actually does" at tier 3).

## When does positioning belong in the README at all?

Positioning (competitor comparison tables, "vs X" sections, "we're the only Y that Z" claims) belongs in the README **only when ALL three conditions hold**:

1. **The tool has earned the comparison** — it's competitive on the headline dimensions readers will compare. An unstable / early-stage tool that loses on the dimensions the reader cares about is better off NOT inviting the comparison; the reader googles for "X vs Y" and finds the analysis if they want it.
2. **The competitive landscape is reasonably stable** — the named competitors exist, are well-known, and aren't moving targets. Comparing to a competitor that ships weekly makes your README go stale weekly.
3. **The reader's primary question is "which tool should I pick?"** — i.e., this README is genuinely a choice doc (e.g., the project is a well-known alternative to a well-known incumbent). If the reader's primary question is "what is this and how do I use it?", positioning is a distraction.

When ANY of those conditions fails, positioning moves OUT of the README:

- Per-competitor analysis lives in `competitors/` (or `comparisons/`, or `vs.md`) as a dedicated directory — link from "Key files" at tier 5
- A one-line "see `competitors/` for full comparisons" pointer near the bottom of the README is fine
- Up-front competitor comparison in the README's main flow is not fine

The deferral rule: **build the tool worth comparing first, then add the comparison**. Positioning is a confidence move; only make it when you can back it up. For unstable or pre-1.0 tools, the absence of a positioning section in the README is itself a signal that the team is focused on the work, not the marketing.

Anti-pattern surfaced 2026-05-20 (operator review of minsky's own README): "you don't really explain what it does and go into what it competes with" — a tagline followed immediately by a competitor table, with no explanation paragraph in between, asks the reader to evaluate positioning before they understand the tool. The fix (applied in the same commit that updated this skill): remove the competitor section entirely from the README (the three conditions all failed: stability ~10-24%, M1 not yet shipped, competitors evolving weekly), restore an explanation paragraph after the tagline, and keep `competitors/` as a dedicated directory linked from "Key files".

## The procedure

### Step 1 — Tag every section

Open the doc. For each `## section`, write the tier number in a margin comment:

```markdown
## What minsky does       <!-- tier 1: what IS this -->
## Getting started        <!-- tier 2: how do I try it -->
## What it actually does  <!-- tier 3: walkthrough -->
## Picking up upstream fixes  <!-- tier 6: maintenance -->
```

If a section serves two tiers (e.g., a hook + walkthrough crammed together), split it into two sections at different tiers.

### Step 2 — Sort by tier

Reorder sections so all tier-1 sections come first, tier-6 sections come last. Within a tier, order by salience to the average reader.

### Step 3 — Audit for tier mismatches

The most common bug: tier-4 / tier-5 / tier-6 content sitting in tier-1 / tier-2 position. Examples (real ones from minsky's history):

- "Picking up upstream fixes" (tier 6) right after "Getting started" (tier 2) — WRONG. Maintenance content blocks the try-it-out flow.
- "Competitors" (tier 4, sometimes) right after the tagline — WRONG. The reader doesn't yet know what the tool DOES, so they can't judge the comparison. See "When does positioning belong in the README at all?" above.
- "Architecture overview" (tier 5) right after the hook (tier 1) — WRONG. Internals before behaviour.
- "Roadmap / coming soon" inside the install section — WRONG. Forward-looking content belongs at tier 6 or in a separate `ROADMAP.md`.
- "Honest capability table" (tier 4) above "What it actually does" (tier 3) — WRONG. The reader needs to know what it does before judging what works.

### Step 4 — Test with a stranger

Read the doc top-to-bottom imagining a reader who has never seen the project. After every section, ask: **"would I keep reading?"**. If no, the section is in the wrong tier OR shouldn't exist in this doc at all.

A faster version: write down the FIRST 3 questions you'd want answered as a stranger; verify they're each answered in the first 3 sections.

### Step 5 — Move debris to tier 6 or out

Common debris that pollutes the main flow:

- **Tracker references** (`P0 minsky-foo-bar`, `tracked in TASKS.md`) — collect in a "Roadmap" subsection at tier 6, OR remove entirely (the README isn't a tracker mirror)
- **Implementation notes** ("uses `launchd KeepAlive=true`", "via `proper-lockfile`") — move into the architecture section at tier 5
- **Author-aside parentheticals** ("(this is rule #16 from vision.md)") — move into a separate "Contributing" or "Design principles" section at tier 6
- **TODO comments** in shipped docs — delete; file the TODO as a TASKS.md entry

## Worked example: tool README skeleton

A clean tool README in reader-priority order:

```markdown
# <Tool name>

> <One-line elevator pitch — what problem this solves, in 12 words or fewer>

<badges>

<2-3 sentence concrete explanation of what the tool actually DOES.    <!-- tier 1: what IS this -->
Specific behaviour the reader will see, not vague positioning. The
elevator pitch was the hook; this paragraph is the concrete reality.>

## Getting started                   <!-- tier 2: install + run -->

```bash
<install>
<run>
<stop>
```

## What it actually does             <!-- tier 3: walkthrough -->

1. ...
2. ...

> **What's a "X"?** <one-paragraph definition of any key term used above>

## What works today (honest)         <!-- tier 4: honest limits -->

| Capability | Status | Confidence |
|---|---|---|
| ... | ... | ... |

## What it will NEVER do             <!-- tier 4: anti-features -->

## Edge cases                        <!-- tier 4: empty input / max runtime / errors -->

### How long does it run?
### What if <main input> is empty?
### How does it talk to humans?

<!-- OPTIONAL — tier 4 positioning, ONLY when the 3 conditions hold (see -->
<!-- "When does positioning belong in the README at all?" above). For most -->
<!-- early-stage tools this section is omitted; the competitor analysis    -->
<!-- lives in `competitors/` and is linked from "Key files" instead.       -->
<!--                                                                        -->
<!-- ## What it competes with             <!-- tier 4: positioning -->       -->
<!--                                                                        -->
<!-- | Tool | Their advantage | This tool's advantage |                     -->
<!-- |---|---|---|                                                          -->
<!-- | ... | ... | ... |                                                    -->

## CLI reference                     <!-- tier 5: reference -->

## Configuration                     <!-- tier 5: reference -->

## Architecture (30 seconds)         <!-- tier 5: reference -->

## Key files                         <!-- tier 5: reference -->

## Principles                        <!-- tier 6: design philosophy -->

## Picking up upstream fixes         <!-- tier 6: maintenance -->

## Uninstall                         <!-- tier 6: maintenance -->

## License                           <!-- tier 6: legal -->
```

Note what's NOT in the skeleton:

- A "Quick start" that duplicates Getting started
- A "FAQ" — if a question's worth answering, fold it into the relevant tier
- A "Why we built this" — fold into the elevator pitch at tier 1, or delete
- Section dividers (`---`) used as content — they're decoration, not organization

## Anti-patterns to scan for

When auditing an existing doc, grep for these red flags:

| Red flag | Why it's wrong | Fix |
|---|---|---|
| "Picking up upstream fixes" / "Updating" / "Upgrade guide" in the first 5 sections | Tier 6 maintenance blocking tier 2 try-it-out | Move to tier 6 |
| Competitor / "vs X" / positioning table appears before the reader knows what the tool DOES | Tier 4 positioning at tier 1 position; reader can't judge the table | Either remove (apply the 3-condition test) or move to tier 4 AFTER the walkthrough |
| Tagline followed immediately by a competitor section, no explanation paragraph between | Reader leaves the tier-1 section without knowing what the tool actually does | Add a tier-1 explanation paragraph (2-3 sentences of concrete behaviour) between tagline and the next `##` |
| Tier-1 paragraph longer than ~60 words / 3 sentences | Feels dense; reader has to think hard. Most details belong in the tier-3 walkthrough or tier-4 edge-case sections, not at the top | Cut to ≤3 sentences sketching only the steady-state loop. Push the rest down. |
| Tier-1 paragraph's FIRST sentence is compound (≥3 coordinated clauses joined by commas) and doesn't stand alone as an explanation | Reader who scans only the first sentence still doesn't know what the tool does — they have to read the whole sentence's worth of clauses to grasp the lede | Rewrite so the first sentence is a single subject + single predicate that fully answers "what is this tool?". Move the mechanism / loop body to the second sentence. See "Tier 1 paragraph — quality criteria" criterion 2. |
| Tier-1 paragraph names internal artifacts the reader doesn't know yet (`TASKS.md`, `config.yaml`, `.foo/queue/`, custom JSON schema fields) or implementation details (event loops, watchdogs, supervisor strategies, locking) | Reader has to context-switch to figure out what those names mean before they can decide if they care — and they're not the reason to care anyway, they're internals | Rewrite to name the OUTCOME (the repo improves, the bug gets fixed, you get a PR) and at most one method-claim ("uses established / evidence-based / rigorous practices"). Push internal artifacts down to tier 3 walkthrough or tier 5 "Key files". See "Tier 1 paragraph — quality criteria" criterion 1. |
| Tier-1 paragraph uses marketing voice ("You sleep, it ships PRs", "Empowers developers", "The only X that Y") | Signals selling-point, not dev-perspective; readers tune out | Rewrite with active verbs describing the actual loop body. See "Tier 1 paragraph — quality criteria" above. |
| Tagline includes a value-prop selling line ("You sleep, it ships PRs") rather than a descriptive claim | Same as above — marketing voice in the tier-1 slot | Replace with a descriptive line: "Background daemon that runs AI coding agents against tasks in any git repo" |
| `> Tracked as P0 X in TASKS.md` callouts in install / quickstart | Tracker chatter polluting tier 2 | Move to tier 6 "Roadmap" or delete |
| Configuration table before any usage example | Tier 5 reference before tier 3 walkthrough | Keep table; move below walkthrough |
| "Architecture" or "Internals" diagram in the first 3 sections | Tier 5 internals before tier 3 behaviour | Move to tier 5 |
| "What it will never do" before "What it does" | Tier 4 limits before tier 3 walkthrough | Reorder |
| Honest-limits table above the elevator pitch | Tier 4 limits drowning tier 1 hook | Move below "What it does" |
| Forward-pointers to other docs in the first paragraph | Reader hasn't decided to care yet | Defer to tier 5 or 6 |

## Verification checklist

Before claiming a doc is reader-priority-ordered, verify:

- [ ] First content after the title is a tier-1 explanation paragraph — concrete sentences saying what the tool DOES (not what it competes with)
- [ ] Tier-1 paragraph answers "why should the reader care?" — names the OUTCOME the reader gets (the repo improves, the bug gets fixed, you get a PR), not internal artifacts (file names, config keys, queue names) or implementation details (event loops, watchdogs, supervisor strategies)
- [ ] Tier-1 paragraph's FIRST sentence is a standalone explanation — reading only that one sentence answers "what is this tool?" (single subject + single predicate; not a 3-clause compound)
- [ ] Tier-1 paragraph is ≤3 sentences and ≤60 words (the "I get it in 30 seconds" contract)
- [ ] Tier-1 paragraph uses active descriptive verbs (`reads`, `picks`, `runs`, `opens`) — no marketing voice (`You sleep, it ships PRs`, `Empowers developers`, etc.)
- [ ] Tagline is descriptive, not a selling-line — "Background daemon that runs X" beats "You sleep, it ships PRs"
- [ ] No competitor / positioning section appears above the walkthrough — either the 3 conditions hold and the table is at tier 4, or the table is out entirely
- [ ] Within 2 minutes of reading, the reader has seen the install + run commands (tier 2 reached)
- [ ] No tier-5 or tier-6 content appears above the "What it actually does" / behaviour walkthrough
- [ ] Operator-only content (update, uninstall, maintenance) lives at the bottom (tier 6)
- [ ] No forward-references to tracker IDs appear in the install / quick-start section
- [ ] Total reading time < 5 min for the README (count words / 250 wpm)
- [ ] Stranger-test passed: a reader who's never seen the project can answer "what does this do?" after the first 2 sections

## Output shape

When this skill is invoked:

1. Tag every section in the target doc with its tier (as a temporary in-place comment)
2. Show the operator the current tier order vs the proposed tier order in a side-by-side table
3. Reorder sections; remove or relocate debris; collapse duplicates
4. Run the verification checklist; report any remaining red flags

The skill doesn't write new content — it only restructures what's already there. New content goes through the normal write flow.

## Source

Pattern conformance: information architecture by audience priority (Krug, _Don't Make Me Think_, 2014, Ch. 2 — "the average user spends 10 seconds on a page before deciding whether to leave"); progressive disclosure (Nielsen, _Usability Engineering_, 1993); reader-driven document order (Williams, _Style: Lessons in Clarity and Grace_, 2007, Ch. 4 — "old information before new").

Anti-patterns sourced from observed bugs in this repo's README (PR #648 README rewrite + PR #668 clarity pass + 2026-05-20 operator review).
