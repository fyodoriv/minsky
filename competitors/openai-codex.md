# Competitor: OpenAI Codex (GPT-5.5)

> OpenAI's cloud-based coding agent — same problem as Minsky (do coding work on its own), different execution model (cloud sandbox, not a program on your own machine).

- **URL**: <https://openai.com/index/introducing-codex/> (cloud agent), <https://github.com/openai/codex> (Codex CLI, open-source)
- **Status**: Active. Codex CLI launched 2025-04-16; cloud agent (codex-1) launched 2025-05-16.
- **Pricing**: Cloud agent — included with ChatGPT Pro / Enterprise / Business / Plus. Codex CLI — free (Apache 2.0); you pay OpenAI API costs per token.
- **Relationship**: **Competitor** — a closed-commercial cloud agent plus an open-source command-line tool. Same problem class as Minsky (do coding work without a human driving every step), different execution model: Codex runs in a cloud sandbox; Minsky runs as a program on the operator's own machine.

## What this is

OpenAI Codex is two separate products that share a name.

- **Cloud agent (codex-1)** — launched 2025-05-16 as a "cloud-based software engineering agent that can work on many tasks in parallel". It is powered by `codex-1`, a version of OpenAI o3 that OpenAI fine-tuned with reinforcement learning on real coding tasks. Each task runs in its own isolated cloud sandbox with no internet access. OpenAI tested it at 192k context and medium reasoning effort. On the SWE-Bench Verified benchmark it scored pass@1 = 0.721 (per OpenAI's launch post; 23 instances were excluded as not-runnable on OpenAI's internal infrastructure) and pass@8 = 0.838.
- **Codex CLI** — launched 2025-04-16, open-source (Apache 2.0), a coding assistant you run in your terminal. Source is on GitHub at `openai/codex`. It runs sandboxed with networking turned off by default. It uses OpenAI models (o3, o4-mini, GPT-4.1).

