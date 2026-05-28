<!-- milestone: M1.11 -->

# 019 — Honest README in <5 min reading time

> A new developer reads `README.md` cold and in under 5 minutes knows: what Minsky is, how to install in one command, how to run, the safety story, and where M1 is.

## Who, what, when, why

**Who**: a developer landing on the GitHub repo for the first time — no prior context, no operator hand-holding, no Slack thread to bootstrap from.

**What**: `README.md` is structured so the first read produces five concrete takeaways:

- **What** — one-line tagline plus a 3-bullet "what minsky is / what minsky is not" frame.
- **Install** — exactly one command an operator can copy-paste (`pnpm minsky:setup`).
- **Run** — exactly one command to start the daemon (`pnpm minsky` / `bin/minsky run`).
- **Safety story** — link to `docs/safety-budget.md` + the rule-#7 chaos table + the rule-#6 fail-loud invariant.
- **M1 progress** — link to `MILESTONES.md` (which has the live `pnpm milestone:check` table) so a reader can see "where we are" without crawling the issue tracker.

**When**: every commit. The README is the project's permanent top-of-funnel; it must hold its shape continuously.

**Why**: M1.11 closes the "outsider can understand minsky in 5 minutes" criterion. Without this, no one onboards — adoption tail dies before it starts. The 5-min ceiling is the operator-machine equivalent of a startup's "60-second elevator pitch" gate.

## Acceptance criteria

1. `README.md` opens with the H1 + tagline blockquote shape (`# Minsky` then `> …`) — the lightweight reader-orientation frame the README has today. Full reader-orientation frame (`## What this is` / `## What this is not`) is a separate P3 follow-up (`docs-frame-coherence-lint`); this story pins the tagline only.
2. README documents at least one canonical install path: `npx -y minsky init` (the RC path), `pnpm install` (manual clone), `pnpm minsky:setup`, or `bin/minsky setup`.
3. README documents at least one canonical run path: `minsky`, `bin/minsky`, or `minsky daemon start`.
4. README links to `MILESTONES.md` so the M1-progress takeaway is one click away.
5. Byte budget: `README.md` ≤11500 bytes (hard limit enforced by `scripts/check-readme-byte-budget.mjs`); target is ≤3072 bytes — the rewrite slices from PRs #751/#752/#753 set the target.
6. A 3-developer user test (per M1.11's spec): three developers who have never seen Minsky read the README and afterwards can each name the 5 takeaways above; reading time p95 ≤5 minutes. Verification recorded as a `Status:` field on this story until the test runs.

## Metric

- **Name**: `readme-byte-budget-bytes`
- **Definition**: `wc -c README.md` (raw byte count).
- **Threshold**: ≤11500 bytes hard, ≤3072 bytes target.
- **Source**: `scripts/check-readme-byte-budget.mjs` (already shipped, wired into `pnpm pre-pr-lint --stage=fast`).
- **Rationale**: byte budget is the simplest measurable proxy for reading time. The 3-developer user test (criterion 7) is the load-bearing acceptance check; this metric is the every-commit CI gate that catches drift between user tests.

## Integration test

- **File**: `user-stories/019-honest-readme.test.ts` (this PR).
- **Setup**: read `README.md` from disk.
- **Action**: assert structural invariants (tagline shape, frame headings, install/run command presence, safety-story link, MILESTONES.md link, byte budget).
- **Assert**: each criterion above corresponds to a substrate-level test that fails loud if the README drifts from the M1.11 shape.

## Status

- **3-developer user test**: pending — the byte-budget gate is the every-commit proxy; the load-bearing user test fires when M1.11 ships the recruitment + observation flow (separate task `readme-honest-3-developer-user-test`).

## Failure modes

- README regrows past 11500 bytes silently (check-readme-byte-budget catches at PR time).
- A new section is added without the reader-orientation frame (`docs-frame-coherence-lint` follow-up will catch — P3 task filed).
- Install/run commands drift (e.g. `pnpm setup` becomes `pnpm minsky:doctor`) without README updating; the substrate test below pins the canonical commands.

## Out of scope

- Recording reading time across 3 developers (separate task `readme-honest-3-developer-user-test` — operator-gated, not auto-detectable).
- Refining the README's prose beyond the structural invariants (those are content decisions; this story pins SHAPE only).

## Pivot

If the byte budget proves too brittle (legitimate clarity additions push past 11500), drop to a soft warning + `Status: pending-3-developer-user-test` field — don't fake the metric to fit the gate. The load-bearing acceptance is the user test, not the byte count.

## Anchor

- M1.11 in `MILESTONES.md` ("Honest README in <5 min reading time").
- `docs/PRACTICES.md § Unified reader-orientation doc frame` (the structural pattern this story conforms to).
- `scripts/check-readme-byte-budget.mjs` (the every-commit gate).
- `readme-honest-3-developer-user-test` task (the operator-gated user test that completes M1.11).
- Krug 2014, *Don't Make Me Think* (the "5 second test" pattern adapted to a 5-minute reading window).
