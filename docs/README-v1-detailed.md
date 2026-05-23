# Minsky

> A reproducible recipe for running a team of AI coding agents on your own machine — supervised, on-budget, and observable. Named after [Marvin Minsky](https://en.wikipedia.org/wiki/Marvin_Minsky) and his [*Society of Mind*](https://en.wikipedia.org/wiki/Society_of_Mind) (1986), which argues that intelligence emerges from many simple specialists cooperating.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

## Who this is for

If you've used Claude Code, Cursor, GitHub Copilot, or any other AI coding assistant and thought *"I wish this could just keep working overnight without me babysitting it"* — Minsky is a serious attempt at the supervisor layer that makes that possible.

- **If you're a junior** trying to ship more with one good AI agent: skip ahead to [Quickstart](#quickstart) and run `./setup.sh`. The setup is one command. Every other claim in this README is a link to either code or a paper.
- **If you're a tech lead or manager** worried about runaway token bills, hidden agent state, or "we shipped something nobody can explain": read [Why this exists](#why-this-exists) — this repo is structurally designed around three concerns that matter to you (cost predictability, observability, change traceability).
- **If you're a researcher or platform engineer** interested in how the guarantees compose: every architectural choice cites a paper. The supervision tree is Erlang/OTP, the budget guard is Google SRE, the autonomic loop is IBM MAPE-K, the experiment discipline is open-science pre-registration. See [Theoretical foundations](./vision.md#theoretical-foundations).

## What this actually is, in 30 seconds

A **curated stack + small custom layers** that wires together existing tools — [Claude Code](https://claude.com/claude-code), [oh-my-claudecode (OMC) personas](https://github.com/Yeachan-Heo/oh-my-claudecode), [OpenTelemetry](https://opentelemetry.io/), systemd / launchd, the [tasks.md queue spec](https://github.com/tasksmd/tasks.md), Apple Shortcuts — into one supervised pipeline. The custom layers, published as `@minsky/*` on npm, fill gaps no upstream tool covers:

- **`@minsky/budget-guard`** — token-budget watchdog. Reads your usage and decides `NORMAL` / `THROTTLE` / `PAUSE` / `WEEKLY_WARN`. Exposes the decision to shell scripts (a flag file) and HTTP (`localhost:9876/budget`).
- **`@minsky/observability`** — three-signal OpenTelemetry adapter (traces / metrics / logs) with health-probe `selfTest()`.
- **`@minsky/handoff-spec`** — parseable record format for handoffs between agents (subject / from / to / status / blockers / suggested next).
- **`@minsky/token-monitor`** — interface + planned Strategy against [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) (the Python tool that actually surfaces Anthropic's hidden usage numbers).
- **`@minsky/mape-k-loop`** — the autonomic manager that runs a spec monitor, identifies the bottleneck, A/Bs prompt variants, and rolls out winners. v0 ships pure `monitor` / `analyze` / `plan` / `execute` / `knowledge` decision functions plus the assembled `tick` cycle (sustained-gain + oscillation guards) — see [`novel/mape-k-loop/`](./novel/mape-k-loop/).

Everything is MIT, every dependency lives behind an interface (`novel/adapters/`), every rule traces to a published source, and every code change in this repo carries a [pre-registered hypothesis + measurement](./vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes).

## What this is *not*

- **Not a framework.** No multi-agent runtime, no proprietary task queue, no proprietary loop driver. We adapt existing tools rather than rebuild them.
- **Not for one-off quick fixes.** Every change in this repo carries the iron-rule overhead (hypothesis + measurement + pivot). If your fix can't justify that, it belongs in another repo.
- **Not an IDE plugin** · **not a productivity tool** · **not a chatbot.** Minsky targets the supervisor layer, not the editor.

## What minsky can and cannot do today (honest)

Minsky is **pre-alpha** (`v0.0.0`). This table reflects what actually works right now, not aspirations. See [`MILESTONES.md`](./MILESTONES.md) for the full per-milestone capability breakdown.

| Task type | Today | Target milestone |
|---|---|---|
| 🟢 **Run a daemon that picks tasks from TASKS.md and opens PRs** | Works. ~60-90% iteration success rate on a single repo. | M1 targets 90% |
| 🟢 **File tasks from a repo audit** (missing tests, stale docs, lint issues) | Works via the 8h default session. Core workflow. | M1 |
| 🟢 **Fix lint / type errors** | Works. Deterministic success criteria. | M1 |
| 🟢 **Add missing tests** for existing code | Works. Test-first is constitutional. | M1 |
| 🟡 **Run overnight unattended** | Works but fragile. Commit hooks, token limits, and GH auth can crash the daemon. | M1 targets 90% stability |
| 🟡 **Single-file bug fixes** | Works when localized. Struggles with multi-file root causes. | M2 improves this |
| 🟡 **Switch between Claude, Devin, and local models** | Partially working. Claude is primary, Devin experimental, local bootstraps but quality varies. | M1 |
| 🔴 **Multi-file refactors** | Likely to produce partial changes that break the build. | M2 |
| 🔴 **UI/frontend changes** | No screenshot capture or visual verification yet. | M2 |
| 🔴 **Run on GitHub Actions** | Not yet. | M3 |
| ⛔ **Security-sensitive changes** | Won't do. Marked human-blocked. | Never autonomous |
| ⛔ **Destructive operations** (force push, delete, deploy) | Won't do. Hard-blocked. | Never autonomous |
| ⛔ **Architecture decisions** | Won't do. Files research tasks for humans. | Never autonomous |

**Bottom line**: today minsky is useful for **repo maintenance** (filing tasks, fixing lint, adding tests, updating docs) running overnight on your machine. It is NOT yet reliable enough for production single-task delivery, not available as a GitHub Action, and not a replacement for a developer on non-trivial work.

## The `minsky` CLI (operator UX)

Minsky ships a single repo-rooted CLI: `pnpm minsky` (or `node novel/tick-loop/bin/minsky.mjs`). Sane defaults + auto-bootstrap:

```bash
minsky                               # autonomous run (foreground, SIGHUP-immune)
minsky --daemon                      # background daemon (survives terminal close / IDE restart)
minsky --daemon --hosts-dir ~/apps   # daemon across multiple repos
minsky --local                       # local-only mode (zero cloud tokens)
minsky --local --daemon              # local-only background daemon
minsky status                        # PID, uptime, last 10 log lines
minsky logs                          # tail -f the daemon log
minsky stop                          # SIGTERM → graceful drain
pnpm minsky doctor                   # health probe — claude / local-LLM / model weights
```

### Daemon mode (`--daemon`)

`minsky --daemon` backgrounds the process, logs to `~/.minsky/daemon.log`, writes a PID file, and exits immediately. The process is SIGHUP-immune — survives IDE terminal close, Windsurf/Cursor restart, and SSH disconnect. Guards against double-start (PID check).

### Local-only mode (`--local`)

`minsky --local` runs exclusively on local models (aider/opencode against MLX/LM Studio). No cloud agent spawned, no budget guard, no claude probing — zero cloud spend. Use when tokens are exhausted. Combinable with `--daemon`.

### Cloud agent selection (`MINSKY_CLOUD_AGENT`)

The cloud agent is selectable per machine. Default `claude` (Claude Code CLI). Set `MINSKY_CLOUD_AGENT=devin` to use Devin CLI (`devin --print`) instead — same stdin/stdout contract, different billing. Pin the model with `MINSKY_CLOUD_AGENT_MODEL`.

**Operator escape hatches** (env vars; see `minsky --help`):

| Env var | Effect |
|---|---|
| `MINSKY_CLOUD_AGENT=devin` | Use Devin CLI instead of Claude Code for cloud iterations. |
| `MINSKY_CLOUD_AGENT_MODEL=<id>` | Model to pass via `--model` to the cloud agent. |
| `MINSKY_LLM_PROVIDER=local-only` | Hard local mode (same as `--local` flag). |
| `MINSKY_LLM_PROVIDER=local-preferred` | Prefer local when reachable, fall back to cloud. |
| `MINSKY_LLM_PROVIDER=claude-only` | Force cloud even on a hard-limit signal. |
| `MINSKY_LOCAL_LLM=1` | Wire the local-LLM fallback wrapper. |
| `MINSKY_HARD_LIMIT_TTL_MIN=<n>` | Trust persisted hard-limit hits for N minutes (default 60). |
| `MINSKY_NON_INTERACTIVE=1` | Auto-confirm prompts. Required for `--daemon` (set automatically). |

The CLI is intentionally repo-rooted (not a global `npm install -g` package) so the daemon's worktree, `.minsky/state.json`, and the workspace's pnpm dependencies stay co-located with the code. The `bin/minsky` PATH shim resolves the repo automatically from any folder.

**Multi-machine flow** (cloning to a second machine where claude tokens are exhausted):

```bash
git clone https://github.com/fyodoriv/minsky.git && cd minsky
pnpm install                            # (a) prepare hook builds dist; (b) lefthook installs hooks
MINSKY_LLM_PROVIDER=local-preferred pnpm minsky   # skip claude probe + bootstrap local-LLM (~19 min, ~17 GB; one [Y/n] confirm)
```

If `pnpm minsky` ran without the env var, the live probe (1-token `claude --print "ping"`) might false-positive `healthy` even when iterations would hit the quota. The first iteration's hard-limit response gets persisted to `.minsky/state.json::last_claude_hard_limit`; every subsequent `minsky` within `MINSKY_HARD_LIMIT_TTL_MIN` minutes (default 60) skips the live probe automatically.

`pnpm minsky doctor` shows the persisted state at any time; the `claude exhaustion (persisted)` row turns YELLOW with the timestamp + age + reason within TTL.

## Observer layer (`minsky` from any folder, watched by a calling agent)

Minsky ships an **observer plugin** distributed via
[agentbrew](https://github.com/cbrwizard/agentbrew) so any Claude Code /
Cursor / Devin / agentbrew-synced agent session can invoke the cross-repo
runner from any folder and automatically watch the loop from outside.

```bash
# One-time install (idempotent — re-run on every machine):
"$MINSKY_REPO/distribution/install-observer.sh"
agentbrew sync --agentfile "$MINSKY_REPO/Agentfile.yaml"

# Then, from any shell in any bootstrapped host:
minsky --daemon --hosts-dir <repos-parent>   # background daemon across all repos
minsky --local --daemon              # same, but local models only (zero tokens)
minsky status                        # PID + uptime + log tail
minsky logs                          # follow the daemon log live
minsky stop                          # SIGTERM → graceful drain
```

The plugin has four pieces:

| Piece | Path | Purpose |
|---|---|---|
| PATH shim | `bin/minsky` | Resolves the minsky repo; handles `--daemon` (background + PID file + log), `--local` (zero-cloud env), `status`/`stop`/`logs` subcommands; forwards to `minsky-run.mjs`. SIGHUP-immune. |
| Skill | `skill-plugins/observer/minsky/SKILL.md` | The observer protocol — Watch / Restart / Safe-heal / Swift-PR / Log. Triggered by phrases like "run minsky here" in any agent session. |
| Slash commands | `commands/minsky.md` + `commands/minsky-status.md` + `commands/minsky-stop.md` | `/minsky`, `/minsky-status`, `/minsky-stop` for Claude Code / Cursor / Devin. |
| Agentfile | `Agentfile.yaml` | Declares `skillSources: [{ label: minsky-observer, path: ./skill-plugins/observer }]` so `agentbrew sync` deploys the skill to every detected agent's `skillsDir`. |

The calling agent **watches the loop from outside** (Perrow 1984,
*Normal Accidents* — independent-monitor pattern), restarts on bounded
transient failures with error-budget discipline (Beyer et al. 2016,
*SRE* — retry budget), attempts a heal ONLY when the fix is in the
catalogued list + single-line + obvious, and — when the retry budget is
exhausted — swiftly opens a **draft** P0 PR in the correct upstream
repo (Minsky for runner bugs; the host for host-side bugs). Rate-limit
≤ 2 observer-filed PRs per hour per repo, rule-#9 substrate required in
every filed task block.

Failure-mode escalation gate: scope-leak / rule-#9 violation / segfault
are immediate escalate; stuck / crash / spawn-failed are bounded-retry
then escalate. See `skill-plugins/observer/minsky/SKILL.md` § 5 for the
full gate.

## Why this exists

Most agent stacks ([OMC](https://github.com/Yeachan-Heo/oh-my-claudecode), [CrewAI](https://github.com/joaomdmoura/crewAI), [MetaGPT](https://github.com/geekan/MetaGPT), Microsoft Agent Framework, Composio AO) optimise the **inner** loop — make one task ship faster. Minsky optimises the **outer** loop. Three concrete promises, each with a track-record of being broken in real-world deployments and each addressed by a specific design choice here:

1. **Stay alive** under process death, rate limits, network partitions, OS sleep, upstream drift. Approach: Erlang/OTP supervision (Armstrong 2007), let-it-crash discipline, no try/catch chains.
2. **Stay on budget.** Treat tokens as an SRE-style error budget (Beyer et al., *Site Reliability Engineering*, 2016, ch. 3) and pre-empt the rate limiter rather than getting throttled by it. The budget watchdog ships in [`@minsky/budget-guard`](./novel/budget-guard/).
3. **Stay on mission.** Runtime specification monitoring (Havelund & Goldberg, *VSTTE* 2008) reads `vision.md` plus recent work and reports drift. *Every* change is a pre-registered experiment with a declared hypothesis, success threshold, pivot threshold, and measurement command (Munafò et al., *Nature Human Behaviour*, 2017 — pre-registration; Ries 2011 — build-measure-learn).
4. **Get better.** A MAPE-K autonomic loop (Kephart & Chess, *IEEE Computer* 2003): observe persona-level metrics, identify the bottleneck (Goldratt, *The Goal*, 1984), A/B test prompt variants, roll out winners with a sustained-gain check.

The named patterns aren't decoration — they're the debuggability promise. When something breaks at 3am, *"this is supervision-tree pattern, restart strategy is one-for-one"* is a debuggable answer; *"this is how I happened to wire it"* is not.

## Status — Pre-alpha (`v0.0.0`, working toward [M1](./MILESTONES.md))

**What works today** (3,135 tests passing):

- ✅ Tick-loop daemon picks tasks from TASKS.md, spawns Claude Code / Devin / aider, opens PRs
- ✅ Budget guard monitors token usage (5h window + weekly), auto-pauses before limits
- ✅ Local-model fallback (aider + ollama) when cloud tokens exhausted
- ✅ Local merge gate (replaces GitHub Actions — deterministic, no CI cost)
- ✅ Orchestrator conducts parallel workers (Opus director + Sonnet workers)
- ✅ Observer plugin lets any agent session watch and heal the loop
- ✅ 180 test files, 12+ deterministic CI lints, Vitest coverage gate

**What's broken / in progress** (see [MILESTONES.md § M1](./MILESTONES.md)):

- 🔴 Stability is ~60-90% — commit hooks, token crashes, and GH auth divergence can break the daemon
- 🔴 All 10 METRICS.md entries are stubs — nothing is actually measured yet
- 🔴 Install requires 5+ manual steps — no one-command bootstrap
- 🔴 No competitive benchmarks — we don't know how minsky compares to Devin, OpenHands, or Aider
- 🔴 README (this file) is too long and makes claims that aren't verified

See [`MILESTONES.md`](./MILESTONES.md) for the full roadmap, per-milestone capability tables, and what minsky will never do.

## Quickstart

```bash
git clone https://github.com/fyodoriv/minsky.git
cd minsky
pnpm install   # the `prepare` hook builds @minsky/tick-loop's dist
pnpm minsky doctor   # verify health
```

`pnpm install` runs a `prepare` hook that does two things in sequence: (a) `tsc -b` builds every workspace package's `dist/` (the CLI's runtime artifacts) so `pnpm minsky` works on a fresh clone with no separate build step, and (b) `lefthook install` writes the pre-commit + pre-push gates into `.git/hooks/` so commits are linted locally before they reach CI. If `dist/` is somehow missing at runtime (e.g., `prepare` was skipped, or a stale `.tsbuildinfo` short-circuited the build), `pnpm minsky` exits 1 with a one-line message naming the recovery command — no node `ERR_MODULE_NOT_FOUND` stack traces.

For the full supervisor + dashboard install + dogfood-on-self loop, run `./setup.sh`:

```bash
./setup.sh
```

`./setup.sh` is idempotent and ends with a GREEN / YELLOW / RED self-test. Re-run any time. `./setup.sh --doctor` runs self-tests only; `./setup.sh --reset` rebuilds from scratch.

To start Minsky **on this repo** (Minsky-on-itself; rule #12 / `user-stories/001-loop-runs-overnight.md`):

```bash
pnpm dogfood          # one-command supervisor start (renders + loads launchd / systemd units)
pnpm dogfood:doctor   # read-only health probe
```

Then in [Claude Code](https://docs.claude.com/en/docs/claude-code) from this directory:

```text
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
/plugin install oh-my-claudecode
/plugin install ralph-wiggum
/next-task
```

`/next-task` is queue mode by default — it picks the highest-priority unblocked task from [`TASKS.md`](./TASKS.md), ships it as a PR, loops to the next, and stops only when the queue is empty across all `~/apps/*/TASKS.md` and the audit cascade is clean.

### Fresh-clone troubleshooting

`pnpm minsky` detects the four likeliest fresh-clone failures before importing any module, replacing cryptic `ERR_MODULE_NOT_FOUND` stack traces with one-line operator-actionable messages:

| Failure | Symptom | Recovery |
|---|---|---|
| `node_modules/` missing | `minsky: node_modules/ missing — run \`pnpm install\` from the repo root` | `pnpm install` |
| `dist/index.js` not built | `minsky: dist not built (…) — run \`pnpm install\` …` | `pnpm install` |
| `pnpm` not on PATH | `./setup.sh --doctor` exits RED: `pnpm missing` | `corepack enable` OR `brew install pnpm` OR `npm i -g pnpm` |
| Node major < 20 | `./setup.sh --doctor` exits RED: `node X.x.x is below the >=20 engine requirement` | `nvm install 20 && nvm use 20` or `brew install node@20` |

`pnpm minsky doctor` shows all four as substrate rows (plus the local-LLM stack). Any row RED → banner is RED and exits 1; fix the substrate before debugging the LLM stack.

## How it fits together

```text
┌─────────────────────────────────────────────────────────────────┐
│ IDENTITY     vision.md                                           │
│ INTELLIGENCE research.md, competitors/, user-stories/            │
│ CONTROL      mape-k-loop, spec-monitor, error budgets            │
│ COORDINATION tasks.md (queue), handoffs/ (blackboard)            │
│ OPERATIONS   OMC personas, MCP tools                             │
│ NERVOUS SYS  OpenTelemetry → dashboards (CLI / web / Watch)      │
└─────────────────────────────────────────────────────────────────┘
```

Stafford Beer's [Viable System Model](https://en.wikipedia.org/wiki/Viable_system_model) (Beer, *Brain of the Firm*, 1972). Lower layers are existing tools (OMC, tasks.md, OTEL, systemd / launchd). Upper layers are the small custom packages, each extracted as `@minsky/*` on npm from day one.

[`ARCHITECTURE.md`](./ARCHITECTURE.md) has the full wiring, the adapter pattern, the dependency table, and the supervision tree.

## Read first

| File | Purpose |
| --- | --- |
| [`MILESTONES.md`](./MILESTONES.md) | Product roadmap: 5 milestones (M1–M5), exit criteria, per-milestone capability tables, what minsky will never do |
| [`vision.md`](./vision.md) | Constitution: non-negotiable rules, glossary, pattern-conformance index, success criteria |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | All dependencies wired through interfaces; data flow; supervision tree |
| [`AGENTS.md`](./AGENTS.md) | How any agent (Claude Code, OMC, future tools) should behave when working in this repo |
| [`TASKS.md`](./TASKS.md) | Current work queue ([tasks.md](https://github.com/tasksmd/tasks.md) spec); 137 open tasks across P0–P3 |
| [`METRICS.md`](./METRICS.md) | Canonical observability surface — 10 metrics (currently stubs; M1 wires real observations) |
| [`research.md`](./research.md) | Living dependency scan; replacement candidates |
| [`competitors/`](./competitors/) | Gap analysis vs OMC, CrewAI, MetaGPT, MS Agent Framework, Composio AO — *plus Devin, OpenHands, SWE-agent, Aider, Cursor Agent, Codex CLI (M1 additions)* |
| [`user-stories/`](./user-stories/) | One file per story; metric, integration test, proof, failure modes |

Two governance disciplines are load-bearing: every Minsky-coined term resolves to a published source via the [Glossary](./vision.md#glossary--every-term-has-a-cs-anchor) (rule #5), and every artifact maps to a published pattern via the [Pattern conformance index](./vision.md#pattern-conformance-index) (rule #8). Both are enforced by deterministic CI lints per [rule #10](./vision.md#10-deterministic-enforcement--every-rule-is-a-ci-lint-not-a-hope) (in flight).

## The namesake

Marvin Minsky (1927–2016) was a co-founder of MIT's AI Lab and one of the field's foundational figures. *The Society of Mind* (1986) argues that what we experience as a single intelligence is actually a collection of many simple "agents" with limited individual capability, organised into societies that produce coherent behaviour. Minsky's later book *The Emotion Machine* (2006) extends the argument to include affect and self-reflection.

The connection to this project is intentional: a useful AI coding stack is many small specialists (the OMC personas, the MCP tools, the supervisor, the budget guard, the spec monitor) cooperating under a shared discipline — not one monolithic super-agent. The discipline is the constitution in [`vision.md`](./vision.md).

Further reading on Marvin Minsky:

- [Marvin Minsky on Wikipedia](https://en.wikipedia.org/wiki/Marvin_Minsky)
- [*The Society of Mind* (1986)](https://en.wikipedia.org/wiki/Society_of_Mind) — the idea this project is named after
- [*The Emotion Machine* (2006)](https://en.wikipedia.org/wiki/The_Emotion_Machine) — extends the argument
- [MIT Memoir on Marvin Minsky](https://news.mit.edu/2016/marvin-minsky-obituary-0125)

## Tech defaults

- **Node.js + TypeScript** for everything in `novel/` (publishes to npm under `@minsky/*`)
- **pnpm** workspaces · **Biome** lint + format · **Vitest** with 90 % line / 85 % branch coverage gate · **lefthook** for pre-commit
- **Strictest TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- **OpenTelemetry** everywhere — every novel package emits at least one span per public method (rule #4)
- **systemd / launchd** for process supervision; let-it-crash discipline (Armstrong 2007)
- **MIT** throughout; every novel layer extracted as its own MIT repo from day one

[vision.md § Theoretical foundations](./vision.md#theoretical-foundations) lists the literature each choice is grounded in.

## Contributing

This repo is open-source MIT, but the contribution model is *strict by design*. Every change goes through the [iron-rule discipline of rule #9](./vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes): you declare a hypothesis, a measurement command, success and pivot thresholds, and a literature anchor *before* you write the code. If that sounds heavy, it is — by design. The repo is for long-tail, measurable improvement of a system that runs for years; not for one-off fixes.

If you want to contribute and that fits, the entry path is `/next-task` against [`TASKS.md`](./TASKS.md). Open issues for discussion before substantive work.

## License

MIT. See [LICENSE](./LICENSE).

---

## Moved from README.md 2026-05-23

The sections below were relocated from the top-level `README.md` to shrink its top-of-funnel surface (per P0 `readme-rewrite-5-min-install-guide`, sub-task `readme-move-deep-content-to-detailed-md`). Content is unchanged; only the location moved. The README now links here for readers who need the depth.

### How it works

1. Reads `TASKS.md` from your host repo (the [tasks.md spec](https://github.com/tasksmd/tasks.md))
2. Picks the highest-priority task that's ready to work on
3. Spawns Devin, Claude, or a local AI model (configurable per machine)
4. The agent implements the task on a feature branch and runs your tests
5. Opens a draft pull request — with a self-graded report on whether the change moved the metric it predicted
6. Records the iteration in `.minsky/experiment-store/` (so the next run can learn from it)
7. Picks the next task. Repeats.

> **Host** = the git repo Minsky operates on. See [docs/configuration.md](configuration.md) for how to select it and how multi-host mode walks N repos in round-robin.

#### Architecture (30 seconds)

```text
minsky (bash CLI shim)
  ↓
cross-repo-runner (minsky-run.mjs) — walks hosts, picks tasks, spawns agents
  ↓
Devin / Claude / Aider — the actual AI agent (pluggable)
  ↓
.minsky/ sidecar — config, experiment store, iteration records
```

Six distinctive mechanisms:

- **Multi-layer team of workers** — per-task backend selection (`novel/tick-loop/src/llm-provider-spawn-strategy.ts`); multi-persona pipelines per task are an M2 milestone.
- **MAPE-K control loop** (Kephart & Chess 2003, IBM autonomic computing) — Monitor / Analyze / Plan / Execute over `.minsky/experiment-store/` knowledge.
- **Constitution = 18 rules, each enforced as a CI lint** — rules #1 (don't reinvent), #9 (hypothesis-driven), #12 (scope discipline), #17 (proactive healing) are the load-bearing ones. `pnpm pre-pr-lint --stage=full` runs 53 deterministic checks; CI runs 65 jobs.
- **Soft-by-default failure modes** — Erlang let-it-crash + launchd / systemd outer supervisor; an iteration that scope-leaks or spawn-fails doesn't halt the loop.
- **Dynamic watchdog** (p95 from history) — `novel/cross-repo-runner/src/dynamic-timeouts.ts` re-derives the watchdog timeout every iteration.
- **Self-improvement on itself** — the daemon refactors the daemon; most P0s in this repo's [TASKS.md](../TASKS.md) were surfaced by daemon iterations.

Deeper dive: [ARCHITECTURE.md](ARCHITECTURE.md), [vision.md § "Pattern conformance index"](../vision.md#pattern-conformance-index), [docs/PRACTICES.md](PRACTICES.md).

### Minsky's position in the landscape

Minsky is an **orchestrator**, not an agent. It sits ABOVE Claude / Devin / Aider — managing the daemon lifecycle, the MAPE-K loop, prompt evolution, the multi-repo task queue, supervisor restart discipline. The agents are its inputs. Its peers are other orchestrators (MetaGPT, AutoGen, CrewAI, LangGraph), not the agents it composes.

A Minsky operator picks an agent (Claude vs Devin vs Aider) AND gets the orchestrator layer. The scorecard at [novel/competitive-benchmark/README.md](../novel/competitive-benchmark/README.md) compares both axes: Minsky should beat other orchestrators on orchestrator metrics AND not regress vs the bare agent. For the moat view of the same substrate, see [vision.md § "What Minsky uniquely does"](../vision.md#what-minsky-uniquely-does-the-moat) and [`competitors/README.md`](../competitors/README.md).

Not the only Minsky on the internet — there's also a popular economic-modelling tool ([`highperformancecoder/minsky`](https://github.com/highperformancecoder/minsky), named after the *economist* Hyman Minsky) plus several other unrelated projects. Full disambiguation table + the prior-art lineage that informs this Minsky's architecture: [docs/prior-art-and-name-collisions.md](prior-art-and-name-collisions.md).

### Where to read next (full audience-segmented map)

Full map: **[docs/README.md](README.md)**. Pick by audience:

- **Newcomer** — [vision.md § "What Minsky is"](../vision.md#what-minsky-is) → [MILESTONES.md](../MILESTONES.md).
- **Installing on your repo** — [INSTALL.md](../INSTALL.md).
- **AI agent working on this codebase** — [AGENTS.md](../AGENTS.md) → [DEPRECATED.md](DEPRECATED.md) → [TASKS.md](../TASKS.md).
- **Operator running Minsky in production** — [docs/edge-cases.md](edge-cases.md), [docs/auto-merge.md](auto-merge.md), [docs/local-llm-fallback.md](local-llm-fallback.md).
- **Architecture deep-dive** — [ARCHITECTURE.md](ARCHITECTURE.md), [vision.md § "Pattern conformance index"](../vision.md#pattern-conformance-index), [docs/PRACTICES.md](PRACTICES.md).
- **Contributing** — [CONTRIBUTING.md](../CONTRIBUTING.md). Code in this repo is AI-authored.
