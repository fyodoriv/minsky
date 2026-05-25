#!/usr/bin/env python3
"""scripts/transform_recommend.py — the Plan phase of MAPE-K.

Reads `.minsky/transform-runs.jsonl` (the Monitor surface from PR #824)
via `transform_trend.compute_trend` (the Analyse phase from PR #825),
applies rule-based pattern detection to the trajectories, and emits
TASKS.md-ready markdown blocks recommending interventions.

Cautious by default — the operator reviews + pastes. No automatic
TASKS.md edit until the patterns stabilize against real ledger data
(rule #6 — let-the-operator-decide on irreversible writes).

Detected patterns (initial set, each opt-in via a separate emit):

1. **test-coverage-gap** — LOC grew by ≥10 across the last 3 sessions
   while test count grew by 0. Files a P2 task block recommending
   "add tests for recently-added code".

2. **lint-regression** — lint exit was 0 in the oldest of the last 3
   sessions and non-zero in the most recent. Files a P1 task block
   recommending "investigate + fix lint regression".

3. **dependency-rot** — outdated-count grew by ≥3 across the window
   (when the value is an int — pnpm reports this; non-numeric
   fallbacks are ignored). Files a P3 task block recommending
   "audit + update dependencies".

CLI:
    python3 scripts/transform_recommend.py [--repo <path>]
        [--ledger <path>] [--window N] [--json]

    --repo:    repo root (default: $PWD)
    --ledger:  ledger path (default: <repo>/.minsky/transform-runs.jsonl)
    --window:  trailing N sessions to analyze (default: 3)
    --json:    emit structured JSON instead of markdown

Exit codes:
    0   ran successfully (with or without recommendations)
    1   ledger file not found
    2   bad CLI args
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import transform_trend as tt  # noqa: E402

DEFAULT_WINDOW = 3
LOC_GROWTH_THRESHOLD = 10
OUTDATED_GROWTH_THRESHOLD = 3


def _last_n_loc(trend: dict[str, Any]) -> int:
    """Sum of LOC deltas over the trend's loaded window."""
    return sum(v for v in trend["loc_delta_per_session"] if isinstance(v, int))


def _last_n_tests(trend: dict[str, Any]) -> int:
    """Sum of test-count deltas over the trend's loaded window."""
    return sum(v for v in trend["tests_delta_per_session"] if isinstance(v, int))


def detect_test_coverage_gap(trend: dict[str, Any]) -> dict[str, Any] | None:
    """Detect: LOC grew ≥LOC_GROWTH_THRESHOLD AND tests grew by 0.

    Returns a recommendation dict on match, None otherwise.
    """
    if trend["session_count"] < 2:
        return None
    loc_total = _last_n_loc(trend)
    tests_total = _last_n_tests(trend)
    if loc_total < LOC_GROWTH_THRESHOLD or tests_total > 0:
        return None
    return {
        "id": "test-coverage-gap",
        "priority": "P2",
        "title": "add tests for recently-added code",
        "evidence": {
            "loc_grew": loc_total,
            "tests_added": tests_total,
            "sessions": trend["session_count"],
        },
        "rationale": (
            f"LOC grew by +{loc_total} across the last {trend['session_count']} "
            f"session{'s' if trend['session_count'] != 1 else ''} while test count "
            f"grew by {tests_total}. Without paired test coverage, the new code is "
            "untested in the operator's CI gates."
        ),
    }


def detect_lint_regression(trend: dict[str, Any]) -> dict[str, Any] | None:
    """Detect: lint was passing (exit 0) and is now failing (non-zero)."""
    history = [v for v in trend["lint_after_history"] if v is not None]
    if len(history) < 2:
        return None
    # Oldest non-None vs most-recent non-None.
    if history[0] == 0 and history[-1] != 0:
        return {
            "id": "lint-regression",
            "priority": "P1",
            "title": "investigate + fix lint regression",
            "evidence": {
                "oldest_lint_exit": history[0],
                "newest_lint_exit": history[-1],
                "sessions": trend["session_count"],
            },
            "rationale": (
                f"Lint was passing (exit 0) in the oldest of the last "
                f"{trend['session_count']} sessions and is failing (exit "
                f"{history[-1]}) in the most recent. Lint regressions are P1 — "
                "they compound across subsequent sessions."
            ),
        }
    return None


