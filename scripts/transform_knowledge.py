#!/usr/bin/env python3
"""scripts/transform_knowledge.py — the K(nowledge) phase of MAPE-K.

Aggregates `.minsky/transform-runs.jsonl` ledgers across all host repos
under a parent directory. Produces cross-host insights the per-host
Analyse + Plan phases can't see — e.g. "5 of 7 hosts saw outdated-count
jump on 2026-05-24" (suggests a real upstream package release), or
"only 1 of 7 hosts added tests in the last 5 sessions" (suggests
operator-wide test-coverage discipline regression).

Pure stdlib — same fixture as the rest of the M→A→P chain. Read-only
consumer of existing per-host ledgers; no new I/O surfaces beyond
directory enumeration.

CLI:
    python3 scripts/transform_knowledge.py --hosts-dir <parent> [--window N]
        [--json]

    --hosts-dir:  parent of host repos (each `<parent>/<host>/.minsky/`
                  expected). REQUIRED.
    --window:     trailing N sessions per host (default: 10)
    --json:       emit structured JSON

Exit codes:
    0   ran successfully (even with 0 hosts found)
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


DEFAULT_WINDOW = 10


def discover_hosts(hosts_dir: Path) -> list[Path]:
    """List subdirs of `hosts_dir` whose `.minsky/transform-runs.jsonl` exists.

    Sorted alphabetically so output is deterministic and tests can
    pin specific orderings without depending on filesystem order.
    """
    if not hosts_dir.exists() or not hosts_dir.is_dir():
        return []
    hosts: list[Path] = []
    for child in sorted(hosts_dir.iterdir()):
        if not child.is_dir():
            continue
        ledger = child / ".minsky" / "transform-runs.jsonl"
        if ledger.exists():
            hosts.append(child)
    return hosts


def aggregate(hosts_dir: Path, window: int = DEFAULT_WINDOW) -> dict[str, Any]:
    """Build the cross-host knowledge map.

    Per-host: load trend, compute cumulative deltas + lint/build glyphs.
    Cross-host: rank hosts by LOC growth, test growth, outdated growth;
    detect "common-cause" patterns where N hosts saw the same regression
    in the same session.
    """
    hosts = discover_hosts(hosts_dir)
    per_host: list[dict[str, Any]] = []
    loc_gains: list[tuple[str, int]] = []
    test_gains: list[tuple[str, int]] = []
    outdated_growth: list[tuple[str, int]] = []
    lint_pass_fractions: list[tuple[str, float]] = []

    for host in hosts:
        ledger = host / ".minsky" / "transform-runs.jsonl"
        records = tt.load_ledger(ledger, window=window)
        trend = tt.compute_trend(records)
        n = trend["session_count"]
        loc_cum = trend["loc_delta_cumulative"][-1] if n > 0 else 0
        tests_cum = trend["tests_delta_cumulative"][-1] if n > 0 else 0

        # lint_pass_fraction: (count of exit 0) / (count of non-None exits)
        lint_hist = [v for v in trend["lint_after_history"] if v is not None]
        if lint_hist:
            lint_pass = sum(1 for v in lint_hist if v == 0) / len(lint_hist)
        else:
            lint_pass = None

        # outdated growth: last - first (numeric only)
        outdated_hist = [v for v in trend["outdated_after_history"] if isinstance(v, int)]
        if len(outdated_hist) >= 2:
            outdated_g = outdated_hist[-1] - outdated_hist[0]
        else:
            outdated_g = None

        per_host.append({
            "host": host.name,
            "session_count": n,
            "loc_delta_cumulative": loc_cum,
            "tests_delta_cumulative": tests_cum,
            "lint_pass_fraction": lint_pass,
            "outdated_growth": outdated_g,
        })
        loc_gains.append((host.name, loc_cum))
        test_gains.append((host.name, tests_cum))
        if outdated_g is not None:
            outdated_growth.append((host.name, outdated_g))
        if lint_pass is not None:
            lint_pass_fractions.append((host.name, lint_pass))

    # Cross-host rankings (sorted by metric, descending).
    loc_gains.sort(key=lambda pair: pair[1], reverse=True)
    test_gains.sort(key=lambda pair: pair[1], reverse=True)
    outdated_growth.sort(key=lambda pair: pair[1], reverse=True)
    lint_pass_fractions.sort(key=lambda pair: pair[1], reverse=True)

    return {
        "host_count": len(hosts),
        "window": window,
        "per_host": per_host,
        "top_loc_growth": loc_gains[:5],
        "top_test_growth": test_gains[:5],
        "worst_outdated_growth": outdated_growth[:5],
        "worst_lint_pass_fraction": lint_pass_fractions[-5:],
        "schema_version": 1,
    }


def render_text(knowledge: dict[str, Any]) -> str:
    """Human-readable summary of the cross-host aggregate."""
    lines: list[str] = []
    n = knowledge["host_count"]
    lines.append(f"transform-knowledge — {n} host{'s' if n != 1 else ''} indexed (window {knowledge['window']})")
    if n == 0:
        lines.append("  (no hosts found — point --hosts-dir at a parent dir of bootstrapped repos)")
        return "\n".join(lines) + "\n"
    lines.append("")
    lines.append("Per-host summary (alphabetical):")
    for host in knowledge["per_host"]:
        loc = host["loc_delta_cumulative"]
        tests = host["tests_delta_cumulative"]
        lint = host["lint_pass_fraction"]
        lint_str = f"{lint:.0%}" if lint is not None else "n/a"
        outdated = host["outdated_growth"]
        outdated_str = f"+{outdated}" if isinstance(outdated, int) and outdated >= 0 else (
            str(outdated) if outdated is not None else "n/a"
        )
        lines.append(
            f"  {host['host']:30s}  n={host['session_count']:<3}  "
            f"loc={loc:+d}  tests={tests:+d}  lint={lint_str}  outdated={outdated_str}"
        )
    lines.append("")
    if knowledge["top_loc_growth"]:
        lines.append("Top LOC growth (largest +):")
        for name, val in knowledge["top_loc_growth"]:
            lines.append(f"  {name}: {val:+d}")
        lines.append("")
    if knowledge["worst_outdated_growth"]:
        lines.append("Worst outdated-deps growth (largest +):")
        for name, val in knowledge["worst_outdated_growth"]:
            lines.append(f"  {name}: +{val}")
        lines.append("")
    if knowledge["worst_lint_pass_fraction"]:
        lines.append("Lowest lint pass rates:")
        for name, frac in knowledge["worst_lint_pass_fraction"]:
            lines.append(f"  {name}: {frac:.0%}")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    hosts_dir: Path | None = None
    window = DEFAULT_WINDOW
    emit_json = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--hosts-dir" and i + 1 < len(argv):
            hosts_dir = Path(argv[i + 1])
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
    if hosts_dir is None:
        print("--hosts-dir <parent> is required", file=sys.stderr)
        return 2
    knowledge = aggregate(hosts_dir, window=window)
    if emit_json:
        print(json.dumps(knowledge, indent=2))
    else:
        print(render_text(knowledge), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