Throughout this doc, "agent" means the coding assistant that does the actual work — Claude Code, Devin, Aider, or OpenHands. Minsky is not an agent; it drives agents. Codex is itself an agent (and OpenAI's own scaffolding around one).

## What this is not

- **Not running as you.** Codex's cloud agent works inside an OpenAI-provisioned sandbox, not on your machine. Minsky runs on your own computer, as you, under your own git and SSH credentials, so the work shows up under your name. This is *operator-machine identity* — the work runs as the human who runs it.
- **Not a background program that keeps running.** Codex spawns one task at a time. Minsky is a *daemon* — a background program that keeps running on your machine after you start it, survives the terminal closing, and restarts on crash.
- **Not the discipline layer.** Codex has no `TASKS.md` (the plain-text to-do list at a project's root that Minsky reads to pick work), no constitutional CI lints (the numbered project rules Minsky enforces automatically), and no self-improvement loop. That layer is what Minsky adds on top of an agent.

## Strengths

- **OpenAI ecosystem** — native access to OpenAI's latest models (o3, o4-mini).
- **Sandboxed by default** — networking off, filesystem restricted. Safer than most.
- **Open source** — the CLI is Apache 2.0 (with some restrictions).
- **Simple CLI** — `codex "fix the bug in auth.ts"` is the whole entry point.
- **Backed by OpenAI** — resources, visibility, ecosystem reach.

## Weaknesses vs Minsky's vision

1. **OpenAI-only.** Codex works only with OpenAI models. No Claude, no models running on your own computer.
2. **Early stage.** It launched recently, so it is less battle-tested than Aider or Claude Code.
3. **No background mode.** Codex runs a task on demand. It is not a daemon — there is no overnight unattended loop.
4. **No supervision.** No budget management, no watchdog, no automatic restart. Minsky has a *supervisor* — an outer watchdog (systemd on Linux, launchd on macOS) that restarts Minsky if it dies.
5. **No task queue.** Codex does not read a `TASKS.md` to pick its own next task.
6. **No multi-agent orchestration.** Codex is a single agent. Minsky routes work across swappable agents.
7. **No self-improvement.** Codex has no loop that studies its own results and adjusts. Minsky calls its self-improvement loop the MAPE-K loop — Monitor, Analyze, Plan, Execute over a Knowledge base — which gets better as it runs on your repository.
8. **Locked out of the strongest coding model.** Because it is OpenAI-only, Codex cannot use Claude, which leads most coding benchmarks.

## What we learn / steal

- **Default sandbox.** Networking-off-by-default is a strong security posture. Minsky's *scope-leak* check — the verdict raised when an agent changes files outside the ones its task declared, enforced by `scripts/check-rule-12-scope-discipline.mjs` — is a weaker guard than a full network sandbox.
- **Simple CLI UX.** `codex "do X"` is about the simplest interface possible. Minsky should keep its own entry points that simple.

## Why choose Minsky over OpenAI Codex

- **Multi-model.** Claude, Devin, or models running on your own computer — not locked to OpenAI, and works offline.
- **Around-the-clock daemon with supervision.** Minsky outlives any one task; Codex spawns one task at a time.
- **Task queue processing.** `TASKS.md` is the operator's surface; codex-1 is per-task only.
- **Operator-machine daemon.** Minsky runs against your existing repos under your own git identity, with no per-task clone; Codex runs in a fresh cloud sandbox.
- **Self-improving.** The MAPE-K loop plus prompt evolution; codex-1 is a fine-tuned static model.

## Why choose OpenAI Codex over Minsky

- You are in the OpenAI ecosystem exclusively and want OpenAI's own best agent scaffolding.
- You want task-parallelism in cloud sandboxes — codex-1 runs many tasks at once against fresh clones, easy to fan out without using your own machine's resources.
- Higher published SWE-bench Verified score: GPT-5.5 reproduced at 0.826, versus Minsky's no-baseline-yet (codex-1 was 0.721 in 2025-05).
- Backed by OpenAI's resources — a frontier-model research pipeline and ChatGPT integration.

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source |
| ----------------------------------- | ----- | ---------- | -------------- |
| `swe-bench-verified-resolve-rate`   | 0.826 | 2026-04-23 | OpenAI, "Introducing GPT-5.5", openai.com/index/introducing-gpt-5-5/, 2026-04-23 (GPT-5.5 is the flagship model powering Codex; SWE-bench Verified 0.826 per the independently-reproduced vals.ai scaffold, corroborated by interestingengineering.com at 0.827, used over OpenAI's headline 0.887; OpenAI emphasised SWE-bench Pro 0.586 for this release) |

The corpus tracks the independently-reproduced SWE-bench **Verified** reading (0.826) rather than OpenAI's headline (0.887). The M1.10 catalogue's `swe-bench-verified-resolve-rate` prefers reproducible numbers over vendor-self-reported ones (rule #4 — visible, not flattering). OpenAI shifted its own emphasis to SWE-bench Pro (0.586) for GPT-5.5, but the corpus keeps tracking Verified for cross-competitor comparability.

### Reading history

| Date       | Model    | Verified | Source |
| ---------- | -------- | -------- | ------ |
| 2026-04-23 | GPT-5.5  | 0.826    | OpenAI, "Introducing GPT-5.5" (current reading) |
| 2025-05-16 | codex-1  | 0.721    | OpenAI, "Introducing Codex" (pass@1; pass@8 = 0.838; 23 instances excluded as not-runnable on internal infrastructure) |

## Should we wrap OpenAI Codex instead?

> Per rule #1 (don't reinvent), every direct-competitor study ends with one honest question: if this competitor is great at everything we do, why not wrap it and let it run for 24 hours?

**Verdict: WRAP THE CLI AS ONE MORE AGENT; DO NOT WRAP THE CLOUD AGENT. Don't file a P0.**

The right wrap target is the Codex **CLI**, not the cloud agent. The CLI is an open-source, local, terminal coding assistant — exactly the shape Minsky drives through an *adapter* (a small wrapper file that lets Minsky talk to one outside tool through a fixed interface, so the tool can be swapped without touching the rest of the code). Adding Codex CLI as a selectable agent would broaden Minsky's OpenAI-model coverage with a small adapter and nothing else.

Wrapping the **cloud agent** (codex-1) is the wrong move, for the same reason it is wrong for any cloud-only product:

1. **It kills operator-machine identity.** codex-1 runs in an OpenAI sandbox under OpenAI's infrastructure. Commits would not originate from the operator. That is the loudest Minsky differentiator per `competitors/README.md` § "What Minsky uniquely does".
2. **It kills daemon-not-framework.** If OpenAI's cloud is the thing that keeps running, Minsky is just a thin wrapper around their API. The "attach Minsky and walk away" framing only holds when the daemon runs on your own machine.
3. **It locks you to OpenAI models.** codex-1 is OpenAI-only by construction, which directly contradicts Minsky's multi-model moat.

So the disposition is split: the CLI is a clean per-agent wrap (correct shape, low cost); the cloud agent is a no-wrap (collapses the moat).

## Five pivot questions

> Applied per the Five Pivot Questions framework (`.claude/skills/competitor-research` § Phase 7, `--deep` mode).

### 1. How is it different from Minsky?

OpenAI Codex is **two OpenAI-only products**: a cloud agent (codex-1) that runs tasks in OpenAI's sandbox, and an open-source terminal CLI. Both are single agents tied to OpenAI models, and neither keeps running on its own. Minsky is an **operator-machine daemon** that drives swappable agents (Codex CLI could be one of them), reads `TASKS.md` to pick work, runs unattended across several repos, and commits under your own git identity. Codex sells you OpenAI's own coding agent; Minsky is the layer that connects many agents into a self-improving system you own and host.

### 2. What lessons can it give to us?

- **2.1 Networking-off-by-default is the security posture to match.** Codex sandboxes execution and disables the network by default. Minsky's scope-leak check (`scripts/check-rule-12-scope-discipline.mjs`) catches out-of-scope file edits but does not contain network access. Lesson: treat the sandbox boundary as a first-class control, not an afterthought. Traces to rule #13 (security and privacy).
- **2.2 A one-line CLI is the right entry-point ergonomics.** `codex "fix the bug in auth.ts"` sets the bar for simplicity. Lesson: keep Minsky's user-facing commands a single line with sensible defaults, no env-var ceremony.
- **2.3 Report reproducible benchmark numbers, not headline ones.** The corpus already tracks the independently-reproduced SWE-bench Verified reading (0.826) over OpenAI's headline (0.887). Lesson: keep doing this — record the number that someone else can reproduce, with its source, per rule #4.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding.** All three lessons sit on top of Minsky's existing architecture and reinforce existing rules. The sandbox lesson (§2.1) strengthens rule #13; the CLI-simplicity lesson (§2.2) is an ergonomics nudge; the reproducible-benchmark lesson (§2.3) strengthens rule #4. None forces a rewrite of `vision.md § What Minsky is`, and none invalidates a rule. This negative finding is recorded here for audit per the framework's "state the negative finding so it is auditable" rule.

### 4. How can we improve our strategy based on this?

- **Tighten the sandbox story.** Evaluate adding a network-deny default to the agent execution environment so Minsky's safety posture matches Codex's, not just its scope-leak verdict. Traces to lesson §2.1.
- **Keep entry points one line.** Hold Minsky's commands to the `codex "do X"` simplicity bar — sensible defaults, no required env vars. Traces to lesson §2.2.
- **Keep reproducible numbers in the scorecard.** Continue preferring the independently-reproduced Verified reading over the vendor headline. Traces to lesson §2.3.

### 5. Can and should we cut corners by replacing part of Minsky with this?

- **agent backend (CLI)**: WRAP — Codex CLI is open-source and local; add it as one more selectable agent through an adapter. Correct shape, low cost.
- **agent backend (cloud)**: DO NOT WRAP — codex-1 runs in OpenAI's sandbox under OpenAI identity; wrapping it collapses operator-machine identity and daemon-not-framework, and locks you to OpenAI models.
- **daemon / fleet / queue**: KEEP — Codex has no around-the-clock loop and no `TASKS.md`; nothing to replace.
- **MAPE-K / self-improvement**: KEEP — Codex has no across-session experiment store; nothing to absorb.
- **constitution-as-CI**: KEEP — Codex relies on OpenAI's internal QA, not an operator-side rule gate.
- **corpus / scorecard**: KEEP + REFRESH — Codex stays a cited corpus entry; keep the reproducible Verified reading.
- **identity / TASKS.md surface**: KEEP — operator-machine identity is the moat the cloud agent specifically lacks.

**Total replace across all surfaces: 0% replacement; 1 candidate WRAP (the open-source CLI, as one more agent backend).** Headline for the operator: *the strategic move is a small CLI adapter to broaden OpenAI-model coverage; the cloud agent stays a competitor, not a backend, because wrapping it would surrender operator-machine identity.*

## Last reviewed

2026-06-02 (refreshed to GPT-5.5 reading via `/competitor-research`; supersedes 2026-05-22 codex-1 reading)
