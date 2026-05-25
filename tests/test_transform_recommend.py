#!/usr/bin/env python3
"""tests/test_transform_recommend.py — paired tests for transform_recommend.py.

Pinned scope:
- detect_test_coverage_gap: matches when LOC grew but tests flat;
  doesn't match when tests also grew; doesn't match for single session
- detect_lint_regression: matches when lint was 0 and is now non-zero;
  doesn't match when lint stayed 0
- detect_dependency_rot: matches when outdated grew by ≥3; doesn't
  match for non-numeric outdated values
- recommend: aggregates non-None detector results
- render_markdown: stable output shape, empty case, multi-pattern case
- main: exits 1 on missing ledger, exits 0 on text/json modes, exits 2
  on bad flag
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import transform_recommend as tr  # noqa: E402
import transform_trend as tt  # noqa: E402


def make_record(
    ts: str = "t",
    files_delta: int = 0,
    tests_delta: int = 0,
    loc_delta: dict[str, int] | None = None,
    lint_exit: int | None = 0,
    build_exit: int | None = 0,
    outdated: int | str | None = 0,
) -> dict:
    return {
        "after_ts": ts,
        "code": {
            "total_files_walked": {"delta": files_delta},
            "test_file_count": {"delta": tests_delta},
            "loc_by_language": {
                lang: {"delta": d} for lang, d in (loc_delta or {}).items()
            },
        },
        "lint": {"after_exit_code": lint_exit},
        "build": {"after_exit_code": build_exit},
        "dependencies": {"after_outdated_count": outdated},
        "schema_version": 1,
    }


def write_ledger(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records))


def trend_from(records: list[dict]) -> dict:
    return tt.compute_trend(records)


# --- detect_test_coverage_gap ---


def test_test_coverage_gap_matches_loc_grew_tests_flat() -> None:
    records = [
        make_record(ts="t1", loc_delta={"ts": 20}, tests_delta=0),
        make_record(ts="t2", loc_delta={"ts": 30}, tests_delta=0),
        make_record(ts="t3", loc_delta={"ts": 15}, tests_delta=0),
    ]
    result = tr.detect_test_coverage_gap(trend_from(records))
    assert result is not None
    assert result["id"] == "test-coverage-gap"
    assert result["priority"] == "P2"
    assert result["evidence"]["loc_grew"] == 65
    assert result["evidence"]["tests_added"] == 0


def test_test_coverage_gap_no_match_when_tests_grew() -> None:
    records = [
        make_record(ts="t1", loc_delta={"ts": 20}, tests_delta=2),
        make_record(ts="t2", loc_delta={"ts": 30}, tests_delta=1),
    ]
    assert tr.detect_test_coverage_gap(trend_from(records)) is None


def test_test_coverage_gap_no_match_below_loc_threshold() -> None:
    records = [
        make_record(ts="t1", loc_delta={"ts": 3}, tests_delta=0),
        make_record(ts="t2", loc_delta={"ts": 2}, tests_delta=0),
    ]
    # 5 < LOC_GROWTH_THRESHOLD=10
    assert tr.detect_test_coverage_gap(trend_from(records)) is None


def test_test_coverage_gap_no_match_for_single_session() -> None:
    records = [make_record(loc_delta={"ts": 50}, tests_delta=0)]
    assert tr.detect_test_coverage_gap(trend_from(records)) is None


# --- detect_lint_regression ---


def test_lint_regression_matches_0_then_nonzero() -> None:
    records = [
        make_record(ts="t1", lint_exit=0),
        make_record(ts="t2", lint_exit=0),
        make_record(ts="t3", lint_exit=1),
    ]
    result = tr.detect_lint_regression(trend_from(records))
    assert result is not None
    assert result["id"] == "lint-regression"
    assert result["priority"] == "P1"
    assert result["evidence"]["oldest_lint_exit"] == 0
    assert result["evidence"]["newest_lint_exit"] == 1


def test_lint_regression_no_match_when_lint_stays_zero() -> None:
    records = [
        make_record(ts="t1", lint_exit=0),
        make_record(ts="t2", lint_exit=0),
    ]
    assert tr.detect_lint_regression(trend_from(records)) is None


def test_lint_regression_no_match_when_oldest_already_failing() -> None:
    records = [
        make_record(ts="t1", lint_exit=1),
        make_record(ts="t2", lint_exit=1),
    ]
    # Not a regression; never was passing.
    assert tr.detect_lint_regression(trend_from(records)) is None


def test_lint_regression_no_match_for_single_session() -> None:
    records = [make_record(lint_exit=1)]
    assert tr.detect_lint_regression(trend_from(records)) is None


def test_lint_regression_skips_none_values() -> None:
    records = [
        make_record(ts="t1", lint_exit=None),
        make_record(ts="t2", lint_exit=0),
        make_record(ts="t3", lint_exit=1),
    ]
    # First non-None is 0; last non-None is 1 → match
    result = tr.detect_lint_regression(trend_from(records))
    assert result is not None


# --- detect_dependency_rot ---


def test_dependency_rot_matches_growth_above_threshold() -> None:
    records = [
        make_record(ts="t1", outdated=2),
        make_record(ts="t2", outdated=4),
        make_record(ts="t3", outdated=6),
    ]
    result = tr.detect_dependency_rot(trend_from(records))
    assert result is not None
    assert result["id"] == "dependency-rot"
    assert result["priority"] == "P3"
    assert result["evidence"]["growth"] == 4


def test_dependency_rot_no_match_below_threshold() -> None:
    records = [
        make_record(ts="t1", outdated=2),
        make_record(ts="t2", outdated=3),
    ]
    # Growth = 1, threshold = 3
    assert tr.detect_dependency_rot(trend_from(records)) is None


def test_dependency_rot_no_match_when_outdated_shrunk() -> None:
    records = [
        make_record(ts="t1", outdated=10),
        make_record(ts="t2", outdated=5),
    ]
    assert tr.detect_dependency_rot(trend_from(records)) is None


def test_dependency_rot_skips_non_numeric_values() -> None:
    records = [
        make_record(ts="t1", outdated="≥1 (run pnpm outdated)"),
        make_record(ts="t2", outdated="≥1 (run pnpm outdated)"),
    ]
    # Both string values; no numeric history → no match
    assert tr.detect_dependency_rot(trend_from(records)) is None


# --- recommend (aggregator) ---


def test_recommend_returns_all_matching_detectors() -> None:
    records = [
        make_record(ts="t1", loc_delta={"ts": 30}, tests_delta=0, lint_exit=0, outdated=2),
        make_record(ts="t2", loc_delta={"ts": 20}, tests_delta=0, lint_exit=0, outdated=4),
        make_record(ts="t3", loc_delta={"ts": 15}, tests_delta=0, lint_exit=1, outdated=6),
    ]
    recs = tr.recommend(trend_from(records))
    ids = [r["id"] for r in recs]
    assert "test-coverage-gap" in ids
    assert "lint-regression" in ids
    assert "dependency-rot" in ids


def test_recommend_returns_empty_when_no_patterns() -> None:
    # Healthy ledger: tests growing, lint passing, deps stable.
    records = [
        make_record(ts="t1", loc_delta={"ts": 5}, tests_delta=2, lint_exit=0, outdated=2),
        make_record(ts="t2", loc_delta={"ts": 5}, tests_delta=1, lint_exit=0, outdated=2),
    ]
    assert tr.recommend(trend_from(records)) == []


# --- render_markdown ---


def test_render_markdown_empty_no_patterns() -> None:
    out = tr.render_markdown([])
    assert "no patterns detected" in out


def test_render_markdown_single_rec() -> None:
    recs = [
        {
            "id": "test-coverage-gap",
            "priority": "P2",
            "title": "add tests for recently-added code",
            "evidence": {"loc_grew": 50, "tests_added": 0, "sessions": 3},
            "rationale": "test rationale text",
        }
    ]
    out = tr.render_markdown(recs)
    assert "1 pattern(s) detected" in out
    assert "## P2 (suggested)" in out
    assert "test-coverage-gap" in out
    assert "test rationale text" in out
    assert "loc_grew" in out
    # Acceptance line present
    assert "**Acceptance**:" in out


def test_render_markdown_multiple_recs() -> None:
    recs = [
        {"id": "a", "priority": "P1", "title": "fix a", "evidence": {}, "rationale": "ra"},
        {"id": "b", "priority": "P3", "title": "fix b", "evidence": {}, "rationale": "rb"},
    ]
    out = tr.render_markdown(recs)
    assert "2 pattern(s) detected" in out
    assert "## P1 (suggested)" in out
    assert "## P3 (suggested)" in out


# --- main ---


def test_main_exits_1_on_missing_ledger(tmp_path: Path) -> None:
    rc = tr.main(["--repo", str(tmp_path)])
    assert rc == 1


def test_main_exits_2_on_unknown_flag() -> None:
    rc = tr.main(["--unknown"])
    assert rc == 2


def test_main_exits_2_on_bad_window(tmp_path: Path) -> None:
    rc = tr.main(["--repo", str(tmp_path), "--window", "abc"])
    assert rc == 2


def test_main_help_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    rc = tr.main(["--help"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "transform_recommend" in captured.out


def test_main_renders_markdown_with_no_patterns(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [make_record(loc_delta={"ts": 5}, tests_delta=2)])
    rc = tr.main(["--repo", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "no patterns detected" in out


def test_main_renders_markdown_with_patterns(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [
        make_record(ts="t1", loc_delta={"ts": 30}, tests_delta=0, lint_exit=0),
        make_record(ts="t2", loc_delta={"ts": 20}, tests_delta=0, lint_exit=1),
    ])
    rc = tr.main(["--repo", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "test-coverage-gap" in out
    assert "lint-regression" in out


def test_main_emits_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [
        make_record(ts="t1", loc_delta={"ts": 30}, tests_delta=0),
        make_record(ts="t2", loc_delta={"ts": 20}, tests_delta=0),
    ])
    rc = tr.main(["--repo", str(tmp_path), "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert "recommendations" in data
    assert len(data["recommendations"]) >= 1
    assert data["trend_summary"]["session_count"] == 2


def test_append_to_tasks_md_dry_run_does_not_write(tmp_path: Path) -> None:
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n")
    recs = [
        {"id": "test-coverage-gap", "priority": "P2", "title": "add tests", "evidence": {}, "rationale": "r"},
    ]
    result = tr.append_to_tasks_md(recs, tasks_md, confirmed=False)
    assert result["dry_run"] is True
    assert result["would_append"] == ["test-coverage-gap"]
    assert result["already_present"] == []
    # File unchanged.
    assert tasks_md.read_text() == "# Tasks\n"


def test_append_to_tasks_md_with_confirmation_writes(tmp_path: Path) -> None:
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n")
    recs = [
        {"id": "test-coverage-gap", "priority": "P2", "title": "add tests", "evidence": {}, "rationale": "r"},
    ]
    result = tr.append_to_tasks_md(recs, tasks_md, confirmed=True)
    assert result["dry_run"] is False
    assert result.get("appended") is True
    content = tasks_md.read_text()
    assert "# Tasks" in content
    assert "test-coverage-gap" in content
    assert "## P2" in content
    assert "suggested-by-transform-recommend" in content
    # Auto-generated marker present.
    assert "<!-- transform-recommend: appended 1 recommendation(s) at" in content


def test_append_to_tasks_md_idempotent(tmp_path: Path) -> None:
    """Re-running --append with --yes does not duplicate existing IDs."""
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n\n- [ ] `existing-task` — already here\n")
    recs = [
        {"id": "existing-task", "priority": "P2", "title": "x", "evidence": {}, "rationale": "r"},
        {"id": "new-task", "priority": "P2", "title": "y", "evidence": {}, "rationale": "r"},
    ]
    result = tr.append_to_tasks_md(recs, tasks_md, confirmed=True)
    assert result["already_present"] == ["existing-task"]
    assert result["would_append"] == ["new-task"]
    content = tasks_md.read_text()
    # `existing-task` appears once (from the initial seed), not twice.
    assert content.count("`existing-task`") == 1
    assert content.count("`new-task`") == 1


def test_append_to_tasks_md_no_append_when_all_present(tmp_path: Path) -> None:
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n\n- [ ] `recA` — x\n- [ ] `recB` — y\n")
    recs = [
        {"id": "recA", "priority": "P2", "title": "x", "evidence": {}, "rationale": "r"},
        {"id": "recB", "priority": "P3", "title": "y", "evidence": {}, "rationale": "r"},
    ]
    before = tasks_md.read_text()
    result = tr.append_to_tasks_md(recs, tasks_md, confirmed=True)
    assert result["would_append"] == []
    assert result["already_present"] == ["recA", "recB"]
    # File unchanged because nothing new to append.
    assert tasks_md.read_text() == before


def test_append_to_tasks_md_groups_by_priority(tmp_path: Path) -> None:
    """P0 first, then P1, P2, P3 — matches the tasks.md spec."""
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n")
    recs = [
        {"id": "c", "priority": "P3", "title": "p3 task", "evidence": {}, "rationale": "r"},
        {"id": "a", "priority": "P1", "title": "p1 task", "evidence": {}, "rationale": "r"},
        {"id": "b", "priority": "P2", "title": "p2 task", "evidence": {}, "rationale": "r"},
    ]
    tr.append_to_tasks_md(recs, tasks_md, confirmed=True)
    content = tasks_md.read_text()
    # P1 should appear before P2, which appears before P3.
    p1_idx = content.find("## P1")
    p2_idx = content.find("## P2")
    p3_idx = content.find("## P3")
    assert p1_idx < p2_idx < p3_idx


def test_main_append_dry_run_default(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """--append without --yes is dry-run."""
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [
        make_record(ts="t1", loc_delta={"ts": 30}, tests_delta=0, lint_exit=0),
        make_record(ts="t2", loc_delta={"ts": 20}, tests_delta=0, lint_exit=1),
    ])
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n")
    rc = tr.main(["--repo", str(tmp_path), "--append", str(tasks_md)])
    assert rc == 0
    err = capsys.readouterr().err
    assert "dry-run" in err
    assert "To actually append, re-run with --yes" in err
    # File still pristine.
    assert tasks_md.read_text() == "# Tasks\n"


def test_main_append_with_yes_writes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [
        make_record(ts="t1", loc_delta={"ts": 30}, tests_delta=0, lint_exit=0),
        make_record(ts="t2", loc_delta={"ts": 20}, tests_delta=0, lint_exit=1),
    ])
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n")
    rc = tr.main(["--repo", str(tmp_path), "--append", str(tasks_md), "--yes"])
    assert rc == 0
    err = capsys.readouterr().err
    assert "appended" in err
    content = tasks_md.read_text()
    assert "test-coverage-gap" in content
    assert "lint-regression" in content


def test_main_append_json_mode_returns_structured_result(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [
        make_record(ts="t1", loc_delta={"ts": 30}, tests_delta=0, lint_exit=0),
        make_record(ts="t2", loc_delta={"ts": 20}, tests_delta=0, lint_exit=1),
    ])
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text("# Tasks\n")
    rc = tr.main(["--repo", str(tmp_path), "--append", str(tasks_md), "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["dry_run"] is True
    assert "test-coverage-gap" in data["would_append"]
    assert "lint-regression" in data["would_append"]


def test_main_window_limits_records(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    # 5 records, but --window 2 should only see the last 2.
    write_ledger(p, [
        make_record(ts=f"t{i}", loc_delta={"ts": 50}, tests_delta=0)
        for i in range(5)
    ])
    rc = tr.main(["--repo", str(tmp_path), "--window", "2", "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["trend_summary"]["session_count"] == 2
