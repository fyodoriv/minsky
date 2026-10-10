# reader-priority-docs — imperative leads, detail pages, and the README skeleton

This file exists so the main skill stays short: it holds the imperative-leading rule, the rules for moving detail pages out of the README, and the full worked README skeleton. Read it when you restructure a README.

## Contents

- Imperative leading — state the action, not the justification
- Move detail pages out — README is for first-touch readers
- Worked example: tool README skeleton

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
