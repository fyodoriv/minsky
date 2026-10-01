<!-- The pr-vision-trace CI gate parses this file's structure — keep the
section headers and bullet shapes intact. -->

## Why needed

<one-paragraph explanation of motivation>

## What changed

<bullet list of substantive deltas, grouped by file area>

## Vision trace

- **Vision goal**: <e.g. "Rule 9 — pre-registered HDD" (vision.md § 9), milestone id from MILESTONES.md, or `N/A — <reason ≥3 chars>`>
- **User story**: <e.g. "user-stories/001-loop-runs-overnight.md" or `N/A — <reason ≥3 chars>`>
- **Competitor prior art**: <e.g. "OpenHands ships X (competitors/openhands.md:21); we delegate via Y" or `N/A — <reason ≥3 chars>`>

<!--
  Opt-out for non-substantive auto-commits:
  <!-- vision-trace: not-applicable — <reason ≥3 chars> -->
-->

## Security & privacy

<one or more lines describing threat surface + mitigation, or
 `no new attack surface; vision.md § 13 minimum-bar items reviewed`>

## Hypothesis self-grade

- **Predicted**: <re-state the hypothesis from the EXPERIMENT.yaml or task description>
- **Observed**: <the actual measurement output>
- **Match**: yes | no | partial
- **Lesson**: <one-sentence takeaway>

## How to test manually

```bash
<commands a reviewer can run locally>
```

## Rollback

```bash
git revert <merge-commit>
```

<one line on revert safety>
