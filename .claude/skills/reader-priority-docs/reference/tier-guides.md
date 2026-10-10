# reader-priority-docs — tier-by-tier writing guides

This file exists so the main skill stays short: it holds the detailed writing guides for Tier 1, Tier 2, and Tier 5 sections, plus the "How <Tool> works inside" section. Read it when you write or audit one of those tiers.

## Contents

- Tier 1 paragraph — quality criteria
- Tier 1 layout — explicit branching after the lede
- Tier 2 (Getting started) — minimize chrome
- Tier 2 — recommended-vs-fallback when there's a magic path
- Tier 5 reference sections — lead with a summary that contextualises volume
- "How <Tool> works inside" — the auditable internals section

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
