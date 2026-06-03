# Recurring loops

<!-- pattern: not-applicable — index doc cataloguing cadence-driven loops; each loop's pattern + literature source lives in its own entry (and its experiments/*.yaml), so no separate vision.md Pattern conformance index row is warranted -->

This file exists to document Minsky's recurring, cadence-driven loops — the
self-checks that run on a schedule rather than only when the operator initiates
them. Continuous verification beats operator-initiated-only runs: a regression
the cadence catches on its weekly pass is caught before a user hits it (Beyer et
al., *Site Reliability Engineering*, 2016, Ch. 27 — dogfooding as the pre-user
canary). Each entry below names its cadence, the artefact that drives it, and
the ledger it writes so the loop's history is auditable.

## observer-dogfood

- **Cadence**: weekly (Saturday 09:00 UTC).
- **Driver**: [`.github/workflows/observer-dogfood.yml`](.github/workflows/observer-dogfood.yml)
  invokes [`scripts/observer-dogfood-runner.mjs`](scripts/observer-dogfood-runner.mjs).
- **What it does**: runs the observer dogfood — `minsky run --once --no-live
  --host .` against minsky's own checkout — parses the cross-repo iteration
  records the run wrote, counts findings, and appends one ledger line to
  `data/observer-dogfood-log.jsonl`. When the finding count is `> 0`, the
  workflow opens a draft PR so the operator triages the signal. The runner does
  NOT reimplement the health-check / restart watch loop (`minsky watch`); it
  runs a single bounded iteration and reads the same record shape (rule #1 —
  don't reinvent).
- **Protocol**: the observer protocol the dogfood follows is documented in
  [`skill-plugins/observer/minsky/SKILL.md`](skill-plugins/observer/minsky/SKILL.md).
- **Pre-registration**: [`experiments/observer-dogfood-recurring-2026-06-02.yaml`](experiments/observer-dogfood-recurring-2026-06-02.yaml)
  (rule #9 — hypothesis, success, pivot, measurement, anchor).

### `data/observer-dogfood-log.jsonl` schema

One JSON object per line, appended once per cadence run:

```json
{ "run": "2026-06-02T09:00:00Z", "findings_count": 0, "new_tasks_filed": 0, "records_read": 0 }
```

| Field             | Type   | Meaning                                                       |
| ----------------- | ------ | ------------------------------------------------------------ |
| `run`             | string | ISO-8601 timestamp the cadence fired.                        |
| `findings_count`  | number | Records whose verdict is a finding (scope-leak / spawn-failed / crash / stuck / rule-9-violation). |
| `new_tasks_filed` | number | Records carrying a non-null `pr_url` — findings already acted on. |
| `records_read`    | number | Total cross-repo iteration records the run parsed (optional). |

A finding is a verdict from the observer SKILL's signal-classification table
that the observer would act on; `validated` and `empty-queue` are healthy and
are not findings. The finding-verdict set is the single source of truth in
`scripts/observer-dogfood-runner.mjs` (`FINDING_VERDICTS`) and is pinned by the
paired test.
