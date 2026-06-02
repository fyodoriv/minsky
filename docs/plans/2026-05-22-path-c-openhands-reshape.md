# Plan: Path C reshape — Minsky on OpenHands

- **Task**: `path-c-reshape-plan-doc` (TASKS.md P1, claimed @claude-opus-4-7-max)
- **Repo**: minsky
- **Author**: claude-opus-4-7-max session 2026-05-22
- **Status**: shipped — this doc IS the canonical Path C plan
- **Supersedes**: `docs/minsky-wraps-openhands-vision.md` (PR #734, deleted in this PR), the orphan `docs/visions/2026-05-22-openhands-fulfillment.md` (on the `save/2026-05-22-openhands-personas-imagining` branch, never landed on main)
- **Triggered by**: PR #735 `docs/strategic-review-2026-05-22-continue-or-wrap-more.md` § "Path C — Continue, but RESHAPE" + operator directive 2026-05-22 ("yes let's indeed reshape minsky completely with plan C, where as much as possible depends on open hands and minsky extends with use of all open hands capabilities, features, integrations, extensions")

## Goal

Reshape Minsky from a 70K-LOC integration distribution that maintains its own agent runtime adapters into a ~10K-LOC operator-identity + constitution + self-improvement layer on top of OpenHands. Every OpenHands capability we can lean on, we do. Every Minsky package or lint redundant with what OpenHands provides, we delete. The surviving Minsky surface is exactly what nobody else builds: operator-machine-identity, the 18 constitutional rules with deterministic enforcement, the TASKS.md surface, and the MAPE-K substrate that observes the daemon's own outcomes and files improvements.

## Why

Two intersecting forces dictate this reshape.

**First**, the 2026-05-22 strategic review (PR #735) ran the math on a 1-operator team maintaining 70K LOC against $20M-Series-A and $4B-valuation competitors. The 1-FTE indefinitely-maintainable LOC budget is 5K-10K. Minsky is 7-14× that. Three paths exist (A: sunset; B: continue as-is; C: continue, reshape via aggressive wrap-then-delete). Path B's math doesn't work for a 1-operator team. Path A is correct only if the operator's time is better spent elsewhere — the recent commit history (strategic deep-dives, wrap discipline, future-vision docs) signals continued investment. Path C is the only sustainable continuation.

**Second**, the operator's 2026-05-22 directive — *"let's indeed reshape minsky completely with plan C, where as much as possible depends on open hands and minsky extends with use of all open hands capabilities, features, integrations, extensions"* — commits to Path C with maximum OpenHands leverage. The agent layer (Claude/Devin/Aider adapters), the sandbox (Docker), the multi-LLM routing, the personas (MicroAgents + DelegateTool + TaskToolSet + AgentDefinition), the skill format (AgentSkills-spec), the integrations (GitHub/GitLab/Slack/Jira/Linear) — all of these get delegated to OpenHands. Minsky stops being an integration distribution and becomes an operator-identity-preserving discipline layer.

## The new identity

> Minsky is attachable 24/7. It runs OpenHands in your repo, enforces 18 constitutional rules deterministically, and observes itself to queue improvements.

Five phrases, each tagged with shipping status:

| Phrase | What it means | Today |
|---|---|---|
| **attachable** | Operator drops `.minsky/repo.yaml` + `--hosts-dir <parent>` and walks away; zero `@minsky/*` imports in the host repo | ✅ ships |
| **24/7** | launchd/systemd KeepAlive daemon survives terminal close + host reboots | ✅ ships |
| **runs OpenHands in your repo** | Agent layer is OpenHands' CodeAct loop inside a Docker sandbox per task | 🟡 **June 1+** — today runs `claude` / `devin` / `aider`; `openhands` becomes the 4th pluggable backend after OpenHands' Agent Canvas Initiative CLI release |
| **enforces 18 constitutional rules deterministically** | 18 rules × 53 pre-pr-lint stages × 65 CI jobs run on every PR the daemon opens; LLM-driven checks are advisory only, never load-bearing | ✅ ships |
| **observes itself to queue improvements** | MAPE-K substrate (experiment-store + spec-monitor + observer) records every iteration's outcome; the daemon files TASKS.md entries against its own weak spots | ✅ ships (L1) — 🟡 closed-loop A/B prompt tuning (L2) is spec-only per `user-stories/003`; constitutional self-revision (L3) is M3+ aspirational |

The operator's verbatim reframe — *"attachable 24/7 running openhands in your repo that works with best practices and constantly rewrites itself to be better"* — is the marketing copy. The version above is the honest technical anchor. They say the same thing.

**What the new identity DOES NOT promise**: closed-loop self-tuning that mutates prompts based on outcomes (L2 — spec exists, code does not); self-revising the constitution based on outcomes (L3 — aspirational); fully autonomous improvement without operator review (the operator still approves PRs the daemon opens, by design — rule #2 operator-machine identity).

## The two axes

The post-reshape Minsky surface collapses cleanly into two axes. Every surviving package maps to exactly one. Anything that doesn't map to one of the two is a rule-#1 violation in waiting and a deletion candidate.

### Axis 1 — Self-improvement loop (the "observes itself" half)

The autonomic management layer that turns a single OpenHands session into a fleet that operates unattended and improves across runs.

- **MAPE-K control plane** — Monitor / Analyze / Plan / Execute over a Knowledge base. *(Kephart, J. O. & Chess, D. M., "The Vision of Autonomic Computing", IEEE Computer, vol. 36, no. 1, Jan 2003.)*
- **Experiment store + validated-learnings ledger** — cross-run knowledge accumulation that drives subsequent task selection and brief curation. *(Beer, S., Brain of the Firm, 2nd ed., Wiley 1981 — Viable System Model, System 4 long-term adaptation.)*
- **Multi-host fair scheduler** — 3-iterations-per-host round-robin across N repos under `--hosts-dir`.
- **Watchdog + budget guard + local-model fallback** — keeps the loop alive when cloud quotas exhaust or a child hangs. *(Armstrong, J., "Making reliable distributed systems in the presence of software errors", PhD thesis, KTH 2003 — Erlang/OTP let-it-crash + supervisor restart.)*
- **OS supervisor integration** — launchd / systemd KeepAlive so the daemon survives host reboots.
- **Fleet dashboard (`minsky watch`)** — operator-facing observability over the autonomic loop.

### Axis 2 — Hard rules and principles (the "best practices" half)

The constitution + its deterministic enforcement. Every change passes through these gates; none are advisory.

- **Rule-#9 pre-registered hypothesis-driven discipline** — every change carries Hypothesis / Success / Pivot / Measurement / Anchor before code. Iron rule, no exemption. *(Munafò et al., "A manifesto for reproducible science", Nature Human Behaviour 1, 0021, 2017.)*
- **Constitutional rule lints (rule #10)** — every constitutional rule is a deterministic CI check, not a skill, not an LLM, not "the agent will remember." LLM-driven checks are advisory only; never load-bearing.
- **Literature-citation gate (rule #1 + rule #5)** — every PR cites the libraries it considered or the patterns it implements. Citation-or-fail-the-build.
- **TASKS.md rule-#9-enforcing picker** — rejects P0/P1 tasks missing any of the 5 pre-registration fields before they enter the autonomic loop.
- **Safety gates (defence in depth)** — scope-drift, secret-scan, daemon-pr-lint, the 53-check mechanical pre-PR stack.

Every novel/ package and every script under `scripts/` must map to one of these two axes after the reshape. Items that don't map are deletion candidates.

## OpenHands capability inventory

What we lean on, with maturity status. Items marked ✅ are production-ready in OpenHands today; 🟡 are beta or partially verified; ⚪ are signaled but unverified by Minsky's research as of 2026-05-22.

### Agent layer

- **CodeAct loop** ✅ — Write → Run → Observe → Iterate. Production-ready. 65.8% SWE-bench Verified (Apr 2025). [`docs.openhands.dev/usage/agents`](https://docs.openhands.dev)
- **Inference-time scaling** ✅ — Critic + best-of-N at the agent layer; this is what gives OpenHands its SWE-bench lead over bare Claude Code.
- **Multi-LLM support** ✅ — 15+ backends via OpenAI-compatible API. Claude, GPT-4, Gemini, DeepSeek, local models. Operators route per-task: Opus to hard tasks, Sonnet to medium, DeepSeek-Thinker to mechanical.
- **Docker sandbox** ✅ — Preventive isolation per conversation. Worktree mounted read-write; rest of filesystem isolated. Strong-bound — replaces Minsky's post-hoc scope-leak detection with prevention.
- **Process sandbox** 🟡 — Dockerless fallback for locked-down corporate laptops. Documented in the Agent Canvas Initiative roadmap (announced 2026-05-11, ships June 1, 2026); weaker isolation than Docker but available where Docker isn't.
- **SDK V1 (Python)** ✅ — In-process instantiation: `openhands.sdk.agent.Agent(...)`. Used by all OpenHands surfaces (CLI, Local GUI, Cloud, Enterprise). Paper: [arxiv:2511.03690](https://arxiv.org/abs/2511.03690).
- **REST / WebSocket server** ✅ — Headless remote agent execution. Built into SDK V1. Minsky's `minsky watch` can subscribe to OpenHands' WebSocket for live CodeAct trace per running task.

### Personas / sub-agent layer

OpenHands ships **four** complementary persona primitives. All production-ready or beta-ready. Minsky's claim that personas are an unresolved M2 milestone collapses post-wrap — OpenHands provides every persona primitive Minsky's multi-persona pipeline specs reach for.

- **MicroAgents** ✅ — Markdown files with YAML frontmatter under `.openhands/microagents/`. Three sub-types:
  - **Knowledge agents** (`type: knowledge`) — triggered by keywords in conversation, provide domain-specific playbooks
  - **Task agents** (`type: task`) — triggered by user commands, support parameterized `inputs:`
  - **Repository agents** (`type: repo`) — auto-loaded for a specific repo from `.openhands/microagents/repo.md`
  - **AgentSkills-spec compatible** ✅ — same format as Claude Code's skills ([agentskills.io](https://agentskills.io/specification)). Means agentbrew's skill catalog ports to `.openhands/microagents/` **mechanically** via a new sync target. *Major rule-#1 win — agentbrew is already syncing to `.claude/`, `.cursor/`, `.codeium/`, `.config/devin/`, `.agents/`; adding `.openhands/microagents/` is one more target.*
- **DelegateTool** ✅ — Parallel sub-agent delegation. Main agent spawns N sub-agents with identifiers, dispatches tasks in parallel, blocks until all return, gets a consolidated observation. Has `DelegationVisualizer` for terminal UX. [`docs.openhands.dev/sdk/guides/agent-delegation`](https://docs.openhands.dev)
- **TaskToolSet** 🟡 — Sequential blocking sub-agent delegation, persistence + resumability via `task_id`. Beta — durability semantics (where state lives, multi-session isolation) not yet verified by Minsky. [`docs.openhands.dev/sdk/guides/task-tool-set`](https://docs.openhands.dev)
- **AgentDefinition** ✅ — Declarative sub-agent spec: `name`, `description`, `tools`, `system_prompt`. Register via `register_agent()`, reference by name in delegation. Example: `examples/01_standalone_sdk/42_file_based_subagents.py`.

### Integration layer

- **GitHub / GitLab** ✅ — Native in OpenHands Cloud + Enterprise. PR creation, issue triage, webhook automation. Minsky's daemon still owns PR creation as the operator (operator-machine identity moat), but OpenHands' GitHub integration powers in-conversation context fetching ("what's the failing test in PR #N?").
- **Slack / Jira / Linear** ✅ — Native in OpenHands Cloud. Event-triggered execution (issue created → agent runs). Not used today by Minsky's local-only daemon; available if the operator opts in.
- **Extensions marketplace** 🟡 — [github.com/OpenHands/extensions](https://github.com/OpenHands/extensions). Public skill / tool registry. Curation maturity unknown as of 2026-05-22 — Minsky should audit before treating as a load-bearing dependency.
- **MCP support** ⚪ — Not confirmed by Minsky research. AgentSkills-spec compatibility is confirmed; whether OpenHands hosts MCP servers natively OR consumes them as clients is unverified. Verify against `docs.openhands.dev` before claiming.

### Surfaces

- **OpenHands SDK** ✅ — Python library, V1 stable.
- **OpenHands CLI** ✅ — Terminal interface, Claude-Code-shaped.
- **OpenHands Local GUI** ✅ — Local-machine GUI, Devin-shaped.
- **OpenHands Cloud** ✅ — Hosted, ships Slack/Jira/Linear, RBAC, multi-user, conversation sharing.
- **OpenHands Enterprise** ✅ — Self-hosted Cloud in VPC, Kubernetes-deployed.

### What OpenHands does NOT provide (the surviving Minsky surface)

Six things Minsky's research confirms OpenHands does not ship today. These are the load-bearing surface that survives the reshape:

1. **24/7 daemon shell** — OpenHands' Server mode is a request/response server, not a daemon walking N repos. The Agent Canvas Initiative adds "self-hosting on VMs as first-class" but doesn't add a fleet daemon.
2. **Cross-repo fleet walker** — `--hosts-dir <parent>` round-robins N hosts; OpenHands Automations are per-task, not multi-repo.
3. **Operator-machine identity** — OpenHands' Docker sandbox commits land as `openhands@sandbox`; the push-mirror to the host's branch is what Minsky's daemon then publishes as the operator. The identity preservation layer is Minsky-specific.
4. **Constitutional gates** — 18 rules × deterministic CI lints. OpenHands has zero rule-level policy enforcement.
5. **TASKS.md as operator surface** — operator-editable markdown, version-controlled, parsed by `pickHostTask`. OpenHands has no equivalent file-based task queue.
6. **MAPE-K substrate** — experiment-store + spec-monitor + observer + cross-run knowledge ledger. OpenHands ships per-session observability; Minsky's MAPE-K is across-session.

## What this plan replaces

Three predecessor docs converge into this plan:

1. **`docs/minsky-wraps-openhands-vision.md`** (PR #734) — speculative future-vision doc, day-in-the-life narrative, architecture changes, 5 failure modes, 6-step implementation sequence. **Deleted in this PR**; content folded into § "Day in the life, post-wrap" and § "Architecture changes" and § "New failure modes" below.
2. **`docs/visions/2026-05-22-openhands-fulfillment.md`** (orphan on `save/2026-05-22-openhands-personas-imagining` branch, never reached main) — the two-axis decomposition + the OpenHands personas Q1-Q3 research findings. **Content folded into § "The two axes" and § "OpenHands capability inventory — personas" above**.
3. **`docs/strategic-review-2026-05-22-continue-or-wrap-more.md`** (PR #735) — the strategic review that recommended Path C. **Stays on main as the WHY-anchor**; this plan doc is the HOW.

After this PR merges, the canonical reading order for understanding Path C is: (a) PR #735's strategic review (the WHY), (b) this plan doc (the HOW), (c) the new vision.md identity sentence + staged status row (the WHAT).

## Day in the life, post-wrap

Condensed from the deleted `minsky-wraps-openhands-vision.md`.

You install Minsky on a fresh laptop. `~/.minsky/config.json` defaults to `cloud_agent: "openhands"` because OpenHands ships the highest-published single-task agent capability (65.8% SWE-bench Verified) and Minsky's whole job is to compose the best available agent into a 24/7 daemon shell.

You drop a `TASKS.md` into a repo. Minsky's daemon picks the top-priority task. Instead of spawning `claude` against the host's working tree, it spawns `openhands solve --task-file <brief.md> --model claude-opus-4-7`. OpenHands runs its CodeAct loop inside a Docker sandbox per task. The sandbox mounts your repo's worktree read-write but isolates the rest of your filesystem — preventive isolation, not detective scope-leak. Tests run inside the sandbox. The agent writes code, commits to a feature branch inside the sandbox, emits a sandboxed diff. Minsky's daemon picks up the sandbox's output, verifies the diff stays within the task's declared scope, opens the draft PR using your git credentials on the host machine.

You wake up. The fleet has processed 8 tasks across 3 repos overnight. Six PRs landed cleanly; one was reverted by the scope-leak detector; one is awaiting a CI retry. The 53 pre-pr-lint stages + 65 CI jobs ran on every PR — your daemon's PRs face the same gates a human-authored PR faces. The MAPE-K substrate noted that OpenHands-via-Opus-4.7 had a 12% rollback rate on test-related tasks but 2% on docs-related tasks; the experiment-store records this and the next iteration's task-router prefers OpenHands-via-Sonnet for docs-only changes (L2 closed-loop auto-tuning — still in specification per user-story-003, but the substrate is there).

The `minsky watch` dashboard surfaces OpenHands' WebSocket stream from each running sandbox — you can see live, in your terminal, what each agent is doing in each repo. Click into a host, and you see the agent's CodeAct trace: `bash: git diff main`, `python: pytest tests/test_foo.py`, `edit: src/foo.ts line 42`.

## Architecture changes

Condensed from the deleted `minsky-wraps-openhands-vision.md`.

### The agent spawn shape

Today (pre-wrap, claude/devin/aider as the 3 cloud agents):

```text
~/.minsky/config.json: cloud_agent = "claude"
        ↓
novel/cross-repo-runner/src/spawn.ts:
        spawn("claude", ["--model", "claude-opus-4-7-max"], { stdin: brief })
        ↓
Claude Code edits the host's working tree directly.
The scope-leak detector runs AFTER claude exits, against the host's git diff.
```

Post-wrap (openhands as the 4th cloud agent, recommended default):

```text
~/.minsky/config.json: cloud_agent = "openhands"
                       openhands.sandbox = "docker"  (or "process" on locked-down hosts)
                       openhands.model   = "claude-opus-4-7"
        ↓
novel/cross-repo-runner/src/spawn.ts:
        spawn("openhands", [
          "solve",
          "--task-file", "/tmp/minsky-brief-<task-id>.md",
          "--workspace", "<host-worktree>",
          "--sandbox", "docker",
          "--model", "claude-opus-4-7"
        ])
        ↓
OpenHands instantiates a Docker sandbox per conversation (one task = one container).
The host's worktree is mounted read-write at /workspace inside the sandbox.
OpenHands runs the CodeAct loop, edits files, runs tests, commits to a feature branch IN THE SANDBOX.
        ↓
On exit, OpenHands serialises agent-state to ~/.openhands/<conversation_id>/state.json
and the sandbox-side feature branch is push-mirrored to the host via git remote tracking.
        ↓
Minsky's scope-leak detector runs AFTER openhands exits, against the host's git diff
(same shape as today — the difference is the diff comes from the sandbox-pushed feature branch).
        ↓
Minsky opens the draft PR using the operator's ~/.config/gh credentials (unchanged).
```

### `~/.minsky/config.json` schema (post-wrap)

```jsonc
{
  "cloud_agent": "openhands",
  "openhands": {
    "model": "claude-opus-4-7",       // passed through to OpenHands' --model
    "sandbox": "docker",              // "docker" | "process" | "remote"
    "remote_host": null,              // populated when sandbox = "remote"
    "cli_path": "/usr/local/bin/openhands"
  },
  // existing fields unchanged:
  "local_agent": "aider",
  "local_agent_model": "ollama_chat/qwen3-coder:30b"
}
```

`openhands.model` is what gives operators multi-LLM choice within OpenHands' supported backends. Minsky's daemon doesn't pick the LLM directly for OpenHands tasks anymore — it picks the agent (`openhands`) and lets OpenHands handle per-step LLM routing.

### What the daemon owns vs delegates

| Layer | Owner | Why |
|---|---|---|
| Daemon lifecycle (bash entry, launchd/systemd, watchdog) | Minsky | OpenHands ships no 24/7 fleet daemon |
| Operator-machine identity (PR commits land as operator) | Minsky | OpenHands sandbox commits author as `openhands@sandbox`; push-mirror + commit-author rewrite is Minsky's job |
| TASKS.md reading + task picking | Minsky | OpenHands has no file-based task queue |
| Constitutional gates (53 pre-pr-lint + 65 CI) | Minsky | OpenHands has zero policy enforcement at the rule level |
| Cross-repo fleet (`--hosts-dir` round-robin) | Minsky | OpenHands Automations are per-task, not multi-repo |
| MAPE-K substrate (experiment-store + observer + spec-monitor) | Minsky | OpenHands ships per-session observability, not across-session |
| Per-task agent loop (CodeAct, write → run → observe) | OpenHands | The 65.8% SWE-bench layer; Minsky has no equivalent |
| Per-task sandbox (Docker / Process / Remote) | OpenHands | Stronger isolation than Minsky's post-hoc scope detection |
| Per-task LLM routing (Opus vs Sonnet vs DeepSeek) | OpenHands | Multi-LLM matrix lives in OpenHands' supported backend list |
| Personas / sub-agents (knowledge / task / repo MicroAgents) | OpenHands | 4 native persona primitives; agentbrew syncs skills to `.openhands/microagents/` |
| Skill format (markdown + YAML frontmatter) | OpenHands (via AgentSkills spec) | Already shared with Claude Code; minsky's skill catalog ports mechanically |

## Package-by-package fate

Every novel/ package, its post-reshape fate, and the trigger to fire each transition.

| Package | LOC (approx) | Fate | Trigger |
|---|---:|---|---|
| `novel/adapters/notifier/` | ~400 | **Keep** | ntfy + Slack integration; not OpenHands' surface |
| `novel/adapters/observability/` | ~600 | **Keep** | OTEL adapter; verify parity with OH's tracing post-adoption |
| `novel/adapters/persona-spawner/` | ~800 | **Delete (fold into OH MicroAgents)** | OH ships MicroAgents + DelegateTool + TaskToolSet + AgentDefinition; agentbrew syncs `.claude/skills/` → `.openhands/microagents/` mechanically |
| `novel/adapters/prompt-optimizer/` | ~500 | **Keep** | Spec for L2 auto-tuning lives here; substrate stays |
| `novel/adapters/token-monitor/` | ~300 | **Delete (use Claude-Code-Usage-Monitor)** | Already cited as "use existing tool" in vision.md § "What Minsky is not" — finally do it |
| `novel/adapters/types/` | ~200 | **Keep** | Shared type definitions |
| `novel/bridges/omc-tasksmd/` | ~600 | **Re-scope** | OMC demoted from primary persona orchestrator per the fulfillment-vision Q3 finding; bridge stays as optional model-routing layer, may be deprecated entirely after the 6-month re-evaluation |
| `novel/budget-guard/` | ~800 | **Keep** | Quota / spend limits across the fleet — not OpenHands' surface |
| `novel/competitive-benchmark/` | ~3K | **Fold into experiment-record** | OpenHands Index becomes the corpus harness post-wrap; the per-task benchmark substrate can absorb `bin/minsky competitive` |
| `novel/cross-repo-runner/` | ~8K | **Keep** | The fleet walker is the moat #5 anchor; OH doesn't ship `--hosts-dir` |
| `novel/dashboard-web/` | ~6K | **Delete (use `minsky watch` CLI + OH WebSocket)** | `minsky watch` subscribes to OpenHands' WebSocket per running task; CLI replaces the web dashboard for the operator's local fleet view |
| `novel/experiment-record/` | ~2K | **Keep + absorb** | Absorbs competitive-benchmark (above); MAPE-K substrate anchor |
| `novel/handoff-spec/` | ~1.5K | **Re-scope** | Brief-engineering substrate; survives but interface changes to OH's `--task-file` format |
| `novel/mape-k-loop/` | ~4K | **Keep** | Axis 1 anchor — observation IS the moat; closed-loop spec stays |
| `novel/observer/` | ~3K | **Keep + merge with spec-monitor** | Both observe runtime invariants; merger preserves rule #2 (every dep through an interface) if interface boundary is respected |
| `novel/sidecar-bootstrap/` | ~1K | **Keep** | Operator-machine-identity-critical (`.minsky/repo.yaml` materialisation) |
| `novel/spec-monitor/` | ~2K | **Merge with observer (above)** | See observer |
| `novel/tick-loop/` | ~3K | **Keep** | MAPE-K substrate anchor; per-machine iteration controller |
| `novel/tui/` | ~2K | **Re-scope** | Operator-facing TUI; survives as the `minsky watch` interface |

Net: 14 top-level packages + 6 adapter sub-packages today → ~10 packages post-reshape. Deletions: `persona-spawner`, `token-monitor`, `dashboard-web`. Mergers: `competitive-benchmark → experiment-record`, `spec-monitor → observer`. Re-scoped: `omc-tasksmd`, `handoff-spec`, `tui`.

LOC delta: ~62K → ~40K from package consolidation alone. The bigger reduction comes from the lint stack pruning (below).

## Lint stack pruning framework

The pre-pr-lint stack today is 54 stages (`scripts/run-pre-pr-lint-stack.mjs`). Many exist because Minsky couldn't trust spawned agents (Claude/Devin/Aider) to do the right thing. Post-OpenHands-wrap, the agent layer has higher single-task quality (65.8% SWE-bench Verified, critic + best-of-N inference-time scaling) and inherits OpenHands' own quality gates. Many Minsky lint stages become belt-and-braces redundant.

The deletion target is 54 → ~20 stages. Procedure:

1. For each of the 54 stages, write a 1-sentence "why does this exist?" justification.
2. Classify each stage by the invariant it guards: (a) **constitutional rule coverage** (each of the 18 rules must have ≥1 surviving lint — non-negotiable); (b) **post-spawn safety** (scope-leak, secret-scan, sandbox boundaries — keep most); (c) **brief-format / PR-format** (some may become redundant if OpenHands' PR generator produces the expected shape by default); (d) **belt-and-braces against weak agent output** (the deletion candidates).
3. For each stage in class (d), check whether OpenHands' output already satisfies the invariant the lint guards. If yes, delete script + remove from stack + remove CI job (in lockstep). If no, document WHY it survives.
4. Re-run pre-pr-lint --stage=full on 3 fixture PRs to confirm the slim stack catches the same violation set.

Target: 54 → ~20 stages, with a documented justification table for the surviving 20. Constitutional rule coverage (each of 18 rules → ≥1 lint) preserved. Operator-facing pre-PR latency drops proportionally.

Tracked in TASKS.md as `lint-stack-audit-post-openhands-wrap` (P1, blocked on the wrap shipping).

## Migration phases

Sequenced phases with success/pivot thresholds per phase. Each phase has rule-#9 fields filed as a TASKS.md entry when work begins.

### Phase 0 — Substrate already shipped (✅ complete)

- Strategic decision documented (PR #735)
- Operator approval for the wrap (PR #733)
- Future-vision doc shipped (PR #734) — *now consolidated into this plan*
- Phase 7 wrap-feasibility discipline encoded in `competitor-research` skill (PR #732)
- This plan doc + vision.md identity update (THIS PR)

### Phase 1 — OpenHands wrap ships

**Goal**: `add-openhands-as-pluggable-backend` (P0, currently external-dep-blocked on June 1, 2026 OpenHands Agent Canvas Initiative CLI release).

**Trigger**: OpenHands' Agent Canvas Initiative ships its Dockerless CLI (June 1, 2026 per GitHub issue #14374).

**Work**: 6 steps from the deleted wraps-openhands-vision doc, each ~1-3 days:

1. Audit the June 1 CLI shape — confirm `solve <task-brief>` interface + `--sandbox` / `--model` flags. Write the brief-delivery format spec.
2. Add `openhands` to the agent matrix — `novel/cross-repo-runner/src/agent-config.ts` + `AGENTS.md` § "Agent support matrix" + `bin/minsky` argv-builder + `~/.minsky/config.json` schema (new `openhands` subkey).
3. Implement the spawn path — daemon writes brief to `/tmp/minsky-brief-<task-id>.md`, spawns OpenHands with `--task-file`, waits, runs scope-leak detection on the now-pushed feature branch, opens the PR.
4. Wire `minsky doctor` — version-range check for `openhands` CLI, Docker availability check when `sandbox=docker`.
5. Wire `minsky watch` — subscribe to OpenHands' WebSocket per running task, surface CodeAct trace per host.
6. Run the prototype experiment — 2-week run on a fixture host: measure Claude-via-OpenHands SWE-bench delta vs Claude-via-bare-Minsky.

**Success**: integration test green; `cloud_agent: "openhands"` works end-to-end on a fixture host; `minsky watch` shows live CodeAct trace; Claude-via-OpenHands SWE-bench delta over bare Minsky ≥10pp on the M1.10 corpus.

**Pivot**: if the SWE-bench delta is <5pp at end of 2-week prototype, OR the June 1 CLI shape mismatches Minsky's brief-delivery contract beyond 4 weeks of adapter work, revert to "openhands not a worthwhile backend" and update `competitors/openhands.md` § "Should we wrap OpenHands instead?".

### Phase 2 — Skill catalog ports

**Goal**: agentbrew syncs the Minsky skill catalog to `.openhands/microagents/` alongside the existing `.claude/`, `.cursor/`, `.codeium/`, `.config/devin/`, `.agents/` targets.

**Trigger**: Phase 1 ships. Operator runs `agentbrew sync` against an OpenHands-enabled repo.

**Work**: ~2-3 days.

1. Add `openhands` as a sync target in agentbrew's `src/agents/`.
2. Verify AgentSkills-spec compatibility — port one skill (e.g., `karpathy-disciplines`) by hand, run it inside OpenHands, confirm equivalent behaviour.
3. Add the new target to the agentbrew Agentfile schema; document in agentbrew's README.
4. Run `agentbrew sync` against Minsky's own Agentfile; confirm `.openhands/microagents/` populates correctly.

**Success**: ≥3 Minsky skills run correctly when invoked via OpenHands MicroAgents triggers; agentbrew sync output shows `.openhands/microagents/` populated.

**Pivot**: if skill translation requires non-trivial format mutation (>5% of skills need re-authoring), the AgentSkills compatibility claim is wrong — document the actual delta in `competitors/openhands.md` and treat as porting work rather than mechanical sync.

### Phase 3 — Pilot one package replacement — ✅ SHIPPED 2026-05-24

**Goal**: replace one Minsky package with an OpenHands equivalent end-to-end. Smallest meaningful replacement: `novel/adapters/persona-spawner/` → OpenHands MicroAgents.

**Outcome**: persona-spawner package deleted in one PR (this PR). Audit found ZERO external consumers — the package was already isolated. Net deletion: 8 files, ~1000 LOC, no migration work needed. Plus updates to: `scripts/check-threat-model-section.mjs` (remove persona-spawner from the threat-model-required list), `user-stories/013-daemon-not-framework-moat.md` (the "extend Minsky with personas" failure-mode row now points at `.openhands/microagents/`), `docs/ARCHITECTURE.md` (multi-role/persona pipeline row now shows ✅ delegated-to-OpenHands), `tsconfig.json` (workspace reference removed).

**Lesson**: when the Path C plan called persona-spawner "the smallest meaningful replacement" it was actually correct — but for a different reason than expected. The reason was structural isolation (no consumers), not the predicted ~1-week migration cost. Future pluggable-interface deletions should run a consumer-count audit FIRST and prioritize zero-consumer packages for the deletion phase before the more-coupled ones.

**Original predicted work** (preserved for the validated-learning record):

1. Audit current `persona-spawner` consumers — which novel/ packages depend on it.
2. Re-author each persona consumer to invoke an OpenHands MicroAgent via the appropriate trigger (keyword for knowledge agents, command for task agents).
3. Delete `novel/adapters/persona-spawner/` + the dependency rows from `ARCHITECTURE.md`.
4. Update `pnpm-workspace.yaml`.

**Success criterion (met)**: `novel/adapters/persona-spawner/` directory is gone; all tests pass; `rule-2-dep-coverage` lint exits 0.

### Phase 4 — Deletion sweep 1 (novel/ packages)

**Goal**: 14 → 10 top-level packages per the package-by-package fate table above.

**Trigger**: Phase 3 ships. Tracked as TASKS.md `novel-packages-audit-post-wrap` (P1, blocked on the wrap shipping).

**Deletion order**: prioritise by consumer count — see [`path-c-deletion-priorities.md`](./path-c-deletion-priorities.md), generated by `scripts/path-c-consumer-count.mjs`. Per the Phase 3 lesson (persona-spawner deleted in 30 min, not 1 week, because its consumer count was zero), zero-consumer packages lead the sweep as mechanical quick wins; coupled packages come later. As of the 2026-06-02 audit, all three surviving Delete/Fold candidates (`token-monitor`, `competitive-benchmark`, `dashboard-web`) have zero external consumers.

**Work**: ~2 weeks. See task block for details.

**Success**: `ls novel/ | wc -l` returns ≤10; ARCHITECTURE.md § "Dependency table" reflects the new structure; all integration tests pass.

**Pivot**: if the audit reveals all 14 packages have load-bearing distinct responsibilities (no clean mergers), the 14-package structure is correct — but then revisit whether each package's per-stage lints can be deleted instead (overlap with Phase 5).

### Phase 5 — Deletion sweep 2 (lint stack)

**Goal**: 54 → ~20 pre-pr-lint stages per the lint stack pruning framework above.

**Trigger**: Phase 4 ships. Tracked as TASKS.md `lint-stack-audit-post-openhands-wrap` (P1, blocked on the wrap shipping).

**Work**: ~2 weeks. See task block for details.

**Success**: `pnpm pre-pr-lint --stage=full` shows ≤20 stages green; `wc -l scripts/check-*.mjs | tail -1` shows ≥25K LOC reduction vs baseline; constitutional rule coverage (each of 18 rules → ≥1 lint) preserved.

**Pivot**: if only ~5 stages are redundant, the deletion strategy is wrong — most lints catch real Minsky-specific violations OpenHands doesn't address. Revisit whether constitution-as-CI is doing more work than this plan credits it for.

### Phase 6 — Identity promotion

**Goal**: vision.md § "What Minsky is" reflects the post-reshape reality (no more 🟡 status flags). Declare Path C complete.

**Trigger**: Phases 1-5 ship. All 🟡 status flags in the new identity table become ✅.

**Work**: ~1 day.

1. Update vision.md § "What Minsky is" — remove the staged status row; replace with the unflagged identity sentence.
2. Update README.md § "How Minsky compares" — refresh the table with post-reshape numbers (LOC, package count, lint stage count, deployed instance count).
3. Update `competitors/openhands.md` — relationship transitions from "Dependency (in-progress)" to "Dependency (adopted)".
4. File the next strategic review (`strategic-review-2027-Q1`) to re-evaluate Path C 6 months post-completion.

**Success**: vision.md identity sentence has zero 🟡 flags; README.md table shows LOC reduction; OpenHands relationship marked "adopted".

**Pivot**: if any 🟡 flag can't be promoted to ✅ within 6 months of the OpenHands wrap shipping, that phase is stuck — file a P1 task to investigate the block and consider whether Path C as written needs revision.

## What we lose

Honest accounting of the trade-offs. Path C is a net win per the math, but it costs three things.

1. **Vendor dependency at the agent layer.** Today's operator can swap Claude → Devin → Aider via per-machine config. Post-wrap, if `cloud_agent: "openhands"`, the operator depends on OpenHands' release cadence + CLI stability. If OpenHands gets acquired or pivots, the operator's daemon breaks.

   *Mitigation*: Minsky retains the 4-backend matrix (`claude` / `devin` / `aider` / `openhands`); operators can fall back to a non-OpenHands backend within 1 config edit. The wrap doesn't require deletion of the existing 3 backends.

2. **Larger install footprint.** Today's Minsky install is `pnpm install` + ~600 MB of node_modules. Post-wrap, operators using `openhands` also install OpenHands' CLI + Docker (or accept the Process sandbox) — another ~200-500 MB.

   *Mitigation*: `pnpm minsky doctor` warns of missing dependencies. Operators who want the smallest footprint stick with `claude` or `aider`. Both modes remain first-class.

3. **Performance variance.** OpenHands' per-task wall-clock latency (3600s average per their published `scores.json`) is higher than bare Claude Code's interactive single-shot mode. Operators trading latency for SWE-bench quality opt in via `cloud_agent: "openhands"`; operators trading quality for speed stick with `claude`.

   *Mitigation*: README's "How Minsky compares" table makes the choice explicit. Both modes are first-class — no migration pressure.

## New failure modes

Five failure modes the wrap introduces. Each has a mitigation.

### 1. OpenHands CLI version skew

If Minsky's daemon expects `openhands@1.7.x` and the operator has `openhands@2.0.0-beta` installed, the `--task-file` argument may have changed shape.

**Mitigation**: `scripts/check-openhands-cli-version.mjs` reads the pinned range from `package.json` and fails fast if the installed CLI is out of range. Same shape as the existing `lockfile-integrity` lint.

### 2. Docker daemon required on operator's machine

OpenHands' default sandbox is Docker. Operators on locked-down corporate laptops without Docker can't run the daemon. The Agent Canvas Initiative ships a Process sandbox for Dockerless operation, but it's a weaker isolation boundary.

**Mitigation**: `~/.minsky/config.json: openhands.sandbox = "process"` is the documented fallback. `minsky doctor` warns when `sandbox=docker` is configured but Docker is unavailable; the daemon refuses to start.

### 3. LLM-choice config drift between Minsky and OpenHands

Today, Minsky picks the LLM (`cloud_agent_model: "claude-opus-4-7-max"`) and passes it to Claude/Devin/Aider. Post-wrap, OpenHands picks the LLM per-step from its supported backends. If the operator sets `claude-opus-4-7-max` (a Devin-only label) but switches `cloud_agent` to `openhands`, the flag fails because OpenHands' Claude name is `claude-opus-4-7` (no `-max` suffix).

**Mitigation**: the daemon's argv-builder reads `openhands.model` from a separate config key — if not set, the daemon refuses to spawn rather than silently dropping the flag. Error: `cloud_agent="openhands" requires openhands.model to be set; valid values: <list from openhands --list-models>`.

### 4. Scope-leak detector vs Docker sandbox interaction

Today's scope-leak detector reads `git status` on the host filesystem after the agent exits. Post-wrap, the agent edits files INSIDE the Docker sandbox; the host filesystem sees no changes until OpenHands push-mirrors the sandbox's feature branch. There's a window where the host's `git status` is clean but the agent has already exited inside the sandbox.

**Mitigation**: daemon's post-spawn flow becomes: (a) OpenHands exits → wait for the sandbox-side push-mirror to complete → THEN run scope-leak detection on the host's now-updated feature branch. The runtime invariant `git-tree-clean-before-spawn` becomes `feature-branch-pushed-before-scope-check`.

### 5. OpenHands' Cloud opt-in pulls operator data off-machine

OpenHands Cloud Connections (per the Agent Canvas Initiative) let local OpenHands optionally connect to OpenHands Cloud for "always-on agents, cloud automations, integrations hub". OFF by default — operators have to opt in. The moment they do, agent traces flow to OpenHands' servers.

**Mitigation**: `openhands.cloud_connections = true` triggers a `~/.minsky/audit.log` entry + a startup banner: "OpenHands Cloud Connections are ENABLED — your agent traces are flowing to OpenHands' servers. To restore zero-cloud-egress mode, set openhands.cloud_connections = false". Same shape as the existing audit gates from vision.md § 13.

## Risks + mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenHands gets acquired and pivots away from OSS | Medium | High | 4-backend matrix preserved; fall back to `claude`/`devin`/`aider` within 1 config edit |
| Agent Canvas Initiative slips past June 1, 2026 | Medium | Medium | All Path C phases blocked on the CLI shipping; the strategic review's pivot threshold fires if delay extends past 6 months |
| AgentSkills spec evolves incompatibly between Claude Code and OpenHands | Low | Medium | agentbrew already abstracts the sync target; a per-target format mutation is cheap to add |
| OpenHands' Cloud Connections become opt-out by default | Low | High | Audit-log gate + startup banner per failure mode 5 above |
| OpenHands' SWE-bench lead evaporates (Claude Code closes the gap) | Medium | Low | The wrap's value drops but the architecture still works; operators just pick a different cloud_agent. No re-do required. |
| Lint-stack deletion sweep reveals only 5 redundant stages (vs 25 target) | Medium | Low | Phase 5 pivot threshold catches this; the package consolidation in Phase 4 may need to absorb the deletion budget instead |
| 1-operator team burns out before Phase 6 ships | High | Critical | The strategic review's 5 re-evaluation triggers fire if operator hours drop below 5/week; Path A (sunset) becomes the honest answer if the math no longer works |

## Re-evaluation triggers

Re-read this plan when any of these fire (in addition to the 5 triggers in the strategic review at PR #735):

1. **OpenHands' Agent Canvas Initiative ships** — June 1, 2026 per tracking task `monitor-openhands-agent-canvas-launch` (P2). Verify the wrap shape predicted here matches reality. If CLI is materially different, Phase 1 work changes.
2. **A package fate above turns out wrong** — e.g., `persona-spawner` audit reveals OpenHands' MicroAgents don't actually cover all consumers; revisit the fate table.
3. **The 4 🟡 status flags in the new identity stay 🟡 past 12 months from now** — the reshape stalled; consider whether to declare Path C failed and re-evaluate per the strategic review's pivot section.
4. **OpenHands publishes a deterministic-rule-enforcement layer** — currently they have zero; if they ship one, Minsky's moat #3 collapses and the reshape's "what stays Minsky" list needs revisiting.
5. **A competitor ships "Minsky-shaped on OpenHands" first** — i.e., another project builds the operator-machine-identity + constitution layer on top of OH before Minsky does. At that point, fold Minsky into theirs or differentiate sharply.

## Tasks filed alongside this plan

The plan unblocks 2 P1 tasks already in the queue (waiting on the wrap shipping):

- `lint-stack-audit-post-openhands-wrap` (P1) — blocked on wrap ship + this plan; pruning framework above is its substrate
- `novel-packages-audit-post-wrap` (P1) — blocked on wrap ship + this plan; package fate table above is its substrate

The plan also files 3 new follow-up tasks scoped to the reshape:

1. `phase-2-agentbrew-openhands-sync-target` (P2) — add `.openhands/microagents/` as an agentbrew sync target, ready for Phase 2 work post-wrap
2. `phase-3-persona-spawner-replacement-pilot` (P2) — pilot `novel/adapters/persona-spawner/` → OpenHands MicroAgents replacement, blocked on Phase 2
3. `phase-6-vision-md-identity-promotion` (P3) — strip 🟡 status flags from vision.md identity sentence after all phases ship; blocked on Phases 1-5

## Open questions / verification items

Items the research subagent flagged as unverified as of 2026-05-22. Each becomes a verification step at the appropriate phase.

1. **MCP support in OpenHands** — AgentSkills compatibility is confirmed; whether OpenHands hosts MCP servers natively OR consumes them as clients is unverified. Verify against `docs.openhands.dev` at Phase 1 entry.
2. **Scheduled execution / cron in OpenHands** — Event-triggered Automations are confirmed (webhook, PR comment); recurring cron-style is not. Verify at Phase 1 entry; if absent, Minsky's daemon scheduler stays load-bearing.
3. **OpenHands evaluation harness** — SWE-bench results are published; user-facing evaluation framework (`oh eval --tasks my-corpus.yaml`) is not confirmed. Verify before Phase 4 starts; if absent, `novel/competitive-benchmark/` may need to stay rather than fold into experiment-record.
4. **Resumable sessions** — TaskToolSet's sub-agent resumption via `task_id` is confirmed beta; full-session pause/resume is not confirmed. Verify at Phase 3 entry.
5. **Sub-agent persistence durability** — TaskToolSet state-storage semantics (filesystem / DB / in-memory) are not documented. Verify at Phase 3 entry; if in-memory only, Minsky's experiment-store stays the durability layer.
6. **June 1, 2026 Agent Canvas details** — three changes announced (Dockerless, BYO-agent, VM-first self-hosting). Verify each against the actual June 1 release; Phase 1's work hinges on the CLI shape that ships.
7. **OpenHands OTEL coverage** — Minsky's research flags this as a post-adoption verification item. Verify at Phase 1 close.

## Last reviewed

2026-05-22 — initial plan composition. Update on: (a) the next OpenHands-related release (Agent Canvas June 1), (b) a re-evaluation trigger firing, (c) Phase 6 completion (declare Path C done).
