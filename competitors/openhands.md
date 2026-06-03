# Competitor: OpenHands (All-Hands AI)

> An open-source coding assistant you give a task and it writes the code — the strongest such tool in the open-source world, and the one Minsky most directly competes with on raw coding skill.

- **URL**: <https://github.com/OpenHands/OpenHands>
- **Site**: <https://www.openhands.dev>
- **Status**: Active, MIT core + Polyform Free Trial for `enterprise/`; SWE-bench leader in OSS category (65.8% verified, April 2025). Series A $18.8M (November 2025). **Agent Canvas Initiative shipped June 1, 2026** (Dockerless install + bring-your-own-agent + self-host-on-VM as first-class) per GitHub issue #14374.
- **Pricing**: Free (self-hosted Agent Canvas / local GUI / CLI / SDK), Cloud (free tier with Minimax model, paid tiers), Enterprise (custom, Kubernetes self-hosted Agent Control Plane).
- **Relationship**: **Competitor** — strongest OSS autonomous coding agent; orchestrator overlap sharpened by the June 2026 Agent Canvas launch (BYO-agent + Dockerless + self-host-on-VM now match three Minsky surfaces).

## What this is

OpenHands is an open-source coding assistant. You hand it one coding task, it writes and runs code until the task is done, then returns the result. It was formerly called OpenDevin.

It works one task at a time. Each task is a fresh conversation: you start it, OpenHands does the work, and the conversation ends. There is no background process that keeps picking up new work on its own — when one task finishes, OpenHands stops and waits for the next request. (By contrast, Minsky is a daemon — a background program that keeps running after you start it, surviving terminal close and restarting on crash — that walks a to-do list unattended.)

Under the hood, a web backend (`openhands/app_server/app.py`) starts an isolated workspace for each conversation, runs the agent loop through the OpenHands Software Agent SDK (which lives in its own repo, `github.com/OpenHands/software-agent-sdk`), and returns the result. It then saves the conversation history to `~/.openhands/<conversation_id>/` as JSON. Each new task re-supplies the full context, because nothing carries over between conversations.

It uses the **CodeAct** pattern: the agent writes code, runs it, looks at the output, and tries again. You can plug in any of **15+ language models** (Claude 4.5 Opus, GPT-5.x, Gemini 3.x, DeepSeek-3.2-Thinker, Qwen, Llama) through OpenAI-compatible APIs, so there is no model lock-in.

**Deployment shapes after the Agent Canvas launch (June 1, 2026)**:

- **Agent Canvas** — the new flagship. A single backend that runs without Docker, on a laptop, in Docker, or on a remote VM. It adds a visual UI for local agent development and lets you **bring your own agent** — pick Claude Code, Codex, or the OpenHands SDK per task.
- **Local GUI** — the legacy Docker-sandbox path, still supported.
- **Cloud SaaS** — hosted at `app.all-hands.dev`.
- **Enterprise** — Kubernetes self-hosted, with the Agent Control Plane.
- **CLI + SDK** — still available; self-hosting on a VM is now a first-class use case, not an Enterprise-only escape hatch.

