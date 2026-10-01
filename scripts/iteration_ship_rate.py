#!/usr/bin/env python3
"""scripts/iteration_ship_rate.py — port of iteration-ship-rate.ts + check-cross-repo-pr-rate.mjs.

Computes the cross-repo runner's iteration→PR ship-rate over a rolling
window with a pre-registered verdict bucket. Replaces the TS pure
function in `novel/cross-repo-runner/src/iteration-ship-rate.ts` AND
the Node CLI wrapper at `scripts/check-cross-repo-pr-rate.mjs` —
keeping the same CLI contract so callers don't change.

Pattern: pure function (compute_ship_rate) + I/O-at-edge CLI (main).
Same approach as the TS version.

Pre-registered thresholds (rule #9 — pinned values, deliberate-diff
to change). Anchors:
- Beyer et al., SRE 2016, Ch. 6 — aggregate visibility for golden signals
- Forsgren/Humble/Kim, Accelerate 2018 — DORA ratios over a window
- Munafò et al., Nature Human Behaviour 1, 0021 (2017) — pre-registered
  thresholds pinned in code (a tune-the-threshold edit is a deliberate
  diff, not silent drift).

CLI:
    python3 scripts/iteration_ship_rate.py
        [--window=Nd]          (default 30)
        [--host-dir=PATH]      (default cwd)
        [--json]               (always exit 0 — for collectors)
        [--now=ISO|EPOCH]      (deterministic-fixture testing)

Exit codes (matches the JS shim it replaces):
    0 — verdict is not BELOW; gate passes
    1 — verdict is BELOW (rate < SHIP_RATE_FLOOR); gate fails
    2 — usage error (unknown flag, bad --window format, etc)
"""

from __future__ import annotations

import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

# --- Pre-registered thresholds (rule #9) ----------------------------------

SHIP_RATE_TARGET = 0.15
SHIP_RATE_FLOOR = 0.10
MIN_SAMPLE_SIZE = 5
DEFAULT_WINDOW_DAYS = 30


# --- Pure function + dataclasses ------------------------------------------


@dataclass(frozen=True)
class ShipRateResult:
    """Mirrors TS `ShipRateResult` — same field names so JSON parity holds."""

    rate: float
    n: int
    withPr: int  # noqa: N815 — keep TS field name for JSON parity
    verdict: str  # "ABOVE" | "WARN" | "BELOW" | "INSUFFICIENT-DATA"


def _parse_iso_ms(ts: str) -> int | None:
    """Parse ISO-8601 to ms-since-epoch. Returns None on bad input."""
    if not ts:
        return None
    # Python's fromisoformat (≥3.11) accepts the trailing 'Z' literal.
    try:
        from datetime import datetime, timezone
        if ts.endswith("Z"):
            dt = datetime.fromisoformat(ts[:-1]).replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(ts)
        return int(dt.timestamp() * 1000)
    except (ValueError, TypeError):
        return None


def _is_inside_window(ts: str, cutoff_ms: int) -> bool:
    """True if record timestamp is parseable AND ≥ cutoff_ms."""
    ms = _parse_iso_ms(ts)
    return ms is not None and ms >= cutoff_ms


def _has_non_empty_pr_url(pr_url: object) -> bool:
    """True when pr_url is a non-empty string. Mirrors TS hasNonEmptyPrUrl."""
    return isinstance(pr_url, str) and pr_url != ""


def bucket_verdict(rate: float, n: int) -> str:
    """Bucket (rate, n) into a verdict. Mirrors TS bucketVerdict."""
    if n < MIN_SAMPLE_SIZE:
        return "INSUFFICIENT-DATA"
    if rate >= SHIP_RATE_TARGET:
        return "ABOVE"
    if rate < SHIP_RATE_FLOOR:
        return "BELOW"
    return "WARN"


