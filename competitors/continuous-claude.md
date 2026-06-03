# Competitor: Continuous Claude (Anand Chowdhary)

> A ~200-line loop that runs a coding assistant over and over, committing and opening a pull request each round — the bare-bones version of Minsky's run loop, without the rules, the self-improvement layer, or the ability to work across many projects.

- **URL**: <https://github.com/AnandChowdhary/continuous-claude>
- **Status**: Active (~1.3k★, single-maintainer OSS, alive as of 2026-06)
- **Pricing**: Free (OSS, MIT). Model/API costs only (Claude Code subscription or Anthropic API).
- **Relationship**: **Competitor (closest-analog, inner-loop tier)** — it is the simplest public implementation of the same loop primitive that Minsky's run loop provides

## What this is

Continuous Claude is a small command-line tool (`npx continuous-claude`) that runs a coding assistant in a fixed loop. The coding assistant it drives is Claude Code — the agent, meaning the assistant that does the actual file edits and commands. Each round of the loop does five things: hand the task to Claude Code, let it edit files and run commands, commit the result, push it, and open or update a pull request. Then it repeats — for `--max-iterations` rounds, or until a stop condition is met.

It is the packaged form of Geoffrey Huntley's "Ralph technique": feed the same prompt to an agent in a loop until the work is done. Continuous Claude wires that technique to a pull-request-per-round workflow. The whole tool is a few hundred lines: a loop, a git/PR helper, and a thin call into the Claude Code SDK.

A typical command:

```bash
npx continuous-claude --task "Fix the failing tests and open a PR" --max-iterations 10
```

Throughout this file, "the agent" means the coding assistant Continuous Claude drives. Minsky is not an agent — it orchestrates agents. One "iteration" or "run" is one round of work: pick a task, ask the agent to do it, capture the result, open a draft.

## What this is not

- It is not a daemon — a background program that keeps running. It is a foreground command you launch for a bounded run, then it exits.
- It is not a task picker. You give it one task string per run; there is no queue to draw from.
- It is not agent-agnostic. It is hard-wired to one coding assistant (Claude Code).
- It is not a self-improving system. The loop is fixed and does not study or change its own behavior.
- It is not a quality gate. The only reviewer is the human reading each pull request.

## Strengths

- **Minimal and legible** — a few hundred lines; a reader can hold the entire control flow in their head. The opposite of a framework.
- **Pull-request-per-round is the right default** — each loop turn lands a reviewable pull request. This matches how real teams gate AI changes: a human or CI reviews at the merge boundary.
- **Zero ceremony** — `npx continuous-claude` with a task string. No config files, no daemon to install, no orchestration layer to learn.
- **Rides Claude Code directly** — it inherits Claude Code's tool use, file editing, and command execution for free. It does not re-implement the agent layer.
- **Bounded by construction** — `--max-iterations` is a hard stop, so the loop cannot run away. (Runaway is the classic Ralph-loop failure mode.)
- **Honest scope** — it does one thing (loop, commit, open a PR) and does not pretend to be a fleet manager or a self-improving system.

## Weaknesses vs Minsky's vision

The terms below are Minsky-specific. Each is glossed on first use.

