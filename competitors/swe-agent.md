# Competitor: SWE-agent (Princeton NLP)

- **URL**: <https://github.com/SWE-agent/SWE-agent>
- **Status**: Active, research-oriented, MIT licensed
- **Pricing**: Free (OSS). Model costs only.
- **Relationship**: **Research benchmark** — minsky measures against SWE-agent's published scores

## What it is

Research agent from Princeton NLP. Pioneered the Agent-Computer Interface (ACI) concept — a custom shell + file viewer optimized for LLM code editing. Strong SWE-bench scores. Designed for research experiments on agent capabilities, not production use.

## Strengths

- **Academic rigor** — published research with reproducible benchmarks
- **ACI innovation** — the Agent-Computer Interface is a genuine contribution to how agents interact with codebases
- **SWE-bench competitive** — strong published scores on the standard benchmark
- **Open source** — MIT, full transparency on methods
- **Multi-LLM** — works with Claude, GPT-4, and other models

## Weaknesses vs minsky's vision

1. **Research, not production** — designed for benchmarking, not for running 24/7 on real repos.
2. **No daemon mode** — single-shot task execution only.
3. **No supervision, budget, or observability** — pure research tool.
4. **No task queue** — runs one benchmark problem at a time.
5. **Setup complexity** — Docker + config for the research harness. Not a `pip install`.
6. **No multi-agent** — single agent architecture.
7. **No self-improvement** — the agent's prompts are manually tuned by researchers.

## What we learn / steal

- **ACI concept** — the idea that the agent's interface to the computer should be purpose-built, not just a terminal. Minsky's brief structure is a lightweight version of this.
- **Benchmark methodology** — SWE-bench is the standard. Minsky's scorecard should run the same or comparable tasks.
- **Published baselines** — SWE-agent's scores are the floor minsky should beat.

## Why choose minsky over SWE-agent

- Production-ready (daemon, supervision, budget, observability)
- Works on any repo (not just SWE-bench problems)
- 24/7 operation
- Multi-agent

## Why choose SWE-agent over minsky

- Better for research/benchmarking
- Higher academic credibility
- Simpler architecture for understanding agent capabilities

## Last reviewed

2026-05-18
