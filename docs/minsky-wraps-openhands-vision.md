# Future vision: Minsky wraps OpenHands

> What the daemon looks like after the OpenHands agent-layer wrap (approved 2026-05-22) ships.

## Status

**Speculative design.** This doc describes the post-wrap world, not the current world. The wrap is operator-approved (2026-05-22) but external-dep-blocked on OpenHands' Agent Canvas Initiative CLI release (June 1, 2026); implementation tracked at [`add-openhands-as-pluggable-backend`](../TASKS.md). Until that ships, today's Minsky uses `claude` / `devin` / `aider` as the 3 backend options — read this doc as "where we're going", not "what runs today".

The wrap is "Shape A" from [`competitors/openhands.md` § "Should we wrap OpenHands instead?"](../competitors/openhands.md) — agent-layer wrap as a 4th pluggable backend. The orchestrator-layer wrap (Shape B, replace `cross-repo-runner` with OpenHands Automations) was rejected and stays rejected.

## A day in the life, post-wrap

You install Minsky on a fresh laptop. `~/.minsky/config.json` defaults to `cloud_agent: "openhands"` because OpenHands ships with the highest-published single-task agent capability (65.8% SWE-bench Verified, April 2025) and Minsky's whole job is to compose the best available agent into a 24/7 daemon shell.

