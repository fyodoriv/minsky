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

## Tier-by-tier writing guides

Read [reference/tier-guides.md](reference/tier-guides.md) when you write or audit these sections:

- Tier 1 paragraph — quality criteria
- Tier 1 layout — explicit branching after the lede
- Tier 2 (Getting started) — minimize chrome, and recommended-vs-fallback when there's a magic path
- Tier 5 reference sections — lead with a summary that contextualises volume
- "How <Tool> works inside" — the auditable internals section, with a worked example

## Motivation and positioning sections

Read [reference/motivation-sections.md](reference/motivation-sections.md) when you write or audit these sections:

- Motivation sections (`Why <Tool>?`) — placement, structure, voice, honesty, and a worked example
- Where "Principles" / "Why is it named X?" / etymology sections go
- When positioning belongs in the README at all

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

### Step 6 — Verify every cited file path exists, every cited task ID is in `TASKS.md`

The README is a contract; broken citations are debt that compounds. Before claiming the doc is shipped:

```bash
# File paths cited in the README — every one must exist
grep -oE '`(novel/[^`]+\.(ts|mjs)|scripts/[^`]+\.mjs|bin/[^`]+|\.minsky/[^`]+\.(json|md|jsonl))`' README.md \
  | tr -d '`' \
  | sort -u \
  | while read f; do test -f "$f" || test -d "$f" || echo "MISS $f"; done

# Task IDs cited in the README — every one must be in TASKS.md
grep -oE '`[a-z][a-z0-9-]+`' README.md \
  | tr -d '`' \
  | sort -u \
  | while read t; do
      grep -q "\\*\\*ID\\*\\*: $t$" TASKS.md || echo "POSSIBLE-MISS $t (verify if this is a task ID)"
    done
