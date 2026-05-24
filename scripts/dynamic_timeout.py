#!/usr/bin/env python3
"""scripts/dynamic_timeout.py — Phase 7 dynamic spawn watchdog (port of dynamic-timeouts.ts).

Reads the host's recent iteration history from
`<host>/.minsky/experiment-store/cross-repo/*.jsonl` and prints the
recommended spawn timeout in WHOLE SECONDS to stdout (the unit GNU
`timeout(1)` expects).

Algorithm (mirrors `computeDynamicSettings` in dynamic-timeouts.ts):

1. Read every `*.jsonl` under the host's experiment-store.
2. Extract `(durationMs, verdict)` pairs by JSON-parsing each line and
   regex-extracting `(\\d+)ms` from the `notes` field.
3. Filter to "completed work" — verdict in {validated, scope-leak} AND
   duration > 10s (sub-10s spawn-failed are config errors, ≥10s are
   prior watchdog kills; exclude both).
4. If <5 samples: print the conservative default (1200 = 20 minutes).
5. Else: p95(durations) × 1.5, clamped to [120s, 2700s] (2min–45min).

CLI:
    python3 scripts/dynamic_timeout.py <host-dir>

Exit codes:
    0  always (prints a number even when the input is empty/missing)

Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
Anchor:   rule #1 (port the TS algorithm 1:1; don't reinvent); rule #4
          (everything measurable — the timeout IS measured from real data,
          not guessed). Astrom & Wittenmark 1997 (adaptive threshold).
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Iterable

# --- Constants (must match dynamic-timeouts.ts) --------------------------

MIN_WATCHDOG_S = 120              # 2 min — never lower
MAX_WATCHDOG_S = 45 * 60          # 45 min — never higher
DEFAULT_WATCHDOG_S = 20 * 60      # 20 min — used when <5 samples
HEADROOM = 1.5                    # p95 × 1.5
MIN_SAMPLE_SIZE = 5
SUCCESS_VERDICTS = ("validated", "scope-leak")
MIN_SUCCESS_DURATION_MS = 10_000  # exclude sub-10s no-ops

# `notes` lines look like: "openhands exited 0; 142000ms" — we capture
# the milliseconds via the same regex the TS uses.
DURATION_RE = re.compile(r"(\d+)ms")


# --- Pure helpers --------------------------------------------------------


def percentile(sorted_values: list[int], p: float) -> int:
    """Compute percentile from an ascending-sorted list. Mirrors TS."""
    if not sorted_values:
        return 0
    idx = math.ceil(p * len(sorted_values)) - 1
    return sorted_values[max(0, min(idx, len(sorted_values) - 1))]


def parse_timings_from_jsonl(content: str) -> list[tuple[int, str]]:
    """Return list of (durationMs, verdict) from a JSONL content string.

    Parity contract: matches `parseTimingsFromJsonl` in dynamic-timeouts.ts.
    Skips lines that don't parse, lines without a duration in notes, and
    lines whose verdict isn't in {validated, scope-leak, spawn-failed}.
    """
    out: list[tuple[int, str]] = []
    for line in content.splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        verdict = obj.get("verdict")
        if verdict not in ("validated", "scope-leak", "spawn-failed"):
            continue
        notes = obj.get("notes") or ""
        m = DURATION_RE.search(notes)
        if m is None:
            continue
        out.append((int(m.group(1)), verdict))
    return out


def compute_watchdog_seconds(timings: Iterable[tuple[int, str]]) -> int:
    """Compute the watchdog timeout in seconds from iteration history.

    Parity contract: spawn timeout calculation matches `computeDynamicSettings`
    in dynamic-timeouts.ts. Returns whole seconds (GNU `timeout` unit).
    """
    successful_ms = sorted(
        dur for dur, verdict in timings
        if verdict in SUCCESS_VERDICTS and dur > MIN_SUCCESS_DURATION_MS
    )
    if len(successful_ms) < MIN_SAMPLE_SIZE:
        return DEFAULT_WATCHDOG_S
    p95_ms = percentile(successful_ms, 0.95)
    raw_s = int(round(p95_ms * HEADROOM / 1000))
    return max(MIN_WATCHDOG_S, min(MAX_WATCHDOG_S, raw_s))


def watchdog_seconds_for_host(host: Path) -> int:
    """Compute the watchdog for a host by reading its experiment-store JSONL."""
    store_dir = host / ".minsky" / "experiment-store" / "cross-repo"
    if not store_dir.is_dir():
        return DEFAULT_WATCHDOG_S
    timings: list[tuple[int, str]] = []
    for jsonl in sorted(store_dir.glob("*.jsonl")):
        try:
            timings.extend(parse_timings_from_jsonl(jsonl.read_text(encoding="utf-8")))
        except OSError:
            continue
    return compute_watchdog_seconds(timings)


# --- CLI -----------------------------------------------------------------


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: dynamic_timeout.py <host-dir>", file=sys.stderr)
        # Still emit the default so bash callers don't bork on bad argv.
        print(DEFAULT_WATCHDOG_S)
        return 0
    host = Path(argv[1])
    print(watchdog_seconds_for_host(host))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
