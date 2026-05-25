---
name: reader-priority-docs
description: Structure technical docs AND pull-request descriptions by reader priority — what a cold reviewer or stranger needs to know RIGHT NOW, not the author's investigation chronology. Use when writing or restructuring READMEs, getting-started guides, contributor docs, any operator-facing markdown, and EVERY PR description / PR body the agent authors or edits. Don't use for API reference docs (alphabetical/type-based order is correct there), in-code docstrings (follow language convention), or spec docs (use `spec-driven-development` instead).
---

# reader-priority-docs

## When to invoke

Trigger phrases (docs):

- "this doc is confusing", "wrong order", "I keep getting lost"
- "section X is in the wrong place"
- "the README leads with the wrong thing"
- "rewrite/restructure the README"
- "what does a new reader see first?"

Trigger phrases (PR descriptions — invoke EVERY time you author or edit a PR body):

- "open a PR", "create a PR", "write the PR description", "update the PR body"
- "PR is hard to read", "reviewer doesn't get it", "PR buries the lede"
- "rewrite the PR description"
- Implicit: ANY `gh pr create` / `gh pr edit --body*` invocation goes through this skill's PR-description section. PR descriptions ship to reviewers who are even more time-pressed than README readers; the cold-reader order is non-negotiable.

Hard signals (docs):

- A README that mentions maintenance / update / uninstall in the first 5 sections
- A walkthrough that requires the reader to know a niche term defined later
- Forward-references to tracker IDs (`P0 foo-bar`) inside the install or quick-start section
- Total reading time >5 min for a tool README
- An operator says they read the README and "still don't know what it does"

Hard signals (PR descriptions):

- The first paragraph of the PR body opens with implementation detail ("TypeScript can't catch X", "the resolver in selectFoo silently drops Y") before any sentence the reviewer could answer "what does this PR do?" from
- The PR body opens with a numbered list of failure modes / edge cases — that's tier 3+ content
- A reviewer who reads only the title + first sentence still doesn't know what the PR changes
- "Why this is needed" runs >100 words and mentions internal artifacts (file paths, selector names) before the user-facing outcome
- Screenshots / visual evidence buried below several sections of prose for a UI-affecting PR
- Test plan or rollback content above the "what changed" summary

## When NOT to invoke

- API reference docs (`api/`, `*.api.md`, `docs/reference/`) — those follow alphabetical / type-based order
- Code docstrings — follow the language convention
- Specs and design docs — use `spec-driven-development`
- Changelogs and release notes — reverse-chronological by definition
- ADRs (architecture decision records) — chronological by definition

## The core principle

> **Order content by what the reader needs to know RIGHT NOW, not by what was easy or chronological for the author to write.**

The reader is a stranger who arrived because someone said "look at this". **They have 12 seconds, not 12 minutes.** The first 12 seconds must answer "do I care?"; the next 2 minutes must answer "can I try it?"; the next 5 minutes must answer "should I commit to it?". Anything that doesn't serve one of those three questions belongs lower in the doc — or in a separate doc entirely.

Author-chronology order (the bug this skill prevents): the author shipped feature A first, so A goes first; then B, so B goes second; etc. This produces a doc that's easy to write and useless to read.

## Six iron rules for the top of the doc

These are the load-bearing rules. Violating any one of them is sufficient to fail the cold-reader test even if everything else is perfect. They are independent of the tier hierarchy below — think of them as filters that apply BEFORE you start tier-tagging.

### Rule 1 — No time-to-read banners measured in minutes at the top

> Wrong: `Three reads, ~12 minutes total: this README → vision.md → MILESTONES.md`
> Wrong: `~15 minutes to read end-to-end`
> Wrong: `Estimated reading time: 8 min`
>
> Right: no banner at all. The doc's structure IS the contract.

Cold readers don't have 12 minutes. They have ~12 seconds before they decide whether to keep reading; if your README opens with "12 minutes to read", you've already lost — they bounce immediately or feel manipulated when they realise the banner is aspirational not measured. Even when the banner is honest, it telegraphs "this doc is long" to a reader who is shopping for short. Delete it.

Time-to-read banners are acceptable ONLY in tier-5 reference docs (e.g., an architecture overview labeled "~10 min read") because the reader has already decided to commit. They are never acceptable in a tier-1 / tier-2 surface.

### Rule 2 — No navigation choices ("read X OR skip to Y") above the first `## section`