You drop a `TASKS.md` into a repo. Minsky's daemon picks the top-priority task. Instead of spawning `claude` against the host's working tree, it spawns `openhands solve --task-file <brief.md> --model claude-opus-4-7` (the per-task LLM choice comes from your config; OpenHands' multi-LLM backend means you can route cost-sensitive tasks to DeepSeek-3.2-Thinker and hard tasks to Opus 4.7 in the same fleet).

OpenHands runs its CodeAct loop inside a Docker sandbox per task. The sandbox mounts your repo's worktree read-write but isolates the rest of your filesystem — preventive isolation, not detective scope-leak. Tests run inside the sandbox. The agent writes code, commits to a feature branch *inside the sandbox*, and emits a sandboxed diff. Minsky's daemon picks up the sandbox's output, verifies the diff stays within the task's declared scope (the scope-leak detector still runs at the diff level — same shape, different timing), then opens the draft PR using your git credentials on the host machine.

You wake up. The fleet has processed 8 tasks across 3 repos overnight. Six PRs landed cleanly; one was reverted by the scope-leak detector (the agent edited an adjacent test file outside the task's scope); one is awaiting a CI retry. The constitution gates (53 pre-pr-lint stages + 65 CI jobs) ran on every PR — your daemon's PRs face the same gates a human-authored PR faces. The MAPE-K substrate noted that OpenHands-via-Opus-4.7 had a 12% rollback rate on the test-related tasks but 2% on the docs-related tasks; the experiment-store records this and the next iteration's task-router prefers OpenHands-via-Sonnet for docs-only changes (the auto-tune of the per-task LLM choice is itself a MAPE-K phase-Plan output — still in specification per user-story-003, but the substrate is there).

The `minsky watch` dashboard surfaces OpenHands' WebSocket stream from each running sandbox — you can see live, in your terminal, what each agent is currently doing in each repo. Click into a host, and you see the agent's CodeAct trace: `bash: git diff main`, `python: pytest tests/test_foo.py`, `edit: src/foo.ts line 42`. This is the live observability OpenHands' web UI gives operators today; Minsky now inherits it across the fleet.

You glance at the scoreboard. Minsky's M1.10 corpus reports `Minsky-via-OpenHands-via-Opus-4.7 SWE-bench Verified = 0.671`, computed last weekend by the `humaneval-pass-at-1` benchmark harness (the gap filed as `benchmark-minsky-via-claude-on-humaneval` is finally closed — though the metric name needs updating). Comparing to bare OpenHands Opus 4.7 (0.658, from OpenHands Index Q1 2026), the +1.3pp delta is the value of Minsky's orchestrator-tier layer on top of OpenHands' agent. That's the headline number that closes one of the 5 honest gaps from `competitors/README.md`.

## What changes architecturally

### The agent spawn shape

Today (PR #732, pre-wrap):

```text
~/.minsky/config.json: cloud_agent = "claude"
        ↓
novel/cross-repo-runner/src/spawn.ts:
        spawn("claude", ["--model", "claude-opus-4-7-max"], { stdin: brief })
        ↓
Claude Code edits the host's working tree directly.
The scope-leak detector runs AFTER claude exits, against the host's git diff.
```

Post-wrap:

```text
~/.minsky/config.json: cloud_agent = "openhands"
                       openhands_sandbox = "docker"  (or "process" for Dockerless on locked-down laptops)
                       openhands_model   = "claude-opus-4-7"  (passed THROUGH to OpenHands' --model)
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
On exit, OpenHands serialises the agent-state to ~/.openhands/<conversation_id>/state.json
and the sandbox-side feature branch is push-mirrored to the host's working tree via git remote tracking.
        ↓
Minsky's scope-leak detector runs AFTER openhands exits, against the host's git diff (same shape as today —
the difference is the diff comes from the sandbox-pushed feature branch, not from in-place editing).
        ↓
Minsky opens the draft PR using the operator's ~/.config/gh credentials (unchanged).
```

The brief-delivery contract changes: today's stdin / `--prompt-file` / `--message-file` shape becomes `--task-file <path>` (matching OpenHands' likely Agent Canvas CLI). The `AGENTS.md` agent-support matrix's 4th row pins the contract.

### `~/.minsky/config.json` schema

A small extension:

```jsonc
{
  "cloud_agent": "openhands",
  "openhands": {
    "model": "claude-opus-4-7",       // passed through to OpenHands' --model
    "sandbox": "docker",              // "docker" | "process" | "remote"
    "remote_host": null,              // populated when sandbox = "remote"
    "cli_path": "/usr/local/bin/openhands"  // optional override; default: PATH lookup
  },
  // existing fields unchanged:
  "local_agent": "aider",
  "local_agent_model": "ollama_chat/qwen3-coder:30b"
}
```

The `openhands.model` field is what gives operators the multi-LLM choice within OpenHands' supported backends. Minsky's daemon doesn't pick the LLM directly anymore for OpenHands tasks — it picks the *agent* (`openhands`) and lets OpenHands handle LLM routing per its own catalog.

### What the daemon still owns

Six things; the same six moats from `competitors/README.md`:

1. **Daemon lifecycle**: `bin/minsky` bash entry, launchd/systemd KeepAlive, dynamic watchdog (`novel/cross-repo-runner/src/dynamic-timeouts.ts`), supervisor restart discipline. OpenHands doesn't ship any of this today; the Agent Canvas Initiative explicitly adds "self-hosting on VMs as first-class" but doesn't ship a 24/7 fleet daemon.
2. **Operator-machine identity**: PRs land as the operator. Today's daemon spawns `gh pr create` with the operator's `~/.config/gh/`; that doesn't change. The sandbox-side commits inside Docker authors as a sandbox-internal user (`openhands@sandbox`), but the PUSH to the host's feature branch happens via operator's ssh; the PR's commit author is reset via `--author "<operator email>"` in the daemon's git plumbing.
3. **TASKS.md surface**: the daemon reads `TASKS.md` from the host repo. OpenHands' brief-delivery format is the integration point — the daemon converts the Minsky task block into an OpenHands `--task-file`.
4. **Constitution as deterministic CI**: 17 rules × 53 pre-pr-lint stages × 65 CI jobs run on every PR the daemon opens. OpenHands has zero policy enforcement at this level; that's still Minsky's job.
5. **Cross-repo fleet**: `--hosts-dir <parent>` walks N repos in round-robin (3 iterations per host per pass). OpenHands' cross-repo support is enterprise-tier only via Automations; Minsky's wrap means open-source operators get fleet-walking without the enterprise license.
6. **MAPE-K substrate**: experiment-store + observer + spec monitor record every iteration's outcome, and the daemon files tasks against its own weak spots. The closed-loop A/B prompt tuning (user-story-003) stays speculative but the substrate observes OpenHands' per-task performance just as it observes Claude's today.

### What the daemon delegates to OpenHands

Three things:

1. **Per-task agent loop**: CodeAct paradigm, write→run→observe→iterate, inference-time scaling (critic + best-of-N), 15+ LLM choice.
2. **Per-task sandbox**: Docker / Process / Remote. The sandbox boundary is at OpenHands' layer, not Minsky's. Scope-leak detection moves from prevention (Docker handles that) to verification (Minsky checks the agent stayed within the task scope by inspecting the diff after OpenHands exits).
3. **Per-task LLM routing**: which exact model variant gets called for each agent step. Operators set the floor in `~/.minsky/config.json`; OpenHands picks per-step from its supported backend list.

## What this unlocks

### Closing 3 of the 5 honest gaps

[`competitors/README.md` § "Honest gaps"](../competitors/README.md) lists 5 gaps. The wrap directly addresses 3:

| Gap (today) | Post-wrap state |
|---|---|
| **Headline benchmark number** — Minsky has none; OpenHands has 65.8% | Minsky-via-OpenHands inherits OpenHands' score + can publish a delta vs bare OpenHands. The `benchmark-minsky-via-claude-on-humaneval` task gets re-shaped to "benchmark Minsky-via-OpenHands against bare OpenHands" — measures the orchestrator-tier delta cleanly. |
| **Multi-LLM support breadth** — Minsky supports `claude` / `devin` / `aider`; OpenHands supports 15+ | The wrap inherits OpenHands' LLM choice. Operators can route Opus-4.7 to hard tasks, Sonnet-4.5 to medium tasks, DeepSeek-3.2-Thinker (1/10 the price) to mechanical tasks. |
| **Preventive sandbox isolation** — Minsky scope-leak-detects post-hoc; OpenHands isolates with Docker | The wrap inherits Docker sandbox. Scope-leak detection becomes a verification layer, not the only line of defence. |

The 2 unchanged gaps: **enterprise distribution** (still a moat-collapse path; Minsky needs its own enterprise story, not OpenHands') and **multi-agent ensembling** (still spec-only).

### Sub-agent delegation pattern

OpenHands' May 2026 roadmap (per the deep-dive in `competitors/openhands.md`) includes sub-agent delegation — multi-agent workflows where the parent agent delegates specialized sub-tasks to sub-agents with inline critic/verification. This maps cleanly onto Minsky's M2 milestone [`multi-persona-pipeline-handoff-spec`](../user-stories/) — the "team of workers per task" framing in `README.md` § "How it works".

Post-wrap, Minsky doesn't have to build sub-agent delegation from scratch. If OpenHands' sub-agent shape is well-designed (we'll see after June 1), Minsky can configure OpenHands to invoke sub-agents per task, and Minsky's role becomes "wire the right OpenHands sub-agent topology to each task type". That's a smaller scope than building the delegation layer ourselves.

### Live observability dashboard

`minsky watch` today shows stability %, iterations, human-help count — all derived metrics. OpenHands' Local GUI surfaces the agent's CodeAct trace in real-time via WebSocket. Post-wrap, `minsky watch` can subscribe to OpenHands' WebSocket per running task and surface the live agent trace (`bash: ...`, `edit: ...`, `python: ...`) per host in the fleet. Operators see what each task is doing, not just whether it's done.

The cost: the dashboard now depends on OpenHands' WebSocket protocol staying stable. That's an external API contract Minsky has to monitor (track in the recurring `corpus-discover-quarterly` or a new `monitor-openhands-protocol-stability` task).

### Future wraps become easier (or moot)

Adding OpenHands sharpens the answers for other competitors' wrap analyses:

| Competitor | Pre-wrap verdict | Post-wrap implications |
|---|---|---|
| **Aider** | Already wrapped at local-agent layer | Unchanged. Operators on local-only mode keep using aider for zero-cloud-token runs. |
| **CrewAI** | NO — structural mismatch (general-purpose) | Unchanged. If we ever want CrewAI's role/goal/backstory pattern, we could potentially configure it INSIDE an OpenHands sub-agent — but that's speculative + low priority. |
| **Devin** | Per-task wrap already correct; further wrap kills moat #2 | Unchanged. Devin and OpenHands are alternative agent backends; operators pick one or the other per machine. |
| **MetaGPT** | NO — task-shape mismatch (greenfield) | Unchanged for the daemon, but the wrap-feasibility framework now has a precedent — future MetaGPT-like analyses can compare to OpenHands' agent capability rather than to bare-Claude. |
| **AutoGen / LangGraph / OpenAI Agents SDK** | No wrap analysis yet | Each becomes a candidate to wrap as an OpenHands SUB-AGENT (running within OpenHands' agent loop) rather than as an alternative to Minsky's orchestrator. That's a much smaller question than "should we replace Minsky's whole orchestrator with their framework". |

The strategic shape: pre-wrap, every direct competitor was a candidate to replace Minsky's whole orchestrator. Post-wrap, the question shifts to "should we wire this competitor's framework as one of OpenHands' sub-agents?" — a smaller, cheaper question that fits Minsky's `competitor-research` skill's Phase 7 framework cleanly.

## New failure modes

Every wrap introduces failure modes that didn't exist pre-wrap. Five to expect:

### 1. OpenHands CLI version skew

If Minsky's daemon expects `openhands@1.7.x` and the operator has `openhands@2.0.0-beta` installed, the `--task-file` argument may have changed shape. Today's `pnpm minsky doctor` checks node version + git version + gh auth; it'll need a new check: `openhands --version` matches a Minsky-pinned compatibility range.

**Mitigation**: `scripts/check-openhands-cli-version.mjs` reads the pinned range from `package.json` and fails fast if the installed CLI is out of range. Same shape as the existing `lockfile-integrity` lint.

### 2. Docker daemon required on operator's machine (today's mitigation: Process sandbox)

OpenHands' default sandbox is Docker. Operators on locked-down corporate laptops without Docker can't run the daemon. The Agent Canvas Initiative ships a Process sandbox for Dockerless operation, but it's a weaker isolation boundary (the agent runs in the operator's shell, not a container) — closer to today's Claude/Aider model.

**Mitigation**: `~/.minsky/config.json: openhands.sandbox = "process"` is the documented fallback for Docker-less environments. The `minsky doctor` check warns when `sandbox=docker` is configured but Docker is unavailable; the daemon refuses to start.

### 3. LLM-choice config drift between Minsky and OpenHands

Today, Minsky picks the LLM (`cloud_agent_model: "claude-opus-4-7-max"`) and passes it to Claude/Devin/Aider. Post-wrap, OpenHands picks the LLM per-step from its supported backends, parameterised by the `--model` flag. If the operator sets `claude-opus-4-7-max` (a Devin-only label) but switches `cloud_agent` to `openhands`, the flag fails because OpenHands' Claude name is `claude-opus-4-7` (no `-max` suffix).

**Mitigation**: the daemon's argv-builder reads `openhands.model` from a separate config key — if it's not set, the daemon refuses to spawn rather than silently dropping the model flag. The error message reads: `cloud_agent="openhands" requires openhands.model to be set; valid values: <list from openhands --list-models>`.

### 4. Scope-leak detector vs Docker sandbox interaction

Today's scope-leak detector reads `git status` on the host filesystem after the agent exits, comparing the diff to the task's declared scope. Post-wrap, the agent edits files INSIDE the Docker sandbox; the host filesystem sees no changes until OpenHands push-mirrors the sandbox's feature branch. There's a window where the host's `git status` is clean but the agent has already exited "successfully" inside the sandbox.

**Mitigation**: the daemon's post-spawn flow becomes: (a) OpenHands exits → wait for the sandbox-side push-mirror to complete (OpenHands handles this) → THEN run scope-leak detection on the host's now-updated feature branch. The runtime invariant `git-tree-clean-before-spawn` (rule 3a in AGENTS.md) becomes `feature-branch-pushed-before-scope-check`.

### 5. OpenHands' Cloud opt-in pulls the operator's data off-machine

OpenHands Cloud Connections (per the Agent Canvas Initiative point 7) let local OpenHands optionally connect to OpenHands Cloud for "always-on agents, cloud automations, integrations hub". This is OFF by default — operators have to opt in. But the moment they do, agent traces, conversation history, and possibly source-tree snippets flow to OpenHands Cloud.

This is the operator-machine-identity moat under pressure. Minsky should detect the configuration and warn loudly: `openhands.cloud_connections = true` triggers a `~/.minsky/audit.log` entry + a startup banner reading "OpenHands Cloud Connections are ENABLED — your agent traces are flowing to OpenHands' servers. To restore zero-cloud-egress mode, set openhands.cloud_connections = false". This is the same shape as the existing audit gates from `vision.md` § 13.

**Mitigation**: explicit operator-facing warning + audit-log entry. The moat doesn't break automatically; it only breaks if the operator opts in AND the daemon doesn't warn them.

## The path from here

The implementation work is straightforward once OpenHands' June 1 CLI ships. Six concrete steps, each ~1-3 days:

1. **Audit the June 1 CLI shape**. Read OpenHands' final CLI docs, confirm the `solve <task-brief>` interface and the `--sandbox` / `--model` flags. Write the brief-delivery format spec.
2. **Add `openhands` to the agent matrix**. `novel/cross-repo-runner/src/agent-config.ts` + `AGENTS.md` § "Agent support matrix" + `bin/minsky` argv-builder + `~/.minsky/config.json` schema (new `openhands` subkey).
3. **Implement the spawn path**. The daemon writes the brief to `/tmp/minsky-brief-<task-id>.md`, spawns OpenHands with `--task-file`, waits for completion, runs scope-leak detection on the now-pushed feature branch, opens the PR.
4. **Wire `minsky doctor`**. Version-range check for `openhands` CLI, Docker availability check when `sandbox=docker`.
5. **Wire `minsky watch`**. Subscribe to OpenHands' WebSocket per running task, surface the CodeAct trace per host.
6. **Run the prototype experiment**. 2-week run on a fixture host: measure Claude-via-OpenHands SWE-bench delta vs Claude-via-bare-Minsky (the pivot threshold in the P0 task). If ≥10pp delta, ship; if <5pp, revert per the pivot.

Each step has the same shape as existing aider/devin/claude wiring — the work is parallel to those, not novel. Estimated 1-2 weeks total, gated on the June 1 launch + the rule-9-required experiment-runner cycle.

The P0 task [`add-openhands-as-pluggable-backend`](../TASKS.md) tracks the work end-to-end with full Hypothesis / Success / Pivot / Measurement / Anchor fields. Cross-references `monitor-openhands-agent-canvas-launch` (P2) which fires on June 1 + audits the post-launch architecture.

## Honest tradeoffs of the wrap

The wrap is a NET WIN per the analysis, but it costs three things:

1. **Vendor dependency at the agent layer**. Today's operator can swap Claude → Devin → Aider via per-machine config. Post-wrap, if `cloud_agent: "openhands"`, the operator depends on OpenHands' release cadence + CLI stability. If OpenHands gets acquired or pivots, the operator's daemon breaks. Mitigation: Minsky retains the 4-backend matrix (`claude` / `devin` / `aider` / `openhands`); operators can fall back to a non-OpenHands backend within 1 config edit.
2. **Larger install footprint**. Today's Minsky install is `pnpm install` + ~600 MB of node_modules. Post-wrap, operators using `openhands` also install OpenHands' CLI + Docker (or accept the Process sandbox) — another ~200-500 MB. The `pnpm minsky doctor` warns of missing dependencies. Operators who want the smallest footprint stick with `claude` or `aider`.
3. **Performance variance**. OpenHands' per-task wall-clock latency (3600s average per their published `scores.json`) is higher than bare Claude Code's interactive single-shot mode. Operators trading latency for SWE-bench quality opt in via `cloud_agent: "openhands"`; operators trading quality for speed stick with `claude`. Both modes are first-class — no migration pressure.

These costs are visible in the post-wrap README's "How Minsky compares" table — the Backend choice row reads "Claude / Devin / Aider / OpenHands; OpenHands recommended for SWE-bench-graded tasks, Claude for interactive iteration, Aider for zero-cloud-token mode".

## What this implies for the moats

After the wrap ships, [`competitors/README.md`](../competitors/README.md) and [`competitors/openhands.md`](../competitors/openhands.md) both need refreshing. The two changes:

- **Moat #1 (daemon-not-framework)** strengthens — the wrap proves the moat is real (you can swap the agent without rewriting the daemon). The framing in `competitors/README.md` § "What Minsky uniquely does" can cite the OpenHands wrap as evidence: "even when the agent layer wraps a more-capable competitor, the daemon shell survives unchanged."
- **Moat #2 (operator-machine identity)** stays the same; the wrap preserves it (Docker sandbox runs locally, commits land as the operator). The 5-row chaos table in `user-stories/012-operator-machine-identity-moat.md` gains a 6th row: `openhands-cloud-connections-enabled` (the failure mode is operator opt-in to cloud egress — see failure mode 5 above).

## Re-evaluation triggers

Re-read this doc + the wrap analysis when:

1. OpenHands' Agent Canvas Initiative ships (June 1, 2026) — tracked by `monitor-openhands-agent-canvas-launch`.
2. Minsky publishes its own SWE-bench number (via `benchmark-minsky-via-claude-on-humaneval`) — if Minsky-via-Claude unexpectedly beats OpenHands' 65.8%, the wrap's value drops.
3. OpenHands gets acquired / pivots / ships a breaking CLI change — recheck the vendor-dependency risk.
4. 12 months after the wrap ships — has the wrap delivered the predicted +10pp SWE-bench delta? If not, fire the pivot per the P0 task's `Pivot` field.

## Last reviewed

2026-05-22 — initial speculative design after operator approval of the wrap. Update when the implementation ships post-June-1.