def compute_ship_rate(
    records: Iterable[dict],
    window_days: int = DEFAULT_WINDOW_DAYS,
    now_ms: int | None = None,
) -> ShipRateResult:
    """Windowed ship-rate from a list of {ts, pr_url, ...} records.

    Parity contract: matches `computeShipRate` in iteration-ship-rate.ts.
    Pure function — no I/O except the optional `time.time()` read when
    now_ms is omitted.
    """
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - window_days * 24 * 60 * 60 * 1000
    in_window = [r for r in records if _is_inside_window(r.get("ts", ""), cutoff_ms)]
    n = len(in_window)
    with_pr = sum(1 for r in in_window if _has_non_empty_pr_url(r.get("pr_url")))
    rate = with_pr / n if n > 0 else 0.0
    return ShipRateResult(
        rate=rate,
        n=n,
        withPr=with_pr,
        verdict=bucket_verdict(rate, n),
    )


# --- I/O — read JSONL records --------------------------------------------


def read_cross_repo_records(host_dir: Path) -> list[dict]:
    """Read every *.jsonl under <host>/.minsky/experiment-store/cross-repo/.

    Skips malformed lines (the daemon appends line-atomically but truncated
    writes are possible under hard kills — let-it-crash via skip + log).
    """
    store = host_dir / ".minsky" / "experiment-store" / "cross-repo"
    if not store.is_dir():
        return []
    out: list[dict] = []
    for jsonl in sorted(store.glob("*.jsonl")):
        try:
            content = jsonl.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in content.splitlines():
            record = _parse_jsonl_line(line)
            if record is not None:
                out.append(record)
    return out


def _parse_jsonl_line(line: str) -> dict | None:
    """Parse one JSONL line into a record, or None on blank/malformed/missing-ts."""
    if not line.strip():
        return None
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(record, dict):
        return None
    if not isinstance(record.get("ts"), str):
        return None
    return record


# --- CLI -----------------------------------------------------------------


@dataclass
class ParsedArgs:
    """Mirrors TS ParsedArgs."""

    window_days: int = DEFAULT_WINDOW_DAYS
    host_dir: Path | None = None
    json_mode: bool = False
    now_ms: int | None = None


def parse_args(argv: list[str]) -> ParsedArgs:
    """Parse CLI argv into a ParsedArgs. Raises ValueError on bad input."""
    result = ParsedArgs()
    for arg in argv:
        if arg == "--json":
            result.json_mode = True
        elif arg in ("--help", "-h"):
            print("Usage: iteration_ship_rate.py "
                  "[--window=Nd] [--host-dir=PATH] [--json] [--now=ISO|EPOCH]",
                  file=sys.stderr)
            sys.exit(0)
        elif "=" in arg:
            key, _, value = arg.partition("=")
            if key == "--window":
                m = re.match(r"^(\d+)d$", value)
                if not m:
                    raise ValueError(
                        f"--window must be in the form Nd (e.g. --window=30d); got '{value}'")
                result.window_days = int(m.group(1))
            elif key == "--host-dir":
                result.host_dir = Path(value)
            elif key == "--now":
                if value.isdigit():
                    result.now_ms = int(value)
                else:
                    ms = _parse_iso_ms(value)
                    if ms is None:
                        raise ValueError(
                            f"--now must be ISO-8601 or epoch ms; got '{value}'")
                    result.now_ms = ms
            else:
                raise ValueError(f"unknown flag: '{arg}'")
        else:
            raise ValueError(f"unknown flag: '{arg}'")
    if result.host_dir is None:
        result.host_dir = Path.cwd()
    return result


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
    except ValueError as exc:
        print(f"iteration_ship_rate: {exc}", file=sys.stderr)
        return 2
    assert args.host_dir is not None
    records = read_cross_repo_records(args.host_dir)
    result = compute_ship_rate(
        records, window_days=args.window_days, now_ms=args.now_ms,
    )
    # Emit JSON identical in shape to the TS version (field names matter
    # — callers parse the JSON to look at `verdict` / `rate` / etc).
    print(json.dumps({
        "rate": result.rate,
        "n": result.n,
        "withPr": result.withPr,
        "verdict": result.verdict,
    }))
    if args.json_mode:
        return 0
    return 1 if result.verdict == "BELOW" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
