# Competitor: ComposioHQ Agent Orchestrator (AO)

> A dashboard that runs several coding assistants at once, each in its own branch and pull request — the closest "autonomy + dashboard" rival to Minsky, but framed pull-request-by-pull-request rather than as a daemon (a background program that keeps running) that works around the clock.

- **URL**: <https://github.com/ComposioHQ/agent-orchestrator>
- **Package**: `@aoagents/ao` (install `npm install -g @aoagents/ao`; nightly `@aoagents/ao@nightly`)
- **Status**: Active, MIT licensed (~7.4k★ as of June 2026 — distinct from `ComposioHQ/composio`, the toolkit repo)
- **Relationship**: **Competitor** — closest "autonomy + dashboard" combo, but pull-request-centric framing
- **Pricing**: Free, open source (MIT)

## What this is

AO runs many agents at once and supervises them from one screen. An "agent" here is the coding assistant doing the actual work — Claude Code, Codex, Aider, Cursor, OpenCode, or KimiCode. Each agent works in its own git worktree (a separate checkout of the repo, so agents do not overwrite each other's files), opens its own pull request, and is watched from a single dashboard.

AO pushes further toward autonomy than any other tool in this corpus. Its agents do not stop after one prompt-and-reply. They keep going long enough to fix continuous-integration (CI) failures, answer review comments, and carry a pull request through its lifecycle — all without asking for approval on each edit.

## What this is not

- Not a daemon. AO does not run around the clock. It spawns agents in sessions tied to your review cycle, then stops at the next review.
- Not a viability engine. AO optimizes for "merge this pull request"; it does not aim to keep a project healthy over years.
- Not governed by a constitution. AO has no numbered project rules enforced as CI gates over agent output.
- Not self-improving across sessions. AO detects activity within one session but keeps no record of past iterations to learn from.

## Strengths

- **True autonomy past one prompt** — agents persist long enough to handle CI failures and review comments, not just a single prompt-and-reply.
- **Per-agent worktree isolation** — each agent works in its own git worktree, so they do not step on each other.
- **Single dashboard** — one supervisor view across all agents.
- **Full pull-request lifecycle** — fixes CI, answers review comments, manages branch state.
- **Fits CI/CD-shaped teams** — a natural surface for engineering organizations.

## Weaknesses vs Minsky's vision

1. **Pull-request-centric, not viability-centric.** AO optimizes for "merge this pull request on its own"; Minsky optimizes for "stay alive and useful for years." Different objective functions.
2. **No constitution layer.** No grounding in a vision document; no critique of work against a set of project rules.
3. **No self-improvement of agent prompts.** Agents do not evolve based on outcome metrics over time.
4. **No theoretical grounding** in cybernetic / VSM / supervision-tree literature; ad hoc engineering.
5. **No mobile or Watch surface.** The dashboard is desktop-bound.
6. **No token-economy awareness** for Claude Code Max subscription dynamics.
7. **Team framing.** Built for teams, not shaped for a solo developer.
8. **No TASKS.md substrate.** AO uses an internal task representation, not a plain Markdown to-do list at the project root.

## What we learn / steal

- **Worktree-per-agent isolation** — a strong pattern. OMC's `team` mode does similar with a shared task list. This reinforces that worktree isolation is the canonical primitive.
- **Autonomous pull-request lifecycle handling** — an important capability for the operations layer. Could be added as an OMC mode, or as a Minsky persona (a role the agent takes on) that listens for review comments.
- **Dashboard supervising multiple agents** — UI inspiration for our web dashboard.
- **CI failure → autonomous fix** — a useful pattern; it should live in the persona repertoire.

## Why choose Minsky over ComposioHQ AO

- Different objective: Minsky targets long-arc project viability; AO targets the next merge.
- AO does not compose with the Claude Code Max economy.
- AO has no solo-developer, mobile, or Watch surface.
- Adopting AO would orient the whole project around pull-request throughput. Minsky's whole framing is the long arc, not the next merge.

## Why choose ComposioHQ AO over Minsky

- You want overnight, parallel pull-request automation for a CI/CD-shaped engineering team, reviewed each morning.
- You want a single dashboard supervising many agents across vendors (Claude Code, Codex, Aider, Cursor, OpenCode, KimiCode) behind one interface.
- You want a mature, declarative reaction state machine (`ci-failed` / `changes-requested` / `approved-and-green`) for pull-request handling out of the box.
- You do not need an unattended daemon, a constitution-as-CI governance layer, or across-session self-improvement.

## Should we wrap ComposioHQ AO instead?

Not a dependency. No adapter (a small wrapper file that lets Minsky talk to one outside tool through a fixed interface). Worth periodic re-review for patterns to extract.

## Five pivot questions

> The Five Pivot Questions framework formalizes the `## Weaknesses vs Minsky's vision` and `## Why choose Minsky over ComposioHQ AO` analysis above into a structured, surface-by-surface decision. AO is the corpus's closest "parallel-worker pool + autonomous PR lifecycle + single dashboard" rival — the task Hypothesis pre-registered that it might cover ≥50% of `cross-repo-runner` surface and force a roadmap downgrade. The primary sources resolve that bet: the AO README ([github.com/ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)) and the author's launch retrospective ([pkarnal.com/blog/open-sourcing-agent-orchestrator](https://pkarnal.com/blog/open-sourcing-agent-orchestrator)) both describe a **session-based, human-review-cadenced** orchestrator — *not* a 24/7 daemon — which keeps Minsky's tick-loop moat intact. (Provenance note: the parent task cited `ComposioHQ/composio, 28.4k★`, but that is Composio's *toolkit* repo — the orchestrator is the separate `ComposioHQ/agent-orchestrator` repo, ~7.4k★ as of June 2026; the package is `@aoagents/ao`, not `@aoagents/ao-cli`. Both fields above are corrected to the primary source.)

### 1. How is it different from Minsky?

AO is an **agent-observing-agents orchestrator for a parallel coding-agent fleet, cadenced to human review cycles.** The launch retrospective is explicit on the execution model: *"Not continuous 24/7 operation — periodic spawning tied to human review cycles"* — the author *"set up sessions before bed; agents worked overnight; human reviewed/merged each morning."* It overlaps Minsky heavily at the *fleet-isolation tier* — per-agent git worktree + branch + PR, a single `localhost:3000` dashboard, autonomous CI-fix loops, review-comment routing — and that overlap is exactly why this competitor is the corpus's sharpest `cross-repo-runner` rival. But it diverges on four axes Minsky owns and AO does not: (a) **outer loop** — Minsky's tick-loop + cross-repo walker run unattended *forever* on a `--hosts-dir` fleet; AO's loop terminates at the next human-review cycle (the orchestrator escalates to a human "after 30 minutes" per the README's reaction config); (b) **objective function** — AO optimizes "merge this PR fleet autonomously" (61-of-102 PRs merged in the self-build); Minsky optimizes "stay alive and useful for years," a viability target not a throughput target; (c) **governance** — Minsky's output is gated by a constitution-as-CI it owns (17 rules, deterministic lints, rule #10); AO ships a `reactions` YAML state machine (`ci-failed` / `changes-requested` / `approved-and-green`) but *zero* deterministic-rule-enforcement layer over agent output; (d) **across-session self-improvement** — Minsky's MAPE-K substrate (experiment-store + observer + spec-monitor) records every iteration's outcome and files improvement tasks; AO ships per-session activity detection (it parses Claude Code's JSONL event files directly) but no across-session experiment store or autonomic Monitor→Analyze→Plan→Execute controller. So the head-to-head is real at the fleet tier and absent at the orchestrator-discipline + identity + self-improvement tiers.

### 2. What lessons can it give to us?

- **The seven-slot plugin architecture** (README: *"Seven plugin slots. Lifecycle stays in core."* — Runtime / Agent / Workspace / Tracker / SCM / Notifier / Terminal, 17 plugins total). The lesson for Minsky's rule #2 adapter discipline: AO independently arrived at the same "lifecycle in core, vendors behind a typed slot" shape Minsky's `novel/adapters/<name>.ts` interface enforces — strong convergent-evolution evidence that the adapter seam is the right boundary. Concretely, AO's **Agent slot** (Claude Code / Codex / Aider / Cursor / OpenCode / KimiCode behind one interface) is the same shape as Minsky's `~/.minsky/config.json` `cloud_agent` backend; AO's **Runtime slot** (tmux / process-ConPTY / Docker) is a sandbox-shape abstraction Minsky lacks and could mirror when it grows a sandbox seam.
- **The reaction state machine** (`agent-orchestrator.yaml` reactions on `ci-failed` / `changes-requested` / `approved-and-green`) — a declarative, auditable mapping from PR-state to agent-action. The lesson: Minsky's autonomous-PR-lifecycle persona (today ad hoc) should be specified as a small declarative state machine, not imperative glue. Cite AO's reaction shape rather than re-deriving the state set.
- **JSONL activity-detection over self-report** — AO *"parses Claude Code's JSONL event files directly rather than relying on agent self-reporting"* to know whether an agent is alive/stuck. This is the exact lesson Minsky already learned the hard way (the `daemon-no-progress-rate` invariant + tool-call-discipline smoke that detect prose-without-tool-call). AO's independent arrival at the same technique validates Minsky's progress-detection approach (rule #1 — don't reinvent, but *do* cross-check the convergent design).
- **Cross-agent conflict is the honest unsolved frontier** — the retrospective flags *"cross-agent conflicts (two agents editing the same file) required manual human resolution … remains unsolved, marked as future work."* The lesson: Minsky's `**Touches**:` glob field + the (deleted) collision-check substrate are aimed at *exactly* this problem AO punts on. Minsky's pre-spawn file-set-disjointness discipline is a differentiator to keep investing in, not a candidate to cut — AO confirms it's hard and unsolved by the strongest fleet competitor.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — and the task's pivot threshold was tested against the primary sources and is NOT crossed.** The pre-registered Hypothesis was that AO's parallel-worker pool might cover ≥50% of `cross-repo-runner` surface and force a roadmap downgrade. On inspection it does not: AO is *session-based and human-review-cadenced*, not a 24/7 daemon, so it covers the **fleet-isolation + PR-lifecycle** sub-surface of `cross-repo-runner` (worktree-per-agent, dashboard, CI-fix loop) but **not** the surfaces that define Minsky's moat — the unattended outer loop (`--hosts-dir` walker that never stops for human review), the operator-machine identity model, the constitution-as-CI governance layer, and the across-session MAPE-K self-improvement controller. The retrospective's own "What It Does NOT Do" list (no continuous operation, no cross-agent conflict resolution, no mid-session course-correction, no remote/Slack interface, *"human remains the bottleneck for architecture decisions … and judgment calls"*) enumerates precisely the gaps Minsky's design fills. So the sources *sharpen* the differentiation thesis rather than threatening it: the fleet tier is contested (AO does it well, session-bound), and the daemon + discipline + identity + self-improvement tiers are uncontested Minsky territory. A negative finding is logged inline here per the deep-research convention; this task's brief routes operator questions centrally (the orchestrator maintains `ask-human.md`), so the doc-level verdict below stands in for an `ask-human.md` note. The one trigger that would re-open §3: if AO ships a *daemon mode* (an outer loop that walks repos and re-spawns without a human review cadence) **and** a deterministic-rule-enforcement layer, the surface coverage jumps past 50% and this section must be re-run.

### 4. How can we improve our strategy based on this?

- **Specify the autonomous-PR-lifecycle persona as a declarative reaction state machine** modeled on AO's `ci-failed` / `changes-requested` / `approved-and-green` set, rather than imperative glue. Strategy move: when the PR-lifecycle persona is built, adopt AO's auditable state-mapping shape. Traces to lesson §2.2 + rule #1.
- **Keep investing in `**Touches**:` file-set disjointness — it is a differentiator, not a cut candidate.** The strongest fleet competitor punts cross-agent conflict to a human; Minsky's pre-spawn collision discipline is exactly the surface to deepen for the M2 parallel-daemon work. Traces to §2.4.
- **Lead positioning with "daemon, not a before-bed batch."** AO's single biggest framing gap vs Minsky is that it is human-review-cadenced overnight automation; Minsky is a 24/7 operator-owned organism. Strategy move: position Minsky's tick-loop + cross-repo walker as the layer that removes the human-review-cycle bottleneck AO's author explicitly names as the constraint. Traces to §1(a).
- **Cite AO's convergent adapter + JSONL-activity-detection designs as external validation**, not as features to import. Strategy move: reference AO's seven-slot plugin model and direct-JSONL progress detection in `research.md` / ARCHITECTURE.md as independent confirmation that Minsky's adapter seam and `daemon-no-progress-rate` invariant are on the right track. Traces to §2.1 + §2.3 + rule #1.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface (baseline updated to AO's session-based fleet model):

- **`cross-repo-runner` fleet-isolation sub-surface (worktree-per-agent, branch, PR)**: KEEP — AO does this well but session-bound; Minsky's equivalent runs inside the unattended tick-loop. No replace: AO is not importable as a library (it is a `@aoagents/ao` CLI, not an adapter), and adopting it would orient Minsky around overnight batches tied to human review, which is the framing Minsky exists to escape.
- **`cross-repo-runner` outer loop (`--hosts-dir` walker)**: KEEP — AO has no continuous-operation mode (retrospective: *"Not continuous 24/7 operation"*); there is nothing to replace.
- **autonomous PR lifecycle (CI-fix loop, review-comment routing)**: AUGMENT (technique, not dependency) — adopt AO's *reaction state-machine shape* for Minsky's PR-lifecycle persona; do not depend on AO's CLI. The capability is in scope; the vendor is not.
- **agent backend (`~/.minsky/config.json` `cloud_agent`)**: KEEP — Minsky's seam already covers Claude / Devin / aider / openhands; AO's Agent slot is the same shape, not a richer one. No replace.
- **runtime/sandbox seam**: AUGMENT (optional, M4) — AO's Runtime slot (tmux / process / Docker) is a clean sandbox-shape abstraction Minsky lacks; mirror the *abstraction*, not the implementation, if/when a sandbox seam is needed.
- **dashboard**: KEEP — AO's `localhost:3000` dashboard is desktop-bound; Minsky's mobile / Watch surface is a differentiator AO does not have.
- **MAPE-K (`novel/mape-k-loop/`, observer, spec-monitor, experiment-record)**: KEEP — AO ships per-session activity detection, not an across-session experiment store + autonomic controller; this is Minsky's self-improvement moat.
- **constitution-as-CI / lint stack**: KEEP — AO has a reactions YAML but *zero* deterministic-rule enforcement over agent output; this is the layer that makes 24/7 unattended autonomy safe (moats #3, #10).
- **operator-machine identity**: KEEP — AO runs as a CLI with configured trackers/SCM credentials; Minsky runs as the operator and walks `--hosts-dir`. No replace.
- **`TASKS.md` substrate**: KEEP — AO's task representation is tracker-backed (GitHub / Linear / GitLab issues) + an internal `agent-orchestrator.yaml`; Minsky's operator-owned file-based queue is a different, deliberate primitive.

**Total replace % across all surfaces: 0% replaced; 2 AUGMENT-as-technique surfaces (PR-lifecycle reaction shape, optional runtime/sandbox seam) where we adopt the *design* without the dependency.** The headline for the operator: *AO is the corpus's strongest fleet competitor and a rich source of convergent-design validation, but it is session-based overnight automation, not a daemon — every Minsky moat survives, the pivot threshold is NOT crossed, and the only imports are two design patterns (the reaction state machine and the runtime-slot abstraction), not the AO CLI itself.* This is the surface-coverage decision the task asked for, formalized against the primary sources.

## Pattern conformance

- **Pattern AO implements**: Multi-agent orchestration with isolated workspaces and a central supervisor / dashboard — Wooldridge, *An Introduction to MultiAgent Systems*, 2nd ed., Wiley, 2009, Ch. 6 (cooperative distributed problem solving); Ousterhout et al., "Sprite Network Operating System", *IEEE Computer* 1988 (per-agent isolation as the workspace primitive)
- **Conformance level**: full (in the pattern AO implements)
- **How Minsky relates**: don't adopt — the objective function differs (PR-throughput vs years-long viability). Minsky's worktree-per-agent inspiration is taken from OMC (row 50), not from AO directly.
- **Index row**: vision.md § "Pattern conformance index" row 46

## Last reviewed

2026-06-02 — deepened with `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-composio-ao`. Verdict against the primary sources (AO README; pkarnal.com launch retrospective): AO is **session-based, human-review-cadenced** overnight automation — *not* a 24/7 daemon — so it covers the fleet-isolation + PR-lifecycle sub-surface of `cross-repo-runner` but none of Minsky's daemon / identity / constitution-CI / MAPE-K moats; pivot threshold (≥50% `cross-repo-runner` coverage) NOT crossed, no roadmap downgrade, no vision-threat filed (negative finding logged inline per central-questions routing). Surface-by-surface: KEEP ×8, AUGMENT-as-technique ×2 (reaction state-machine shape, optional runtime/sandbox seam), 0% replaced. Corrected the front-matter: package is `@aoagents/ao` (was `@aoagents/ao-cli`); star count ~7.4k on `agent-orchestrator` (the parent task's 28.4k★ conflated it with the separate `ComposioHQ/composio` toolkit repo).

Earlier review: 2026-05-03.
