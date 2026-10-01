#!/usr/bin/env python3
"""scripts/transform_trend.py — read `.minsky/transform-runs.jsonl` ledger
and emit trend analysis across N sessions.

The MAPE-K Analyse phase consumer of the Monitor surface shipped in
PR #824. Per-host JSONL ledger accumulates one record per
`minsky --transform` session; this script reads them, computes
trajectories for each measurable dimension, and emits either a
human-readable trend summary (default) or structured JSON
(`--json`) for downstream consumers (dashboards, alerting rules).

Pure standard-library — no pandas / numpy / matplotlib dependency
(rule #1, don't reinvent → but also don't add a 200MB scientific-
computing dep for what is fundamentally counting and comparing
integers).

CLI:
    python3 scripts/transform_trend.py [--repo <path>]
        [--ledger <path>] [--window N] [--json]

    --repo:    repo root (default: $PWD)
    --ledger:  ledger path (default: <repo>/.minsky/transform-runs.jsonl)
    --window:  last N sessions only (default: all)
    --json:    emit structured JSON on stdout

Exit codes:
    0   trend rendered (any number of sessions ≥ 0)
    1   ledger file not found
    2   bad CLI args
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


def load_ledger(path: Path, window: int | None = None) -> list[dict[str, Any]]:
    """Read the JSONL ledger as a list of records (newest last).

    Records that fail to parse as JSON are silently skipped — the
    ledger is append-only, and partial records from a crashed write
    shouldn't kill trend analysis (rule #6 graceful degrade).
    """
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if window is not None and window > 0:
        records = records[-window:]
    return records


def _safe_get(record: dict[str, Any], *keys: str) -> Any:
    """Dotted-path getter that returns None on any missing key."""
    cur: Any = record
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


def compute_trend(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute trajectories from the ledger.

    Trajectories are emitted as lists in chronological order. For
    delta-style fields (e.g. `code.total_files_walked.delta`), the
    trajectory is the sequence of per-session deltas; the cumulative
    sum is also surfaced because operators want to know "where am I
    now relative to where I started?".
    """
    session_count = len(records)
    timestamps: list[str | None] = []
    files_delta: list[int | None] = []
    tests_delta: list[int | None] = []
    lint_after: list[int | None] = []
    build_after: list[int | None] = []
    outdated_after: list[Any] = []
    loc_total_delta: list[int] = []

    for record in records:
        timestamps.append(_safe_get(record, "after_ts"))
        d = _safe_get(record, "code", "total_files_walked", "delta")
        files_delta.append(d if isinstance(d, int) else None)
        d = _safe_get(record, "code", "test_file_count", "delta")
        tests_delta.append(d if isinstance(d, int) else None)
        lint_after.append(_safe_get(record, "lint", "after_exit_code"))
        build_after.append(_safe_get(record, "build", "after_exit_code"))
        outdated_after.append(_safe_get(record, "dependencies", "after_outdated_count"))

        # Sum LOC delta across all languages for the session — gives
        # the operator a single "code grew/shrank by N" number.
        loc_map = _safe_get(record, "code", "loc_by_language") or {}
        total = 0
        if isinstance(loc_map, dict):
            for entry in loc_map.values():
                if isinstance(entry, dict):
                    d = entry.get("delta")
                    if isinstance(d, int):
                        total += d
        loc_total_delta.append(total)

    return {
        "session_count": session_count,
        "timestamps": timestamps,
        "files_delta_per_session": files_delta,
        "files_delta_cumulative": _cumsum(files_delta),
        "tests_delta_per_session": tests_delta,
        "tests_delta_cumulative": _cumsum(tests_delta),
        "loc_delta_per_session": loc_total_delta,
        "loc_delta_cumulative": _cumsum(loc_total_delta),
        "lint_after_history": lint_after,
        "build_after_history": build_after,
        "outdated_after_history": outdated_after,
        "schema_version": 1,
    }


def _cumsum(values: list[int | None]) -> list[int]:
    out: list[int] = []
    total = 0
    for v in values:
        if isinstance(v, int):
            total += v
        out.append(total)
    return out


def _green_red(exit_history: list[int | None]) -> str:
    """One-character glyph per session: green ✓ on exit 0, red ✗ on
    non-zero, dot · on missing. Reads left-to-right (oldest first)."""
    glyphs: list[str] = []
    for code in exit_history:
        if code == 0:
            glyphs.append("✓")
        elif code is None:
            glyphs.append("·")
        else:
            glyphs.append("✗")
    return "".join(glyphs)


def render_text(trend: dict[str, Any]) -> str:
    """Human-readable trend summary. Stable line order so tests can
    pin output."""
    lines: list[str] = []
    n = trend["session_count"]
    lines.append(f"transform-runs trend — {n} session{'s' if n != 1 else ''} recorded")
    if n == 0:
        lines.append("  (no sessions yet — run `minsky --transform` to record one)")
        return "\n".join(lines) + "\n"
    lines.append(f"  earliest: {trend['timestamps'][0]}")
    lines.append(f"  latest:   {trend['timestamps'][-1]}")
    lines.append("")
    lines.append("Cumulative deltas (oldest → newest):")
    lines.append(f"  files: {trend['files_delta_cumulative'][-1]:+d}")
    lines.append(f"  tests: {trend['tests_delta_cumulative'][-1]:+d}")
    lines.append(f"  loc:   {trend['loc_delta_cumulative'][-1]:+d}")
    lines.append("")
    lines.append("Per-session history (oldest → newest):")
    lines.append(f"  lint  exit codes: {_green_red(trend['lint_after_history'])}")
    lines.append(f"  build exit codes: {_green_red(trend['build_after_history'])}")
    # Outdated history — show the raw values, not glyphs (the values
    # vary: int 0+ when pnpm is the package manager; string fallback;
    # None for empty observations).
    outdated_str = " ".join(str(v) if v is not None else "·" for v in trend["outdated_after_history"])
    lines.append(f"  outdated deps:    {outdated_str}")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    repo = Path(os.environ.get("PWD") or ".")
    ledger_path: Path | None = None
    window: int | None = None
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
            "  run `minsky --transform` (or `bin/minsky-default-session.sh "
            f"{repo}`) first to record a session.",
            file=sys.stderr,
        )
        return 1
    records = load_ledger(ledger_path, window=window)
    trend = compute_trend(records)
    if emit_json:
        print(json.dumps(trend, indent=2))
    else:
        print(render_text(trend), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
