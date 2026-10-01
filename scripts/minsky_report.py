#!/usr/bin/env python3
"""scripts/minsky_report.py — before/after delta on .minsky/baseline.json.

Vertical slice 2 MVP for `minsky-default-8h-repo-transformation`
(TASKS.md P0) — step (g) of the 8h default session: "at the end,
produce a `minsky report` showing before/after delta on all baseline
metrics".

Pairs with `scripts/baseline_metrics.py` (slice 1, PR #812). The
report captures a NEW snapshot of the current repo state (via
`baseline_metrics.capture`), diffs it against the stored
`.minsky/baseline.json`, and emits:
- a human-readable summary (default) showing field-by-field deltas
- or structured JSON (--json) for programmatic consumers

The diff is computed in `compute_delta` as a pure function so it can
be tested independently of the I/O wrappers.

Rule #1 (don't reinvent) — this is just a structured diff between
two snapshots; no new metric collectors, no new tools. The baseline
script does the measurement; this script does the comparison.

Anchor: Forsgren/Humble/Kim 2018 (DORA — measure four-keys before
+ after); Ries 2011 (build-measure-LEARN — this script is the
"learn" half of the loop).

CLI:
    python3 scripts/minsky_report.py [--repo <path>] [--baseline <path>]
        [--json] [--no-recapture]

    --repo:          repo root (default: $PWD)
    --baseline:      baseline JSON path (default: <repo>/.minsky/baseline.json)
    --json:          emit structured JSON delta on stdout
    --no-recapture:  skip the live capture pass; only emit the stored
                     baseline. Useful to inspect what was captured
                     without paying lint/build/outdated cost again.

Exit codes:
    0   report rendered successfully
    1   baseline file not found
    2   bad CLI args
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sys
from pathlib import Path
from typing import Any

# Import the capture function from the sibling baseline script.
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import baseline_metrics as bm  # noqa: E402


def load_baseline(path: Path) -> dict[str, Any]:
    """Read the baseline snapshot. Raises FileNotFoundError if absent."""
    return json.loads(path.read_text())


def _diff_int(before: Any, after: Any) -> dict[str, Any] | None:
    """Diff two integer-valued fields. Returns None when both are missing."""
    if before is None and after is None:
        return None
    try:
        b = int(before) if before is not None else 0
        a = int(after) if after is not None else 0
    except (TypeError, ValueError):
        return {"before": before, "after": after, "delta": "unmeasurable"}
    return {"before": b, "after": a, "delta": a - b}


def _diff_bool(before: Any, after: Any) -> dict[str, Any] | None:
    if before is None and after is None:
        return None
    return {
        "before": bool(before) if before is not None else None,
        "after": bool(after) if after is not None else None,
        "changed": bool(before) != bool(after),
    }


def _diff_loc(before: dict[str, int] | None, after: dict[str, int] | None) -> dict[str, Any]:
    """Per-language LOC delta. New / removed languages surface explicitly."""
    before = before or {}
    after = after or {}
    languages = sorted(set(before) | set(after))
    return {
        lang: {
            "before": before.get(lang, 0),
            "after": after.get(lang, 0),
            "delta": after.get(lang, 0) - before.get(lang, 0),
        }
        for lang in languages
    }


def compute_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Pure-function diff between two baseline snapshots.

    Output schema mirrors the input schema: every top-level key from
    the snapshot gets a delta entry. Subprocess probes (lint / build /
    dependencies) compare exit codes; missing-before is reported as
    `{"before": null, "after": <value>}`.
    """
    b_code = before.get("code", {})
    a_code = after.get("code", {})
    b_docs = before.get("docs", {})
    a_docs = after.get("docs", {})
    b_lint = before.get("lint", {})
    a_lint = after.get("lint", {})
    b_build = before.get("build", {})
    a_build = after.get("build", {})
    b_deps = before.get("dependencies", {})
    a_deps = after.get("dependencies", {})

    return {
        "before_ts": before.get("ts"),
        "after_ts": after.get("ts"),
        "repo": after.get("repo") or before.get("repo"),
        "code": {
            "total_files_walked": _diff_int(
                b_code.get("total_files_walked"), a_code.get("total_files_walked")
            ),
            "test_file_count": _diff_int(
                b_code.get("test_file_count"), a_code.get("test_file_count")
            ),
            "files_source_before": b_code.get("files_source"),
            "files_source_after": a_code.get("files_source"),
            "files_source_mismatch": (
                b_code.get("files_source") is not None
                and a_code.get("files_source") is not None
                and b_code.get("files_source") != a_code.get("files_source")
            ),
            "loc_by_language": _diff_loc(
                b_code.get("loc_by_language"), a_code.get("loc_by_language")
            ),
            "loc_source_before": b_code.get("loc_source"),
            "loc_source_after": a_code.get("loc_source"),
            "loc_source_mismatch": (
                b_code.get("loc_source") is not None
                and a_code.get("loc_source") is not None
                and b_code.get("loc_source") != a_code.get("loc_source")
            ),
        },
        "docs": {
            "markdown_file_count": _diff_int(
                b_docs.get("markdown_file_count"), a_docs.get("markdown_file_count")
            ),
            "has_readme": _diff_bool(b_docs.get("has_readme"), a_docs.get("has_readme")),
            "has_agents_md": _diff_bool(
                b_docs.get("has_agents_md"), a_docs.get("has_agents_md")
            ),
            "has_claude_md": _diff_bool(
                b_docs.get("has_claude_md"), a_docs.get("has_claude_md")
            ),
            "has_vision_md": _diff_bool(
                b_docs.get("has_vision_md"), a_docs.get("has_vision_md")
            ),
            "has_tasks_md": _diff_bool(
                b_docs.get("has_tasks_md"), a_docs.get("has_tasks_md")
            ),
        },
        "lint": {
            "before_exit_code": b_lint.get("exit_code"),
            "after_exit_code": a_lint.get("exit_code"),
        },
        "build": {
            "before_exit_code": b_build.get("exit_code"),
            "after_exit_code": a_build.get("exit_code"),
        },
        "dependencies": {
            "package_manager": a_deps.get("package_manager") or b_deps.get("package_manager"),
            "before_outdated_count": b_deps.get("outdated_count"),
            "after_outdated_count": a_deps.get("outdated_count"),
        },
        "schema_version": 1,
    }


