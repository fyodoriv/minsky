# Competitor: Sweep AI (sweepai)

> Sweep AI was a GitHub App that turned issues into pull requests on its own. It reached 7.7k GitHub stars, could not make that autonomy reliable, and pivoted to an in-editor assistant. It is the closest cautionary tale to Minsky's own bet, so this file is a post-mortem, not a vendor to adopt.

- **URL**: <https://github.com/sweepai/sweep>
- **Status**: **Dead as a GitHub App.** The `sweepai/sweep` repo README now reads *"Thank you for all of the support on Sweep. We're now building an AI coding assistant for JetBrains."* The GitHub App is deprecated. The company is alive; the autonomous-PR product is not. The live product is an AI autocomplete and coding agent for JetBrains IDEs (<https://sweep.dev/>, <https://plugins.jetbrains.com/plugin/26860-sweep-ai-autocomplete--coding-agent>).
- **Pricing**: The GitHub App had free and paid tiers, now retired. The JetBrains plugin is the live commercial product.
- **Relationship**: **Reference and thesis-falsifier.** Sweep is not a tool to adopt. It is a failure to learn from. Its dead branch most directly tests Minsky's load-bearing claim: that sustained autonomous PR generation is viable.

Minsky is a background program you point at your code projects. It picks the most important unfinished to-do item, asks a coding assistant to do it, and hands you a draft to review. It never publishes changes on its own. Read this file before assuming a stateless, event-driven design can carry round-the-clock autonomy.

## What this is

A post-mortem of the issue → PR autonomous pattern, written so a cold reader can see exactly which design choice killed the product.

Sweep was a GitHub App. You filed a GitHub issue, applied a `sweep:` label (or wrote `Sweep:` in the title), and the app planned a change, generated a patch across one or more files, opened a pull request, and iterated on review comments and failing CI. There was no editor and no local session. The unit of work was a GitHub issue; the unit of output was a GitHub PR. Everything ran on GitHub webhooks against the vendor's cloud backend.

It reached **7.7k GitHub stars** and graduated Y Combinator (<https://www.ycombinator.com/companies/sweep>) on this idea. The founders started in 2023 to build "an AI junior developer," then concluded (in their YC launch, <https://www.ycombinator.com/launches/N2H-sweep-jetbrains-ai-coding-assistant>) that this "was many years out," and pivoted to "a coding assistant that developers could use today." The repo README confirms the lineage: *"we previously built an AI coding agent with >7k github stars."*

## What this is not

- Not a product Minsky should wrap or adopt. The autonomous version does not exist anymore.
- Not a competitor in Minsky's category today. The live Sweep is an editor plugin; Minsky is an orchestrator that drives coding assistants (an "agent" here means the coding assistant — Claude Code, Devin, Aider, or OpenHands).
- Not a scored row in the benchmark corpus. Sweep never published a vendor-primary benchmark number, so there is no honest reading to record.

## Strengths

These worked while the product was alive.

- **Zero-install on-ramp.** A GitHub App is the lowest-friction way to ship autonomous PR generation — no clone, no background program, no local setup. Install once on the org, label an issue, get a PR.
- **Issue-as-spec ergonomics.** The issue body was the task spec; the PR was the deliverable. This is the same shape as Minsky reading TASKS.md (the plain-text Markdown to-do list at a project's root) and shipping a PR, just sourced from GitHub Issues instead of a Markdown file.
- **Strong early traction.** 7.7k stars is real demand: developers want "describe a change in English, get a reviewed PR."
- **Clean pivot.** When the autonomous bet stalled, the team shipped a viable second product (the JetBrains assistant) instead of dying — evidence that the founders, not the broader market for AI coding, were the constraint.

## Weaknesses vs Minsky's vision

These are the failure modes, each tied to the design choice behind it.

1. **A stateless webhook cannot sustain autonomy.** A GitHub App reacts to events. It has no long-lived process that watches its own success rate, retries across sessions, or recovers mid-task after a crash. Each issue is a cold start. There is no self-improvement loop because there is no *loop* — only a fan-out of independent, stateless invocations. This is the structural opposite of Minsky's daemon, which is a background program that keeps running, supervised and always on (vision rule #6, stay alive).
2. **Cloud-sandbox identity, not operator identity.** "Operator" means the human who runs the tool, and the work runs as that person under their own git and SSH credentials. Sweep ran in the vendor's cloud with its own credentials and a fresh clone per invocation. Commits landed as a bot, not as the operator — the operator's git config, SSH keys, and `gh` auth were nowhere in the loop. Minsky deliberately rejects this boundary (see competitors/README.md § "Reject (by design)").
3. **No self-improvement substrate.** Nothing measured per-task success, filed tasks against its own weak spots, or tuned its own prompts. A stateless app cannot improve itself because it remembers nothing between invocations.
4. **Autonomy was a headline, not a measured floor.** "AI junior developer" was a marketing claim, not a pre-registered, falsifiable threshold (for example, "merge rate ≥ X% over N issues"). Pre-registered hypothesis-driven development (vision rule #9) is the discipline that states a hypothesis, success threshold, pivot threshold, and measurement command before code is written. When real-world merge rate fell short, Sweep had no such framework to localize *where* autonomy paid rent, so the whole autonomous bet was abandoned instead of narrowed to the task classes where it worked.
5. **The pivot direction is itself a verdict.** The team moved from *autonomous* (issue → PR, no human in the loop) to *assistive* (in-editor autocomplete plus agent, human always in the loop). That is the market telling a 7.7k-star team that, as of 2023–2024, reliable hands-off autonomy was "many years out." Minsky's bet is that the *orchestration layer* — the supervised daemon, the numbered project rules, the self-improvement loop, and crash-restart supervision — is what makes sustained autonomy viable today, not the underlying agent. Sweep is the strongest existing evidence that the agent alone is not enough.

## What we learn / steal

Sweep promised sustained autonomous PR generation but shipped a stateless webhook app. Stateless event handlers have no continuity: no cross-session state, no self-observation, no supervised recovery, no closed improvement loop. So reliability could never compound — each issue was a fresh roll of the dice at the model's then-current ability. When hands-off merge rate proved too low to be a product, there was no instrumented framework to retreat to the subset of tasks where autonomy *did* work. The whole autonomous line was retired.

This is the canonical lesson for Minsky. Sweep's dead branch and Minsky's live bet share the same promise — describe work, get a reviewed PR, autonomously — and differ in exactly the layer Minsky claims as its moat. Sweep proved the *demand* (7.7k stars) and proved that the *naive architecture* (a stateless cloud webhook app) cannot deliver it. Minsky's entire reason for existing is the claim that the missing ingredient was the orchestration layer: a supervised daemon (rule #6), running as the operator (the identity moat), with a self-improvement substrate and pre-registered, falsifiable autonomy thresholds (rule #9). If Minsky cannot sustain a measurably better merge rate than a stateless app on the *same* issue → PR task, then Minsky's thesis is the one Sweep already falsified, and the orchestration layer is paying no rent.

### Guardrails this post-mortem hardens

Each names a vision rule and where it is (or should be) enforced.

- **No stateless-webhook autonomy (rule #6, stay alive).** Sustained autonomous PR generation MUST run inside the supervised daemon with cross-session state (`.minsky/orchestrate.jsonl`), never as a stateless event handler that cold-starts per task. This is the most load-bearing guardrail Sweep's death produces: it is the architectural line between Minsky and the product that already failed at Minsky's own promise.
- **Autonomy ships with a pre-registered, falsifiable merge-rate threshold (rule #9).** No hands-off-autonomy feature ships without a numeric success threshold, a pivot threshold, and a runnable measurement (for example `scripts/check-cross-repo-pr-rate.mjs`, the iteration → PR ship-rate gate). Sweep's "AI junior developer" claim with no measured floor is the anti-pattern.
- **Autonomy degrades to a task-class subset, never to zero (rule #9 plus the benchmark corpus).** When merge rate underperforms, the system narrows autonomy to the task classes where it still clears threshold (per-task-class measurement in `novel/competitive-benchmark/`), rather than abandoning the autonomous line wholesale as Sweep did.
- **Commits land under operator identity, never a cloud-sandbox bot (the identity moat).** Any autonomous path that reintroduces a separate cloud identity boundary regresses toward Sweep's architecture and is rejected (competitors/README.md § "Reject (by design)").

### Open threats for operator review

The task `competitor-add-sweep` calls for surfacing vision-threats for the operator. Operator-question files (`ask-human.md`) are written centrally by the orchestrator, not by this task, so the threats are recorded here for the operator to lift.

1. **Thesis-falsifier threat.** Sweep is direct evidence that *demand* for autonomous issue → PR is real (7.7k stars) but the *naive architecture* fails. Minsky's whole thesis rests on the orchestration layer closing that gap. **Operator question:** is there a head-to-head measurement (Minsky driving Claude versus a stateless reference on the same issue → PR task) that shows the orchestration layer paying rent? If not, file the benchmark before claiming the moat.
2. **Pivot-pressure threat.** A 7.7k-star YC team concluded hands-off autonomy was "many years out" and retreated to assistive in-editor tooling. **Operator question:** what is Minsky's pivot threshold — at what measured merge rate, over what window, does the autonomous-daemon bet get narrowed to a task-class subset rather than persevered with on faith? Rule #9 demands this be pre-registered, not decided after the fact.

## Why choose Minsky over Sweep

Sweep's autonomous product no longer exists, so for autonomous PR generation there is nothing to choose. Versus the architecture Sweep *had*: Minsky runs as a supervised, always-on daemon under the operator's own identity, with a self-improvement substrate and pre-registered autonomy thresholds — the exact ingredients whose absence retired Sweep's GitHub App.

## Why choose Sweep over Minsky

For in-editor, human-in-the-loop coding assistance inside JetBrains IDEs, Sweep is now a live, focused product and Minsky is not in that category at all. Minsky is an orchestrator above the agent tier, not an editor plugin. If you want autocomplete and an in-editor agent in IntelliJ or PyCharm today, use Sweep; Minsky does not compete there.

## Scorecard readings

No primary-source reading on the M1.10 metric catalogue (SWE-bench Verified / HumanEval Pass@1). Sweep never published a vendor-primary benchmark number on either metric, and the autonomous product is now dead. This entry is therefore a **post-mortem / thesis-falsifier reference**, not a scored corpus row — it informs strategy (the guardrails above) without adding a fabricated reading (rule #4, no fabricated readings). If a scored row is later wanted, the only honest path is a `local-harness` head-to-head, not a cited vendor number.

## Should we wrap Sweep instead?

No. There is nothing left to wrap. The autonomous GitHub App is deprecated, and the live product is a JetBrains editor plugin in a different category from Minsky. The value here is the lesson, not the integration.

## Five pivot questions

Interrogate these before Minsky ships any feature that depends on hands-off autonomy. Sweep failed each one, and the failure is instructive.

1. **Is there a long-lived, supervised process, or just stateless event handlers?** Sweep had only stateless handlers. Minsky must keep the daemon (rule #6) load-bearing — if any autonomous path degrades to "fire-and-forget on an event," it has regressed to the Sweep architecture.
2. **Does the system observe its own success rate and act on it?** Sweep observed nothing across invocations. Minsky's self-improvement substrate (experiment store, observer, specification monitor, task-filing audit) is the answer — but only if it actually measures per-task merge rate and files tasks against weak spots, not if it is substrate-on-paper.
3. **Is autonomy a pre-registered, falsifiable threshold, or a marketing claim?** Sweep's "AI junior developer" was a slogan. Rule #9 requires a numeric success and pivot threshold plus a runnable measurement *before* shipping. No autonomous feature ships without one.
4. **When autonomy underperforms, can you localize *where* it still pays rent?** Sweep couldn't, so it abandoned the whole line. Minsky's benchmark corpus plus per-task-class measurement must be able to say "autonomy works on bug-fix-shaped issues, loses on cross-cutting refactors" — and route accordingly (compare competitors/agentless.md, the same task-class-isolation lesson).
5. **Who owns the identity the commits land under?** Sweep used a cloud bot identity. Minsky's bet is operator-machine identity — the commits *are* the operator's. If a future feature reintroduces a cloud-sandbox identity boundary, it has reintroduced one of Sweep's structural weaknesses.

## Read next

- <https://github.com/sweepai/sweep> — repo README's pivot note and 7.7k-star count (primary source)
- <https://www.ycombinator.com/launches/N2H-sweep-jetbrains-ai-coding-assistant> — founders' "many years out" pivot rationale (primary source)
- <https://sweep.dev/> — the live JetBrains product (primary source for current status)
- [competitors/README.md](./README.md) § "Reject (by design)" — the cloud-sandbox vs operator-identity distinction Sweep's death reinforces
- [competitors/agentless.md](./agentless.md) — the sibling thesis-falsifier; same task-class-isolation lesson, different angle
- vision.md rule #6 (stay alive — supervised daemon, not stateless handlers), rule #9 (pre-registered, falsifiable autonomy thresholds), rule #1 (don't reinvent — learn from the dead branch before rebuilding it)

## Last reviewed

2026-06-02
