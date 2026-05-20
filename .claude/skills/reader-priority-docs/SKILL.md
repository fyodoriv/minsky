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
| **1** | Does this solve my problem? | 30 sec | One-line hook, demo, problem statement, screenshot/gif |
| **2** | Am I the target user? | 1 min | Competitor comparison, positioning, anti-positioning ("not for X") |
| **3** | How do I try it? | 2 min | Install + run (≤2 commands), the main behaviour walkthrough, glossary of one or two key terms the walkthrough uses |
| **4** | Should I commit to it? | 5 min | Honest capability table, known limits, edge cases (empty input, max runtime, error modes, communication channels) |
| **5** | How do I use it day-to-day? | reference | CLI reference, configuration, architecture overview, key files |
| **6** | How do I maintain it? | reference | Update workflow, uninstall, contribute, principles, license |

A section that doesn't fit any tier probably shouldn't be in the README — move it to a dedicated doc and link to it from the relevant tier.

## The procedure

### Step 1 — Tag every section

Open the doc. For each `## section`, write the tier number in a margin comment:

```markdown
## Getting started        <!-- tier 3: how do I try it -->
## Competitors            <!-- tier 2: am I the target user -->
## Picking up upstream fixes  <!-- tier 6: maintenance -->
```

If a section serves two tiers (e.g., "What it does" is tier 1 elevator + tier 3 walkthrough), split it into two sections at different tiers.

### Step 2 — Sort by tier

Reorder sections so all tier-1 sections come first, tier-6 sections come last. Within a tier, order by salience to the average reader.

### Step 3 — Audit for tier mismatches

The most common bug: tier-5 / tier-6 content sitting in tier-1 / tier-2 position. Examples (real ones from minsky's history):

- "Picking up upstream fixes" (tier 6) right after "Getting started" (tier 3) — WRONG. Maintenance content blocks the try-it-out flow.
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

## What it competes with             <!-- tier 2: positioning -->

| Tool | Their advantage | This tool's advantage |
|---|---|---|
| ... | ... | ... |

## Getting started                   <!-- tier 3: install + run -->

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
| "Picking up upstream fixes" / "Updating" / "Upgrade guide" in the first 5 sections | Tier 6 maintenance blocking tier 3 try-it-out | Move to tier 6 |
| `> Tracked as P0 X in TASKS.md` callouts in install / quickstart | Tracker chatter polluting tier 3 | Move to tier 6 "Roadmap" or delete |
| Configuration table before any usage example | Tier 5 reference before tier 3 walkthrough | Keep table; move below walkthrough |
| "Architecture" or "Internals" diagram in the first 3 sections | Tier 5 internals before tier 3 behaviour | Move to tier 5 |
| "What it will never do" before "What it does" | Tier 4 limits before tier 3 walkthrough | Reorder |
| Honest-limits table above the elevator pitch | Tier 4 limits drowning tier 1 hook | Move below "What it does" |
| Forward-pointers to other docs in the first paragraph | Reader hasn't decided to care yet | Defer to tier 5 or 6 |

## Verification checklist

Before claiming a doc is reader-priority-ordered, verify:

- [ ] First section after the title answers "does this solve my problem?" (tier 1)
- [ ] Competitor / positioning section appears before the deep walkthrough (tier 2 before tier 3)
- [ ] Within 2 minutes of reading, the reader has seen the install + run commands (tier 3 reached)
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