def _fmt_delta(d: dict[str, Any] | None, prefix: str = "") -> str:
    """Render a single _diff_int / _diff_bool dict as one line."""
    if d is None:
        return f"{prefix}: (no data)"
    if "delta" in d:
        sign = "+" if (isinstance(d["delta"], int) and d["delta"] >= 0) else ""
        return f"{prefix}: {d['before']} → {d['after']} ({sign}{d['delta']})"
    if "changed" in d:
        return f"{prefix}: {d['before']} → {d['after']}{' (CHANGED)' if d['changed'] else ''}"
    return f"{prefix}: {d}"


def render_text(delta: dict[str, Any]) -> str:
    """Human-readable summary. Stable line order so tests can pin output."""
    lines: list[str] = []
    lines.append(f"minsky report — {delta.get('repo', '(unknown repo)')}")
    lines.append(f"  baseline: {delta.get('before_ts')}")
    lines.append(f"  current:  {delta.get('after_ts')}")
    lines.append("")
    lines.append("Code:")
    code = delta.get("code", {})
    lines.append("  " + _fmt_delta(code.get("total_files_walked"), prefix="files walked"))
    lines.append("  " + _fmt_delta(code.get("test_file_count"), prefix="test files"))
    # Surface files_source — git-ls-files vs walk (PR #818). Operators
    # who see "files walked: 850 → 1450 (+600)" want to know whether
    # that's actually real code growth or a sourcing-method change.
    files_source_after = code.get("files_source_after") or "unknown"
    files_source_before = code.get("files_source_before") or files_source_after
    if code.get("files_source_mismatch"):
        lines.append(
            f"  ⚠ files source CHANGED: {files_source_before} → {files_source_after} "
            "(counts are not directly comparable — re-run baseline)"
        )
    else:
        lines.append(f"  files source: {files_source_after}")
    for lang, d in (code.get("loc_by_language") or {}).items():
        sign = "+" if d["delta"] >= 0 else ""
        lines.append(f"  loc.{lang}: {d['before']} → {d['after']} ({sign}{d['delta']})")
    # Same for loc_source — tokei / scc / cloc / walk (PR #817).
    loc_source_after = code.get("loc_source_after") or "unknown"
    loc_source_before = code.get("loc_source_before") or loc_source_after
    if code.get("loc_source_mismatch"):
        lines.append(
            f"  ⚠ loc source CHANGED: {loc_source_before} → {loc_source_after} "
            "(code-only vs all-lines counts diverge — re-run baseline)"
        )
    else:
        lines.append(f"  loc source: {loc_source_after}")
    lines.append("")
    lines.append("Docs:")
    docs = delta.get("docs", {})
    lines.append("  " + _fmt_delta(docs.get("markdown_file_count"), prefix="markdown files"))
    for key in ("has_readme", "has_agents_md", "has_claude_md", "has_vision_md", "has_tasks_md"):
        lines.append("  " + _fmt_delta(docs.get(key), prefix=key))
    lines.append("")
    lint = delta.get("lint", {})
    lines.append(f"Lint: exit {lint.get('before_exit_code')} → {lint.get('after_exit_code')}")
    build = delta.get("build", {})
    lines.append(f"Build: exit {build.get('before_exit_code')} → {build.get('after_exit_code')}")
    deps = delta.get("dependencies", {})
    lines.append(
        f"Dependencies ({deps.get('package_manager', 'none')}): "
        f"outdated {deps.get('before_outdated_count')} → {deps.get('after_outdated_count')}"
    )
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    repo = Path(os.environ.get("PWD") or ".")
    baseline_path: Path | None = None
    emit_json = False
    no_recapture = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--repo" and i + 1 < len(argv):
            repo = Path(argv[i + 1])
            i += 2
        elif a == "--baseline" and i + 1 < len(argv):
            baseline_path = Path(argv[i + 1])
            i += 2
        elif a == "--json":
            emit_json = True
            i += 1
        elif a == "--no-recapture":
            no_recapture = True
            i += 1
        elif a in ("--help", "-h"):
            print(__doc__)
            return 0
        else:
            print(f"unknown flag: {a}", file=sys.stderr)
            return 2
    if baseline_path is None:
        baseline_path = repo / ".minsky" / "baseline.json"
    if not baseline_path.exists():
        print(f"baseline not found: {baseline_path}", file=sys.stderr)
        print(
            "  run `python3 scripts/baseline_metrics.py --repo "
            f"{repo}` first to capture one.",
            file=sys.stderr,
        )
        return 1
    before = load_baseline(baseline_path)
    if no_recapture:
        # Synthesize an empty "after" so the delta surfaces just the
        # before snapshot — useful for inspecting what was captured.
        after = {
            "ts": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "repo": str(repo.resolve()),
            "code": {},
            "docs": {},
            "lint": {},
            "build": {},
            "dependencies": {},
        }
    else:
        after = bm.capture(repo)
    delta = compute_delta(before, after)
    if emit_json:
        print(json.dumps(delta, indent=2))
    else:
        print(render_text(delta), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