> Wrong: `[Seven reasons you'd want this →](#why) · Or skip to [getting started](#getting-started).`
> Wrong: `If you're an operator, read X; if you're a contributor, read Y; if you're curious, read Z.`
> Wrong: `TL;DR · Quick start · Architecture · Comparison · License` (jump links at the top of a tool README)
>
> Right: the author sets the flow. Reader reads top-to-bottom; if they bounce, they were not the audience.

A choice menu at the top is the author admitting they don't know what the reader should read first. That's the author's job to decide. Choice paralysis at byte zero is worse than serving the wrong content to one reader segment.

**The only acceptable exception**: a table of contents at the top of a genuinely large doc (≥2000 lines, e.g., a full specification or RFC). For a tool README under 500 lines, the answer is always "no choice menu at the top".

Choices ARE welcome at the BOTTOM of the doc ("Where to read next — pick by audience"). That's tier 6, after the reader has committed.

### Rule 3 — Internal taxonomy goes deep, not at the top

> Wrong (at the top): `## Minsky's position — Minsky is an orchestrator, not an agent. It sits ABOVE Claude / Devin...`
> Wrong (at the top): `Foo is a library, not a framework — it does X not Y.`
> Wrong (at the top): `Bar is a P2P system in the Y class of Z-style protocols.`

Internal taxonomy is the project team's mental model — which competitive bucket the tool sits in, which architectural pattern it follows, which framing the maintainers use internally. The reader doesn't have the same context; the taxonomy reads as inside baseball.

A cold reader's first 12 seconds need to answer "what does this do for me?" — not "which conceptual category does this belong to?". Move all self-classification (`X is an orchestrator`, `X is a daemon-not-framework`, `X is a peer of Y but not Z`) to **tier 5 (reference) or tier 6 (design principles)**. The reader gets there only after they've decided to commit; at that point taxonomy is useful context.

If the taxonomy is genuinely market-critical (the project is a well-known alternative to a well-known incumbent and the comparison sells), that's a tier-4 positioning section — not a tier-1 framing claim. See "When does positioning belong in the README at all?" below.

### Rule 4 — Why X before What X does

> Wrong (this order): What it actually does (mechanism) → Why you'd want it (benefit)
> Right (this order): Why you'd want it (benefit) → How it works (mechanism)

A cold reader who arrives because someone said "look at this" needs the BENEFIT first — what they GET from the tool — before they care about the MECHANISM. "Why X" sells the tool; "How X works" explains it. The reader can't judge the mechanism until they know why the mechanism matters to them.

This rule applies at the section level (Why-section before How-section) AND at the paragraph level inside the tier-1 lede (outcome sentence before mechanism sentence). Combined with the existing Tier-1 paragraph criteria, this means:

- Sentence 1 of the lede: outcome ("the repo improves over time, with rigour")
- Sentence 2-3 of the lede: lightest mechanism sketch ("identifies issues, fixes them, opens a PR")
- Section 2 of the README: more benefits (the "Why" section listing the 5-7 reader-visible advantages)
- Section 3 of the README: the "How it works" walkthrough
- NOT: section 2 mechanism, section 3 benefits

### Rule 5 — One section per topic; no duplicate How-it-works / What-it-does sections

> Wrong: `## What it actually does` (tier 3 walkthrough) AND `## How Minsky works inside` (tier 5 architecture) — two sections, same topic, different depth.
> Right: ONE `## How it works` section that nests the depth levels — high-level walkthrough first, then key files / architecture sketch in a subsection.

Duplicate "How it works" sections are the most common structural bug in technical READMEs. The author writes a friendly walkthrough first (tier 3), then later wants to add file paths + architecture (tier 5), and ends up with two sections on the same topic. The reader sees the duplication, gets confused about which is canonical, and reads neither carefully.

The fix: ONE `## How it works` section with two parts —

1. **The 30-second walkthrough** (tier 3) — numbered steps, plain English, zero file paths.
2. **The 30-second architecture sketch** (tier 5, embedded as a sub-section) — pipeline diagram, key file paths, named patterns.

If the architecture sketch is too long for a sub-section, move it to a dedicated `ARCHITECTURE.md` and link from the bottom of the "How it works" section. Don't create a parallel section in the README.

### Rule 6 — Don't pre-explain what a nearby link or label already says

