# reader-priority-docs — motivation and positioning sections

This file exists so the main skill stays short: it holds the rules for "Why <Tool>?" motivation sections, where principles and etymology go, and when positioning belongs in a README. Read it when you write or audit those sections.

## Contents

- Motivation sections (`Why <Tool>?`) — outcome-led value list
- Where do "Principles" / "Why is it named X?" / etymology sections go?
- When does positioning belong in the README at all?

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
