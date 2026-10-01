---
name: experiment-validate
description: Run the three rule-#9 lints (anchor-primary-source, measurement-inspects-output, pivot-success-margin) plus the experiment-runner gate against an `experiments/<id>.yaml` file. Use after authoring or editing a pre-registration record. Replaces typing the four `node scripts/check-*.mjs` commands inline.
allowed-tools: Bash, Read
---

# Experiment-validate

Validate a rule-#9 pre-registration record (`experiments/<id>.yaml`) end-to-end before opening the PR. Replaces the four-command inline ritual that's been typed dozens of times.

## Args

The skill takes one optional argument: the path to the experiment yaml.

- `/experiment-validate experiments/my-fix-2026-05-04.yaml` — validate that file.
- `/experiment-validate` (no arg) — validate every `experiments/*.yaml` (the directory-walker default each lint already supports).

## What it runs

```bash
node scripts/check-anchor-primary-source.mjs       experiments/<id>.yaml
node scripts/check-measurement-inspects-output.mjs experiments/<id>.yaml
node scripts/check-pivot-success-margin.mjs        experiments/<id>.yaml
node scripts/run-experiment.mjs gate --record      experiments/<id>.yaml
```

Each lint exits 0 on pass, non-zero on violation. The runner gate exits 0 when the measurement command is runnable + produces a number.

## Reading the output

- **anchor-primary-source ok**: anchor cites a published primary source (italicised title or `Ch. <n>` etc.) — rule #5.
- **measurement-inspects-output ok**: measurement command pipes through an inspector (`assert`, `vitest`, `pnpm test`, `jq`, `grep -q`, etc.) — not a degenerate `echo done`.
- **pivot-success-margin ok**: success and pivot thresholds have ≥1% numeric Δ — not vanity-equal.
- **ci-experiment-runner gate ok**: measurement command actually runs within `timeout_seconds` and produces an exit code.

If any lint fails, the violation message tells you exactly what to fix. Common patterns:

- `degenerate / non-inspecting token(s) present and no inspector token` → measurement is `echo PASS` or similar; route through `assert` / `vitest` / a `node scripts/check-*.mjs` invocation.
- `success/pivot margin too tight (numeric Δ < 1%)` → success and pivot are `0.85` / `0.84` (vanity); pick a meaningful threshold gap.
- `gate measurement is not runnable (exit N)` → the command in `measurement:` actually ran and failed; reproduce locally and fix.

## Why all four matter

Rule #9 says every change carries a falsifiable hypothesis with a runnable measurement. The three lints catch *static* failure modes (no anchor, vanity threshold, non-inspector measurement). The runner gate catches the *dynamic* one — a measurement that doesn't actually run. All four together close the rule-#9 loop deterministically; running only some of them lets a broken record slip through.

## When NOT to use this

- The PR is purely doc / formatting and `experiments/` is unchanged → skip; rule-#9 isn't triggered.
- You're authoring a NEW experiment file and haven't filled all five required fields yet → finish the file first; the lints assume the schema is complete.
- The PR's `pivot-success-margin` advisory output is `only one of {success, pivot} has a leading numeric token` — that's an advisory, not a fail; ship.
