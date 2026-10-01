<!-- milestone: M1.11 -->

# 019 — Honest README in under 5 minutes of reading

> A developer who has never heard of Minsky reads `README.md` cold and, in under five minutes, knows what Minsky is, how to install it in one command, how to run it, what keeps it safe, and where the M1 milestone stands.

## Story

As a developer who just landed on the GitHub page, I open `README.md` with no prior context — no one walking me through it, no chat thread to catch me up. I read it once. By the end I can name five things:

- **What it is** — a one-line tagline, plus a short "what Minsky is / what Minsky is not" frame.
- **How to install** — exactly one command I can copy and paste.
- **How to run** — exactly one command that starts the daemon (the background program that keeps running and does the work).
- **Why it is safe** — a link to `docs/safety-budget.md`, the rule-#7 chaos table, and the rule-#6 fail-loud guarantee.
- **Where M1 stands** — a link to `MILESTONES.md`, which holds the live `pnpm milestone:check` table, so I never have to crawl the issue tracker to learn "where are we".

This matters because the README is the project's permanent front door. If an outsider cannot understand Minsky in five minutes, no one onboards, and adoption dies before it starts. Five minutes is the operator-machine version of a startup's 60-second elevator pitch — the gate every newcomer passes through.

Here, **operator** means the human who runs Minsky — you. The README must hold this shape on every commit, because the front door is never "done".

## Acceptance criteria

1. `README.md` opens with the H1-plus-tagline shape: `# Minsky` then a `> …` blockquote. This is the lightweight reader-orientation frame the README has today. The fuller frame (`## What this is` / `## What this is not`) is a separate P3 follow-up, `docs-frame-coherence-lint`; this story pins only the tagline.
2. README documents at least one canonical install command: `npx -y minsky init` (the release-candidate path), `pnpm install` (manual clone), `pnpm minsky:setup`, or `bin/minsky setup`.
3. README documents at least one canonical run command: `minsky`, `bin/minsky`, or `minsky daemon start`.
4. README links to `MILESTONES.md`, so the M1-progress takeaway is one click away.
5. Byte budget: `README.md` ≤ 11500 bytes (hard limit, enforced by `scripts/check-readme-byte-budget.mjs`); the target is ≤ 3072 bytes. The rewrite slices from PRs #751, #752, and #753 set that target.
6. A 3-developer user test (per M1.11's spec): three developers who have never seen Minsky read the README, then each name the five takeaways above; reading time at the 95th percentile is ≤ 5 minutes. Until that test runs, its result is recorded in the `Status` section below.

## Metric

- **Name**: `readme-byte-budget-bytes`
- **Definition**: `wc -c README.md` (raw byte count).
- **Threshold**: ≤ 11500 bytes hard, ≤ 3072 bytes target.
- **Source**: `scripts/check-readme-byte-budget.mjs` (already shipped, wired into `pnpm pre-pr-lint --stage=fast`).
- **Rationale**: byte count is the simplest measurable proxy for reading time. The 3-developer user test (criterion 6) is the load-bearing acceptance check; this metric is the every-commit gate that catches drift between those tests.

## Integration test

- **File**: `user-stories/019-honest-readme.test.ts` (this PR).
- **Setup**: read `README.md` from disk.
- **Action**: assert the structural invariants — tagline shape, frame headings, presence of an install command, presence of a run command, the safety link, the `MILESTONES.md` link, and the byte budget.
- **Assert**: each acceptance criterion maps to a test that fails loudly if the README drifts from the M1.11 shape.

## Proof

The every-commit gate is `scripts/check-readme-byte-budget.mjs`, run inside `pnpm pre-pr-lint --stage=fast`. The structural test is `user-stories/019-honest-readme.test.ts`. Together they pin the shape on every PR; the 3-developer user test confirms the human-facing claim once M1.11 ships its recruitment flow.

## Status

- **3-developer user test**: pending. The byte-budget gate is the every-commit proxy. The load-bearing user test fires when M1.11 ships the recruit-and-observe flow, tracked under the separate task `readme-honest-3-developer-user-test`.

## Failure modes

- The README quietly regrows past 11500 bytes. Caught at PR time by `check-readme-byte-budget`.
- A new section lands without the reader-orientation frame. The `docs-frame-coherence-lint` follow-up will catch this (P3 task filed).
- Install or run commands drift — for example `pnpm setup` becomes `pnpm minsky:doctor` — without the README updating. The structural test pins the canonical commands.

## Pivot

If the byte budget proves too brittle — legitimate clarity additions push past 11500 — drop to a soft warning plus a `Status: pending-3-developer-user-test` field. Do not fake the metric to fit the gate. The load-bearing acceptance is the user test, not the byte count.

## Out of scope

- Recording reading time across three developers (the separate task `readme-honest-3-developer-user-test` — operator-gated, not auto-detectable).
- Refining the README's prose beyond the structural invariants. Those are content decisions; this story pins shape only.

## Anchor

- M1.11 in `MILESTONES.md` ("Honest README in <5 min reading time").
- `docs/PRACTICES.md § Unified reader-orientation doc frame` (the structural pattern this story conforms to).
- `scripts/check-readme-byte-budget.mjs` (the every-commit gate).
- `readme-honest-3-developer-user-test` task (the operator-gated user test that completes M1.11).
- Krug 2014, *Don't Make Me Think* (the "5 second test", adapted here to a 5-minute reading window).