1. **No rule set, no merge gate** — there is no machine-enforced rule set. Minsky has a constitution: 17 numbered, non-negotiable rules in `vision.md`, enforced before merge by `pnpm pre-pr-lint --stage=full`. In Continuous Claude, quality control is entirely the human reviewer on each pull request. It can loop forever producing PRs that no rule rejects.
2. **No daemon, not 24/7** — it is a foreground process you launch for a bounded run. It is not a background program that keeps running, survives terminal close, and drains a queue indefinitely (Minsky `daemon start`).
3. **No task queue** — you give it one task string per run. There is no `TASKS.md` (the plain-text Markdown to-do list at a project's root that Minsky reads to pick work), no task picker, no priority ordering, and no claim protocol for parallel workers.
4. **No self-improvement layer** — the loop is fixed. It does not monitor itself, diagnose its own failure classes, or amend its own behavior. Minsky has a MAPE-K loop: an autonomic manager that runs Monitor, Analyze, Plan, and Execute over a Knowledge base (Kephart & Chess, 2003). Continuous Claude has no analog.
5. **No cross-repo fleet** — one repo, one task, one run. A "host" is one code project Minsky works on; Minsky drives many hosts from one operator machine.
6. **No agent-agnosticism** — it is hard-wired to Claude Code. Minsky uses adapters — small wrapper files that let it talk to one outside tool through a fixed interface (rule #2). That seam lets it swap Claude, Devin, Aider, or OpenHands without touching the rest of the code.
7. **No dynamic safety** — there is no watchdog computed from iteration history, no budget guard, and no supervised restart on crash. The bound is a fixed iteration count, not a learned timeout.
8. **No pre-registered hypothesis discipline** — iterations are not falsifiable experiments with a success/pivot threshold. The loop just runs N times. Minsky's rule #9, pre-registered hypothesis-driven development, requires every change to state its hypothesis, success threshold, pivot threshold, and measurement command before code is written (Munafò et al. 2017; Basili et al. 1994).

## What we learn / steal

- **Pull-request-per-round as the unit of progress** — Continuous Claude validates Minsky's choice to make the merge-gated pull request the atom of the loop. The lesson: keep the per-iteration boundary at the PR, not at a raw commit, so every turn is reviewable.
- **The `npx <tool> --task "..."` zero-config entry point** — Continuous Claude's whole interface is one command and a task string. This is a positioning reminder for Minsky's own `minsky transform` and `minsky solve <task-id>` verbs: the common case must be one command with sane defaults (AGENTS.md § "All user interface is P0-P1").
- **Completion-condition gating** — its loop can stop early on a condition, not only on iteration count. Minsky's run loop should likewise prefer a verifiable completion signal (gate-green, task-removed-from-queue) over a fixed bound where one exists.
- **The Ralph technique, productized** — confirms (alongside Anthropic's official `ralph-wiggum` plugin, see `competitors/ralph-wiggum-official.md`) that the re-feed loop is the right inner primitive. Minsky already adopts it as its `InnerLoop`.

## Why choose Minsky over Continuous Claude

- A 24/7 background daemon that survives terminal close and drains a queue indefinitely — not a bounded foreground run.
- A deterministic constitution (17 rules) enforced by CI as the *reviewer*, instead of relying on a human to catch every bad PR.
- A `TASKS.md` queue with priority ordering, a claim protocol, and `**Touches**:` collision-safety for parallel workers.
- A self-monitoring MAPE-K loop with runtime invariants and self-diagnose — the loop watches and heals itself.
- A cross-repo fleet from one operator machine, with agent-agnostic backends (Claude, Devin, Aider, OpenHands) behind an adapter seam.
- Pre-registered hypothesis-driven iterations (rule #9): every change carries a success and pivot threshold, not just an iteration counter.

## Why choose Continuous Claude over Minsky

- You want to read the entire tool in one sitting — it is a few hundred lines, not a system.
- You have exactly one task in one repo and want a bounded run, not a standing daemon.
- You don't want to learn a constitution, a queue format, or a config file. `npx` plus a task string is the whole interface.
- You are happy to be the reviewer on every pull request and don't need an automated quality gate.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

Continuous Claude publishes **no quantitative benchmark** — no SWE-bench number, no merge-rate, no cost-per-PR figure. Per the competitor-research skill's anti-pattern ("don't fabricate readings"), no corpus entry is added. The M1.10 shape gate (≥4 competitors × ≥5 metrics) is already met by the existing corpus, and a single wrapper with no metrics does not need to widen it. If the maintainer ever publishes a resolve-rate or merge-rate, add a `Competitor` record to `competitors.ts` and a row here.

| Metric | Value | Date | Primary source |
| ------ | ----- | ---- | -------------- |
| *(none published)* | — | — | — |

## Should we wrap Continuous Claude instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a wrap target, because Continuous Claude *is* the inner loop Minsky already owns, built on a primitive Minsky already adopts (the Ralph technique via `ralph-wiggum`). Wrapping it would mean wrapping a thinner version of our own run loop that is hard-wired to one agent (Claude Code) — strictly less capable than the seam we have. It is a peer to `novel/tick-loop`, not a layer beneath it. |
| 2. **What we delegate** | Nothing net-new. The only layer Continuous Claude owns is "loop → commit → PR", which Minsky's run loop already owns and does with a queue, a constitution gate, and agent-agnostic backends. Delegating to it would *remove* capability (agent-agnosticism, queue, MAPE-K), not add it. |
| 3. **What we keep** | All 6 moats survive trivially because there is nothing to delegate: daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface. Continuous Claude has none of these. |
| 4. **Net moat after wrap** | 6 of 6 (no surface is delegated). The relevant action is *technique confirmation* (pull-request-per-round, completion-gated loop) — both already present in Minsky — not a structural delegation. |
| 5. **Verdict** | **NO.** Continuous Claude is a strictly-smaller subset of Minsky's run loop locked to one agent. Wrapping it would subtract capability. No P0 wrap task is filed. The productive read is the *strategic* one (see Five pivot questions §4): it is evidence that the loop is commodity, and Minsky's moat is the discipline layer wrapped around the loop, not the loop itself. |

**Trigger for re-evaluation**: if Continuous Claude grows a queue, a deterministic rule-gate, and agent-agnostic backends — that is, if it converges on Minsky's shape — re-run this analysis as an orchestrator-tier competitor. Until then it stays inner-loop tier and the verdict is NO.

## Five pivot questions

### 1. How is it different from Minsky?

Continuous Claude is a **bounded foreground loop** that runs Claude Code N times and opens a pull request per turn. Minsky is a **24/7 daemon** that drains a `TASKS.md` queue across many repos under a CI-enforced constitution. The intent diverges sharply. Continuous Claude productizes the Ralph technique (re-feed the prompt until done) as the *whole* product. For Minsky, the Ralph loop is just the `InnerLoop` primitive (`competitors/ralph-wiggum-official.md`) wrapped in an outer system of queue, supervision, self-improvement, and a deterministic merge gate.

Structurally, Continuous Claude is a peer of `novel/tick-loop` — but a thinner one, hard-wired to a single agent, with no queue, no constitution, and no autonomic layer. The defining difference is the *discipline wrapper*. Continuous Claude trusts the human reviewer on each pull request. Minsky substitutes a machine reviewer — the 17-rule constitution enforced by `pnpm pre-pr-lint --stage=full` — that never sleeps.

### 2. What lessons can it give to us?

- **Pull-request-per-round is the correct loop atom** (Continuous Claude README, the per-iteration `commit → push → PR` flow) — keeping the per-turn boundary at a *reviewable PR* rather than a raw commit is what makes the loop safe for real codebases. Minsky already does this. Continuous Claude's popularity (~1.3k★) is independent confirmation it is the right unit.
- **Zero-config `npx <tool> --task "..."` entry point** (Continuous Claude README, the one-line invocation) — the entire product is one command and a task string. This is a portable UX lesson, not a feature request. It pressures Minsky's `minsky transform` and `minsky solve <task-id>` verbs (AGENTS.md § "Running minsky") to keep the common case to one command with sane defaults (AGENTS.md § "All user interface is P0-P1").
- **Completion-gated, not just count-gated, loops** (Continuous Claude's early-stop condition) — the loop should prefer a *verifiable* completion signal where one exists (gate-green / task-removed) over a fixed iteration count. This generalizes Minsky's run-loop exit condition.
- **The Ralph technique is commodity** (Geoffrey Huntley's original Ralph post; Anthropic's official `ralph-wiggum` plugin; Continuous Claude as a third independent implementation) — three independent productizations of the same re-feed loop is strong evidence the *loop itself* is not a moat. This is the most strategically important lesson and feeds Q4.

### 3. Are any of these lessons potentially vision-changing?

**Yes — one was examined as a candidate vision-threat, and the resolution sharpens rather than rewrites the vision.** The hypothesis behind this task was: if a ~200-line wrapper (Continuous Claude) captures ~70%+ of Minsky's run-loop surface, then the loop is commodity and Minsky's moat must be re-framed as "discipline-as-a-product" (the constitution + MAPE-K + rule-1 reuse bias), not "the loop".

On inspection the premise is **true** — Continuous Claude does cover the bare loop-and-PR surface — but it does **not** force a rewrite of `vision.md § What Minsky is`. That section already states Minsky "is not a framework" and that its value is the system around the loop, not the loop. The loop being commodity is consistent with, not contradictory to, the existing vision.

The correct disposition is therefore **strategic** (Q4: lead positioning with the discipline layer, treat the loop as commodity to be inherited from `ralph-wiggum`) rather than constitutional. A negative finding is recorded here inline per this task's central-routing convention (the brief routes operator strategic questions centrally rather than into this file). Recommendation: **absorb the commodity-loop framing into positioning, no vision change.** The single load-bearing claim to re-emphasize publicly: *Minsky's moat is the constitution-as-CI and the autonomic layer wrapped around a commodity loop — not the loop.*

### 4. How can we improve our strategy based on this?

- **Lead positioning with "discipline-as-a-product", treat the loop as commodity** — three independent Ralph-loop productizations (Huntley's original, Anthropic's `ralph-wiggum`, Continuous Claude) prove the loop is not the moat. Strategy move: in README/positioning, foreground the constitution-as-CI merge gate, the MAPE-K self-improvement, and the cross-repo fleet — and explicitly say Minsky *inherits* the loop from `ralph-wiggum` rather than claiming it. Traces to lesson §2.4.
- **Keep the common-case entry point to one command** — Continuous Claude's `npx + task string` is the bar. Strategy move: ensure `minsky transform` and `minsky solve <task-id>` stay zero-config for the 90% case (rule #16 default-by-default; AGENTS.md § "All user interface is P0-P1"), so Minsky is never *harder to start* than the thin wrapper while being far more capable. Traces to lesson §2.2.
- **Make the loop exit condition completion-gated where verifiable** — strategy move: prefer a verifiable completion signal (gate-green, task removed from queue) over a fixed bound in the run-loop exit logic, matching Continuous Claude's early-stop while keeping Minsky's bound as the fallback. Traces to lesson §2.3.
- **Cite Continuous Claude as the "minimal baseline" in the competitive narrative** — strategy move: use it as the concrete answer to "why not just a 200-line wrapper?" in positioning. It is the honest floor against which Minsky's added discipline is measured. Traces to lesson §2.1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **run loop (`novel/tick-loop`)**: KEEP — Continuous Claude is a *thinner, single-agent* version of exactly this surface. Replacing the run loop with it would drop agent-agnosticism, the queue, and the completion gate. Minsky's version is superior.
- **MAPE-K**: KEEP — Continuous Claude has no self-monitoring or self-improvement layer; nothing to replace.
- **adapters / agent backend**: KEEP — Continuous Claude is hard-wired to Claude Code; adopting it would *remove* Minsky's adapter seam (rule #2) and lock us to one vendor.
- **sandbox**: N/A — out of Continuous Claude's scope.
- **queue / TASKS.md surface**: KEEP — Continuous Claude takes one task string per run; it has no queue, priority ordering, or claim protocol.
- **corpus / scorecard**: N/A — Continuous Claude publishes no benchmark and is not in the M1.10 corpus.
- **dashboard / fleet**: KEEP — no cross-repo fleet, no observability surface in Continuous Claude.

**Total replace % across all surfaces: 0%.** The headline for the operator: *nothing to replace — Continuous Claude is a strictly-smaller subset of Minsky's run loop locked to one agent. The takeaway is strategic (the loop is commodity; the moat is the discipline wrapper), not architectural.*

## Last reviewed

2026-06-02 — initial entry created per task `competitor-add-continuous-claude` with `## Should we wrap Continuous Claude instead?` (verdict NO — strictly-smaller subset of the run loop) + `## Five pivot questions` (Five Pivot Questions framework). Hypothesis (a ~200-line wrapper captures ≥70% of the bare loop surface) confirmed true, but it sharpens rather than rewrites the vision: `vision.md § What Minsky is` already frames the loop as commodity and the moat as the constitution-as-CI + MAPE-K + cross-repo fleet around it. No corpus entry (no published benchmark). Negative vision finding logged inline per this task's central-routing convention.