def detect_dependency_rot(trend: dict[str, Any]) -> dict[str, Any] | None:
    """Detect: outdated-count grew by ≥OUTDATED_GROWTH_THRESHOLD.

    Only fires when the outdated values are numeric (pnpm reports
    ints; other package managers may emit strings or null). Non-
    numeric values are silently ignored.
    """
    history = [v for v in trend["outdated_after_history"] if isinstance(v, int)]
    if len(history) < 2:
        return None
    growth = history[-1] - history[0]
    if growth < OUTDATED_GROWTH_THRESHOLD:
        return None
    return {
        "id": "dependency-rot",
        "priority": "P3",
        "title": "audit + update dependencies",
        "evidence": {
            "oldest_outdated": history[0],
            "newest_outdated": history[-1],
            "growth": growth,
            "sessions": trend["session_count"],
        },
        "rationale": (
            f"Outdated dependency count grew from {history[0]} to {history[-1]} "
            f"(+{growth}) across the last {trend['session_count']} sessions. "
            "Compounded dependency drift gets harder to update the longer it's "
            "deferred (Spolsky's 'big-bang upgrade')."
        ),
    }


DETECTORS = (
    detect_test_coverage_gap,
    detect_lint_regression,
    detect_dependency_rot,
)


def recommend(trend: dict[str, Any]) -> list[dict[str, Any]]:
    """Run all detectors over the trend; return non-None recommendations."""
    out: list[dict[str, Any]] = []
    for detector in DETECTORS:
        result = detector(trend)
        if result is not None:
            out.append(result)
    return out


def render_markdown(recs: list[dict[str, Any]]) -> str:
    """Render recommendations as TASKS.md-ready blocks.

    Operator copy-pastes the block under the matching priority
    section. Each block includes the required Tags / Details /
    Acceptance fields so a downstream agent picking the task has
    enough context to start.
    """
    if not recs:
        return "transform-recommend: no patterns detected — keep iterating\n"
    lines: list[str] = []
    lines.append(f"transform-recommend: {len(recs)} pattern(s) detected\n")
    for r in recs:
        lines.append(f"## {r['priority']} (suggested)\n")
        lines.append(f"- [ ] `{r['id']}` — {r['title']}")
        lines.append(f"  - **ID**: {r['id']}")
        lines.append(f"  - **Tags**: {r['priority'].lower()}, suggested-by-transform-recommend")
        lines.append(f"  - **Details**: {r['rationale']}")
        lines.append(f"  - **Evidence**: {json.dumps(r['evidence'], sort_keys=True)}")
        lines.append(
            "  - **Acceptance**: operator reviews the rationale + evidence, then either "
            "accepts (moves to active priority) or marks **Blocked**: not-needed with reason."
        )
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    repo = Path(os.environ.get("PWD") or ".")
    ledger_path: Path | None = None
    window: int = DEFAULT_WINDOW
    emit_json = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--repo" and i + 1 < len(argv):
            repo = Path(argv[i + 1])
            i += 2
        elif a == "--ledger" and i + 1 < len(argv):
            ledger_path = Path(argv[i + 1])
            i += 2
        elif a == "--window" and i + 1 < len(argv):
            try:
                window = int(argv[i + 1])
            except ValueError:
                print(f"--window requires an int, got {argv[i + 1]!r}", file=sys.stderr)
                return 2
            i += 2
        elif a == "--json":
            emit_json = True
            i += 1
        elif a in ("--help", "-h"):
            print(__doc__)
            return 0
        else:
            print(f"unknown flag: {a}", file=sys.stderr)
            return 2
    if ledger_path is None:
        ledger_path = repo / ".minsky" / "transform-runs.jsonl"
    if not ledger_path.exists():
        print(f"ledger not found: {ledger_path}", file=sys.stderr)
        print(
            "  run `minsky --transform` to record a session first.",
            file=sys.stderr,
        )
        return 1
    records = tt.load_ledger(ledger_path, window=window)
    trend = tt.compute_trend(records)
    recs = recommend(trend)
    if emit_json:
        print(
            json.dumps(
                {"recommendations": recs, "trend_summary": {"session_count": trend["session_count"]}},
                indent=2,
            )
        )
    else:
        print(render_markdown(recs), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
