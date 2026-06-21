#!/usr/bin/env python3
"""classify-spawn-failures.py — group .minsky/failures/ entries by error class.

Reads stderr.txt files under .minsky/failures/ (or --failures-dir), groups by
pattern, and emits a frequency table. Use --json for machine-readable output.

Usage:
  python3 scripts/classify-spawn-failures.py [--window=48h] [--json]
  python3 scripts/classify-spawn-failures.py --failures-dir <path> [--window=48h] [--json]

Measurement (task spawn-failure-silent-stderr-capture):
  python3 scripts/classify-spawn-failures.py --window=48h --json | jq '.top_class != null'
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

# Ordered list of (class_name, regex) pairs. First match wins.
PATTERNS: list[tuple[str, str]] = [
    ("ModuleNotFoundError", r"ModuleNotFoundError"),
    ("command not found", r"command not found"),
    ("Killed", r"\bKilled\b"),
    ("signal 15", r"signal 15|SIGTERM"),
    ("ENOENT", r"\bENOENT\b"),
    ("Not logged in", r"Not logged in"),
]


def classify_text(text: str) -> str:
    """Return the first matching class name, or 'unknown'."""
    for cls, pattern in PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return cls
    return "unknown"


def _parse_window(window_str: str) -> float:
    """Parse '48h' into seconds. Raises ValueError on bad format."""
    m = re.fullmatch(r"(\d+)h", window_str.strip())
    if not m:
        raise ValueError(f"Invalid window format: {window_str!r}; expected NNh")
    return int(m.group(1)) * 3600.0


def classify_failures(failures_dir: Path, window_seconds: float) -> dict:
    """Read stderr.txt files in failures_dir newer than window_seconds ago.

    Returns a dict with keys: window_hours, total_failures, top_class, classes.
    """
    cutoff = time.time() - window_seconds
    classes: dict[str, int] = {}
    total = 0

    if failures_dir.is_dir():
        for entry in failures_dir.iterdir():
            if not entry.is_dir():
                continue
            stderr_file = entry / "stderr.txt"
            if not stderr_file.exists():
                continue
            try:
                if stderr_file.stat().st_mtime < cutoff:
                    continue
                text = stderr_file.read_text(encoding="utf-8", errors="replace")
                cls = classify_text(text)
                classes[cls] = classes.get(cls, 0) + 1
                total += 1
            except OSError:
                continue

    top_class: Optional[str] = None
    if classes:
        top_class = max(classes, key=lambda k: classes[k])

    return {
        "window_hours": int(window_seconds / 3600),
        "total_failures": total,
        "top_class": top_class,
        "classes": dict(sorted(classes.items(), key=lambda x: -x[1])),
    }


def classify_file(file_path: Path) -> dict:
    """Classify a single file and return {class, confidence}.

    Used for inline dispatch in bin/minsky-run.sh immediately after a failed
    spawn: pass the combined stdout+stderr log to get a class + confidence so
    the caller can emit a heal-events row and execute the class-specific remedy
    within the same iteration — no offline batch run required.
    """
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"class": "unknown", "confidence": "low", "error": str(exc)}
    cls = classify_text(text)
    return {
        "class": cls,
        "confidence": "high" if cls != "unknown" else "low",
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="classify-spawn-failures.py",
        description="Classify spawn failure stderr.txt files by error pattern.",
    )
    parser.add_argument("--window", default="48h", help="Time window, e.g. 48h (default: 48h)")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    parser.add_argument(
        "--failures-dir",
        default=None,
        help="Path to failures dir (default: $MINSKY_HOST_ROOT/failures or .minsky/failures)",
    )
    parser.add_argument(
        "--file",
        default=None,
        help="Classify a single file (e.g. a combined stdout+stderr log); emits {class, confidence} JSON",
    )
    args = parser.parse_args(argv)

    # Single-file mode: classify one log file and emit {class, confidence}.
    # Used by bin/minsky-run.sh inline after a non-zero spawn exit so the
    # heal-dispatch block can act on the failure class without a batch run.
    if args.file:
        result = classify_file(Path(args.file))
        if args.json:
            print(json.dumps(result))
        else:
            print(f"Class: {result['class']} (confidence: {result['confidence']})")
        return 1 if "error" in result else 0

    try:
        window_seconds = _parse_window(args.window)
    except ValueError as exc:
        print(f"classify-spawn-failures: {exc}", file=sys.stderr)
        return 1

    if args.failures_dir:
        failures_dir = Path(args.failures_dir)
    else:
        host_root = os.environ.get("MINSKY_HOST_ROOT")
        failures_dir = Path(host_root) / "failures" if host_root else Path(".minsky") / "failures"

    result = classify_failures(failures_dir, window_seconds)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Window: {result['window_hours']}h | Total failures: {result['total_failures']}")
        print(f"Top class: {result['top_class'] or 'none'}")
        for cls, count in result["classes"].items():
            pct = int(100 * count / result["total_failures"]) if result["total_failures"] else 0
            print(f"  {cls}: {count} ({pct}%)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