```

The first command catches typos like `task-picker.ts` instead of `task-finder.ts` (observed bug from minsky 2026-05-20). The second catches dangling task references after a task ID is renamed. Both bugs survive the markdown lint and the typecheck — they only manifest when a reader actually clicks the link.

This is a discipline, not a rule. The agent following this skill MUST run these checks before committing any README that cites file paths or task IDs.

## Cross-cutting README discipline

These apply across all tiers, not specific to one section:

1. **Code-formatted task IDs** — when referencing a TASKS.md task in any tier, use backticks: `` `task-id` ``. Not bare text. Makes them visually distinct AND greppable (the verification step above relies on this).
2. **Code-formatted file paths** — when citing a file path in the body of any section, use backticks: `` `novel/cross-repo-runner/src/host-cto-audit.ts` ``. Not bare text. Same reason.
3. **Specific over generic in any claim** — if the README says "the daemon does X", it should say "the daemon (`novel/tick-loop/src/daemon.ts`) does X" — the parenthetical citation lets the reader verify. This applies even to tier-3 walkthroughs where the file name might seem irrelevant; one backticked path per section is the floor.
4. **No future-tense for shipped features** — write in present indicative ("Minsky reads `TASKS.md`"), not future or conditional ("Minsky will read", "Minsky can be configured to read"). Future tense reads as marketing aspiration; present indicative reads as factual description. Reserve future tense for explicitly-roadmapped items at tier 6.
5. **Honesty markers on partial features in any tier** — the same `*(in flight)*` / `*(rule #N, enforced)*` / `*(P0 `` `task-id` ``)*` convention used in motivation sections applies to ANY claim about a feature. If a tier-4 "What works today" row claims a feature, it should also link the partial-state task if the feature is partial. The honesty markers are a doc-wide pattern, not a section-local one.

## Imperative leads, detail pages, and the README skeleton

Read [reference/readme-skeleton.md](reference/readme-skeleton.md) when you restructure a README:

- Imperative leading — state the action, not the justification
- Move detail pages out — what stays in the README, what moves to `docs/<topic>.md`, the bibliography section, and when not to move out
- Worked example: a full tool README skeleton with tier tags

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
| Getting started code block has multi-line `#` block comments inside the code fence (e.g., 4 lines of comment for one command) | One-word command looks complex; reader thinks the tool is hard to use | Cut comments to ≤1 line per command. Move deep explanation to PROSE AFTER the code block. See "Tier 2 (Getting started) — minimize chrome". |
| Getting started lists 5+ commands in the code block (status, logs, stop, update, doctor, ...) | First-touch flow drowned in maintenance / observation commands the reader doesn't need yet | Keep only install + run (optionally + stop). Everything else goes to `## CLI reference` at tier 5. |
| Tier-5 reference section (Key files, CLI reference, Config) dumps a 9+-row table on the reader with no opening summary | Feels like inventory dump; "tool is taking over my machine" anxiety | Open the section with one sentence contextualising volume ("Tool adds 1 file; rest is gitignored / per-machine / read-only"). Split into sub-tables by grouping. See "Tier 5 reference sections — lead with a summary that contextualises volume". |
| `## Principles` (or any design-philosophy section) sandwiched between two tier-5 reference sections | Breaks the reader's lookup flow when they're in "find the command I need" mode | Move principles to tier 4 (between "What it will NEVER do" and the edge cases) — design philosophy informs "should I commit". Reserve tier 6 for contributor-only philosophy. See "Where do Principles / Why is it named X? / etymology sections go?". |
| Tier-1 paragraph uses marketing voice ("You sleep, it ships PRs", "Empowers developers", "The only X that Y") | Signals selling-point, not dev-perspective; readers tune out | Rewrite with active verbs describing the actual loop body. See "Tier 1 paragraph — quality criteria" above. |
| Tagline includes a value-prop selling line ("You sleep, it ships PRs") rather than a descriptive claim | Same as above — marketing voice in the tier-1 slot | Replace with a descriptive line: "Background daemon that runs AI coding agents against tasks in any git repo" |
| `> Tracked as P0 X in TASKS.md` callouts in install / quickstart | Tracker chatter polluting tier 2 | Move to tier 6 "Roadmap" or delete |
| Configuration table before any usage example | Tier 5 reference before tier 3 walkthrough | Keep table; move below walkthrough |
| "Architecture" or "Internals" diagram in the first 3 sections | Tier 5 internals before tier 3 behaviour | Move to tier 5 |
| "What it will never do" before "What it does" | Tier 4 limits before tier 3 walkthrough | Reorder |
| Honest-limits table above the elevator pitch | Tier 4 limits drowning tier 1 hook | Move below "What it does" |
| Forward-pointers to other docs in the first paragraph | Reader hasn't decided to care yet | Defer to tier 5 or 6 |
| Tier-1 paragraph makes a bare credibility claim ("uses established practices", "battle-tested", "evidence-based", "scientifically proven") without a link to a doc that lists the specific practices | Bare claim = marketing line; no way for the reader to verify. The first re-read erodes trust because the claim has nothing under it | Name 3-5 specific practices inline + link to a tier-5 reference doc (`docs/PRACTICES.md` or equivalent) that lists them with citations. See "Tier 1 paragraph — quality criteria" criterion 6. |
| Manual install path shown first, agent-mediated / `npx` / `curl-pipe-sh` shown second | Operator who'd benefit from the magic path scrolls past the wrong code block first; the magic path looks like an optional optimization | Lead with the magic path marked **Recommended**; demote the manual path to a "for when you don't have <X>" fallback. Both must work today. See "Tier 2 — recommended-vs-fallback when there's a magic path". |
| Magic install path documented but not yet shipped (the prompt the operator pastes doesn't lead to a working install) | Bait — operator tries the magic path, it fails, they leave. The README oversold | Lead with what works today; file the magic path as a P0 with a target state in the task body. Tier 1 + 2 are HONEST, not aspirational. |
| Motivation section (`Why <Tool>?`) missing entirely on a tool that has 5+ distinct outcomes to claim | Reader sees the walkthrough and the capability matrix but never gets the "here's the value this delivers" framing | Add a `## Why <Tool>?` section at the tier 3/4 boundary with 5-7 outcome-led one-line bullets each linking to a dedicated detail page. See "Motivation sections (`Why <Tool>?`) — outcome-led value list". |
| Motivation-section bullet without a partial-state honesty marker for a feature that isn't fully shipped | The reader trusts the bullet; later discovers it's vapor; loses trust in the whole README | Append `*(in flight — P0 task-id)*` (with `task-id` backticked when used in real bullets) to the headline; the body sentence describes the partial state that's shipped today and links the closing task. See "Honesty — every claim is shipped, or marked partial with a linked task". |
| Motivation-section bullets are multi-line "sausages" (each takes 3-4 wrapped lines, headline on one line and body paragraph on the next) | Section feels long, reader can't scan the outcomes at a glance, depth is duplicated between the bullet and any linked detail page | Collapse to ONE compact line per bullet (≤25 words): bold outcome + optional honesty marker + brief description + `[details →](path)` link. Push the depth onto the linked page. See "Structure — 5-7 compact one-line bullets with `[details →]` links" |
| Motivation-section bullet without a `[details →]` link to a dedicated detail page | The reader who wants depth has to scroll-and-grep; the README has to duplicate the depth into the bullet body to be useful, which makes bullets "sausages" | Every motivation bullet links to a user story / docs page / section anchor / backticked task ID. The link is the contract — it must back the bullet's specific claim |
| Motivation-section headline leads with the operator's PAIN ("Your invoice at 2am should not end the night") rather than the OUTCOME they get ("Keep iterating when the cloud agent runs dry") | Pain-led reads as cynical / inside-baseball; the reader evaluating the tool wants to know what they GET. The previous skill version recommended pain-first; 2026-05-20 operator feedback over-rode it | Reframe headlines as outcomes. The pain can be hinted in the body; the headline is the deliverable. See "Voice — outcome-led, positive but real". |
| Motivation-section makes an over-claim about agent autonomy ("the agent writes your tickets", "the daemon rewrites your codebase overnight", "the AI runs your whole repo") | Tough sell — operators want CONFIDENCE, not "the AI is in charge". Over-claim erodes trust | Soften: "issues your agents notice get surfaced" + "you decide what's worth keeping" + opt-out marker. Operator agency is the differentiator from competitors that aren't draft-only; lean into it |
| Motivation-section bullet names the maintainer / individual contributor by first name | Inside-baseball; the reader is a stranger | Use roles ("daemon iterations", "the audit pass", "an agent backend") or anonymous actors ("a recent iteration"). Never first-name the human owner of the repo in a customer-facing surface |
| Motivation-section uses marketing puff verbs ("empowers", "unlocks", "transforms", "delights", "revolutionizes") | Banned for the same reason marketing voice is banned in tier 1 — readers can spot it in 2 words | Stay descriptive: "improves", "picks", "rejects", "ships", "surfaces". The verb is the test |
| Motivation-section vendor-dunks ("Your Anthropic invoice at 2am", "Cursor would have charged you double") | Specificity used for shock value, not load-bearing claim. Reads as edgy not informative | Specificity stays IF it sharpens the claim ("pay Sonnet prices only for Sonnet work" — concrete cost framing). Drop IF it's purely a dunk |
| File path or task ID cited in the README without backticks | Not visually distinct from prose; not greppable; survives lint but breaks discoverability | Use backticks: `` `novel/foo.ts` `` for file paths, `` `task-id` `` for task IDs. See "Cross-cutting README discipline" rule 1-2. |
| File path cited in the README that doesn't exist on disk (typo, rename, half-merged refactor) | Reader who clicks / greps doesn't find it; reads as bluff | Run the `Step 6 — verify cited paths exist` shell snippet before committing. See "Step 6" in The procedure. |
| Task ID cited in the README that isn't an `**ID**:` line in `TASKS.md` | Same as above — dangling reference, looks like bluff | Same verification step catches this. |
| Future-tense or conditional verb for a shipped feature ("Minsky will read", "the tool can be configured to") | Reads as marketing aspiration, not factual description | Present indicative ("Minsky reads", "the tool reads"). Reserve future tense for explicitly-roadmapped items at tier 6. See "Cross-cutting README discipline" rule 4. |
| Section opens with a justification of who-it's-for or why-it-exists before the action ("**Recommended — let your agent install it.** If you're inside Claude Code, Cursor, Windsurf, Devin, Codex, or any AI coding agent that can read files and run commands, paste this:") | The header already established the section's intent; the prefix re-justifies what the reader already chose. Reads as corny. | Lead with the imperative: "**Through your AI agent.** Copy-paste:" + the prompt. See "Imperative leading — state the action, not the justification" |
| Padding assurance immediately after install command ("Total: ~60 seconds, one human prompt." / "Should work in <5 min.") | The reader finds out by running it; the assurance is filler that delays the next useful sentence | Cut. If a real concern needs surfacing (e.g., "Requires Node ≥20"), state it as a precondition BEFORE the command, not as padding after |
| Kitchen-sink closing paragraph after install code block ("The first run installs launchd persistence so minsky survives reboots; later runs in the same folder attach to the existing daemon. Ctrl-C detaches the dashboard...; minsky stop shuts everything down...") | Kitchen-sink paragraphs cram every possibly-useful fact about the running tool into the install section. The reader doesn't need all of it before they paste; they need it later, when they're actually using the tool | Move the operator-while-running content to a dedicated detail page (e.g., `docs/operating.md`) or fold individual items into the relevant tier-5 reference section (CLI reference, edge cases). The install section ends at the install command |
| Tier-4/5/6 reference section >15 rendered lines sitting inline in the README (full CLI table, full configuration spec, full uninstall workflow, full update procedure, full file inventory) | The first-touch reader has to scroll past content they don't yet need; the operator returning later has to grep through the README instead of a focused detail page | Move to `docs/<topic>.md` with a one-line pointer in the README's "## More" bibliography. See "Move detail pages out — README is for first-touch readers" |
| README has no "## More" / "## Reference & detail pages" bibliography section at the bottom | Operator returning to find a specific detail page (uninstall / update / CLI / config) has to know the exact filename — no discoverability | Add a bibliography of one-line links at the bottom. See the worked example in "Move detail pages out" |
| Tier 1 has no branching link after the lede paragraph | Linear scrolling for all readers; impatient operator who knows they want install bounces because Getting started is too far down | Add ONE line after the lede: `**[Seven reasons you'd want this →](#why-<tool>)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started).` See "Tier 1 layout — explicit branching after the lede". |
| Motivation section claims a how-it-works mechanism (MAPE-K, multi-persona pipelines, self-improvement loop) but the README has no "How <Tool> works inside" section to back the claim | Claims without auditable receipts read as marketing. The motivation bullets become hand-wavy without the inside section to dig into | Add a tier-5 "How <Tool> works inside" section between Architecture (30 seconds) and Key files, with file-path citations for every claimed mechanism. See "'How <Tool> works inside' — the auditable internals section". |
| "Architecture" section is a 200-line ASCII diagram with module names but no file paths | Impressive-looking but un-auditable — operator can't click through to verify any claim | Replace with the "How <Tool> works inside" structure: 5-7 short noun-phrase sections, prose with file paths, one literature citation per section when applicable |
| Separate `## Architecture (30 seconds)` H2 sitting adjacent to `## How <Tool> works inside` | Two reference sections cover the same material — the reader's eye bounces between them looking for the "real" architecture section | Merge: open `## How <Tool> works inside` with "The 30-second sketch:" + the diagram, then "The deeper sketch — N things…" + the H3 subsections. One continuous read. See "'How <Tool> works inside' — the auditable internals section" rule 6 |
| Edge cases shipped as 3+ separate tier-4 H2s (`## How long does it run?`, `## What if X is empty?`, `## How does it talk to humans?`) | TOC noise — each H2 is one paragraph, the reader scans the TOC and thinks the doc is longer than it is. Also breaks the reader's tier-4 evaluation flow into edge-case interruptions | Group under one `## Edge cases` H2 with H3 sub-questions. See the worked-example skeleton |
| All-caps emphasis in section titles ("What it will NEVER do", "DO NOT modify", "ALWAYS run") | Reads as shouty; reader's eye flinches | Lowercase with the same semantic emphasis carried in the prose body ("What it won't do" + opening line "Hard rules. Not 'tries not to' — mechanically blocked.") |
| Etymology section titled `## Why "<Tool>"?` (quoted) when the motivation section is `## Why <Tool>?` (unquoted) | The two render nearly identically in a TOC — readers can't tell which is which without clicking | Rename etymology to `## About the name`. See "Disambiguating motivation from etymology" |

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
- [ ] Getting started code block has ≤2-3 commands; each command has ≤1 line of `#` comment; no multi-line block comments inside the fence; deep explanation lives as prose AFTER the code block
- [ ] Tier-5 reference sections (Key files, CLI reference, Configuration) each open with one sentence that contextualises volume — never a raw 9+-row table dump with no perspective
- [ ] Principles / Why-named / design-philosophy sections sit at tier 4 (informs "should I commit?") OR tier 6 (contributor culture), never sandwiched between tier-5 reference sections
- [ ] No tier-5 or tier-6 content appears above the "What it actually does" / behaviour walkthrough
- [ ] Operator-only content (update, uninstall, maintenance) lives at the bottom (tier 6)
- [ ] No forward-references to tracker IDs appear in the install / quick-start section
- [ ] If the tier-1 paragraph makes a credibility claim (scientifically proven / battle-tested / evidence-based / established practices), it names 3-5 specific practices inline AND links to a tier-5 reference doc that lists them with literature citations
- [ ] After the tier-1 lede paragraph, exactly one line of arrow-link branching exists (`**[<Why-Tool> →](#anchor)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started)`) — both anchors resolve to sections in this doc
- [ ] If there's a magic install path (agent-mediated / npx / curl|sh) AND a manual fallback, Getting started leads with the magic path marked **Recommended** and demotes the manual path to a "for when you don't have <X>" fallback
- [ ] Magic install path documented in Getting started actually works today (paste the prompt into a fresh agent, it completes an install — not just a stub that says "coming soon")
- [ ] If the tool has 5+ distinct outcomes to claim, a motivation `## Why <Tool>?` section exists at the tier 3/4 boundary with 5-7 outcome-led one-line bullets each linking to a dedicated detail page
- [ ] Every motivation bullet is ONE compact line (≤25 words): bold OUTCOME-led noun-phrase + optional honesty marker + one-line description + `[details →](path)` link to a dedicated user-story / docs page. No multi-line "sausage" paragraphs — depth lives on the linked page, not in the README
- [ ] Every motivation bullet's `[details →]` link resolves to a real page (user story, docs/, section anchor, or backticked task ID) — never a placeholder or TODO. Verified via the Step 6 link-validation snippet
- [ ] Motivation-section headlines lead with the OUTCOME the operator gets ("continuous improvement", "match the model to the task", "async Q&A"), not the operator's pain ("asking your agent gets old fast"). Pain-led headlines are banned — they read as cynical to a stranger evaluating the tool
- [ ] Motivation-section bullets don't over-claim agent autonomy ("the agent writes your tickets") — soften to "issues get surfaced for your review" + opt-out marker
- [ ] Motivation-section bullets don't name the maintainer by first name — use roles ("daemon iterations", "an audit pass") or anonymous actors
- [ ] Motivation-section bullets don't vendor-dunk for shock ("Your Anthropic invoice at 2am") — specificity stays IF it's load-bearing ("pay Sonnet prices only for Sonnet work"), drops IF it's a dunk
- [ ] Motivation-section bullets don't use marketing puff verbs ("empowers", "unlocks", "transforms") — descriptive verbs only ("improves", "picks", "rejects")
- [ ] If the motivation section claims a how-it-works mechanism (MAPE-K loop, multi-persona pipeline, self-improvement, constitution-as-CI-lint, control-plane / data-plane split, etc.), a tier-5 "How <Tool> works inside" section exists between Architecture (30 seconds) and Key files with 5-7 short noun-phrase subsections, each citing at least one file path
- [ ] "How <Tool> works inside" subsections lead with the OUTCOME the piece delivers, then cite the file path. No prose-only subsections — every one has a backticked file path or task id
- [ ] "How <Tool> works inside" subsections that map to a named published pattern carry one literature citation in the subsection title (e.g., "MAPE-K control loop (Kephart & Chess 2003, IBM autonomic computing)"). No faked citations — skip the citation if the piece doesn't map to a published pattern
- [ ] "How <Tool> works inside" subsections honour the same honesty markers as motivation bullets — `*(in flight)*` / `*(M2)*` / `*(P0 task-id)*` / `*(opt-out via ENV_VAR)*` — and the markers link partial-state work to its closing task
- [ ] No separate `## Architecture (30 seconds)` H2 sits adjacent to `## How <Tool> works inside` — the diagram opens the "inside" section as "The 30-second sketch:"
- [ ] Edge-case questions are grouped under ONE `## Edge cases` H2 with H3 sub-questions, not shipped as 3+ separate H2s
- [ ] No section title uses all-caps emphasis (`NEVER`, `ALWAYS`, `DO NOT`) — emphasis lives in the prose body, not the heading
- [ ] Etymology section is titled `## About the name` (not `## Why "<Tool>"?`) when a `## Why <Tool>?` motivation section exists in the same doc
- [ ] If a `## Why "<Tool>"?` etymology section exists alongside the motivation `## Why <Tool>?` section, the motivation section appears FIRST in document order (so the bare slug `#why-<tool>` resolves to it)
- [ ] Every file path cited in the README exists on disk — run the `Step 6` shell snippet to verify; broken paths are bluff
- [ ] Every task ID cited in the README has an `**ID**: <id>` line in `TASKS.md` — same `Step 6` snippet verifies
- [ ] Every file path and task ID in the README body is wrapped in backticks (greppable, visually distinct)
- [ ] No future-tense or conditional verb for a shipped feature ("will read" / "can be configured to") — present indicative throughout
- [ ] Every section opens with the imperative or a 1-2 word category label — never a justification of who-it's-for or why-it-exists ("Recommended — let your agent install it. If you're inside Claude Code, Cursor, Windsurf, Devin, Codex, or any AI coding agent that can read files and run commands, paste this:" → "**Through your AI agent.** Copy-paste:")
- [ ] No padding assurances after install commands ("Total: ~60 seconds, one human prompt.", "Should work in <5 min."). Cut. Real preconditions go BEFORE the command, not as filler after
- [ ] No kitchen-sink closing paragraph after install code block — the install section ends at the install command. Operator-while-running content (Ctrl-C, stop, persistence, attach) moves to a detail page
- [ ] Every tier-4/5/6 reference section >15 rendered lines has been considered for move-out to `docs/<topic>.md` with a one-line pointer in the README's bibliography
- [ ] README has a "## More" / "## Reference & detail pages" bibliography section at the bottom listing every moved-out detail page with a one-line description + link
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

Pattern conformance: information architecture by audience priority (Krug, *Don't Make Me Think*, 2014, Ch. 2 — "the average user spends 10 seconds on a page before deciding whether to leave"); progressive disclosure (Nielsen, *Usability Engineering*, 1993); reader-driven document order (Williams, *Style: Lessons in Clarity and Grace*, 2007, Ch. 4 — "old information before new").

Anti-patterns sourced from observed bugs in this repo's README, iterated through a 2026-05-20 operator-feedback session that lasted ~30 messages:

- PR #648 — initial README rewrite (added the 6-tier hierarchy + the tier-1 paragraph quality criteria)
- PR #668 — clarity pass (added the Getting started chrome rules + Key files restructure)
- PR #671 — removed competitor table from README (the 3-condition test was failing)
- PR #672 — tier-1 brief + concrete + dev-voice (added criteria 3, 4, 5)
- PR #674 — tier-1 must answer "why should the reader care?" (added criterion 1)
- 2026-05-20 session (early) — added Tier-1 layout (explicit branching after the lede), Tier 2 recommended-vs-fallback when there's a magic path, Motivation sections (`Why <Tool>?` with dry observation-comedy pain-led headlines + honesty markers), Cross-cutting README discipline (backticked paths/IDs, future-tense ban, Step 6 file/task verification), and the tier-1 credibility-claims-are-linked criterion (criterion 6).
- 2026-05-20 session (later) — operator over-rode the "dry observation-comedy / pain-led headline" framing as too cynical for a stranger evaluating the tool. Renamed the section to "outcome-led value list"; rewrote the voice guidance to lead with OUTCOMES the operator gets; added 5 anti-patterns specific to over-claiming, vendor-dunking, maintainer-self-references, marketing puff, and pain-led headlines. The worked example was rewritten end-to-end to match. The CTO-audit bullet specifically was softened from "the agent writes your tickets" (over-claim) to "issues your agents notice get surfaced for your review" (operator-agency framing) — that softening pattern is the second new anti-pattern row.
- 2026-05-20 session (latest) — operator asked the README to describe how minsky works internally ("what exactly makes it great inside"). Added the tier-5 "How <Tool> works inside" pattern: a 5-7-section subsections-with-file-paths structure that backs the motivation section's how-it-works claims (MAPE-K, multi-persona, self-improvement, etc.) with auditable receipts. Distinct from "Architecture (30 seconds)" which is a brief diagram. Added 2 anti-pattern rows ("motivation claims a mechanism but no inside section exists" and "Architecture section is a 200-line ASCII diagram with no file paths") + 4 verification checklist items. The skeleton was updated to place the new section between Architecture (30 seconds) and Key files.
- 2026-05-20 session (final pass) — operator did a full README read-through and asked for a start-to-finish flow rewrite. Five structural improvements rolled in: (a) etymology renamed `Why "<Tool>"?` → `About the name` (cleaner TOC, no visual collision with the motivation section); (b) anti-features renamed `What it will NEVER do` → `What it won't do` (less shouty, semantic emphasis moved to prose body); (c) edge-case questions grouped under one `## Edge cases` H2 with H3 sub-questions instead of 3+ adjacent H2s; (d) `Architecture (30 seconds)` merged into `How <Tool> works inside` as its opening 30-second sketch — one continuous read from elevator to depth instead of two adjacent reference sections; (e) skeleton + anti-patterns + checklist updated accordingly. Added 4 anti-pattern rows and 4 verification items.
- 2026-05-20 session (sausage-cut) — operator: "Why Minsky is really hard to read. It's a bullet list but it's not bullets but sausages. Instead might be good to have links to more descriptive pages after short descriptions." Earlier skill versions told the agent to write TWO-line bullets (bold headline + body paragraph), which wrap to 3-4 lines each and lose the scanability that makes a bulleted list useful. Restructured to ONE compact line per bullet (≤25 words: outcome + optional honesty marker + brief description + `[details →](path)` link). Depth moved onto dedicated detail pages (user stories / docs / section anchors / task IDs). Added 2 anti-pattern rows ("sausage" multi-line bullets; bullets without detail-page links) + 2 verification checklist items. Worked example rewritten end-to-end to demonstrate the compact form linking out to user-stories/.
- 2026-05-20 session (efficiency rewrite) — operator: "rewrite readme again to follow more straight to the point (without being corny). Eg in 'Recommended — let your agent install it. If you're inside Claude Code, Cursor, Windsurf, Devin, Codex, or any AI coding agent that can read files and run commands, paste this:' it could have been just a single line like 'Copy-paste this prompt into your agent:'. Then below somewhere we can describe installation in detail (let's actually do it and write one about uninstallation). So the idea is to provide readers only that information which they need to read right now. This is how you write efficiently." Two new patterns: (a) **imperative leading** — section openings state the action ("Copy-paste:") rather than re-justifying who the section is for ("Recommended — let your agent install it. If you're inside <list>, paste this:"). Padding assurances after commands ("Total: ~60 seconds, one human prompt.") and kitchen-sink closing paragraphs ("The first run installs launchd persistence so minsky survives reboots; later runs...") move to detail pages or get cut entirely. (b) **Move detail pages out** — tier-4/5/6 reference sections >15 rendered lines move to `docs/<topic>.md` with a one-line pointer in the README's "## More" bibliography. The reader on first touch needs LEDE + INSTALL + WALKTHROUGH + MOTIVATION + HONEST-MATRIX + ANTI-FEATURES; everything else is operator-returning content. Added 5 anti-pattern rows (justification-prefix / padding-assurance / kitchen-sink-paragraph / inline-reference-section / no-bibliography) + 6 verification checklist items + a worked-example bibliography format.

The skill version that produced minsky's README post-rewrite is the version after all six 2026-05-20 updates — meaning a fresh agent reading the skill from scratch and applying it to minsky's repo should land at the trimmed README + detail pages + bibliography without operator feedback.
