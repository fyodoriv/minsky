# Competitor: Continuous Claude (Anand Chowdhary)

> A ~200-line Ralph-loop wrapper that runs Claude Code in a bounded loop, committing and opening a PR each iteration — the minimal version of Minsky's tick-loop, without the constitution, the MAPE-K substrate, or the cross-repo fleet.

- **URL**: <https://github.com/AnandChowdhary/continuous-claude>
- **Status**: Active (~1.3k★, single-maintainer OSS, alive as of 2026-06)
- **Pricing**: Free (OSS, MIT). Model/API costs only (Claude Code subscription or Anthropic API).
- **Relationship**: **Competitor (closest-analog, inner-loop tier)** — it is the simplest public implementation of the exact outer-loop primitive Minsky's tick-loop provides

## What it is

A small CLI / npm package (`npx continuous-claude`) that wraps the Claude Code SDK in a fixed-iteration loop. Each iteration: invoke Claude Code with the task prompt, let it edit files and run commands, commit the result, push, and open (or update) a pull request — then repeat for `--max-iterations` rounds or until a completion condition is met. It is the productized form of Geoffrey Huntley's "Ralph technique" (re-feed the same prompt in a loop until done), wired specifically to the PR-per-iteration workflow. The whole tool is on the order of a few hundred lines: a loop, a git/PR helper, and a thin Claude Code invocation.

Typical invocation:

```bash
npx continuous-claude --task "Fix the failing tests and open a PR" --max-iterations 10
```

## Strengths

- **Minimal and legible** — a few hundred lines; a reader can hold the entire control flow in their head. The opposite of a framework.
- **PR-per-iteration is the right default** — each loop turn lands a reviewable PR, which matches how real teams gate AI changes (human or CI review at the merge boundary).
- **Zero ceremony** — `npx continuous-claude` with a task string; no config files, no daemon to install, no orchestration layer to learn.
- **Rides Claude Code directly** — inherits Claude Code's tool use, file editing, and command execution for free; no re-implementation of the agent layer.
- **Bounded by construction** — `--max-iterations` is a hard stop, so the loop can't run away (the classic Ralph-loop failure mode).
- **Honest scope** — it does one thing (loop + commit + PR) and doesn't pretend to be a fleet manager or a self-improving system.

## Weaknesses vs Minsky's vision

