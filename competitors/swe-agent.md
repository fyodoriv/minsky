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

| Metric                              | Value | Date       | Primary source                                                                                                                                                                                                                                  |
| ----------------------------------- | ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swe-bench-verified-resolve-rate`   | 0.74  | 2026-02-26 | SWE-bench Verified leaderboard (`swebench.com`, "Bash Only" track), *mini-swe-agent + Gemini 3 Pro*, submitted 2026-02-26 (resolve rate 0.74 on the 500-instance Verified split); primary statement at `mini-swe-agent.com`.                     |

Note: this reading was refreshed (2026-06-02) from the original 2024
NeurIPS baseline to the SWE-agent team's current flagship scaffold,
**mini-swe-agent** — a ~100-line minimal bash-only ReAct agent. The
project's documented headline is "Gemini 3 Pro reaches 74% on SWE-bench
verified with mini-swe-agent!" (`mini-swe-agent.com`), and the same run
appears as a dated submission (2026-02-26) on the official SWE-bench
Verified "Bash Only" leaderboard at `swebench.com`. Unlike the prior
entry, this is a true **Verified-split** number, so the previous
full-split/Lite proxy caveat no longer applies.

Superseded reading (history): SWE-agent + GPT-4, resolve rate 0.125 on
the 2,294-instance full SWE-bench split — Yang, Jimenez, Wettig, Lieret,
Yao, Narasimhan, Press, *SWE-agent: Agent-Computer Interfaces Enable
Automated Software Engineering*, NeurIPS 2024. That figure was carried
as a Verified proxy (cross-referenced against the Aider leaderboard,
`aider.chat/2024/06/02/main-swe-bench.html`, which listed SWE-agent +
GPT-4 at 12.5%) until the project shipped mini-swe-agent and a
Verified-split number became available.

## Last reviewed

2026-06-02
