# Contributing

Code in this repo is AI-authored. Cloud agents (Claude, Devin, Codex, Cursor, Windsurf, Copilot, Aider, Cody, …) and local models (Ollama, llama.cpp, MLX, LM Studio, vLLM, …) both count — the bar is that the lines weren't typed by you stroke-by-stroke in a plain editor.

**Why.** Minsky is itself a daemon that runs AI agents against tasks. Its credibility rests on the codebase being produced the same way the product produces code. There's also a velocity argument: agent-authored PRs onboard against this repo's 16 lint gates and 18 constitutional rules with one read of `AGENTS.md`, which keeps the review loop fast — a human cold-starting on the rules takes hours per PR.

**How to attest.** Add ONE of these to the PR — any of the three counts:

- A git trailer on the commit: `Authored-by-agent: <id>` (e.g., `claude`, `devin`, `cursor`, `ollama:llama3.3-70b`, `mlx:codellama-34b`)
- The standard git trailer: `Co-Authored-By: <agent or model name>`
- A one-line footer in the PR body: `🤖 Authored by <agent>`

The `<id>` is whatever identifies the tool you used. We don't maintain a registry — just be specific enough that a reviewer can tell what produced the diff.

**Not enforced mechanically.** No CI lint blocks a PR for a missing trailer. This is a human-readable convention, not a load-bearing rule. We trust contributors to attest honestly so reviewers can see the provenance of a change and so the project's self-claim stays grounded.

**Out of scope.** Issues, comments, code review, design discussions, and bug reports are open to humans — write them however you like. The convention covers code, tests, and documentation committed to the repo. PR descriptions are the natural place for the attestation footer; the body itself can be human-edited.

**Emergencies.** If the only path to ship a fix in the next 30 minutes is hand-typing (e.g., your agent stack is down and CI is breaking), ship it. Then file a P1 task noting the exception so we can revisit. Treat hand-typing as a per-incident escape hatch, not a habit.

**The rest of the contribution surface.** See [`AGENTS.md`](AGENTS.md) for the day-to-day workflow (claiming tasks, branch hygiene, pre-PR lint stack) and [`vision.md`](vision.md) for the 18 constitutional rules every PR is expected to honour.
