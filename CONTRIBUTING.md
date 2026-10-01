# Contributing

> Welcome. This is a quick orientation for anyone — human or AI agent — about to contribute.

## TL;DR

Code in this repo is **AI-authored**. Pick a task, claim it, ship a PR. The substantive doc you'll spend most of your time with is [AGENTS.md](AGENTS.md) — the operational runbook.

| If you want to... | Read |
|---|---|
| Understand what Minsky is | [README.md](README.md) → [vision.md § "What Minsky is"](vision.md#what-minsky-is) |
| Pick a task to work on | [MILESTONES.md](MILESTONES.md) → [TASKS.md](TASKS.md) |
| Understand the workflow | [AGENTS.md](AGENTS.md) — setup, claim, lint, PR |
| Understand the rules | [vision.md](vision.md) — 17 non-negotiable rules, each CI-enforced |
| See what NOT to work on | [DEPRECATED.md](./docs/DEPRECATED.md) |

The full documentation map is at [docs/README.md](docs/README.md).

## The AI-authored convention

Code in this repo is AI-authored. Cloud agents (Claude, Devin, Codex, Cursor, Windsurf, Copilot, Aider, Cody, …) and local models (Ollama, llama.cpp, MLX, LM Studio, vLLM, …) both count — the bar is that the lines weren't typed by you stroke-by-stroke in a plain editor.

**Why.** Minsky is itself a daemon that runs AI agents against tasks. Its credibility rests on the codebase being produced the same way the product produces code. There's also a velocity argument: agent-authored PRs onboard against this repo's 53 pre-PR lint stages, 65 CI jobs, and 17 constitutional rules with one read of `AGENTS.md`, which keeps the review loop fast — a human cold-starting on the rules takes hours per PR.

**No attestation needed.** Don't add a trailer, footer, or co-author tag to declare what tool you used. Provenance is established by live observation (how the work was produced in the active session), not by self-declaration in the commit. The convention is descriptive, not mechanically enforced.

**Out of scope.** Issues, comments, code review, design discussions, and bug reports are open to humans — write them however you like. The convention covers code, tests, and documentation committed to the repo.

**Emergencies.** If the only path to ship a fix in the next 30 minutes is hand-typing (e.g., your agent stack is down and CI is breaking), ship it. Then file a P1 task noting the exception so we can revisit. Treat hand-typing as a per-incident escape hatch, not a habit.

## What you need to know before your first PR

- **The lint stack is real.** `pnpm pre-pr-lint --stage=full` runs 53 deterministic checks locally before push. CI runs them again. Don't push without local green.
- **Rule #9 is iron.** Every task — even a bugfix — needs Hypothesis / Success / Pivot / Measurement / Anchor fields. The task picker rejects tasks missing them.
- **Rule #12 is scope discipline.** Touch only what the task says you'll touch. Drive-by edits fail the `rule-12-scope-discipline` lint.
- **Rule #17 is proactive healing.** Every error you observe gets a same-PR fix or a `**Blocked**: <code>` task block. "Observe and report" is forbidden.

See [vision.md](vision.md) for the rest.

## The full contribution surface

See [`AGENTS.md`](AGENTS.md) for the day-to-day workflow (claiming tasks, branch hygiene, pre-PR lint stack) and [`vision.md`](vision.md) for the 17 constitutional rules every PR is expected to honour.