> Wrong: `Seven things you get. Each links to the dedicated page with the full story (what the feature delivers, how it's measured, and how it's tested under stress).` followed by bullets with `([details →](...))` links.
> Wrong: `Six distinctive mechanisms, each backed by file paths so any claim is auditable:` followed by bullets that show the file paths.
> Wrong: `Three tradeoffs an operator should weigh before picking Minsky:` followed by the three tradeoffs (we're already in the Minsky README; the "Minsky" is implicit).
> Wrong: `> **What's a "host"?** A host is a single git repo that Minsky operates on. Selected via X in Y, the Z flag, or the working directory. Multi-host mode (W flag) walks every git repo under one parent directory in round-robin (3 iterations per host per pass).` — paragraph-length jargon callout inside a 7-step walkthrough.
>
> Right (link pre-explanation): bullets + `[details →](...)` link with no preface. The link text and the bullet are the story.
> Right (label pre-explanation): `Six distinctive mechanisms:` (the bullets' file-paths speak for themselves).
> Right (jargon callout): `> **Host** = the git repo Minsky operates on. See [docs/configuration.md] for selection + multi-host mode.` (one line; details live in the linked doc).

If a sentence above a link, list, or label restates what the reader is about to see, delete it. The link's text + the item's content + the section heading already encode the same information; the preface is friction. Apply at three scales:

- **Link-pre-explanation**: a sentence like "Each links to the dedicated page with the full story (what the feature delivers, how it's measured, ...)" before a list of `([details →])` links — delete entirely. The link label is the spec.
- **Label-pre-explanation**: a sentence like "Six distinctive mechanisms, each backed by file paths" when the bullets THEMSELVES show file paths — cut the qualifier, keep the count ("Six distinctive mechanisms:").
- **Glossary-callout-bloat**: jargon callouts ("> **What's an X?**") that run >2 sentences inside a walkthrough. The callout interrupts the reader; move all but the one-line definition + a `See docs/X.md for ...` link into the linked doc.

The rule is asymmetric — *more* explanation is sometimes needed (a tier-1 lede should over-explain the outcome, not under-explain it). The trigger is REDUNDANCY: when the preface and the thing-being-prefaced say the same thing in different words, the preface is the one to cut.

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

## PR descriptions — cold-reader order (IRON LAW)

PRs ship to reviewers who are MORE time-pressed than README readers. A reviewer scanning a list of 12 open PRs gives each one ~8 seconds; if the title + first sentence don't deliver "what does this PR do for me as a reviewer?", they bounce and pick a friendlier-looking PR. The investigation chronology that lives in the author's head — "I noticed X, then realised Y, then dug into Z" — is the WRONG order for the body.

### The PR-body cold-reader contract

A reviewer opening the PR for the first time must answer these questions in this order, and the body's sections must appear in the matching order:

| Reviewer question | Time budget | Where in the body |
|---|---|---|
| **What does this PR do?** (one-sentence summary) | 5 sec | Title + first sentence of body |
| **Should I care? Does this affect me?** | 15 sec | TL;DR paragraph (1–3 sentences, ≤60 words) immediately after the title — before any `## section` |
| **What does it look like?** (visual changes only) | 30 sec | Screenshot / before-after / storyshot — ABOVE the `## Why`, NOT under "How to test" |
| **Why was this needed?** | 1 min | `## Why` — one-line problem statement first, then failure-mode list / motivation |
| **What changed?** | 2 min | `## What changed` — high-level summary by area (Tests / UI / Storage / etc.), file paths in collapsible sub-detail if long |
| **How do I verify it works?** | reference | `## How to test` |
| **What if it breaks in prod?** | reference | `## Rollback` (only if there's runtime impact — test-only PRs explicitly say "no runtime change, no rollback needed") |
| **Where's the ticket?** | reference | `## JIRA` near the bottom |
| **Did the author check the boxes?** | reference | Checklist at the very bottom |

The "TL;DR paragraph immediately after the title" is the single most load-bearing line in a PR body and is the rule violated most often. It is NOT optional. It is NOT "obvious from the title" — the title carries the conventional-commit verb and the ticket, not the WHY.

### Six iron rules for PR-body order

These are the load-bearing rules for PR descriptions specifically. They override the doc-tier hierarchy when they conflict.

#### PR Rule 1 — TL;DR paragraph immediately after the title, before any `##`

The first prose the reviewer sees must be a 1–3 sentence outcome statement. NOT a numbered list. NOT a bullet list. NOT a `## Why` section heading. Prose.

> Wrong (jumps straight to the problem analysis):
> ```
> ## Why this is needed
>
> `ToolConfig.icon` is `string` (non-optional), so `tsc` rejects entries
> missing the field. TypeScript can't reject three remaining failure modes...
>
> 1. `icon: ""` — empty string passes `icon: string`.
> 2. `icon: "Emial"` — a typo or removed-icon name passes...
> 3. An engagement type whose `order: [...]` lists a tool ID that has...
> ```
>
> Right (TL;DR first, then `## Why`):
> ```
> Adds three runtime gates plus a Storybook visual reference that prevent a
> Command Center tool from shipping with an invalid icon — empty string, typo,
> or referenced-but-unregistered tool ID. Test-only PR; no runtime change.
>
> ## Why
>
> TypeScript already enforces "icon is required". It can't enforce "icon is
> non-empty and resolves to a real generated component", or "every tool ID
> in an engagement's order array is registered"...
> ```

The TL;DR must answer "what does this PR do?" and ideally also "what risk does it carry?" (e.g., "test-only, no runtime impact"). The reviewer should be able to assign rough urgency from the TL;DR alone.

#### PR Rule 2 — Screenshot above prose for visual changes

If the PR changes pixels — UI, design system, story snapshots, dashboard, generated docs site — the screenshot or before-after pair appears BETWEEN the TL;DR and the `## Why`. Not under `## How to test`. Not at the bottom under `## Screenshots`. Reviewers form their opinion from the picture first.

For PRs that add a new Storybook story or storyshot, embed the baseline PNG inline near the top with one sentence of caption.

For pure-backend / pure-test PRs with no visual diff, no screenshot needed — but still call that out explicitly in the TL;DR: "no UI change" / "test-only PR".

#### PR Rule 3 — Inverted pyramid inside every section

Each `## section` follows the same lede-then-detail order at its own scale. `## Why` opens with a one-line problem summary, then expands. `## What changed` opens with a one-line scope summary, then bullets. Never lead a section with a numbered list of edge cases — the reviewer can't tell which case is the headline.

> Wrong:
> ```
> ## Why
>
> 1. `icon: ""` — empty string passes...
> 2. `icon: "Emial"` — typo passes...
> 3. An engagement type whose `order: [...]` lists a tool ID...
> ```
>
> Right:
> ```
> ## Why
>
> TypeScript enforces "icon is required" but cannot enforce the three
> runtime invariants that determine whether a tool actually renders.
> The gaps:
>
> 1. `icon: ""` — empty string passes...
> 2. ...
> ```

#### PR Rule 4 — Implementation detail below the user-facing outcome

In `## What changed`, lead with the user-facing or reviewer-facing outcome (what the PR accomplishes), THEN list file-level changes. A bullet that opens with a file path is wrong; a bullet that opens with the outcome and ends with the file path is right.

> Wrong:
> ```
> - `plugins/foo/src/Bar.ts` — added the `validate()` function
> - `plugins/foo/src/Bar.spec.ts` — added 14 tests
> ```
>
> Right:
> ```
> - **Validates Bar inputs at runtime** (added in `Bar.ts:42`, covered by
>   14 vitest cases in `Bar.spec.ts`).
> ```

For PRs touching ≥10 files, group by area first (`### Tests` / `### Storage` / `### UI`), one paragraph of outcome per group, file paths in collapsible `<details>` blocks below.

#### PR Rule 5 — Test plan and rollback come AFTER the substance, not before

`## How to test` and `## Rollback` are operational/reference content. They go AFTER `## Why` and `## What changed`. A reviewer who hasn't decided whether they care about the change yet doesn't need to know which vitest project to run.

The PR template's section ORDER is the source of truth — if the repo's template puts `## Why` first, follow that. Don't reorder template sections; the rule is about not adding test-plan content ABOVE the template's where-it-belongs slot.

#### PR Rule 6 — Title is the tier-0 read

The PR title is the first (and often ONLY) thing a reviewer sees in the PR list view, in Slack notifications, and in Jenkins build emails. It carries more weight per byte than any other prose in the PR. It must:

- Use the conventional-commit format the repo enforces (`type(scope): subject TICKET-0000`)
- Stay ≤72 characters (most repos enforce this via commitlint)
- Capture the scope of the PR's contents — if the PR added Storybook coverage on top of vitest gates, the title should reflect both, not just the first commit's subject
- NOT be the first commit's literal subject when the PR has grown to cover more

Bad title (the first commit's subject, PR has since grown to add Storybook + JSDoc): `test(iep-ai-native): block CC tools with empty icon strings AIFN-994`

Good title (reflects full PR scope): `test(iep-ai-native): vitest + storybook gates for cc icons AIFN-994`

### Canonical PR-body skeleton

A reader-priority PR body in order:

```markdown
<!-- Title (set via gh pr edit --title): type(scope): subject TICKET-XXX (≤72 chars) -->

<TL;DR — 1-3 sentences, ≤60 words. Outcome + scope + risk class.        <!-- tier 1 -->
Example: "Adds three runtime gates that prevent shipping a CC tool with
an invalid icon. Test-only PR; no runtime change.">

<Screenshot / before-after / storyshot — for visual changes only.       <!-- tier 2 -->
Inline embed at full width. One sentence of caption.>

## Why                                                                  <!-- tier 3 -->

<One-line problem statement.>

<Expanded motivation — failure modes, what TypeScript / existing tests
can't catch, why now. Numbered list of edge cases is OK HERE, after
the one-line summary established the headline.>

## What changed                                                         <!-- tier 4 -->

<One-line scope summary.>

- **<User-facing outcome 1>** — implementation detail / file path.
- **<User-facing outcome 2>** — ...

(For ≥10-file PRs, group by area with `### Tests` / `### UI` sub-sections.)

## How to test                                                          <!-- tier 5 -->

<vitest command(s), storyshot path, manual repro steps if needed.>

## Rollback                                                             <!-- tier 6 -->

<"No rollback needed — no runtime change" for test-only PRs,
or specific affected plugin(s) for runtime PRs.>

## JIRA                                                                 <!-- tier 7 -->

[TICKET-XXX](https://...)

---

### PR checklist                                                        <!-- tier 8 -->

- [x] ...
```

Note what's NOT in the skeleton:

- A `## Why this is needed` opening section before the TL;DR — the TL;DR IS the lede, and `## Why` follows it
- A separate `## Screenshots` section at the bottom for visual PRs — screenshot goes above the `## Why`
- A "Follow-ups" section at the top — those go at the very bottom or in TASKS.md
- Long quoted ticket descriptions / Slack-thread copy-paste — link to the ticket; don't inline-quote
- Marketing voice ("This PR ships X to enable Y" — replace with "Adds X. Y now works.")

### Anti-patterns specific to PR descriptions

| Red flag | Why it's wrong | Fix |
|---|---|---|
| **PR body opens with `## Why this is needed` followed by numbered failure modes** | No TL;DR; reviewer dropped into the problem analysis with no idea what the PR DOES | Add a 1–3 sentence TL;DR paragraph BEFORE any `## section`. State the outcome + risk class. |
| **PR title is the first commit's literal subject after the PR has grown beyond that commit's scope** | Misleads list-view scanners; PR seems narrower than it is | Update the title via `gh pr edit --title` to reflect the FULL scope of all commits |
| **Screenshot for a UI-affecting PR is below `## How to test`** | Visual context buried under operational detail; reviewer can't form a visual opinion in their 8-second scan | Move the screenshot to immediately after the TL;DR paragraph, before `## Why` |
| **`## Why` leads with a numbered list of edge cases** | Reviewer can't tell which case is the headline; reads as "here are 3 problems" not "here's the unified gap we're closing" | Add a one-line problem summary before the list — `TypeScript enforces X but can't enforce Y. The gaps:` then the list |
| **File-path-first bullets in `## What changed`** (`- plugins/foo/Bar.ts — added validate()`) | Reader has to mentally translate file paths into outcomes; the diff already shows the paths | Outcome-first bullets — `- Validates Bar inputs at runtime (Bar.ts:42, 14 tests in Bar.spec.ts)` |
| **Long inline quote of the ticket description / Slack thread / RFC paragraph** | Bloats the body without adding signal; the reader can follow the link if they want context | Replace with a one-line summary + link. Inline-quote at most one sentence. |
| **Marketing voice in a PR body** ("This PR ships X to enable Y", "Empowers reviewers to ...") | PR bodies are dev-to-dev communication; marketing voice signals "I'm not sure this PR stands on its own" | Replace with descriptive verbs. "Adds X. Y now works." |
| **"Follow-ups" / "Future work" section at the TOP of the body** | Implies the PR is incomplete before the reviewer has seen the substance | Move to the very bottom. Better: file the follow-ups as TASKS.md entries in the same commit, link from the bottom of the PR body. |
| **No risk class in the TL;DR** (reviewer can't tell if this is `test-only`, `infra change`, `production behavior change`, `revert`) | Forces the reviewer to scan the whole body just to assign rough urgency | Add one phrase to the TL;DR: "test-only, no runtime change" / "behavior change in prod for X% of users" / "revert of PR #YYY" |
| **PR description rewrites in `## What changed` what's already in the diff** (a 30-line file-by-file enumeration when the diff has 4 files) | Duplication of the diff in prose form; the reviewer reads both and trusts neither | Outcome-first bullets at the area level; if a file enumeration is genuinely useful, put it in `<details>` collapsible |

### PR-description verification checklist

Before running `gh pr create` or `gh pr edit --body-file`, verify:

- [ ] **TL;DR paragraph exists** — 1–3 sentences, ≤60 words, immediately after the title and before any `## section`
- [ ] **TL;DR states the outcome and the risk class** — reviewer can tell from those sentences alone "what does this do?" and "test-only or runtime change?"
- [ ] **Title reflects full PR scope** — not just the first commit's subject if the PR has grown
- [ ] **Title is ≤72 chars and matches the repo's commitlint format**
- [ ] **Screenshot / storyshot appears above `## Why`** (for visual-affecting PRs only)
- [ ] **`## Why` opens with a one-line problem summary** — numbered failure-mode lists come AFTER that one line
- [ ] **`## What changed` bullets are outcome-first** — no leading file paths
- [ ] **`## How to test` and `## Rollback` come AFTER `## Why` and `## What changed`** — not before
- [ ] **No inline quote of >1 sentence from the ticket / Slack / RFC** — replace with a one-line summary + link
- [ ] **No marketing voice** — dev-to-dev descriptive verbs
- [ ] **No `## Follow-ups` section above the substance** — bottom or in TASKS.md
- [ ] **Cold-reader test passes**: a reviewer who has never seen the PR can answer (1) what does this do, (2) what's the risk class, after reading ONLY the title + TL;DR paragraph

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
Outcome first, mechanism second. Zero internal artifacts. No
"X is an orchestrator" / "X is a daemon-not-framework" framing.>

<!-- NO time-to-read banner here (Rule 1). NO "skip to X" navigation menu (Rule 2). -->
<!-- NO "X's position in the landscape" section here (Rule 3 — taxonomy goes deep). -->

## Getting started                   <!-- tier 2: install + run -->

```bash
<install>
<run>
<stop>
```

## Why <tool>                        <!-- tier 3: benefit (Why BEFORE How — Rule 4) -->

- **Concrete benefit 1** — one-line consequence the reader will see.
- **Concrete benefit 2** — ...
- **...** — 5-7 bullets max.

(Optional: one-paragraph honest-tradeoffs note — what the tool DOESN'T optimise for.)

## How it works                      <!-- tier 3 + 5: mechanism (ONE section — Rule 5) -->

1. <numbered walkthrough — plain English, zero file paths>
2. ...
3. ...

### Architecture (30 seconds)        <!-- tier 5 as sub-section, NOT a separate top-level -->

```text
<pipeline diagram with key file paths>
```

> **What's a "X"?** <one-paragraph definition of any key term used above>

## Safety                            <!-- tier 4: protections (renamed from "What it won't do" — Rule 4 anti-pattern) -->

Hard rules — mechanically blocked, not "tries not to":

- **<constraint 1>** — what's prevented + how (lint / hook / draft-only / human-gate)
- **<constraint 2>** — ...

## How <tool> compares               <!-- tier 4: honest comparison + status, folded together -->

| Capability | <tool> | <competitor A> | <competitor B> |
|---|---|---|---|
| ... | ✅ / 🟡 / ❌ | ... | ... |

(Per the "Status table folded into compare" anti-pattern — don't keep BOTH a standalone status table AND a compare table.)

### Where <tool> is strong / Where <tool> has tradeoffs

<3-5 bullets each — bracketing what the operator gets vs what they give up>

## Reference                         <!-- tier 5 -->

- [CLI reference](docs/cli-reference.md)
- [Configuration](docs/configuration.md)
- [Architecture deep-dive](./docs/ARCHITECTURE.md)
- [Key files](#key-files-below)

## <Tool>'s position in the landscape   <!-- tier 5 / 6: internal taxonomy (Rule 3) -->

<2-3 paragraphs of self-classification — orchestrator vs agent, daemon vs framework,
which competitive bucket. Lives here because the reader has already committed by
this point; taxonomy is useful context, not a blocking first impression.>

## Principles                        <!-- tier 6: design philosophy -->

## Where to read next                <!-- tier 6: navigation choices welcome HERE — Rule 2 -->

Pick by audience:

- **Newcomer** — <link>
- **Operator** — <link>
- **Contributor** — <link>

## Picking up upstream fixes         <!-- tier 6: maintenance -->

## Uninstall                         <!-- tier 6: maintenance -->

## License                           <!-- tier 6: legal -->
```

Note what's NOT in the skeleton:

- A "Quick start" that duplicates Getting started
- A "FAQ" — if a question's worth answering, fold it into the relevant tier
- A "Why we built this" — fold into the elevator pitch at tier 1, or delete
- Section dividers (`---`) used as content — they're decoration, not organization
- A separate "What works today" status table (folded into the compare table — anti-pattern above)
- A separate "Architecture" top-level section (lives as a sub-section under "How it works" — Rule 5)
- An "X's position" framing section above the walkthrough (lives deep, tier 5/6 — Rule 3)

## Anti-patterns to scan for

When auditing an existing doc, grep for these red flags:

| Red flag | Why it's wrong | Fix |
|---|---|---|
| **Time-to-read banner measured in minutes at the top** ("~12 minutes to read", "8 min read", "Three reads, ~15 min total") | Cold readers have 12 SECONDS, not minutes — banner either bounces them immediately or signals "this doc is long" to a reader shopping for short | Delete the banner. The doc's structure IS the contract. See Rule 1 in "Six iron rules". |
| **Navigation choice menu above the first `## section`** ("Skip to X · Or read Y", "If operator → X; if contributor → Y", "TL;DR · Quick start · Architecture · Comparison · License" jump links) | Choice paralysis at byte zero. Author abdicating the flow-setting job to the reader | Delete the menu. The reader reads top-to-bottom; author sets the order. Choices welcome ONLY at the BOTTOM ("Where to read next — pick by audience"). See Rule 2. |
| **Internal taxonomy / self-classification at the top** ("X is an orchestrator, not an agent", "X is a daemon-not-framework", "X is a peer of Y but not Z", "X sits ABOVE Z") | Internal team mental model leaked into the reader's first 12 seconds; reads as inside baseball | Move ALL self-classification to tier 5 reference or tier 6 design-principles. See Rule 3. |
| **Mechanism section ("What it does") above benefit section ("Why X")** | Reader can't judge mechanism before they know why it matters to them | Reorder so benefit / "Why X" comes BEFORE mechanism / "How it works". See Rule 4. |
| **Two sections on the same topic** (e.g., `## What it actually does` AND `## How X works inside` — both describe the loop, at different depths) | Reader sees duplication, gets confused, reads neither carefully | Collapse to ONE `## How it works` section with a walkthrough sub-section + an architecture sub-section. See Rule 5. |
| **Sentence pre-explains what the next link or list item already says** ("Each links to a dedicated page with the full story (what the feature delivers, how it's measured, ...)" before bullets with `[details →]` links; "Six mechanisms, each backed by file paths" before bullets that show file paths; "Three tradeoffs an operator should weigh before picking Minsky" before three tradeoffs in Minsky's README) | The preface and the thing-being-prefaced say the same thing twice; the reader pays for both. Friction without information gain | Delete the preface. The link label + bullet content + section heading already encode the same information. See Rule 6. |
| **Glossary callout that runs more than 1 sentence inside a walkthrough** ("> **What's an X?**" followed by 4 sentences of definition + flag-list + sub-mode explanation) | Paragraph-length callouts interrupt the numbered-step flow they're embedded in; the reader bounces out of the walkthrough to read terminology, then has to find their way back | One-line glossary: `> **X** = <one-line definition>. See <link> for details.` Push the rest into the linked doc. See Rule 6. |
| **Standalone "Status / What works today" table dwarfing the rest of the README** (>15 rows of feature × {✅ done / 🟡 partial / ❌ not-yet}) | Reader spends more time scanning the status table than reading the doc; reads as "we'd rather audit ourselves than tell you what it does" | Compress to ≤5 rows OR fold into the competitor comparison table (one column "Minsky" + ✅/🟡/❌ markers per capability). Don't keep both. |
| **"What it won't do" / "What we refuse to do" labeled section** | The reader doesn't yet know what it WILL do; "won't do" framing reads negative + defensive | Rename to "Safety" — frame the same constraints as protections (draft PRs, no main pushes, scope-leak detection, security-sensitive changes need human approval). Same content, positive framing, lives at tier 4 after "How it works". |
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

**Six iron rules for the top of the doc:**

- [ ] **Rule 1**: No "time-to-read" banner measured in minutes anywhere above the first `## section` (no "~12 minutes total", "8 min read", "Three reads X min"). The structure IS the contract.
- [ ] **Rule 2**: No navigation choice menu above the first `## section` (no "Skip to X · Or read Y", no "If operator → X; if contributor → Y" branching, no top-of-doc TOC unless the doc is ≥2000 lines). Author sets the flow.
- [ ] **Rule 3**: No internal taxonomy / self-classification above tier 5 (no "X is an orchestrator, not an agent", no "X is a daemon-not-framework", no "X sits ABOVE Y"). Move to tier 5 reference or tier 6 principles.
- [ ] **Rule 4**: "Why X" benefits section appears BEFORE "How it works" mechanism section. Section ordering at the top must be: tagline → tier-1 lede → quickstart → Why → How → Safety → Compare.
- [ ] **Rule 5**: Exactly ONE section per topic. No duplicate "What it does" / "How it works" sections at different depths — collapse into one section with sub-sections.
- [ ] **Rule 6**: No sentence pre-explains what a nearby link, label, or list item already says. Examples to delete on sight: "Each links to a dedicated page with the full story" before bullets with `(details →)` links; "Each backed by file paths" before bullets that show file paths; "Three tradeoffs an operator should weigh before picking Minsky" before three tradeoffs in the Minsky README. Glossary callouts (`> What's an X?`) max 1 line + a link.

**Tier-1 paragraph quality:**

- [ ] First content after the title is a tier-1 explanation paragraph — concrete sentences saying what the tool DOES (not what it competes with)
- [ ] Tier-1 paragraph answers "why should the reader care?" — names the OUTCOME the reader gets (the repo improves, the bug gets fixed, you get a PR), not internal artifacts (file names, config keys, queue names) or implementation details (event loops, watchdogs, supervisor strategies)
- [ ] Tier-1 paragraph's FIRST sentence is a standalone explanation — reading only that one sentence answers "what is this tool?" (single subject + single predicate; not a 3-clause compound)
- [ ] Tier-1 paragraph is ≤3 sentences and ≤60 words (the "I get it in 12 seconds" contract)
- [ ] Tier-1 paragraph uses active descriptive verbs (`reads`, `picks`, `runs`, `opens`) — no marketing voice (`You sleep, it ships PRs`, `Empowers developers`, etc.)
- [ ] Tagline is descriptive, not a selling-line — "Background daemon that runs X" beats "You sleep, it ships PRs"

**Section ordering & content:**

- [ ] Within 2 minutes of reading, the reader has seen the install + run commands (tier 2 reached)
- [ ] No tier-5 or tier-6 content appears above the "How it works" walkthrough
- [ ] No competitor / positioning section appears above the walkthrough — either the 3 conditions hold and the table is at tier 4 (after How-it-works), or the table is out entirely
- [ ] "Safety" labeled (not "What it won't do" / "What we refuse to do") and lives at tier 4 after "How it works"
- [ ] Status / "what works today" table is ≤5 rows OR folded into the competitor comparison table (not both)
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

Anti-patterns sourced from observed bugs in this repo's README (PR #648 README rewrite + PR #668 clarity pass + 2026-05-20 operator review + 2026-05-22 operator review surfacing the five iron rules — no-time-banner, no-top-navigation, taxonomy-goes-deep, why-before-what, one-section-per-topic).

PR-description section sourced from 2026-05-25 operator directive: "all PRs you create or update strictly follow great useful order of info for cold readers. Eg don't spam readers with technical details until you give them an overview." Surfaced by iep-capabilities PR #2095 (https://github.intuit.com/expertnetwrk-portal/iep-capabilities/pull/2095) — agent shipped a PR body that opened with a `## Why this is needed` heading followed by a numbered list of failure modes, with no TL;DR sentence between the title and the technical analysis. Reviewer cold-read fail. The PR-body skeleton, the cold-reader contract table, and PR Rules 1–6 are the fix.
