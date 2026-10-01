# User tests

This directory exists because MILESTONES.md criterion **M1.11** ("Honest README
in <5 min reading time") is a *qualitative UX claim* that only humans can
falsify: no auto-test can measure whether a developer who has never seen Minsky
can read the README and get from `git clone` to a first iteration in under five
minutes. This folder is where those human user-test runs are recorded, and
[`scripts/user-test-results.mjs`](../../scripts/user-test-results.mjs) turns the
recorded runs into the M1.11 pass/fail number.

## What M1.11 requires

Three developers who have never run Minsky each follow **only the README** from
`git clone` to first iteration. The criterion passes when:

- At least **3** developers complete the flow successfully.
- The **median** time-to-first-iteration is **≤ 5 minutes**.
- **Zero** developers needed operator clarification mid-flow (a developer who
  needed help is not counted as a success run).

Per the task `readme-honest-3-developer-user-test`, the pivot threshold is: if
even one developer takes >10 min, needs operator help, or cannot finish, the
README needs a *structural* fix (not a wording tweak), and the 2-of-3 bar
becomes the line below which M1.11 fails and the README is rewritten on the
friction-point findings.

Anchor: Nielsen 1993, *Usability Engineering* — five users uncover ~85% of
usability issues; three surface the most-likely blockers fast.

## How to run a user test

1. Recruit a developer who has never run Minsky — ideally at least one from
   outside the operator's direct network.
2. Give them the [README](../../README.md) link and nothing else. Do not coach.
3. Observe over screenshare or an async log. Start the clock at `git clone`.
4. Stop the clock at the first iteration record in `.minsky/orchestrate.jsonl`
   (or the first PR opened).
5. Capture the run in a new file `docs/user-tests/<YYYY-MM-DD>-<initials>.md`,
   copied from [`template.md`](./template.md). Fill in the metadata block and
   list every friction point.
6. File any friction point that cost more than five minutes as a P1 task
   against the README.

## How to read the result

The metric command (the task's `**Measurement**` field):

```bash
node scripts/user-test-results.mjs --window=30d --json \
  | jq '.successful_runs >= 3 and .median_time_minutes <= 5'
```

Returns `true` once three developers have succeeded with a median ≤ 5 minutes.
For a human-readable summary, drop the `--json`:

```bash
node scripts/user-test-results.mjs --window=30d
```

The aggregator reads every `*.md` file in this directory except `README.md`
and `template.md`, parses each one's metadata block, and reports:

- `total_runs`, `successful_runs`, `failed_runs`, `blocked_runs`
- `median_time_minutes` (over success runs only; `null` when there are none)
- `m1_11_pass` — `true` iff ≥3 success runs AND median ≤ 5 min

The script always exits 0 — it is a measurement reporter, not a build gate. A
not-yet-passing user test keeps M1.11 honestly `🟡 partial` rather than
breaking CI.

## Report file format

Each report is a markdown file whose metadata block is a bullet list of
`**Field**: value` lines (the same shape TASKS.md uses), so the aggregator can
parse it deterministically:

- **Developer**: initials, for run identity
- **Date**: ISO `YYYY-MM-DD`
- **Time to first iteration (minutes)**: a non-negative number
- **Outcome**: one of `success` / `fail` / `blocked`
- **Needed operator help**: `yes` / `no`

A half-filled report is skipped with a warning rather than silently skewing the
median — see the paired tests in
[`scripts/user-test-results.test.mjs`](../../scripts/user-test-results.test.mjs).
