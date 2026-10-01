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
6. **Credibility claims are linked, not bare** — if the paragraph makes a *quality* / *rigor* / *evidence-based* claim (e.g., "uses established software-engineering practices", "scientifically proven", "battle-tested patterns", "every behaviour cited"), that claim is a marketing line UNLESS it links to a tier-5 reference doc that lists the specific practices with citations. A bare claim is a vibe; a linked claim is honest. The link is the difference. Example: `using established software-engineering practices` → bare, marketing. `applying scientifically proven software-engineering practices — TDD, MAPE-K, hypothesis-driven development, let-it-crash supervision, error budgets — each backed by a literature citation ([PRACTICES](docs/PRACTICES.md))` → honest, linked, and the named practices give the reader a way to verify before clicking. Pattern: name 3-5 specific practices inline (so the reader can spot one they recognize) AND link to the full list (so the reader can audit the rest). Without this, the credibility claim is debt that erodes trust on the next read.

Worked example — successive rewrites of the same tier-1 paragraph (real iteration trail from minsky's README, 2026-05-20):

```text
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

## Tier 1 layout — explicit branching after the lede

The tier-1 lede paragraph is a sketch. Different readers reach the end of it in different states: some are convinced and want to install, some want the marketing pitch, some want to see what works today. Don't make them all scroll linearly — give them a one-line branch.

After the lede paragraph (before `## Getting started`), add a single line with 2-3 inline arrow-links pointing to the most likely next-step sections. Example:

```markdown
<60-word lede paragraph>

**[Seven reasons you'd want this →](#why-minsky)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started).
```

Rules:

- ≤2 branches. Three is the cap; four is decision paralysis.
- Format each as `[arrow text →](#anchor)`. The `→` is the visual cue that says "this is a next step".
- The default branch (the one a typical reader will follow if they don't pick) goes second, with a separator (`&nbsp;·&nbsp;`) or `Or` connector — making it the "skip ahead" option rather than the prominent path.
- The branches MUST resolve to anchors that exist in the same document. If a branch points to a section the reader has to scroll past, that's fine; the link saves them the scroll.
- Don't put the branching ABOVE the lede. The lede answers "what is this"; the branching answers "where do I go next". You need the first to make the second mean anything.

This is the **hybrid placement pattern** for content that wants to be at the top but doesn't fit there. If the operator says "this feature list should be at the top!" but the feature list is 7 bullets long, the answer is NOT to move the list above the lede (that breaks the 60-word rule). The answer is to put a teaser link in the lede area AND the full section at its proper tier. The reader who wants the pitch clicks the link; the reader who doesn't, scrolls past.

## Tier 2 (Getting started) — minimize chrome

The `## Getting started` code block is the second-most-read piece of prose in the README (after the tier-1 paragraph). It must look INVITING, not INTIMIDATING. A reader who sees a one-word command preceded by four lines of comment thinks "this is complex"; a reader who sees a one-word command preceded by a one-line comment thinks "this is simple".

Rules:

1. **At most one line of `#` comment per command in the code block.** Never a multi-line comment block inside the fence. If a command genuinely needs deep explanation, put it as PROSE AFTER the code block, not as comments inside.
2. **Code block has at most 2-3 commands.** Install + run is the minimum; an optional third command for the most-needed maintenance action (e.g., `stop` for a daemon) is fine but should be the LAST line. Anything beyond that (status, update, doctor, watch, …) lives in `## CLI reference` at tier 5, not in Getting started.
3. **Demote secondary commands.** Commands like `stop` / `update` / `uninstall` are reassuring to know about, but they're not the first-touch flow. Drop them from the code block; mention them in ONE sentence of prose after the block (`Ctrl-C detaches; minsky stop shuts everything down`).

Worked example — bad → good:

```text
BAD (4-line block comment for one command + stop emphasised equal to run):

    # Install
    git clone ... && cd ... && pnpm install

    # Run — starts the daemon (if needed), installs launchd persistence,
    # and drops you into the live dashboard. Same command works on first run
    # AND every run after: if a daemon is already running for this folder,
    # you attach to it. Ctrl-C detaches; the daemon keeps running.
    minsky

    # Stop everything (zero ghost processes — kills runners + agent children)
    minsky stop

GOOD (minimal comments, stop in prose below):

    # Install
    git clone ... && cd ... && pnpm install

    # Run
    minsky

The first run installs launchd persistence so minsky survives reboots; later
runs in the same folder attach to the existing daemon. Ctrl-C detaches the
dashboard without stopping the daemon; `minsky stop` shuts everything down.
```

The BAD version has 4 lines of comment for `minsky` and gives `minsky stop` equal weight in the block. The GOOD version has zero comment for `minsky`, mentions persistence + attach + Ctrl-C + stop ONCE in prose right after — and the reader's eye finds the simple `minsky` command immediately.

## Tier 2 — recommended-vs-fallback when there's a magic path

Some tools have two valid install paths: a *magic* path (one-line, often agent-mediated or `npx`-style auto-install) and a *manual* path (clone + install). Don't list them as equal options — that's decision paralysis. Lead with the magic path marked **Recommended**, demote the manual path to a fallback.

Structure:

```markdown
## Getting started

**Recommended — <one-line description>.** <Reader instruction in plain prose, optionally a copy-pasteable quoted prompt block>.

<Brief explanation of what happens, ~1-2 sentences>

**Manual install** — for when you don't have <whatever the magic path requires>:

​```bash
<2-3 commands>
​```

<Brief explanation of what happens, ~1-2 sentences>
```

Three rules:

1. **Magic path leads.** Operator-first ordering: the path that's faster for the typical reader is shown first, even if it's newer / less battle-tested.
2. **Both paths must work today.** If the magic path is half-shipped, don't lead with it — that's a bait. Lead with whatever works; file the magic path as a P0 and document the desired future state in the task body. The skill is "honest tier 1 + tier 2", not "aspirational tier 1 + tier 2".
3. **Recommended path includes a copy-pasteable instruction.** If the magic path is "ask your AI agent to install this", give the operator the exact prompt to paste — a copy-pasteable block in a `>` quote. Don't make them paraphrase your description.

Worked example (minsky's Getting started, 2026-05-20):

```markdown
## Getting started

**Recommended — let your agent install it.** If you're inside Claude Code,
Cursor, Windsurf, Devin, Codex, or any AI coding agent that can read files
and run commands, paste this:

> Install minsky for this folder per the runbook at <URL>, then start it.
> Ask me only the consent question.

The agent reads INSTALL.md, clones minsky, registers your current folder
as the host, asks you once about anonymized telemetry, and starts the
daemon. Total: ~60 seconds, one human prompt.

**Manual install** — for when you don't have an agent handy:

​```bash
git clone <repo> ~/apps/tooling/minsky
cd ~/apps/tooling/minsky && pnpm install && bin/minsky
​```

The first run installs launchd persistence so minsky survives reboots; later
runs in the same folder attach to the existing daemon. Ctrl-C detaches the
dashboard without stopping the daemon; minsky stop shuts everything down.
```

Anti-pattern: showing the manual path first because "it's the one that always works" or "it's what we've had longest". That makes the magic path look like an afterthought / optional optimization rather than the recommended flow. The recommended flow goes FIRST regardless of which one shipped first.

## Tier 5 reference sections — lead with a summary that contextualises volume

Reference tables (`## Key files`, `## CLI reference`, `## Configuration`) feel overwhelming when they list 10+ items with no perspective. Even an accurate inventory reads as "this tool is going to take over my machine" if the reader doesn't know which items they'll actually touch.

Rule: **every reference section opens with one sentence that contextualises the volume**. Three patterns:

1. **Numerical reassurance**: "Minsky adds **one tracked file to your host repo** (`TASKS.md`). Everything else is gitignored or in your home directory." (Killing the "too many files!" anxiety.)
2. **Scope reassurance**: "Most of these commands you'll never touch — `minsky` and `minsky watch` cover 90% of usage." (Telling the reader 80% of the table is for power users.)
3. **Grouping reassurance**: "Files live in three places — your host repo (your data), your home dir (per-machine state), or this minsky repo (read-only from a user's perspective)." (Letting the reader skip the groups that don't apply.)

Then split the long table into sub-tables (or sub-sections) by the grouping you just announced. A reader scans the headings, finds the group that matters to them, and ignores the rest.

Worked example — bad → good:

```text
BAD (one big 9-row table dumped on the reader):

  ## Key files

  | File | Where | What it is | What you do with it |
  |---|---|---|---|
  | TASKS.md | host repo | ... | ... |
  | ~/.minsky/config.json | home dir | ... | ... |
  | ... 7 more rows ...

GOOD (lede + 3 sub-tables by grouping):

  ## Key files

  Minsky adds **one tracked file to your host repo** (`TASKS.md`) and one
  gitignored dotfolder (`.minsky/`). Everything else is in your home dir
  or inside the minsky repo itself.

  **In your host repo:**
  | File | Tracked? | What you do with it |
  | TASKS.md | yes | ... |
  | .minsky/ | no | ... |
  | AGENTS.md | optional | ... |

  **In your home directory:**
  | File | What you do with it |
  | ~/.minsky/config.json | ... |
  | ~/.minsky/daemon.log | ... |

  **Inside the minsky repo itself** (read-only from a user's perspective):
  MILESTONES.md, vision.md, DEPRECATED.md, competitors/ — context, not
  surface area.
```

The BAD version asks the reader to scan a 9-row table to figure out which files matter. The GOOD version's lede tells them "1 tracked file" before they see any list, and the 3 sub-tables let them skip 5-6 files immediately.

## "How <Tool> works inside" — the auditable internals section

For tools whose distinctiveness is in HOW they're built (not just what they do), add a tier-5 section explicitly named "How <Tool> works inside" — different from "Architecture (30 seconds)" which is a brief diagram. The "inside" section is the 5-minute follow-up that names the specific files where each distinctive piece lives, so an evaluator can audit any claim by opening the file.

### When to add this section

Add it when:

- The tool has architectural distinctiveness vs. competitors (a control loop pattern, an enforcement model, a multi-component pipeline)
- The README's `## Why <Tool>?` (motivation) bullets make claims about HOW the tool works ("the daemon refactors the daemon", "MAPE-K control loop", "constitutional rules enforced as CI lints") — those claims deserve a place where the operator can dig in
- The codebase has 5+ distinctive files / mechanisms an evaluator should know about

Skip it when:

- The tool's distinctiveness is purely UX (a CLI wrapper, a config layer) — the brief Architecture diagram is enough
- The internals are well-described by an existing reference doc (e.g., `ARCHITECTURE.md`) — link to that instead
- The codebase has <5 distinctive pieces; just expand "Architecture (30 seconds)" to ~15 lines

### Structure

```markdown
## How <Tool> works inside

<N> things that make <Tool> distinctive at the implementation level.
File paths included so any claim is auditable.

### 1. <Distinctive piece — short noun-phrase title>

<2-4 sentence prose paragraph or a bullet list with file paths.
Lead with the OUTCOME the piece delivers, then cite the file path.>

- **<Sub-item if needed>** (shipped). `<file/path.ts>` does X. <Why it
  matters in one sentence.>
- **<Sub-item>** *(M2 — tracked at `task-id`)*. <What it will do once shipped.>

### 2. <Next piece — name a pattern + citation>

<...repeat...>
```

Six rules:

1. **5-7 sections.** Same range as motivation bullets — enough to feel substantive, not so many that the reader bounces. Each section is one "thing".
2. **Every section names file paths.** No prose-only sections. The whole point is auditability; without paths, the section is marketing.
3. **Section titles are short noun-phrases.** "Multi-layer team of workers" / "MAPE-K control loop" / "Soft-by-default failure modes" — not full sentences and not pain-led.
4. **Honesty markers carry forward.** If a piece is `*(in flight)*` / `*(M2)*` / `*(opt-out via ENV_VAR)*`, mark it the same way as in motivation bullets. Aspirational claims with no implementation are NOT allowed in this section — they belong in the Roadmap at tier 6.
5. **One academic citation per section when applicable.** "MAPE-K control loop (Kephart & Chess 2003, IBM autonomic computing)" gives the section title literature weight. Don't fake citations; if the piece doesn't map to a published pattern, skip the citation.
6. **Open with the 30-second sketch, then the deeper sketch.** Don't ship a separate `## Architecture (30 seconds)` H2 — that creates two adjacent reference sections covering the same material. Instead, open `## How <Tool> works inside` with the ASCII / mermaid diagram (as "The 30-second sketch:") and follow with "The deeper sketch — N things that make <Tool> distinctive…". One continuous read from elevator pitch to file-path-by-file-path depth. Place between Configuration and Key files. The progression is: configure → understand → look up.

### Worked example — minsky's "How Minsky works inside" section (real, 2026-05-20)

Six sections covering: (1) multi-layer team of workers, (2) MAPE-K control loop with literature citation, (3) constitution = 18 rules each enforced as a CI lint, (4) soft-by-default failure modes (Erlang let-it-crash + OS supervisor), (5) dynamic watchdog (p95 from history), (6) self-improvement on itself (the daemon refactors the daemon).

See `README.md` § "How Minsky works inside" — 60 lines, every section cites at least one file path, half cite literature, three carry honesty markers (`*(M2)*`, `*(P0)*`, `*(opt-out via ENV_VAR)*`).

Anti-pattern this section avoids: an "Architecture" section that's a 200-line ASCII diagram with module names but no file paths. The diagram is impressive-looking but un-auditable. Replace with this section's structure: short titles, prose with file paths, claims you can verify by clicking.

## Motivation sections (`Why <Tool>?`) — outcome-led value list

A motivation section answers the question **"what do I get with this tool running?"** — listing the concrete outcomes the operator gets, in operator-relatable language. It's distinct from "What works today" (a capability matrix that says "feature X: shipped"). The capability matrix is for evaluation; the motivation section is for value framing. Both belong in the README; they do different jobs.

(The original framing of this section was "pain-point list" — earlier skill versions led each bullet with the operator's pain. 2026-05-20 operator feedback over-rode that: pain-led headlines read as cynical to a stranger evaluating the tool. The right framing is OUTCOME-led — what does the operator GET? — with the pain hinted in the body if at all.)

### Placement

Motivation section sits at the **tier 3 / tier 4 boundary** — right after the walkthrough (`## What it actually does`), before the etymology (`## Why "<Tool>"?` with quotes) if the etymology exists. Reasoning: the reader has just seen *what* the tool does (tier 3 walkthrough); now they need to see *why they should care that it does that* before they invest in evaluating the capability matrix (tier 4).

### Structure — 5-7 compact one-line bullets with `[details →]` links

Use a bulleted list. Each bullet is ONE compact line — bold outcome, optional honesty marker, brief description, link to a dedicated detail page:

```markdown
- **<Outcome — short noun-phrase, ≤8 words>** *(<honesty marker if partial>)* — <one-line description, ≤20 words>. ([details →](<path-to-detail-page>))
```

Why one line per bullet: earlier versions of this skill recommended TWO-line bullets (bold headline + body paragraph). 2026-05-20 operator feedback overrode that — multi-line bullets read as "sausages": each takes 3-4 wrapped lines, the section feels long, and the reader can't scan the list of outcomes at a glance. Compact one-line bullets are scannable; the depth lives on a dedicated detail page the reader clicks into.

Why dedicated detail pages: each motivation point usually has a corresponding artifact already — a user story, a design doc, a tracked task page. The motivation section LINKS to those instead of duplicating their content. The reader who wants the pitch scans 7 bullets in 30 seconds; the reader who's evaluating clicks into the detail page for the bullet that hooked them.

Detail-page candidates (in order of preference):

- `user-stories/<NNN>-<feature>.md` if the motivation point has a published user story with acceptance criteria + metric + chaos coverage. This is the strongest backing.
- `docs/<feature>.md` if there's a dedicated feature doc.
- A specific section anchor in this README (`#how-<tool>-works-inside` for example) if the detail belongs in the same doc.
- A linked TASKS.md entry by task ID (use backticks, never bare text) if the feature is in flight and the task IS the spec.

Never link a motivation bullet to a generic landing page or a TODO. The link is a contract: clicking it must reach a page that backs the bullet's specific claim.

Why 5-7 bullets: 3 or fewer feels thin (the reader doesn't trust there's a real list). 8+ dilutes the strongest bullets. 5-7 is the sweet spot.

### Voice — outcome-led, positive but real (not dry-pain-comedy)

Earlier versions of this skill recommended "dry observation-comedy" (pain-first headlines with constructed observational humor). Operator feedback 2026-05-20 over-rode that: the framing was too cynical. The reader is here because they're considering ADOPTING the tool — they want to know what they GET, not be reminded of what hurts.

The right tone is **outcome-led, positive but real**:

1. **Lead with what the operator GETS, not what hurts them.** Bad: "Asking your agent 'what should I work on next?' after every task gets old fast." Good: "Continuous, unattended improvement — with safety guards that hold." The operator's question isn't "what's wrong with my life?" — it's "what does this tool deliver?".
2. **Name specific entities when they sharpen the claim, not for shock value.** Good specificity: "pay Sonnet prices only for Sonnet work" (concrete cost framing), "swaps to a local Ollama model" (specific tech). Bad specificity: dunking on a vendor ("Your Anthropic invoice running out at 2am") when the framing is purely pain-led. Use the specific name when it's load-bearing, not when it's a punchline.
3. **Honest about caveats without leaning into them.** Honesty markers `*(in flight)*` / `*(rule #N, enforced)*` / `*(opt-out via env var)*` carry the partial-implementation note without making the bullet feel apologetic. Don't bury the caveat; don't make it the headline.
4. **No author-self-references.** Don't name the maintainer by name ("filed by a Devin session, not by Fyodor"). It reads as inside-baseball. Use roles ("filed by daemon iterations") or generic actors ("filed by an agent").
5. **No marketing puff.** "Empowers", "unlocks", "transforms", "delights" — all banned. Stay descriptive: "improves", "picks", "rejects", "ships". The operator can tell the difference between a real claim and a marketing claim within 2 words.

Length constraint: each headline ≤20 words, each body ≤25 words. Tightness preserves the punch.

The previous skill version offered "dry observation-comedy" as the recommended voice. That worked for an internal audience that already lived the pain. It doesn't work for a stranger evaluating the tool — they need the value proposition before they recognize the pain. Use outcome-led headlines for the README's motivation section; reserve dry-pain-comedy for internal post-mortems / retros where the audience is already invested.

### Honesty — every claim is shipped, or marked partial with a linked task

The motivation section is high-stakes: a reader who sees a bullet they like, then later discovers the feature isn't shipped, won't trust the rest of the README. Mitigation: explicit honesty markers.

For each bullet, the body claim is in one of three states:

- **Shipped** — no marker needed. Just state what the tool does. Optionally cite the file path (e.g., `` `novel/cross-repo-runner/src/host-cto-audit.ts` `` shipped).
- **Partial / in flight** — append `*(in flight)*` or `*(<rule>, enforced)*` to the headline, link the task in the body: "Tracked as P0 `` `task-id` ``".
- **Aspirational** — don't include. If the feature isn't started, it's not motivation, it's hope. Move it to roadmap.

The honesty marker convention:

```markdown
- **<Headline>.** *(in flight — P0 `task-id`)*
  <Body claim mentioning that the partial implementation exists today and the linked task closes the loop>.

- **<Headline>.** *(<rule #N>, enforced)*
  <Body claim with file path to the linter / mechanism>.

- **<Headline>.**
  <Body claim — shipped today, no marker>.
```

### Disambiguating motivation from etymology

A repo may have two `## Why ...?` sections: motivation and etymology. They look similar in the rendered TOC. Disambiguate by punctuation:

- `## Why <Tool>?` (no quotes around tool name) → **motivation** — answers "why does this tool exist?". The pain-point list.
- `## Why "<Tool>"?` (quotes around tool name) → **etymology** — answers "why is it called <Tool>?". The naming trivia.

GitHub auto-generates heading anchors by lowercasing + stripping punctuation. Both `Why Minsky?` and `Why "Minsky"?` slugify to `why-minsky`; the second one gets auto-suffixed to `#why-minsky-1`. Document the slug assignment in the commit body when adding the second section, so the first link in the doc resolves predictably:

- The section that appears FIRST in document order gets the bare slug.
- Any teaser-link from tier 1 should point at the bare slug — which means the motivation section (first occurrence) is what the teaser jumps to.

If the slug collision feels brittle, rename the etymology section to something like `## About the name` — but the `Why <Tool>?` vs `Why "<Tool>"?` convention is the canonical way, and the disambiguation is well-defined.

### Worked example — minsky's "Why Minsky?" section (real, 2026-05-20 — post-rewrite for compact one-line bullets)

```markdown
## Why Minsky?

Seven things you get with minsky running on a repo. Each links to a dedicated
user-story page with acceptance criteria, metric, and chaos coverage.

- **Continuous, unattended improvement** — daemon picks tasks, ships draft PRs, never merges without you. ([details →](user-stories/001-loop-runs-overnight.md))
- **Issues surfaced as draft tasks** *(opt-out via `MINSKY_CTO_AUDIT=off`)* — a CTO-audit pass after each iteration proposes new tasks for your review. ([details →](user-stories/007-cto-audit-files-new-tasks.md))
- **Right model for each task** *(per-task backend today; multi-persona M2)* — claude for prose, devin for refactors, local Ollama for mechanical lint fixes. ([details →](user-stories/008-per-task-backend-and-personas.md))
- **Forced research at PR time** *(rule #1, enforced)* — every PR cites the existing libraries it considered; the linter blocks reinvention. ([details →](user-stories/009-forced-research-rule-1.md))
- **A tool that improves itself** — reads own daemon metrics, files tasks against own stability, ships the fixes. ([details →](user-stories/003-mape-k-improves-prompts.md))
- **Keeps iterating when the cloud runs dry** *(detection today; mid-run swap is P0)* — quota exceeded → local Ollama → loop continues until your tokens return. ([details →](user-stories/004-budget-auto-pause.md))
- **Async Q&A across timezones** *(P0)* — agents write to `.minsky/qa-log.md`; you reply by editing the file. ([details →](user-stories/010-async-human-qa-via-file.md))

Safety guards are mechanical — every PR is a draft for your review, every
iteration passes 15 lint gates including secret-scan, scope-discipline, and
security review. No agent can push to `main`. No PR merges without your
approval.
```

Notice:

- 7 bullets at the upper end of the 5-7 range
- Each bullet is ONE compact line (≤25 words total: bold outcome + optional honesty marker + brief description + `[details →]` link). The reader can scan all 7 in under 30 seconds
- Every bullet has a `[details →]` link to a user story — the depth lives on the dedicated page, not duplicated in the README
- Headlines lead with the OUTCOME the operator gets ("continuous improvement", "issues surfaced", "right model for each task") — never with the operator's pain
- Specificity is load-bearing where it appears: "Sonnet prices" (concrete cost framing), "Ollama" (specific tech), `MINSKY_CTO_AUDIT=off` (verbatim env var). No vendor-dunking
- Three of seven have honesty markers (`*(opt-out via ...)*`, `*(detection today; mid-run swap is P0)*`, `*(P0)*`) — partial state is named, not buried
- A short closing paragraph below the list carries the "safety guards" cross-cutting claim that doesn't belong in any one bullet. This is optional — use it when there's a single sentence that applies to all 7 bullets and would otherwise need to be repeated in each
- No author-self-references — no maintainer named

## Where do "Principles" / "Why is it named X?" / etymology sections go?

These design-philosophy / context sections are interesting reading but not essential. They can sit at one of two positions, depending on how much they inform the reader's decision to commit:

- **Tier 4 (between "What it will NEVER do" and the edge-case sections)** — when the principles or name origin are operator-relevant, i.e., they help the reader decide "does this fit my style / will I want to use it?". Example: a `## Principles` section saying "we lean toward soft-failure by default" tells the operator something about the tool's behaviour they need to know BEFORE committing. Put it at tier 4.
- **Tier 6 (after Picking up upstream fixes / Uninstall)** — when the section is purely about contributor culture, project history, or trivia. Example: a "## Naming" section that just tells the trivia "named after person X" with no operational implication. Put it at tier 6 if you keep it at all.

**Anti-pattern**: design-philosophy sections sandwiched between reference sections (tier 5). The reader is in "look up the command I need" mode at tier 5; interleaving "here's our design philosophy" between `CLI reference` and `Configuration` breaks the lookup flow. Always cluster reference sections together; principles either goes above (tier 4) or below (tier 6) them, never inside.

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

## Imperative leading — state the action, not the justification

Sections that lead the reader into a code block, prompt, or instruction should open with the imperative — "Run this", "Copy-paste this", "Edit this file" — not with a justification of who the section is for or why it exists.

Bad (real example from minsky's README, 2026-05-20):

> **Recommended — let your agent install it.** If you're inside Claude Code, Cursor, Windsurf, Devin, Codex, or any AI coding agent that can read files and run commands, paste this:
>
> > Install minsky for this folder per the runbook at <…>, then start it. Ask me only the consent question.

Good:

> **Through your AI agent.** Copy-paste:
>
> > Install minsky for this folder per the runbook at <…>, then start it. Ask me only the consent question.

The reader already decided to read the section labelled `## Getting started`. They don't need a second-layer justification ("Recommended — let your agent install it. If you're inside <list>, paste this:") before the actual instruction. The header established intent; the imperative delivers the action.

Three rules:

1. **Open with the imperative.** "Run this", "Copy-paste", "Edit this file". Or a 1-2 word category label followed by the action: "**Through your AI agent.** Copy-paste:" / "**Manual:**" / "**With a token:**".
2. **No "Recommended" / "Preferred" / "If you're using X" prefixes.** The header already established the section's applicability. The prefix re-justifies what the reader already chose.
3. **No padding assurances.** "Total: ~60 seconds, one human prompt." / "Should work in <5 min." / "Trust me, this is the easiest way." If the command actually takes 60 seconds, the reader finds out by running it. The assurance is padding.

Same principle applies to **closing assurances** after code blocks: don't write a paragraph explaining what just happened ("The first run installs launchd persistence so minsky survives reboots; later runs in the same folder attach to the existing daemon. Ctrl-C detaches the dashboard without stopping the daemon; minsky stop shuts everything down") unless the reader genuinely needs that information BEFORE they paste the command. Most of the time, the explanation belongs on a detail page the operator visits LATER.

## Move detail pages out — README is for first-touch readers

Tier-4 / tier-5 / tier-6 reference sections that exceed ~15 rendered lines should usually be moved to a dedicated `docs/<topic>.md` page, with a one-line pointer in the README's bibliography section ("More" / "Reference & detail pages").

The principle: the reader on first touch needs the LEDE + INSTALL + WALKTHROUGH + MOTIVATION + HONEST-MATRIX + ANTI-FEATURES. They do NOT need the full CLI reference, the full configuration spec, the full uninstall workflow, the full file inventory, or the full update procedure inline. Those are operator-returning content — read later, when the operator is actually using the tool.

### What stays in the README

- Tagline + lede + teaser-branch (tier 1)
- Getting started (tier 2)
- Walkthrough — "What it actually does" (tier 3)
- Motivation — "Why <Tool>?" with compact bullets + `[details →]` links (tier 3/4 boundary)
- Honest capability matrix — "What works today" (tier 4)
- Anti-features — "What it won't do" (tier 4)
- Architecture overview (tier 5) — keep the 30-second sketch + brief summary of distinctive mechanisms; the file-path-by-file-path depth goes to `docs/how-it-works.md`
- Roadmap pointer (tier 6) — 2 lines
- License (tier 6) — 1 line
- "More" / "Reference & detail pages" bibliography (tier 5) — list of one-line links to every moved-out detail page

### What moves out to `docs/<topic>.md`

In rough order of how-often-moved across READMEs:

1. **CLI reference** → `docs/cli-reference.md`. The full command table is power-user content; rarely read on first touch. Keep at most 3 commands hinted inline (the ones every user touches).
2. **Configuration** → `docs/configuration.md`. The full config-file spec + agent comparison table + env-var index. Keep a 5-line `~/.minsky/config.json` example in README if the install path needs it; move the rest.
3. **Uninstall** → `docs/uninstall.md`. Operator removing the tool isn't reading the README; they're searching for "how do I uninstall". A dedicated page is more discoverable.
4. **Updating / Picking up upstream fixes** → `docs/updating.md`. Post-install workflow; not first-touch content.
5. **Key files / file inventory** → `docs/key-files.md`. Useful for debugging but verbose; the README can carry a one-sentence summary ("Adds one tracked file to your host repo (TASKS.md) plus a gitignored .minsky/ sidecar; the rest lives in your home dir or the minsky repo itself") with the full table on the linked page.
6. **Edge cases** (empty queue / runtime limits / communication channels) → `docs/edge-cases.md`. Curious-reader content; not load-bearing for the install decision.
7. **Principles / design philosophy** → `docs/principles.md`. Informs "should I commit?" but most readers don't drill into it.
8. **Etymology / about the name** → `docs/about.md`. Trivia.
9. **How <Tool> works inside (depth)** → `docs/how-it-works.md`. The 30-second sketch stays in the README; the 6 file-path-by-file-path subsections move to the detail page.

### The bibliography section

The README's "## More" (or "## Reference & detail pages") section at the bottom is the navigation aid. Format: bulleted list, each item is a one-line description + link. No prose between items. Group related items if there are 8+ entries.

```markdown
## More

- **Install runbook** — [INSTALL.md](INSTALL.md) — agent-readable install steps
- **Uninstall** — [docs/uninstall.md](docs/uninstall.md) — full removal, daemon stop, sidecar cleanup
- **Updating** — [docs/updating.md](docs/updating.md) — `git pull` workflow, restart, sentinel
- **CLI reference** — [docs/cli-reference.md](docs/cli-reference.md) — every command, every flag
- **Configuration** — [docs/configuration.md](docs/configuration.md) — `~/.minsky/config.json`, agent comparison, env vars
- **Edge cases** — [docs/edge-cases.md](docs/edge-cases.md) — empty queues, runtime limits, communication channels
- **Key files** — [docs/key-files.md](docs/key-files.md) — file inventory by location
- **Architecture depth** — [docs/how-it-works.md](docs/how-it-works.md) — file-path-by-file-path mechanisms
- **Design principles** — [docs/principles.md](docs/principles.md) — the 5 design choices
- **Practices index** — [docs/PRACTICES.md](docs/PRACTICES.md) — scientifically proven practices with citations
- **Constitution** — [vision.md](vision.md) — the 18 rules
- **Work queue** — [TASKS.md](TASKS.md) — open tasks with rule-9 fields
- **Roadmap** — [MILESTONES.md](MILESTONES.md) — M1–M5 exit criteria
```

The reader scans the bibliography and clicks into the one they need. The README itself is a compact landing page; the detail pages are the working surface.

### When NOT to move out

- The section is <10 lines and load-bearing (e.g., "What it won't do" — 4-5 bullets, every reader needs them, keep inline)
- The section IS the elevator pitch (e.g., the 30-second architecture sketch — moving it would make the README feel hollow)
- The section's content is duplicated in other places anyway (no point creating a third source of truth)

## Worked example: tool README skeleton

A clean tool README in reader-priority order:

```markdown
# <Tool name>

> <One-line elevator pitch — what problem this solves, in 12 words or fewer>

<badges>

<60-word concrete explanation of what the tool actually DOES — outcome     <!-- tier 1: what IS this -->
not internals. If the paragraph makes a credibility claim (scientifically
proven / battle-tested / evidence-based), it MUST link to a tier-5
reference doc that lists the specific practices with citations.>

**[<X reasons you'd want this> →](#why-<tool>)** &nbsp;·&nbsp; Or skip to [getting started](#getting-started).

<!-- Tier 1 branching: ≤2 arrow-links; the second is the default
     skip-ahead path; both must resolve to anchors in this doc. -->

## Getting started                   <!-- tier 2: install + run -->

<!-- If there's a magic install path (agent-mediated / npx / curl|sh) AND
     a manual fallback, use the recommended-vs-fallback pattern. If only
     one path exists, just show that one as a single code block. -->

**Recommended — <one-line description of the magic path>.** <Reader instruction in prose, plus a copy-pasteable `>` quoted prompt if the path is "ask your agent">.

<1-2 sentence explanation of what happens — timing, prompts, end state>.

**Manual install** — for when you don't have <whatever the magic path needs>:

​```bash
<2-3 commands>
​```

<1-2 sentence explanation of what happens on first run — daemon install,
attach behaviour, stop command>.

## What it actually does             <!-- tier 3: walkthrough -->

1. ...
2. ...

> **What's a "X"?** <one-paragraph definition of any key term used above>

## Why <Tool>?                        <!-- tier 3/4 boundary: motivation -->

<!-- The outcome-led value list. 5-7 bullets, each TWO lines (bold
     OUTCOME-led headline naming what the operator gets + concrete claim
     body with honesty marker for partial features). Specificity is
     load-bearing where it appears; no vendor-dunking, no maintainer
     first-names, no marketing puff verbs. Honesty markers link partial
     features to their P0/P1 tasks. See "Motivation sections
     (`Why <Tool>?`) — outcome-led value list" above. -->

<N> things you get with <Tool> running:

- **<Outcome-led headline naming what the operator gets — not what hurts>.** *(<honesty marker if partial — `in flight — P0 task-id` / `rule #N, enforced` / `opt-out via ENV_VAR`>)*
  <One-sentence concrete claim about what the tool does about it, with file path or task ID citation>.

- ... (5-7 total)

## What works today (honest)         <!-- tier 4: honest limits -->

| Capability | Status | Confidence |
|---|---|---|
| ... | ... | ... |

## What it won't do                  <!-- tier 4: anti-features (was "What it will NEVER do" — the all-caps NEVER reads as shouty; the prose under the heading carries the "mechanically blocked" emphasis) -->

## Principles                        <!-- tier 4: design philosophy that informs "should I commit" -->

## About the name                    <!-- tier 4: etymology, OPTIONAL — only when relevant -->

<!-- Preferred title for the etymology section. The earlier convention
     was `## Why "<Tool>"?` (quoted), which renders very similar to the
     motivation `## Why <Tool>?` in a TOC and confuses readers. "About
     the name" is unambiguous and reads naturally. If you must keep the
     `Why "<Tool>"?` form, accept the slug-collision discipline from
     "Disambiguating motivation from etymology" above. -->

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

## How <Tool> works inside           <!-- tier 5: brief diagram + auditable internals (merged) -->

<!-- Opens with the 30-second ASCII / mermaid sketch as a one-look spatial
     model, then "The deeper sketch — N things that make <Tool> distinctive
     at the implementation level, with file paths so any claim is auditable."
     5-7 H3 noun-phrase subsections follow, each citing file paths. Add
     when the tool has architectural distinctiveness OR the motivation
     section makes claims about HOW the tool works. See "'How <Tool>
     works inside' — the auditable internals section" above for the
     structure. Don't ship a separate "## Architecture (30 seconds)"
     H2 — merge the diagram into the opening of this section so the
     reader gets one continuous read from elevator pitch to deep dive. -->

## Key files                         <!-- tier 5: reference -->

## Picking up upstream fixes         <!-- tier 6: maintenance -->

## Uninstall                         <!-- tier 6: maintenance -->

## License                           <!-- tier 6: legal -->

<!-- NOTE: Principles moved to tier 4 above (between "What it will NEVER do" -->
<!-- and "Edge cases") because design philosophy informs "should I commit?", -->
<!-- which is tier 4. Only put Principles at tier 6 if it's purely about     -->
<!-- contributor culture / project history with no operational implications. -->
<!-- See "Where do Principles / Why is it named X? / etymology sections go?" -->
<!-- above for the rule.                                                      -->
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