Agent Canvas changed how you install OpenHands and which agent you pick — not the per-task runtime. Each task is still a single-session CodeAct agent that runs once and ends (V1 SDK reference architecture, [arXiv:2511.03690](https://arxiv.org/abs/2511.03690)).

## What this is not

- **Not a daemon.** OpenHands answers one request at a time and remembers nothing between conversations. Minsky is the always-on outer loop that walks a `TASKS.md` queue — the plain-text Markdown to-do list at a project's root — unattended.
- **Not cross-repo at operator scale.** Even after Agent Canvas, a self-hosted instance runs one task at a time. Working across many repositories (a "fleet") is Enterprise-only. ("Operator" means you — the human who runs the tool.)
- **Not operator-machine identity.** Self-host-on-VM hands a GitHub token to the OpenHands backend. It does not run as you, inheriting your own `~/.config/gh` + `~/.gitconfig` + `~/.ssh` the way Minsky does.

## Strengths

- **SWE-bench leader** in OSS — 65.8% verified resolve rate (April 2025) via inference-time scaling + critic model (best@4).
- **Docker sandbox** — per-conversation container isolation, agent can't damage host filesystem or escape to host git config. Configurable non-root user.
- **Pluggable sandbox layer** (`openhands/app_server/sandbox/`) — Docker, Process, Remote (SSH to VM). Customers pick the security/cost tradeoff.
- **Multi-LLM support** — 15+ models tracked in the OpenHands Index, no vendor lock-in.
- **Active community + funding** — 70K+ GitHub stars, 495 contributors, 102 releases, Series A $18.8M led by Madrona (Nov 2025), strategic partnerships with AMD + NVIDIA + Fujitsu.
- **CLI + web UI + SDK** — flexible interface; React frontend with real-time WebSocket updates for live agent observation.
- **OpenHands Enterprise Agent Control Plane** (May 2026) — RBAC, cost tracking, audit logs, scheduled/event-driven Automations, cross-repo workflows.
- **OpenHands Index** (5-task suite, updated quarterly) — issue resolution, greenfield, frontend, testing, info gathering. More comprehensive than SWE-bench alone.
- **Dockerless install** (Agent Canvas, June 1, 2026) — removes the "Docker required for local GUI" weakness; the single agent-server backend runs directly on a laptop, in Docker, or on a remote VM. Corporate laptops without Docker can now run the full local experience, not just the CLI.
- **Bring-your-own-agent** (Agent Canvas, June 1, 2026) — the operator picks Claude Code, Codex, or the OpenHands SDK as the per-task agent. ("Agent" means the coding assistant that does the actual work.) Structurally the same shape as Minsky's per-machine `~/.minsky/config.json` agent selection (`claude` / `devin` / `aider`), now shipped in a mainstream OSS competitor.
- **Self-host-on-VM as first-class** (Agent Canvas, June 1, 2026) — running the agent-server on an operator-controlled VM is now a documented primary use case, not an Enterprise-tier escape hatch. Narrows the "no operator-controlled long-running deployment" gap.

### Recent benchmarks (2025–2026)

| Benchmark                     | Score                         | Date       | Source                                                                                                                                          |
| ----------------------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SWE-bench Verified            | 65.8%                         | 2025-04-15 | All-Hands AI, *SOTA on SWE-bench Verified with Inference-Time Scaling and Critic Model*, all-hands.dev/blog; verified `SWE-bench/experiments` PR #209 |
| SWE-bench Verified (OpenHands LM 32B) | 37.2%                | 2025-03-31 | openhands.dev/blog/introducing-openhands-lm-32b-a-strong-open-coding-agent-model — open-weight 32B model, comparable to Deepseek V3 (38.8%, 671B) |
| OpenHands Index (5-task suite)| Multi-model leaderboard       | 2026-01-29 | index.openhands.dev — issue resolution + greenfield + frontend + testing + info gathering; Claude 4.5 Opus leads overall                          |
| OpenHands Index (3-month update) | Expanded to 15+ models     | 2026-05-11 | openhands.dev/blog/openhands-index-3-months-out — Opus 4.7 top, GPT-5.5 competitive, Gemini 3.1 Pro cost-effective, DeepSeek-3.2-Thinker 1/10 price of Claude |
| SWE-bench Lite (10 models)    | 27% (Claude 3.5 Sonnet)       | 2024-10-04 | openhands.dev/blog/evaluation-of-llms-as-coding-agents-on-swe-bench-at-30x-speed — closed models outperform open; o1-mini underperforms GPT-4o   |

**Model migration**: Moved beyond Claude 3.5 Sonnet (2024). Now benchmarks Claude 4.5 Opus (Nov 2025), GPT-5.x, Gemini 3.x, open models. Framework is LLM-agnostic; bring-your-own-model via OpenAI-compatible APIs.

### Production architecture

- **Local GUI** — FastAPI + React on operator's machine, Docker sandbox per conversation. `~/.openhands/` for state. GitHub token via `~/.openhands/.env` or `GITHUB_TOKEN` env var. SSH keys in `~/.ssh/`.
- **OpenHands Cloud** — SaaS at `app.all-hands.dev`. Multi-tenant. GitHub/GitLab SSO. Free tier with Minimax model.
- **OpenHands Enterprise** — Kubernetes via Helm. Agent Control Plane (orchestration, RBAC, cost tracking, audit logs), Automations backend, integrations (Slack, GitHub, Jira, Linear). Requires PostgreSQL + Redis + Keycloak. Polyform Free Trial license (30-day) for `enterprise/` directory.
- **CLI** — Separate repo, lightweight binary, no Docker required. Runs agent-server directly.

### Adoption signals

- GitHub stars: **70,651** (May 2026); forks ~8,900; contributors **495**; releases **102** (latest 1.7.0, May 2026).
- Funding: **$18.8M Series A** (November 2025, Madrona-led; co-investors Menlo Ventures, Pillar VC, Obvious Ventures, Fujitsu Ventures, Alumni Ventures). Prior $5M seed (Sept 2024).
- Customer logos (per README.md): TikTok, VMware, Roche, Amazon, C3 AI, Netflix, Mastercard, Red Hat, MongoDB, Apple, NVIDIA, Google.
- Press / case studies: US Mobile (Sept 2025), C3 AI ("eight billion tokens in two weeks", Dec 2025), OpenHands Enterprise launch (May 2026), monthly product updates.

### Roadmap (next 6–12 months)

**Agent Canvas Initiative — SHIPPED June 1, 2026** (announced May 11, 2026, GitHub issue #14374). Delivered on launch:

- Agent Canvas as flagship interface — visual local agent development, **bring-your-own-agent (Claude Code, Codex, OpenHands SDK)**, repo at github.com/OpenHands/agent-canvas.
- Dockerless installation — single agent-server backend running on laptop, Docker, or remote VM.
- Self-hosting on VMs as first-class use case.

Still in flight (not part of the June 1 launch):

- Move `enterprise/` directory out of OSS repo (simpler licensing).
- **Open-source the Automations backend** — scheduled/event-driven workflows currently enterprise-only.
- Optional Cloud Connections — local OpenHands can attach to OpenHands Cloud.
- OpenHands Index expansion (quarterly updates).
- Agent Skills marketplace.
- Sub-agent delegation — multi-agent workflows with inline critic/verification.

## Weaknesses vs Minsky's vision

1. **Request-response, not a daemon** — agent is stateless between turns; no 24/7 background process surviving terminal close on the operator's machine. Each invocation re-passes context. **Agent Canvas (June 2026) did NOT change this** — self-host-on-VM is now first-class, but the per-conversation runtime remains a single-session CodeAct loop that terminates when the agent finishes (V1 SDK reference architecture, arXiv:2511.03690). No tick-loop (one wake-up of the loop on its timer), no continuous queue drain.
2. **No constitutional rules** — agent behavior is LLM-driven, not policy-driven. ("Constitution" is Minsky's set of numbered, non-negotiable project rules.) No way to enforce "never commit to main", "must add tests", or any deterministic invariant. Pure LLM advisory. Agent Canvas adds an agent-selection UI, not a deterministic rule-enforcement layer; this gap is untouched by the June 2026 launch.
3. **No MAPE-K self-improvement loop** — the MAPE-K loop is the self-improvement cycle (Monitor, Analyze, Plan, Execute over a Knowledge base). OpenHands Index benchmarks models but doesn't auto-tune agent prompts/policies based on observed performance. Static once shipped; operator manually adjusts.
4. **Cross-repo support is enterprise-only** — Local GUI / Agent Canvas / CLI / SDK work one repo at a time. ("Host" means one code project — one git repository — Minsky works on.) Enterprise Automations support cross-repo workflows but require the Agent Control Plane license. Agent Canvas's self-host-on-VM mode runs one agent-server per conversation, not a fleet walker across N repos.
5. **~~Docker dependency in local GUI~~ — RESOLVED June 1, 2026.** The Agent Canvas Initiative shipped Dockerless installation; the single agent-server backend now runs on a laptop with no Docker requirement. This is no longer a Minsky advantage — both products run Dockerless locally. (Minsky still differs in that it never had a Docker step at all; OpenHands now matches the end state.)
6. **Credential flow still differs from Minsky** — even Dockerless, the operator provisions a GitHub token *into* the agent-server (configured per agent-selection), not the operator's own ambient identity. Agent Canvas's BYO-agent model selects WHICH agent runs, but the credential is still handed to the OpenHands-managed agent-server rather than the agent inheriting the operator's `~/.config/gh` + `~/.gitconfig` + `~/.ssh` directly the way Minsky's operator-machine-identity model does. The Dockerless change removes the sandbox boundary that previously broke `~/.gitconfig` reuse, narrowing — but not closing — this gap. Cloud and Enterprise remain pure SaaS credential vaults.
7. **No TASKS.md / git-native operator surface** — work is queued via Agent Canvas UI, Web UI, CLI, or Slack/GitHub integrations (Enterprise Automations). No version-controlled markdown queue. Agent Canvas is a visual local-agent-development surface, not a git-native task queue.

## What we learn / steal

- **Docker sandbox shape** — cleaner isolation than Minsky's scope-leak detector. (A scope-leak is the verdict when the agent changes files outside the ones the task declared.) Consider as an optional M4 sandbox adapter — a small wrapper file that lets Minsky talk to one outside tool through a fixed interface (off by default; operator opts in for untrusted tasks).
- **OpenHands Index** — 5-task multi-benchmark suite is the right shape for orchestrator-tier evaluation. Minsky's `humaneval-pass-at-1` corpus metric is one number; adding a multi-task suite would be a stronger proof point.
- **CLI + bring-your-own-agent** — the Agent Canvas Initiative's "operator picks Claude Code, Codex, or OpenHands" framing is structurally identical to Minsky's per-machine agent config. Watch how they communicate this trade-off.
- **Pluggable sandbox layer** (`openhands/app_server/sandbox/`) — separating sandbox shape from agent loop is a clean architectural choice we should mirror if/when Minsky grows a sandbox abstraction.

## Why choose Minsky over OpenHands

- **Daemon-not-framework** — 24/7 background process surviving terminal close, fleet-aware, no SaaS dependency in the hot path.
- **Operator-machine identity** — Minsky uses operator's `~/.ssh` + `~/.gitconfig` + `~/.config/gh` directly; no credential provisioning, no token handoff to a system.
- **17-rule constitution + 53 pre-pr-lint stages + 65 CI jobs** — every iteration is deterministically gated. OpenHands relies on LLM advisory + optional critic.
- **MAPE-K substrate** — Minsky's experiment-store + observer + spec monitor capture iteration outcomes and surface them as filed tasks the daemon works on next iteration. The closed-loop A/B prompt tuning (full MAPE-K) is in specification phase per [`user-story-003`](../user-stories/003-mape-k-improves-prompts.md) — substrate ships today, full loop forthcoming. OpenHands has neither.
- **Cross-repo fleet built-in** — single Minsky daemon walks N repos. OpenHands needs the Enterprise tier for cross-repo.
- **TASKS.md as operator surface** — work queued in version-controlled markdown, git-native, no UI lock-in.
- **No Docker required for local** — Minsky runs as the operator. (OpenHands shipped a Dockerless option on June 1, 2026, so this is no longer a differentiator — both run Dockerless locally. Minsky's remaining edge here is that the agent inherits the operator's ambient identity directly, with no token handed to a managed agent-server.)

## Why choose OpenHands over Minsky

- **SWE-bench leaderboard position** — 65.8% verified resolve rate (Minsky has no published SWE-bench score yet; gap filed as `benchmark-minsky-via-claude-on-humaneval` and follow-ups).
- **Docker sandbox is preventive, not detective** — Minsky's scope-leak detector is post-hoc; Docker prevents the leak.
- **Web UI for live observation** — operators can watch the agent think, edit, run. Minsky is CLI/dashboard-only.
- **Multi-LLM support breadth** — OpenHands Index benchmarks 15+ models. Minsky's per-machine config currently supports `claude`, `devin`, `aider`.
- **Larger community** — 70K stars vs Minsky's ~1 deployment.
- **Enterprise Agent Control Plane** — RBAC + audit + Automations for regulated industries. Minsky's enterprise gap is filed as `enterprise-deployment-readiness-audit`.
- **Strong VC backing + customer momentum** — $18.8M Series A + Fortune 500 customers + named partnerships (AMD, NVIDIA, Fujitsu).

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value     | Date       | Primary source                                                                                                                                                                                                                                       |
| ----------------------------------- | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.728     | 2026-04-22 | Wang et al. (All-Hands AI), *The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents*, arXiv:2511.03690v2, 2026-04-22 (Table 4 §5.4 — Claude Sonnet 4.5 + extended thinking on the V1 SDK; 0.728, up from V0's 0.646). Supersedes the 2025-04-15 inference-time-scaling reading of 0.658 (all-hands.dev/blog, verified via `SWE-bench/experiments` PR #209). |
| `cost-per-merged-pr`                | $0.30     | 2024-10-04 | All-Hands AI, *Evaluation of LLMs as Coding Agents on SWE-Bench (at 30x Speed!)*, openhands.dev/blog — Claude 3.5 Sonnet, prompt-caching enabled, SWE-bench Lite subset (`$0.3 per issue`). Used here as the cost-per-merged-pr proxy.                |
| `mean-autonomous-merge-latency`     | 3600 s    | 2024-11-12 | `OpenHands/openhands-index-results/scores.json` — `average_runtime: 3600` for SWE-bench v1.8.3 with Claude Sonnet 4.5. Used here as the mean-autonomous-merge-latency proxy (per-instance wall-clock).                                                |

### OpenHands Index multi-task suite adopted (2026-06-02)

`research-finding-multi-task-benchmark-suite` adopted the **shape** of the
OpenHands Index (5 per-task dimensions, not one SWE-bench headline) into
Minsky's metric catalogue. The five dimensions are now registered metrics,
each pinned to its originating public dataset so a reading is reproducible
and primary-cited without re-running OpenHands' harness (rule #1, don't reinvent):

| Index dimension  | Minsky metric id                    | Dataset (primary citation)                                                  |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| Issue resolution | `swe-bench-verified-resolve-rate`   | Jimenez et al., SWE-bench, ICLR 2024 (already in the catalogue)             |
| Greenfield       | `commit0-library-resolve-rate`      | Zhao et al., Commit0, arXiv 2412.01769, 2024                                |
| Frontend         | `swe-bench-multimodal-resolve-rate` | Yang et al., SWE-bench Multimodal, arXiv 2410.03859, ICLR 2025              |
| Testing          | `swt-bench-test-generation-rate`    | Mündler et al., SWT-Bench, arXiv 2406.12952, NeurIPS 2024                   |
| Info gathering   | `gaia-resolve-rate`                 | Mialon et al., GAIA, arXiv 2311.12983, 2023                                 |

OpenHands owns the Index harness but does not publish a single fixed
absolute per-dimension number cleanly attributable to "OpenHands" as one
corpus entry (the Index is a multi-model leaderboard), so OpenHands' own
cells on the four new axes stay `undefined` (visible-not-silent). The one
vendor-primary Index-shape reading in the corpus today is **SWE-agent's
0.12 on SWE-bench Multimodal** (the frontend dimension; Yang et al. — top
of all systems). See `novel/competitive-benchmark/README.md`
§ "OpenHands Index multi-task suite".

## Should we wrap OpenHands instead?

> Per rule #1 (don't reinvent), every direct competitor research must end with: *if this competitor is amazing at everything we do, why not wrap it and let it run for 24h?* Honest answer here.

**Verdict: PARTIAL YES — operator-approved 2026-05-22.** Agent layer wraps as a pluggable backend; orchestrator layer does NOT wrap. Implementation tracked at [`add-openhands-as-pluggable-backend`](../TASKS.md) (P0, external-dep-blocked on OpenHands' June 1, 2026 Agent Canvas Initiative CLI release). **The canonical Path C reshape plan**: [docs/plans/2026-05-22-path-c-openhands-reshape.md](../docs/plans/2026-05-22-path-c-openhands-reshape.md) — full post-reshape architecture, day-in-the-life, 6 migration phases, package-by-package fate mapping, lint-stack pruning framework, 5 new failure modes + mitigations, honest cost accounting.

This is the most strategically interesting case in Minsky's competitor set, because OpenHands ships things Minsky doesn't (and probably can't catch up to in M1):

- **65.8% SWE-bench Verified** (April 2025) — published, public, verified. Minsky has zero published benchmarks.
- **OpenHands Index 5-task suite** updated quarterly. Minsky has the per-vendor scorecard but no own multi-task harness.
- **Docker sandbox + pluggable sandbox layer** — preventive isolation. Minsky has scope-leak detection (post-hoc).
- **15+ LLM backends** via OpenAI-compatible API. Minsky has `claude` + `devin` + `aider` (3, one blocked).
- **$18.8M Series A, 70K stars, Fortune 500 customers, named partnerships** — community + capital Minsky doesn't have.

The **Agent Canvas Initiative** (announced May 11, launches June 1, 2026; GitHub issue #14374) is the inflection point. It explicitly adds:

- Dockerless local installation (matches Minsky's "no Docker required").
- **Bring-your-own-agent** (Claude Code, Codex, OpenHands SDK) — structurally identical to Minsky's per-machine `~/.minsky/config.json` agent selection.
- Self-hosting on VMs as first-class.

After June 1, OpenHands will look architecturally a lot like Minsky's per-task backend layer. So the wrap question becomes sharp.

**Two wrap shapes to evaluate**:

### Shape A — Wrap the agent layer (PARTIAL YES, file P0)

Add `openhands` as a fourth pluggable backend in `~/.minsky/config.json`, alongside `claude` / `devin` / `aider`. Per-task, Minsky's daemon spawns `openhands solve <task-brief>` and OpenHands runs the agent loop with its 65.8%-verified policy + Docker sandbox + multi-LLM choice. Minsky keeps the daemon + TASKS.md + cross-repo fleet + constitution-as-CI on top.

- **What we keep**: 6/6 moats survive (daemon, operator-machine identity, constitution+CI, MAPE-K substrate, cross-repo fleet, TASKS.md surface).
- **What we gain**: state-of-the-art single-task agent, Docker sandbox, 15+ LLM choice, OpenHands' benchmark surface (we cite their score for our agent-tier comparison).
- **What we lose**: nothing fundamental. We're just adding an option; operators who prefer `claude` keep using it.
- **Cost**: ~1-2 weeks. New entry in agent-support matrix + brief-delivery format + `openhands` argv contract + integration test. Same shape as the existing aider/devin/claude wiring.
- **Risk**: OpenHands' CLI may not have a stable "single-shot run" mode yet; the Agent Canvas Initiative is what unblocks this. Implementation waits on the June 1 launch.

**This is the wrap to do**, and the operator approved it on 2026-05-22. P0 task [`add-openhands-as-pluggable-backend`](../TASKS.md) is now external-dep-blocked on the June 1, 2026 OpenHands Agent Canvas Initiative CLI release. The strategic-decision gate is closed; the next agent to claim this task does so when the Dockerless `openhands` CLI ships with a stable single-shot `solve <task-brief>` interface.

### Shape B — Wrap the orchestrator layer (NO)

Replace Minsky's cross-repo-runner with OpenHands Enterprise's Automations backend (open-source June 2026 per Agent Canvas Initiative point 6). Minsky becomes a thin operator-identity layer on top of OpenHands' scheduled / event-driven workflow engine.

- **What we keep**: operator-machine identity, constitution-as-CI (if we still gate the agent's PRs).
- **What we lose**: TASKS.md surface (OpenHands Automations are configured in UI/SDK, not markdown), MAPE-K substrate (no equivalent in Automations), and probably the daemon-not-framework moat (Automations are event-driven workflows, not 24/7 daemons).
- **Net moat**: ≤3 of 6 survive — below the 3-moat threshold required to claim "distinctive" (per `competitors/README.md` § "What Minsky uniquely does").
- **Architectural mismatch**: Automations are *scheduled/event-driven* (run at 9am Monday; run on new PR); Minsky's TASKS.md is *queue-driven* (continuously drain the priority queue). Different shape; one doesn't replace the other.

**Don't wrap at this layer.** The moat collapse alone makes this a no-go.

### Trigger for re-evaluation

Both shapes get re-evaluated whenever:

1. OpenHands' Agent Canvas Initiative launches (June 1, 2026; tracked by `monitor-openhands-agent-canvas-launch`).
2. Minsky publishes its own SWE-bench Verified or HumanEval Pass@1 score (`benchmark-minsky-via-claude-on-humaneval`) — if Minsky-via-Claude beats OpenHands' 65.8%, the agent-wrap rationale weakens.
3. OpenHands publishes a "Minsky-like" SDK explicitly designed for "run me forever on a task queue" — that'd reduce the orchestrator-tier moat further and the wrap-the-orchestrator question gets sharper.

## Five pivot questions

> The Five Pivot Questions framework closes the loop on the `## Should we wrap OpenHands instead?` analysis above with a structured, surface-by-surface decision. For OpenHands this section is the sharpest in the corpus, because OpenHands is the **only** competitor that is simultaneously a head-to-head rival *and* an in-progress dependency adoption (Shape A approved 2026-05-22; ~50% Minsky-surface coverage per `docs/validated-learnings.md` → `openhands-natively-covers-personas-and-skills`).

### 1. How is it different from Minsky?

OpenHands is a **request-response agent framework** — the FastAPI app instantiates a Docker sandbox per conversation, runs a stateless CodeAct loop via the V1 SDK ([arXiv:2511.03690](https://arxiv.org/abs/2511.03690)), returns results, and persists history to `~/.openhands/<conversation_id>/`. Minsky is an **operator-owned, constitution-governed, self-improving 24/7 daemon** that walks N repos and drives agents (including, after June 1, OpenHands itself) on a `TASKS.md` queue. They overlap heavily at the *agent tier* — and that overlap is exactly why Shape A is a YES — but diverge on four axes Minsky owns and OpenHands does not: (a) **outer loop** — Minsky's tick-loop + cross-repo walker run unattended forever; OpenHands' loop is per-conversation and terminates when the agent finishes; (b) **identity** — Minsky runs as the operator (`~/.ssh` + `~/.gitconfig` + `~/.config/gh` directly, no token handoff); OpenHands provisions a GitHub token *into* the system and isolates it behind the Docker boundary; (c) **governance** — Minsky's output is gated by a constitution-as-CI it owns (17 rules, deterministic lints, rule #10); OpenHands relies on LLM advisory + an optional critic model, with *zero* deterministic-rule-enforcement layer; (d) **across-session self-improvement** — Minsky's MAPE-K substrate (experiment-store + observer + spec-monitor) records every iteration's outcome and files improvement tasks; OpenHands ships per-session observability only. The V1 SDK paper confirms (d): OpenHands' reference architecture is a *single-session* agent runtime, not an across-session autonomic controller — so Minsky's tick-loop + MAPE-K reference architecture survives the paper intact.

### 2. What lessons can it give to us?

- **The V1 SDK in-process `Agent(...)` instantiation** ([arXiv:2511.03690](https://arxiv.org/abs/2511.03690); `openhands.sdk.agent.Agent`) — a clean, single API that every OpenHands surface (CLI, Local GUI, Cloud, Enterprise) is built on. The lesson for Minsky's Shape A wrap: target the SDK seam, not the CLI surface, so the `openhands` backend behind `~/.minsky/config.json` is a thin in-process call rather than a fragile subprocess-and-parse-stdout adapter.
- **Native persona primitives at the AgentSkills spec** — a persona is a role the agent takes on (researcher, planner, implementer, QA). OpenHands ships MicroAgents (keyword-triggered markdown skills, *format-identical* to Claude Code skills that agentbrew already syncs), DelegateTool (parallel sub-agents), TaskToolSet (sequential resumable sub-agents), and AgentDefinition (declarative sub-agent specs). The lesson is rule #1 in its purest form: Minsky has **no scope-need to build personas** — the `novel/adapters/persona-spawner/` package is already a deletion candidate (Path-C phase-3 pilot), folded into `.openhands/microagents/` via a mechanical agentbrew sync.
- **The pluggable sandbox layer** (`openhands/app_server/sandbox/` — Docker / Process / Remote) — separating sandbox *shape* from agent *loop* is the clean abstraction Minsky should mirror if/when it grows a sandbox seam; preventive isolation beats Minsky's post-hoc scope-leak detector for untrusted tasks.
- **The OpenHands Index 5-task suite** (issue resolution + greenfield + frontend + testing + info gathering, quarterly) — a multi-task benchmark is the right shape for orchestrator-tier evaluation; Minsky's single `humaneval-pass-at-1` corpus reading is one number. Cite OpenHands' published 65.8% SWE-bench Verified rather than re-running an equivalent harness (rule #1 — don't reinvent the benchmark).

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — but the task's pivot threshold was tested against the V1 SDK paper and survives, which is the point of asking.** The task Hypothesis was that OpenHands V1's SDK reference architecture (arXiv:2511.03690) might subsume Minsky's MAPE-K + adapter layer and force a "thinner Minsky" pivot. On inspection it does **not**: the V1 SDK is a *single-session* agent-runtime reference architecture; it has no across-session experiment store, no autonomic Monitor→Analyze→Plan→Execute controller, no constitutional-rule enforcement, no operator-machine-identity model, and no file-based task queue. These are precisely the six surfaces `docs/plans/2026-05-22-path-c-openhands-reshape.md` § "What OpenHands does NOT provide" enumerates as the surviving Minsky moat. So the SDK paper *sharpens* the reshape thesis rather than threatening it: it confirms that the agent tier is OpenHands' (delegate it — Shape A) and the orchestrator + discipline + self-improvement tiers are Minsky's (keep them — Shape B reject). The persona/sandbox/benchmark lessons are all technique/scope-pruning level (a package deletion, an optional sandbox seam, a benchmark citation) — none touches the 17 rules. A negative finding is logged inline here per the deep-research convention; this task's brief routes operator questions centrally (the orchestrator maintains `ask-human.md`), so the doc-level verdict below stands in for an `ask-human.md` note. Recommendation: **proceed with Shape A on the SDK seam; no vision change; the pivot threshold is NOT crossed.** The one item that would re-open this: if OpenHands ships a *deterministic-rule-enforcement layer* (today they have zero), Minsky's moat #3 collapses and §3 must be re-run (see Trigger #4 below).

### 4. How can we improve our strategy based on this?

- **Wire Shape A against the SDK seam, not the CLI** — the V1 SDK's in-process `Agent(...)` is the stable contract; an `openhands` backend that calls the SDK directly is more durable than one that shells out to a still-evolving CLI. Strategy move: when `add-openhands-as-pluggable-backend` unblocks (June 1, 2026), prefer the SDK adapter shape. Traces to lesson §2.1.
- **Delete persona-spawner; sync skills to `.openhands/microagents/`** — OpenHands' native MicroAgents + DelegateTool cover Minsky's persona surface at the same AgentSkills spec. Strategy move: execute the Path-C phase-3 pilot (`novel/adapters/persona-spawner/` → MicroAgents) and let agentbrew mechanically sync `.claude/skills/` → `.openhands/microagents/`. Traces to lesson §2.2 + rule #1.
- **Cite OpenHands' benchmark; build the multi-task suite shape, not a re-run** — Minsky has zero published benchmarks; OpenHands has 65.8% verified + a 5-task Index. Strategy move: cite their numbers in the M1.10 corpus scorecard and adopt the *multi-task suite shape* for Minsky's own eventual harness rather than re-implementing SWE-bench. Traces to lesson §2.4 + rule #1.
- **Lead positioning with "the constitution is the reviewer OpenHands doesn't have"** — OpenHands' single biggest gap vs Minsky is the absence of deterministic rule enforcement. Strategy move: position Minsky's constitution-as-CI (moats #3, #10) as the layer that makes 24/7 autonomy *safe*, on top of OpenHands' best-in-class single-task agent. Traces to §1(c).

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface (baseline updated to the V1 SDK + Path-C reshape mapping):

- **agent backend (`novel/adapters/<agent>`)**: REPLACE-AS-OPTION — add `openhands` as a 4th pluggable backend behind `~/.minsky/config.json` (Shape A, P0 [`add-openhands-as-pluggable-backend`](../TASKS.md), external-dep-blocked on June 1, 2026). This is the active wrap; OpenHands' 65.8%-verified CodeAct loop + Docker sandbox + 15+ LLM choice slot behind the existing agent seam.
- **personas (`novel/adapters/persona-spawner/`)**: REPLACE — fold into OpenHands MicroAgents + DelegateTool + TaskToolSet + AgentDefinition (Path-C phase-3 pilot). OpenHands covers this at the AgentSkills spec; the package is a deletion candidate with zero external consumers.
- **sandbox**: AUGMENT (optional, M4) — adopt OpenHands' pluggable Docker sandbox as an opt-in seam for untrusted tasks; preventive isolation complements (does not replace) the scope-leak detector.
- **tick-loop**: KEEP — OpenHands' loop is per-conversation; no across-session daemon to replace. V1 SDK paper confirms it is single-session.
- **MAPE-K (`novel/mape-k-loop/`, `novel/observer/`, `novel/spec-monitor/`, `novel/experiment-record/`)**: KEEP — OpenHands ships per-session observability, not the across-session experiment store + autonomic controller; this is moat #6.
- **operator-machine identity / `cross-repo-runner`**: KEEP — OpenHands provisions tokens into the system behind Docker; Minsky runs as the operator and walks `--hosts-dir`, which OpenHands does not ship outside the Enterprise tier (moats #2, #5).
- **constitution-as-CI / lint stack**: KEEP — OpenHands has *zero* deterministic-rule enforcement (moats #3, #10); this is the layer that makes the OpenHands agent safe to run unattended.
- **corpus / scorecard**: KEEP + CITE — OpenHands stays a primary-catalogue reading (`novel/competitive-benchmark/src/competitors.ts`, `swe-bench-verified-resolve-rate: 0.658`); cite the published Index rather than re-running a harness.
- **`TASKS.md` surface**: KEEP — OpenHands has no operator-owned file-based queue; Automations are UI/SDK-configured, scheduled/event-driven, not queue-driven (moat — Shape B reject).

**Total replace % across all surfaces: agent tier delegated (Shape A) + personas folded (1 package) ≈ the ~50% agent/persona/skill surface coverage; orchestrator + identity + constitution + MAPE-K + TASKS.md (the 6-of-6 moats) are 0% replaced.** The headline for the operator: *delegate the agent tier and personas to OpenHands (Shape A is the right wrap, and the V1 SDK paper sharpens — does not threaten — the case); keep all six orchestrator-tier moats; no vision change; pivot threshold NOT crossed.* This is the surface-coverage decision the task asked for, formalized against the V1 baseline.

## Last reviewed

2026-06-02 — **post-Agent-Canvas-launch audit** per task `monitor-openhands-agent-canvas-launch`. The Agent Canvas Initiative shipped June 1, 2026 (Dockerless install + bring-your-own-agent + self-host-on-VM first-class). Refreshed § "What it is" (Agent Canvas is the new flagship deployment shape; per-conversation runtime unchanged), § "Strengths" (added Dockerless / BYO-agent / self-host-on-VM), § "Weaknesses" (Docker-dependency weakness #5 now RESOLVED; credential-flow weakness #6 narrowed but not closed — the agent-server still takes a provisioned token rather than inheriting the operator's ambient identity). **Moat impact**: BYO-agent now matches Minsky's per-machine agent config and Dockerless matches Minsky's no-Docker-local, so two surfaces converged; but the operator-machine-identity moat (#2) and cross-repo fleet moat (#5) survive intact — Agent Canvas still provisions a token into a managed agent-server (not ambient operator identity) and runs one agent-server per conversation (not a fleet walker across N repos). Net: 6-of-6 moats survive; the headline "daemon-not-framework + operator-identity" framing holds because Canvas's self-host-on-VM mode is still per-conversation request-response, not a 24/7 queue-draining daemon. **Pivot threshold NOT crossed** (Canvas absorbed ≤2 surfaces convergence, not 3+ clean moat absorptions).

2026-06-01 — deepened with `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-openhands`. Verdict: Shape A (agent-tier + persona) delegation to OpenHands confirmed against the V1 SDK paper ([arXiv:2511.03690](https://arxiv.org/abs/2511.03690)); the SDK's single-session reference architecture sharpens rather than subsumes Minsky's across-session MAPE-K + cross-repo daemon + constitution-as-CI — pivot threshold NOT crossed, no "thinner Minsky" vision-threat filed (negative finding logged inline per this task's central-questions routing). Surface-by-surface: REPLACE-AS-OPTION (agent backend), REPLACE (persona-spawner → MicroAgents), AUGMENT (sandbox, M4), KEEP ×6 (tick-loop, MAPE-K, identity, constitution-CI, corpus, TASKS.md).

Earlier reviews: 2026-05-22 (deep-dive refresh — Agent Canvas Initiative, Series A, Enterprise Agent Control Plane, OpenHands Index expansion); 2026-05-22 wrap-feasibility analysis added per rule #1 + operator directive — verdict: agent layer wrap (P0 filed), orchestrator layer reject.
