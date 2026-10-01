# Language strategy — TypeScript control plane, polyglot workers

> Captured 2026-05-22 in response to the operator question "why not Python tools / Python backend?" Surfaces a decision that was previously latent in the architecture (rule #2 + the dependency table) but never explicitly justified. Future agents should read this before proposing a language rewrite or a substrate change.

## The rule

**TypeScript stays the control plane. Workers and adapters can be any language.** The process boundary is the language seam. Rule #2 (every external dependency accessed through an interface in `novel/adapters/`) is what makes this safe — the interface is TypeScript; the implementation behind it can wrap a Python subprocess, an HTTP service, an MCP server, a Rust binary, or a bash script.

## Why TypeScript for the control plane

The control plane is `novel/tick-loop`, `novel/cross-repo-runner`, the watchdog, the safety gates, the dashboard, the experiment-store readers, and the CLI shim — process management, scheduling, file I/O, IPC, structured logging. These are **ops** code, not **ML** code.

Five concrete strengths:

1. **Discriminated unions + exhaustive switch checks.** The `ResultSource` union in `novel/competitive-benchmark/src/competitors.ts` is the pattern: `kind: "published" | "local-harness"`, and the scorecard runner's switch must cover both. Pyright / mypy do this worse. For control-plane code where wrong dispatch causes silent budget burn, that matters.
2. **Strict null checks.** `--strictNullChecks` catches the entire class of "we forgot the agent might not have started yet." Python's typing is opt-in and less rigorously enforced.
3. **Node `child_process` + `async/await` ergonomics.** Process management is half of what minsky does. The Node ecosystem for spawning, piping, killing, and waiting on subprocesses is more ergonomic than Python's `subprocess` + `asyncio`.
4. **pnpm workspaces.** The `novel/` layered structure with per-package `dist/` builds and shared `tsconfig.base.json` is genuinely clean for a multi-package repo of this shape. Python's monorepo story (Poetry workspaces, uv workspaces) is improving but trails.
5. **CLI tooling ecosystem.** Ink / chalk / commander / yargs / vitest are all production-grade. The `minsky watch` dashboard, the `bin/minsky` shim, and the verify pipeline benefit from this.

## Why NOT Python for the control plane

Even though Python is the AI/ML lingua franca, minsky's control plane isn't ML code. The rewrite cost (3-6 months of focused work, regression risk in the safety gates) is high and the benefit is low. The strengths Python offers (Pydantic, DSPy, numpy, pandas, HuggingFace, mature LLM SDKs) all apply to **workers** that minsky invokes — not to the loop that schedules them.

What minsky would lose by going Python:

- Type-system rigor at the discriminated-union / strict-null level
- The current `novel/` workspace structure and its passing test suite (~3500+ tests)
- 18 months of TS-shaped institutional code conventions

What minsky would gain:

- In-process access to Python LLM SDKs (instead of subprocess)
- Direct access to LangGraph / CrewAI / Pydantic AI as in-process libraries
- Bigger contributor pool

Net: negative ROI for the whole backend. Positive ROI for **specific components** that are best-in-class Python (see below).

## Where Python *should* land in minsky

Python is the right language for any component where the upstream best-in-class implementation is Python and porting to TS would be a rule-#1 violation (reinventing the wheel). Specifically:

| Component | Language | Why | Adapter pattern |
|---|---|---|---|
| **OpenHands runtime** | Python | OpenHands SDK is Python; in-process call avoids subprocess overhead | `novel/adapters/agent-runtime.openhands.ts` TS interface; Python subprocess implementation talking JSON-RPC or HTTP |
| **Agentless harness** | Python | Research repo is Python; reproducibility matters for the M1.10 corpus | Subprocess invocation from `bin/minsky competitive` |
| **DSPy prompt optimizer** | Python (already) | Stanford library; in TS would be a fork-and-maintain disaster | Already in `dependency table row 13`; the pattern exists |
| **LangGraph** (demoted 2026-05-22) | (Python if ever adopted) | No concrete use case in surviving scope post-OpenHands-adoption — see `competitors/langgraph.md` re-promote criterion | n/a |
| **Experiment-store ML analysis** (if needed) | Python | pandas / numpy / scikit-learn for cross-run learning | Optional — only if MAPE-K analysis grows beyond declarative TS |

## When to add a Python (or Rust, Go, bash) worker — the decision rule

Apply in order:

1. **Is the best-in-class implementation already in another language?** If yes → adopt that implementation as-is via an adapter, don't port. (Rule #1.)
2. **Does the work fit poorly in TypeScript?** ML pipelines, heavy numerical work, OS-specific system calls — yes; process orchestration, CLI tooling, declarative logic — no.
3. **Is the process boundary natural?** A worker that takes a JSON brief and returns a JSON result is a good polyglot boundary. A worker that needs to share live state with the daemon is not.
4. **Is the adapter interface stable enough that vendor churn is absorbed?** If the upstream tool changes APIs frequently (early-stage research code), the adapter must be opinionated about which subset of the API it exposes — to satisfy rule #2.

If all four are yes → write the adapter. Pick the worker's language to match the upstream tool. Document the choice in `ARCHITECTURE.md` § dependency table.

## What this means for MCP + skills vs. Python-functions-as-tools

The same logic applies. MCP servers + Claude Code skills are the **cross-runtime substrate**:

- One MCP server is consumed by Claude Code, Cursor, Windsurf, Devin, OpenHands, Goose, Cline — a fleet-spanning agent platform that minsky orchestrates.
- A Python-function-as-tool is consumed only by the Python agent framework that loaded it.

Python-functions-as-tools are an **in-process** pattern (CrewAI, LangGraph, Pydantic AI). They're the right substrate inside one of those frameworks. They're the wrong substrate at the layer minsky operates — which spans multiple agents, runtimes, and languages.

Anyone can write a Python MCP server and minsky consumes it as a first-class tool. The Python ecosystem isn't locked out; it's wrapped at the process boundary, same as everything else.

## Open questions / future directions

- **Is there a class of minsky-internal logic that would benefit from in-process Python ML libraries?** Currently no. MAPE-K analysis is declarative; experiment-store reads are tabular. If we ever want learned routing (e.g., a small classifier picking the agent per task), that's a Python worker, not a control-plane move.
- **Should we move to Deno or Bun?** Not now. The pnpm workspace + Node target is stable; switching adds risk for no measurable benefit. Revisit at M3 or later.
- **What if the JS/TS agent ecosystem catches up to Python?** It might. Pydantic AI has TS variants in early stages; LangGraph has `@langchain/langgraph` JS. If by M3 the JS variants are at parity with Python, the polyglot tax goes down — but the architecture doesn't need to change, only the worker languages would shift.

## Related

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) § dependency table — the live list of adapters and their current language choice
- [`vision.md`](../vision.md) § 1 — don't reinvent the wheel (the rule that forces "use the upstream language")
- [`vision.md`](../vision.md) § 2 — every dependency behind an interface (the rule that makes polyglot safe)
- [`competitors/README.md`](../competitors/README.md) — the decision rule for when an external tool becomes a dependency
