# Competitor: OpenAI Codex CLI

> OpenAI's open-source terminal coding agent (`openai/codex`) — the inner-loop CLI half of the Codex offering, distinct from the cloud agent (codex-1) tracked in `competitors/openai-codex.md`. This file applies the Five Pivot Questions framework to decide what Minsky absorbs from the most-starred agent CLI on GitHub.

- **URL**: <https://github.com/openai/codex> (Codex CLI, open-source); <https://openai.com/index/introducing-codex/> (cloud agent context); <https://developers.openai.com/codex/cli> (CLI docs)
- **Status**: Active. Codex CLI launched 2025-04-16; rewritten from TypeScript to Rust mid-2025 for a single static binary and tighter sandbox control. ~88k★ as of 2026-06-02 (`gh api repos/openai/codex --jq .stargazers_count`), the most-starred coding-agent CLI on GitHub.
- **Pricing**: Free (Apache-2.0). Pays OpenAI API token costs, OR signs in with a ChatGPT Plus / Pro / Team / Enterprise plan to use included model quota. No separate Codex CLI subscription.
- **Relationship**: **Competitor (agent-tier) + candidate wrap target** — Codex CLI is an inner-loop terminal agent in the same slot Minsky already fills with Claude / Devin / aider. It is not an orchestrator: it has no daemon, no queue, no cross-repo loop, no supervision. Minsky could wrap it as a fourth cloud/local backend the way it wraps the others.

## What it is

Codex CLI is OpenAI's open-source, terminal-resident coding agent: `codex "fix the failing test in auth.ts"` opens an interactive session that reads the repo, proposes edits as diffs, runs commands, and (with approval) applies them. It is the local, operator-machine counterpart to the cloud agent `codex-1`.

