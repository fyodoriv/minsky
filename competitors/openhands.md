# Competitor: OpenHands (All-Hands-AI)

- **URL**: <https://github.com/OpenHands/OpenHands>
- **Site**: <https://www.openhands.dev>
- **Status**: Active, MIT core + enterprise license, SWE-bench leader in OSS category
- **Pricing**: Free (self-hosted), cloud hosted plans available
- **Relationship**: **Competitor** — the strongest OSS autonomous coding agent

## What it is

Open-source autonomous software engineering platform (formerly OpenDevin). Docker-sandboxed execution. CodeAct paradigm — the agent writes and executes code to solve tasks. Supports multiple LLM backends (Claude, GPT-4, local). CLI + web interface. Can be self-hosted or used via cloud.

## Strengths

- **SWE-bench leader** in the OSS category — highest published resolve rate among open-source agents
- **Docker sandbox** — full isolation, can't damage the host
- **Multi-LLM support** — Claude, GPT-4, local models via OpenAI-compatible API
- **Self-hosted** — run on your own infra, no data leaves your network
- **Active community** — large contributor base, rapid iteration
- **CLI + web UI** — flexible interface for different workflows
- **Enterprise offering** — managed cloud version for teams

## Weaknesses vs minsky's vision

1. **Single-task focused** — no 24/7 daemon, no task queue processing, no overnight unattended runs.
2. **No supervision layer** — no budget management, no automatic restart on failure, no error-budget discipline.
3. **No self-improvement loop** — no MAPE-K, no prompt evolution, no competitive benchmarking against itself.
4. **No multi-agent orchestration** — one agent per task. No brain+workers, no model routing.
5. **No cross-repo support** — works on one repo at a time. No multi-repo walker.
6. **Heavy Docker dependency** — requires Docker for sandboxing. Not all machines have Docker (especially locked-down corporate laptops).
7. **No integrated observability** — no OTEL, no daemon logs, no fleet-wide metrics.

## What we learn / steal

- **Docker sandboxing** — cleaner isolation than minsky's scope-leak detector. Consider as M4 option.
- **CodeAct paradigm** — the agent writing and executing code is powerful; minsky delegates to Claude/Devin which do this natively.
- **SWE-bench benchmarking** — OpenHands publishes scores; minsky's scorecard should include the same benchmark.
- **CLI UX** — OpenHands CLI is clean and focused; minsky's CLI should be equally simple.

## Why choose minsky over OpenHands

- 24/7 daemon with budget management and supervision
- Multi-repo walker, cross-repo task queue
- Self-improving (MAPE-K loop)
- No Docker required
- Multi-agent (brain + workers with model routing)
- Competitive self-benchmarking

## Why choose OpenHands over minsky

- Higher SWE-bench scores on single-task benchmarks
- Docker sandbox is safer than scope-leak detection
- More mature single-task execution
- Web UI for interactive work
- Larger community

## Last reviewed

2026-05-18
