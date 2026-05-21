# Minsky

> A background daemon that runs AI coding agents on your repo's task queue — picks tasks, opens draft PRs, never merges without you.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml/badge.svg)](https://github.com/fyodoriv/minsky/actions/workflows/ci.yml)

**For indie hackers**: ship the boring tickets while you sleep — failing tests, lint, dependency bumps, docs drift. Wake up to draft PRs to review.

**For companies**: a self-hosted, audit-traceable autonomous coding loop with mechanically-enforced safety rules. You bring your own model keys. No vendor lock-in, no managed service.

Built on TDD, MAPE-K, hypothesis-driven development, let-it-crash supervision, and error budgets — each backed by a literature citation.

- **Continuous, unattended improvement** — picks the next task, ships a draft PR, never merges without you.
- **Issues surfaced as draft tasks** — a CTO-audit pass after each iteration proposes new tasks for your review.
- **Right model for each task** — Claude for prose, Devin for refactors, local Ollama for mechanical lint fixes.
- **Forced research at PR time** — every PR cites existing libraries it considered; the linter blocks reinvention.
- **A tool that improves itself** — reads its own metrics, opens tasks against its own stability, ships the fixes.
- **Keeps iterating when the cloud runs dry** — quota exceeded → local Ollama → loop continues until your tokens return.
- **Async Q&A across timezones** — agents write questions to a local file; you reply by editing it.

## Getting started

Through your AI agent — copy-paste:

> Install minsky for this folder per the runbook at <https://github.com/fyodoriv/minsky/blob/main/INSTALL.md>, then start it. Ask me only the consent question.

Manual:

```bash
git clone https://github.com/fyodoriv/minsky.git && cd minsky && pnpm install && ./bin/minsky
```

Minsky runs against your current repo by default. First run auto-installs persistence so it survives reboots.

## Why it's safe to use Minsky

Safety is mechanical, not aspirational. Every rule below is enforced by a CI lint that runs on every iteration; violations halt the iteration before any change reaches your repo.

- **No agent ever pushes to `main` or merges a PR** — every PR is a draft for your review. ([`scripts/check-rule-12-scope-discipline.mjs`](scripts/check-rule-12-scope-discipline.mjs))
- **Security-sensitive changes stay human-blocked** — auth, crypto, secrets, permissions never get auto-edited. ([`scripts/check-pr-security-review.mjs`](scripts/check-pr-security-review.mjs))
- **No destructive operations** — force pushes, branch deletes, deploys are blocked at the iteration boundary. ([`scripts/check-rule-12-scope-discipline.mjs`](scripts/check-rule-12-scope-discipline.mjs))
- **No personal data in published docs** — usernames, home directories, paths are caught at PR time. ([`scripts/check-no-personal-paths-in-docs.mjs`](scripts/check-no-personal-paths-in-docs.mjs), [`scripts/check-no-hardcoded-user-paths.mjs`](scripts/check-no-hardcoded-user-paths.mjs))
- **Don't reinvent existing tools** — every new module cites the prior art it rejected. ([`scripts/check-rule-1-novel-justification.mjs`](scripts/check-rule-1-novel-justification.mjs))
- **Every dependency behind an interface** — no tool name leaks into business logic; you can swap any dep without rewriting the loop. ([`scripts/check-rule-2-dep-coverage.mjs`](scripts/check-rule-2-dep-coverage.mjs))
- **Test-first, metric-first, doc-first** — no code lands without a paired test, a metric, and a docs update. ([`scripts/check-rule-3-doc-first.mjs`](scripts/check-rule-3-doc-first.mjs))
- **Everything observable** — every component emits OpenTelemetry; nothing happens silently. ([`scripts/check-rule-4-otel-coverage.mjs`](scripts/check-rule-4-otel-coverage.mjs))
- **Every term has a CS citation** — no invented terminology when literature has a word for it. ([`scripts/check-rule-5-glossary-discipline.mjs`](scripts/check-rule-5-glossary-discipline.mjs))
- **Let-it-crash supervision** — failures are caught at the supervisor boundary, not swallowed mid-iteration. ([`scripts/check-rule-6-let-it-crash.mjs`](scripts/check-rule-6-let-it-crash.mjs))
- **Chaos engineering per module** — every package ships a deterministic chaos test that proves a failure mode is contained. ([`scripts/check-rule-7-chaos-coverage.mjs`](scripts/check-rule-7-chaos-coverage.mjs))
- **Pre-registered hypothesis** — every change ships with a falsifiable success metric and a pivot threshold. No vanity metrics. ([`scripts/check-rule-9-tasksmd-fields.mjs`](scripts/check-rule-9-tasksmd-fields.mjs))
- **Proactive healing** — every observed error must be fixed in the same session that observed it. ([`scripts/check-rule-17-proactive-heal.mjs`](scripts/check-rule-17-proactive-heal.mjs))
- **No secrets in logs or commits** — pre-commit secret scan + OpenTelemetry PII filter. ([`scripts/scan-secrets.mjs`](scripts/scan-secrets.mjs), [`scripts/check-otel-no-pii.mjs`](scripts/check-otel-no-pii.mjs))

Full constitution: [`vision.md`](vision.md).

## Architecture

A bash CLI shim → a task walker that picks the next priority item → a pluggable AI agent (Claude, Devin, or a local Ollama model) → a sidecar (`.minsky/`) recording each iteration → a draft PR for you to review. Built on MAPE-K (Kephart & Chess 2003), let-it-crash supervision (Armstrong 2007), and the Viable System Model (Beer 1972).

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full breakdown.

## What works today

Stability target: 90% over 10h unattended runs. Today it's lower — improving via the roadmap in [`MILESTONES.md`](MILESTONES.md). The daemon picks tasks and opens draft PRs reliably; multi-repo walking, the live dashboard (`minsky watch`), the dynamic per-machine watchdog, and auto-survive-reboots all work. Switching between Claude / Devin / local Ollama works but Devin is experimental. Async file-based Q&A, `npx minsky` one-command install, multi-file refactors with a CI gate, and GitHub Actions integration are coming.

About the name: Marvin Minsky (1927–2016), *The Society of Mind* (1986) — intelligence emerges from many simple specialised agents working together.

## License

MIT. See [LICENSE](LICENSE).