- **Execution model** — runs on the operator's machine against the real working tree, sandboxed. Default `--ask-for-approval` (interactive); `--full-auto` runs read/write/execute inside a sandbox with no prompts; `--dangerously-bypass-approvals-and-sandbox` removes both (the explicit-name-shames-the-user pattern Minsky should copy).
- **Sandbox** — macOS Seatbelt (`sandbox-exec`) / Linux Landlock + seccomp. Network is disabled by default inside the sandbox; filesystem writes are confined to the workspace. This is a stronger default posture than Minsky's scope-leak detector, which is advisory.
- **Models** — OpenAI-only. Defaults to the `gpt-5-codex` / `o4-mini` family; `--model` selects among OpenAI models. No Claude, no local models, no BYO endpoint.
- **Config** — `~/.codex/config.toml` plus `AGENTS.md` files the agent reads for repo conventions (the same `AGENTS.md` convention this repo uses).
- **Non-interactive mode** — `codex exec "<prompt>"` runs one shot and exits, usable in CI. This is the surface that makes "`codex --background` as a one-flag default in Cursor / Copilot / Replit" a plausible commoditization threat (this task's Hypothesis).

### Published benchmark numbers

- **codex-1 (cloud)**: SWE-Bench Verified pass@1 = **0.721**, pass@8 = **0.838** (OpenAI, "Introducing Codex", 2025-05-16; 23 instances excluded as not-runnable on internal infrastructure; 192k context, medium reasoning effort). This is the number the corpus tracks under `swe-bench-verified-resolve-rate` for the `openai-codex` entry.
- **Codex CLI** does not publish its own separate SWE-Bench number — its score is whatever OpenAI model it is pointed at. The CLI is plumbing; the model is the measured artefact. This is the load-bearing distinction for Q5: replacing Minsky's agent backend with Codex CLI would inherit the model's score, not add one.

## Strengths

- **Strongest sandbox default in the category** — network-off + Landlock/Seatbelt confinement, not opt-in.
- **Single static Rust binary** — no Node/Python runtime to provision; trivially installable, fast cold start.
- **OpenAI ecosystem + ChatGPT-cloud integration** — sign in with a ChatGPT plan instead of wiring an API key; the same task can be handed to the cloud agent (codex-1) and back. Tight local ↔ cloud handoff is the integration model Minsky lacks.
- **`AGENTS.md` convention** — reads the same repo-convention file Minsky standardised on; zero adaptation cost to wrap.
- **Open source (Apache-2.0)** — inspectable, forkable, embeddable.
- **Enormous distribution** — ~88k★ and shipped inside ChatGPT subscriptions means it is the default "background coding agent" for the bottom-half of the funnel.

## Weaknesses vs Minsky's vision

1. **OpenAI-only** — no Claude (the strongest coding model per most benchmarks), no Devin, no local/offline models. Minsky's multi-model adapter layer is the direct contrast.
2. **No daemon** — single interactive (or single `exec`) session. Nothing keeps running after the task; nothing walks a queue.
3. **No supervision** — no budget guard, no watchdog, no restart-on-crash, no MAPE-K self-improvement.
4. **No task queue** — no `TASKS.md` processing; the operator is the scheduler.
5. **No cross-repo fleet** — one repo per invocation; no round-robin over N hosts.
6. **No constitution / deterministic enforcement** — no equivalent of the 17-rule `pnpm pre-pr-lint --stage=full` gate; "best practices" live in prose, not in CI.
7. **Cloud handoff re-clones** — the codex-1 side runs in a fresh cloud sandbox with separate identity, not the operator's git identity against their existing checkout.

## What we learn / steal

- **Name-and-shame the unsafe flag** — `--dangerously-bypass-approvals-and-sandbox` makes the dangerous path verbose and self-documenting. Minsky's `--no-verify` ban already follows this spirit; the explicit-verbose-name pattern is worth copying for any future escape hatch.
- **Sandbox-by-default as the security posture** — Codex CLI confines writes + disables network by default. Minsky's scope-leak detector is advisory; a default-deny sandbox is a stronger primitive worth evaluating behind an adapter.
- **One-shot `exec` mode for CI** — a clean non-interactive entry point. Minsky's `minsky solve <task-id>` is the analogue; Codex's `exec` confirms the shape.
- **ChatGPT-plan auth instead of API keys** — lowering the credential-setup tax is a distribution lever. Minsky's `~/.minsky/config.json` could grow a "sign in with your existing plan" path for the agents that support it.

## Why choose Minsky over OpenAI Codex CLI

- Multi-model (Claude / Devin / aider / local — not locked to OpenAI).
- 24/7 daemon with supervision, budget guard, and watchdog — outlives any one task.
- `TASKS.md` queue + cross-repo fleet — Codex CLI is per-invocation, per-repo.
- Operator-machine identity end-to-end — commits land as the operator with no fresh clone, including the cloud-handoff case Codex re-clones for.
- Constitution-as-CI — 17 rules enforced deterministically; Codex CLI has no equivalent gate.

## Why choose OpenAI Codex CLI over Minsky

- You are OpenAI-exclusive and want OpenAI's own first-party agent + the strongest sandbox default.
- You want the tightest local ↔ cloud (codex-1) handoff inside one ChatGPT subscription.
- You want a single static binary with no runtime to provision.
- You want OpenAI's published SWE-Bench Verified pass@1 = 0.721 (codex-1) rather than Minsky's no-baseline-yet.

## Should we wrap Codex CLI instead?

**Verdict: ADD as an optional fourth agent backend (low priority), do NOT replace the orchestrator.** Codex CLI fills exactly the agent-tier slot Minsky already abstracts behind `cloud_agent` / `local_agent`. Wrapping it is the rule-#1 / rule-#2 move (adapter behind `novel/adapters/`), and it is cheap because Codex already reads `AGENTS.md` and accepts a one-shot prompt via `codex exec`. But it adds nothing to the orchestrator tier — no daemon, queue, supervision, fleet, or constitution — so it is an agent option, not a substrate. Priority is low because the existing three backends already cover the multi-model story; the only unique pull is OpenAI-exclusive shops wanting first-party tooling + the cloud handoff.

## Five pivot questions

### 1. How is it different from Minsky?

Codex CLI is an **agent-tier, OpenAI-only terminal coding agent**; Minsky is an **orchestrator-tier 24/7 daemon** that drives agents (Claude, Devin, aider) on a `TASKS.md` queue across a fleet of repos, under a 17-rule constitution enforced by CI. The categories do not overlap: Codex CLI is the kind of inner-loop agent Minsky *wraps*, the way it wraps the others. The defining structural differences are (a) the loop — Codex CLI exits after one task; Minsky keeps walking the queue indefinitely under a watchdog; (b) the model — Codex is locked to OpenAI; Minsky is multi-model by design; and (c) the reviewer — Codex relies on a human approving diffs in the interactive loop; Minsky substitutes a deterministic CI merge gate for that human. The cloud half (codex-1) is closer to Minsky's *ambition* (autonomous, parallel tasks) but runs in fresh cloud sandboxes with separate identity, the opposite of Minsky's operator-machine identity binding.

### 2. What lessons can it give to us?

- **Sandbox-by-default** (Codex docs § "Sandbox & approvals"; Landlock + Seatbelt, network-off) — the strongest default-deny posture in the category. Minsky's scope-leak detection is advisory; a default-deny execution sandbox is a stronger primitive. Candidate for a sandbox adapter behind `novel/adapters/` (rule #2), evaluated against the existing seatbelt-sandboxer skill.
- **Verbose-shaming the unsafe flag** (`--dangerously-bypass-approvals-and-sandbox`) — the escape hatch is named so a reader knows it is dangerous without docs. A negative-affordance pattern Minsky already mirrors with its `--no-verify` ban; worth pinning as a convention for future escape hatches.
- **ChatGPT-plan auth as a distribution lever** — removing the API-key setup step (sign in with an existing subscription) measurably lowers the onboarding tax. Minsky's install-time-to-first-iteration metric (`agent-mediated-install`) is the place this lesson lands.
- **The CLI-is-plumbing / model-is-the-artefact distinction** — Codex CLI does not publish its own benchmark because its score is the model's score. This is a clarifying lesson for the M1.10 corpus: Minsky's eventual headline number must measure *Minsky's orchestration delta over the bare model*, not re-measure the model.

### 3. Are any of these lessons potentially vision-changing?

**No vision-changing finding — but the Hypothesis was examined and rejected, which is the point of asking.** This task's Hypothesis was that Codex's growth to ~88k★ as the default "background coding agent" — especially if `codex --background` becomes a one-flag default inside Cursor / Copilot / Replit — could erode the slot Minsky's tick-loop occupies. On inspection it does not: a one-flag `--background` agent is still *agent-tier* — one repo, one task, one model, no supervision, no fleet, no constitution. It commoditizes the *inner loop* Minsky already delegates, not the *outer loop* Minsky is. If anything, a ubiquitous cheap background agent is a tailwind: it is one more backend Minsky can wrap, and it sharpens the orchestrator-vs-agent boundary that is Minsky's whole positioning. The cloud half (codex-1) is the closer threat to the eventual "managed product" framing (M5), but it re-clones with separate identity, so it cannot deliver Minsky's operator-machine-identity guarantee. A negative finding is recorded here per the deep-research convention; this task's brief routes operator-facing vision questions centrally rather than into this file. Recommendation: **absorb sandbox-by-default + plan-auth lessons; no vision change.**

### 4. How can we improve our strategy based on this?

- **Treat the sandbox as an explicit, measurable adapter seam** — Codex's strongest, most-cited differentiator is default-deny execution. Strategy move: expose Minsky's execution sandbox as an adapter boundary (rule #2) so the posture is testable and swappable, rather than leaving scope-leak detection advisory. Traces to lesson §2.1.
- **Lower the credential-setup tax** — Codex's plan-auth removes a setup step. Strategy move: let `~/.minsky/config.json` support "use your existing ChatGPT/Claude plan" for backends that allow it, measured by the `agent-mediated-install` time-to-first-iteration metric. Traces to lesson §2.3.
- **Frame Minsky's eventual benchmark as an orchestration delta, not a model re-score** — Codex CLI's no-own-benchmark stance shows the model is the measured artefact. Strategy move: the M1.10 headline number must isolate the orchestrator's contribution (queue + supervision + retries) over the bare model, not duplicate SWE-Bench. Traces to lesson §2.4.
- **Lead positioning with "orchestrator, not agent"** — a ubiquitous `codex --background` makes the agent tier a commodity. Strategy move: pre-empt the "isn't this just a background agent?" objection by leading the README with the daemon/queue/fleet/constitution properties no agent CLI has. Traces to lesson §2.

### 5. Can and should we cut corners by replacing part of Minsky with this?

For each Minsky surface:

- **tick-loop**: KEEP — Codex CLI has no daemon/queue/loop; the cloud half is per-task parallel, not a persistent operator-machine loop. Nothing to replace.
- **MAPE-K**: KEEP — no self-improvement substrate exists in Codex CLI.
- **adapters / agent backend**: ADD (low priority) — Codex CLI is a clean candidate fourth backend behind the existing `cloud_agent` abstraction (it reads `AGENTS.md`, accepts `codex exec "<prompt>"`). Seam: the agent-spawn + brief-delivery step. Adds OpenAI-first-party coverage; adds nothing to the orchestrator.
- **sandbox**: EVALUATE-TO-ABSORB — Codex's Landlock/Seatbelt default-deny posture is worth wrapping as a sandbox adapter; this is the one technique to absorb, not just wrap.
- **corpus / scorecard**: KEEP + CITE — the codex-1 published SWE-Bench Verified pass@1 = 0.721 already lives in the `openai-codex` corpus entry; cite it rather than re-running a harness (rule #1).
- **dashboard / TASKS.md surface**: KEEP — Codex CLI has neither a fleet dashboard nor a queue surface.

**Total replace % across all surfaces: 0% orchestrator replacement** — one ADD (optional fourth agent backend) and one EVALUATE-TO-ABSORB (sandbox posture); everything orchestrator-tier is KEEP. Headline for the operator: *nothing in the orchestrator to replace; Codex CLI is a candidate fourth agent backend and the source of one technique (sandbox-by-default) to absorb.*

## Scorecard readings

Codex CLI carries no separate scorecard reading — its benchmark score is the OpenAI model it is pointed at, and the cloud agent's published number is already tracked under the `openai-codex` corpus entry (`novel/competitive-benchmark/src/competitors.ts`):

| Metric                            | Value | Date       | Primary source |
| --------------------------------- | ----- | ---------- | -------------- |
| `swe-bench-verified-resolve-rate` | 0.721 | 2025-05-16 | OpenAI, "Introducing Codex", openai.com/index/introducing-codex/, 2025-05-16 (codex-1, pass@1; pass@8 = 0.838; 23 instances excluded as not-runnable on internal infrastructure; 192k context, medium reasoning effort) |

This file intentionally does NOT add a duplicate `codex-cli` corpus entry: the CLI shares codex-1's model lineage and the corpus tracks one reading per published number (rule #4 — no fabricated or double-counted readings).

## Last reviewed

2026-06-02 — created with `## Should we wrap Codex CLI instead?` + `## Five pivot questions` (Five Pivot Questions framework) per task `competitor-deepen-codex-cli`. Verdict: ADD Codex CLI as an optional low-priority fourth agent backend; absorb sandbox-by-default posture; no vision change — a ubiquitous `codex --background` commoditizes the agent tier Minsky already delegates, not the orchestrator tier Minsky is (negative finding logged inline per this task's central-questions routing).
