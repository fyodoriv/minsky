# Competitor: Aider

> Best-in-class CLI for AI pair programming with local models — used by Minsky as the `local_agent` for zero-cloud-token mode.

- **URL**: <https://aider.chat> / <https://github.com/Aider-AI/aider>
- **Status**: Active, "the tool to benchmark against" (HN), battle-tested CLI
- **Pricing**: Free (OSS, Apache 2.0). Model costs only.
- **Relationship**: **Integration** — minsky uses aider as its local-model agent

## What it is

AI pair programming in your terminal. Best-in-class local model support. Works with Claude, GPT-4, Gemini, and any OpenAI-compatible local model (ollama, LM Studio, etc). Diff-based editing, git-native, minimal footprint. The gold standard for CLI-first AI coding.

## Strengths

- **Best local model support** — works with 100+ models including all ollama models. No other tool matches this breadth.
- **Fast and lightweight** — pip install, no Docker, no cloud dependency
- **Git-native** — auto-commits, understands repo structure, respects .gitignore
- **Battle-tested** — years of production use, massive HN/community following
- **Diff-based editing** — precise, reviewable changes (not whole-file rewrites)
- **Multi-file editing** — can edit multiple files in a single turn
- **Cost-efficient** — smart context management, caching, minimal token waste
- **SWE-bench competitive** — publishes scores, competitive with cloud-only agents

## Weaknesses vs minsky's vision

1. **Interactive-first** — designed for pair programming, not autonomous background operation. No daemon mode.
2. **No task queue** — works on what you tell it right now. No TASKS.md processing, no queue drain.
3. **No supervision** — no budget management, no watchdog, no automatic restart.
4. **No multi-agent** — one aider instance at a time. No brain+workers.
5. **No self-improvement** — no MAPE-K loop, no prompt optimization.
6. **No PR creation** — edits files and commits, but doesn't create PRs or run CI.
7. **No cross-repo** — one repo at a time.

## What we learn / steal

- **Local model integration** — minsky uses aider as its local agent precisely because aider's model support is unmatched.
- **Diff-based editing** — aider's `--edit-format diff` is more efficient than whole-file. Minsky's brief should prefer this.
- **`--no-auto-commits`** — minsky uses this to control when commits happen.
- **Message-file input** — aider reads briefs from `--message-file`, minsky composes with this.

## Why choose minsky over Aider

- 24/7 autonomous operation (daemon + queue)
- Multi-agent orchestration (cloud brain + local workers)
- TASKS.md queue processing
- PR creation and merge gate
- Budget management
- Self-improving

## Why choose Aider over minsky

- Better for interactive pair programming
- Simpler — no daemon, no config, just `aider`
- Better local model UX (model picker, context management)
- More battle-tested for daily coding

## Last reviewed

2026-05-18