1. **No constitution / no merge gate** — there is no deterministic CI-enforced rule set (Minsky's 17 rules + `pnpm pre-pr-lint --stage=full`). Quality control is entirely the human reviewer on each PR. Continuous Claude can loop forever producing PRs that no rule rejects.
2. **No daemon / not 24/7** — it is a foreground process you launch for a bounded run. It is not a SIGHUP-immune background daemon that survives terminal close and drains a queue indefinitely (Minsky `daemon start`).
3. **No task queue** — you give it one task string per run. There is no `TASKS.md` queue, no `/next-task` picker, no priority ordering, no claim protocol across parallel workers.
4. **No MAPE-K / no self-improvement** — the loop is fixed; it does not monitor itself, diagnose its own failure classes, or amend its own behaviour. Minsky's autonomic layer (spec-monitor, runtime invariants, self-diagnose) has no analog.
5. **No cross-repo fleet** — one repo, one task, one run. Minsky drives many repos from one operator machine.
6. **No agent-agnosticism** — it is hard-wired to Claude Code. Minsky's adapter layer (rule #2) lets it swap Claude / Devin / Aider / OpenHands behind one seam.
7. **No dynamic safety** — no spawn watchdog computed from iteration history, no budget guard, no supervised restart on crash. The bound is a fixed iteration count, not a learned timeout.
8. **No pre-registered hypothesis discipline** — iterations are not falsifiable experiments with a success/pivot threshold; the loop just runs N times.

## What we learn / steal

- **PR-per-iteration as the unit of progress** — Continuous Claude validates Minsky's choice to make the merge-gated PR the atom of the loop. The lesson is to keep the per-iteration boundary at the PR, not at a raw commit, so every turn is reviewable.
- **The `npx <tool> --task "..."` zero-config entry point** — Continuous Claude's UX is one command and a task string. This is a positioning reminder for Minsky's own `minsky transform` / `minsky solve <task-id>` killer-feature verbs: the common case must be one command with sane defaults (AGENTS.md § "All user interface is P0-P1").
- **Completion-condition gating** — its loop can stop early on a condition, not only on iteration count. Minsky's tick-loop should likewise prefer a verifiable completion signal (gate-green, task-removed-from-queue) over a fixed bound where one exists.
- **The Ralph technique, productized** — confirms (alongside Anthropic's official `ralph-wiggum` plugin, see `competitors/ralph-wiggum-official.md`) that the re-feed loop is the right inner primitive; Minsky already adopts it as its `InnerLoop`.

## Why choose Minsky over Continuous Claude

- 24/7 SIGHUP-immune daemon that drains a queue indefinitely — not a bounded foreground run.
- A deterministic constitution (17 rules) enforced by CI as the *reviewer*, instead of relying on a human to catch every bad PR.
- A `TASKS.md` queue with priority ordering, claim protocol, and `**Touches**:` collision-safety for parallel workers.
- MAPE-K self-monitoring + runtime invariants + self-diagnose — the loop watches and heals itself.
- Cross-repo fleet from one operator machine; agent-agnostic backends (Claude / Devin / Aider / OpenHands) behind an adapter seam.
- Pre-registered hypothesis-driven iterations (rule #9): every change carries a success and pivot threshold, not just an iteration counter.

## Why choose Continuous Claude over Minsky

- You want to read the entire tool in one sitting — it is a few hundred lines, not a system.
- You have exactly one task in one repo and want a bounded run, not a standing daemon.
- You don't want to learn a constitution, a queue format, or a config file — `npx` and a task string is the whole interface.
- You are happy to be the reviewer on every PR and don't need an automated quality gate.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

Continuous Claude publishes **no quantitative benchmark** (no SWE-bench number, no merge-rate, no cost-per-PR figure). Per the competitor-research skill's anti-pattern ("don't fabricate readings"), no corpus entry is added — the M1.10 shape gate (≥4 competitors × ≥5 metrics) is already met by the existing corpus, and a single-metric-less wrapper does not need to widen it. If the maintainer ever publishes a resolve-rate or merge-rate, add a `Competitor` record to `competitors.ts` and a row here.

| Metric | Value | Date | Primary source |
| ------ | ----- | ---- | -------------- |
| *(none published)* | — | — | — |

## Should we wrap Continuous Claude instead?

> Per rule #1 (don't reinvent), every direct-competitor research run ends with: *if this is amazing at everything we do, why not wrap it and run for 24h?* Honest answer here.

| Question | Output |
|---|---|
| 1. **Architectural fit** | Poor as a wrap target, because Continuous Claude *is* the inner loop Minsky already owns, built on a primitive Minsky already adopts (the Ralph technique via `ralph-wiggum`). Wrapping it would mean wrapping a thinner version of our own tick-loop that is hard-wired to one agent (Claude Code) — strictly less capable than the seam we have. It is a peer to `novel/tick-loop`, not a layer beneath it. |
| 2. **What we delegate** | Nothing net-new. The only layer Continuous Claude owns is "loop → commit → PR", which Minsky's tick-loop already owns and does with a queue, a constitution gate, and agent-agnostic backends. Delegating to it would *remove* capability (agent-agnosticism, queue, MAPE-K), not add it. |
| 3. **What we keep** | All 6 moats survive trivially because there is nothing to delegate: daemon-not-framework, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface. Continuous Claude has none of these. |
| 4. **Net moat after wrap** | 6 of 6 (no surface is delegated). The relevant action is *technique confirmation* (PR-per-iteration, completion-gated loop) — both already present in Minsky — not a structural delegation. |
| 5. **Verdict** | **NO.** Continuous Claude is a strictly-smaller subset of Minsky's tick-loop locked to one agent. Wrapping it would subtract capability. No P0 wrap task is filed. The productive read is the *strategic* one (see Five pivot questions §4): it is evidence that the loop is commodity, and Minsky's moat is the discipline layer wrapped around the loop, not the loop itself. |

**Trigger for re-evaluation**: if Continuous Claude grows a queue, a deterministic rule-gate, and agent-agnostic backends — i.e. converges on Minsky's shape — re-run this analysis as an orchestrator-tier competitor. Until then it stays inner-loop tier and the verdict is NO.

## Five pivot questions

### 1. How is it different from Minsky?

Continuous Claude is a **bounded foreground loop** that runs Claude Code N times and opens a PR per turn; Minsky is a **24/7 daemon** that drains a `TASKS.md` queue across repos under a CI-enforced constitution. The intent diverges sharply: Continuous Claude productizes the Ralph technique (re-feed the prompt until done) as the *whole* product, while for Minsky the Ralph loop is just the `InnerLoop` primitive (`competitors/ralph-wiggum-official.md`) wrapped in an outer system of queue, supervision, self-improvement, and a deterministic merge gate. Structurally Continuous Claude is a peer of `novel/tick-loop` — but a thinner one, hard-wired to a single agent, with no queue, no constitution, and no autonomic layer. The defining difference is the *discipline wrapper*: Continuous Claude trusts the human reviewer on each PR; Minsky substitutes a machine reviewer (the 17-rule constitution enforced by `pnpm pre-pr-lint --stage=full`) that never sleeps.

### 2. What lessons can it give to us?

- **PR-per-iteration is the correct loop atom** (Continuous Claude README, the per-iteration `commit → push → PR` flow) — keeping the per-turn boundary at a *reviewable PR* rather than a raw commit is what makes the loop safe for real codebases. Minsky already does this; Continuous Claude's popularity (~1.3k★) is independent confirmation it is the right unit.
- **Zero-config `npx <tool> --task "..."` entry point** (Continuous Claude README, the one-line invocation) — the entire product is one command and a task string. This is a portable UX lesson, not a feature request: it pressures Minsky's `minsky transform` / `minsky solve <task-id>` verbs (AGENTS.md § "Running minsky") to keep the common case to one command with sane defaults (AGENTS.md § "All user interface is P0-P1").
- **Completion-gated, not just count-gated, loops** (Continuous Claude's early-stop condition) — the loop should prefer a *verifiable* completion signal where one exists (gate-green / task-removed) over a fixed iteration count. This generalizes Minsky's tick-loop exit condition.
- **The Ralph technique is commodity** (Geoffrey Huntley's original Ralph post; Anthropic's official `ralph-wiggum` plugin; Continuous Claude as a third independent implementation) — three independent productizations of the same re-feed loop is strong evidence the *loop itself* is not a moat. This is the most strategically important lesson and feeds Q4.

### 3. Are any of these lessons potentially vision-changing?

**Yes — one was examined as a candidate vision-threat, and the resolution sharpens rather than rewrites the vision.** The Hypothesis behind this task was: if a ~200-line wrapper (Continuous Claude) captures ~70%+ of Minsky's tick-loop surface, then the loop is commodity and Minsky's moat must be re-framed as "discipline-as-a-product" (the constitution + MAPE-K + rule-1 reuse bias), not "the loop". On inspection the premise is **true** — Continuous Claude does cover the bare loop-and-PR surface — but it does **not** force a rewrite of `vision.md § What Minsky is`, because that section already states Minsky "is not a framework" and that its value is the *cybernetic system* around the loop, not the loop. The loop being commodity is consistent with, not contradictory to, the existing vision. The correct disposition is therefore **strategic** (Q4: lead positioning with the discipline layer, treat the loop as commodity to be inherited from `ralph-wiggum`) rather than constitutional. A negative finding is recorded here inline per this task's central-routing convention (the brief routes operator strategic questions centrally rather than into this file); recommendation: **absorb the commodity-loop framing into positioning, no vision change**. The single load-bearing claim to re-emphasize publicly: *Minsky's moat is the constitution-as-CI and the autonomic layer wrapped around a commodity loop — not the loop.*

### 4. How can we improve our strategy based on this?

- **Lead positioning with "discipline-as-a-product", treat the loop as commodity** — three independent Ralph-loop productizations (Huntley's original, Anthropic's `ralph-wiggum`, Continuous Claude) prove the loop is not the moat. Strategy move: in README/positioning, foreground the constitution-as-CI merge gate, the MAPE-K self-improvement, and the cross-repo fleet — and explicitly say Minsky *inherits* the loop from `ralph-wiggum` rather than claiming it. Traces to lesson §2.4.
- **Keep the common-case entry point to one command** — Continuous Claude's `npx + task string` is the bar. Strategy move: ensure `minsky transform` / `minsky solve <task-id>` stay zero-config for the 90% case (rule #16 default-by-default; AGENTS.md § "All user interface is P0-P1"), so Minsky is never *harder to start* than the thin wrapper while being far more capable. Traces to lesson §2.2.
- **Make the loop exit condition completion-gated where verifiable** — strategy move: prefer a verifiable completion signal (gate-green, task removed from queue) over a fixed bound in the tick-loop exit logic, matching Continuous Claude's early-stop while keeping Minsky's bound as the fallback. Traces to lesson §2.3.
- **Cite Continuous Claude as the "minimal baseline" in the competitive narrative** — strategy move: use it as the concrete answer to "why not just a 200-line wrapper?" in positioning — it is the honest floor against which Minsky's added discipline is measured. Traces to lesson §2.1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Continuous Claude is a *thinner, single-agent* version of exactly this surface; replacing the tick-loop with it would drop agent-agnosticism, the queue, and the completion gate. Minsky's version is superior.
- **MAPE-K**: KEEP — Continuous Claude has no self-monitoring or self-improvement layer; nothing to replace.
- **adapters / agent backend**: KEEP — Continuous Claude is hard-wired to Claude Code; adopting it would *remove* Minsky's adapter seam (rule #2) and lock us to one vendor.
- **sandbox**: N/A — out of Continuous Claude's scope.
- **queue / TASKS.md surface**: KEEP — Continuous Claude takes one task string per run; it has no queue, priority ordering, or claim protocol.
- **corpus / scorecard**: N/A — Continuous Claude publishes no benchmark and is not in the M1.10 corpus.
- **dashboard / fleet**: KEEP — no cross-repo fleet, no observability surface in Continuous Claude.

**Total replace % across all surfaces: 0%.** The headline for the operator: *nothing to replace — Continuous Claude is a strictly-smaller subset of Minsky's tick-loop locked to one agent. The takeaway is strategic (the loop is commodity; the moat is the discipline wrapper), not architectural.*

## Last reviewed

2026-06-02 — initial entry created per task `competitor-add-continuous-claude` with `## Should we wrap Continuous Claude instead?` (verdict NO — strictly-smaller subset of the tick-loop) + `## Five pivot questions` (Five Pivot Questions framework). Hypothesis (a ~200-line wrapper captures ≥70% of the bare loop surface) confirmed true, but it sharpens rather than rewrites the vision: `vision.md § What Minsky is` already frames the loop as commodity and the moat as the constitution-as-CI + MAPE-K + cross-repo fleet around it. No corpus entry (no published benchmark). Negative vision finding logged inline per this task's central-routing convention.
