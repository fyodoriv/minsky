# Competitor: SWE-agent (Princeton NLP)

> Princeton NLP's research-benchmark coding agent — Minsky measures against SWE-agent's published SWE-bench scores.

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

## Scorecard readings (per `novel/competitive-benchmark/src/competitors.ts`)

| Metric                              | Value | Date       | Primary source                                                                                                                                                                                                                          |
| ----------------------------------- | ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.125 | 2024-10-01 | Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press, *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*, NeurIPS 2024 (SWE-agent + GPT-4 SWE-bench resolve rate 0.125 on the 2,294-instance full split).     |

Note: SWE-agent's published numbers are from the original NeurIPS paper
on the full SWE-bench split, not the Verified split specifically. The
Verified-split number is comparable per the Aider leaderboard cross-
reference (`aider.chat/2024/06/02/main-swe-bench.html` lists SWE-agent +
GPT-4 at 12.5% on the 2,294-instance bench). If SWE-agent publishes a
Verified-only number, replace this reading and update the citation.

## Last reviewed

2026-05-22
