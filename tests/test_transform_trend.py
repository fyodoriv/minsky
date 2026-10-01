#!/usr/bin/env python3
"""tests/test_transform_trend.py — paired tests for scripts/transform_trend.py.

Pinned scope:
- load_ledger: file-not-exists, empty file, valid records, partial corruption,
  window slicing
- compute_trend: empty, single record, multi-record, cumulative sums,
  loc cross-language aggregation
- render_text: stable line order, empty / non-empty modes, glyph rendering
- main: exits 1 on missing ledger, exits 2 on bad flag, exits 0 on
  --json + --window
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import transform_trend as tt  # noqa: E402


def make_record(
    ts: str = "2026-05-25T00:00:00+00:00",
    files_delta: int | None = 0,
    tests_delta: int | None = 0,
    loc_delta: dict[str, int] | None = None,
    lint_exit: int | None = 0,
    build_exit: int | None = 0,
    outdated: int | str | None = 0,
) -> dict:
    return {
        "after_ts": ts,
        "code": {
            "total_files_walked": {"delta": files_delta} if files_delta is not None else {},
            "test_file_count": {"delta": tests_delta} if tests_delta is not None else {},
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


def test_load_ledger_returns_empty_for_missing_file(tmp_path: Path) -> None:
    assert tt.load_ledger(tmp_path / "nope.jsonl") == []


def test_load_ledger_returns_empty_for_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "ledger.jsonl"
    p.write_text("")
    assert tt.load_ledger(p) == []


def test_load_ledger_reads_valid_records(tmp_path: Path) -> None:
    p = tmp_path / "ledger.jsonl"
    write_ledger(p, [make_record(ts="t1"), make_record(ts="t2")])
    records = tt.load_ledger(p)
    assert len(records) == 2
    assert records[0]["after_ts"] == "t1"
    assert records[1]["after_ts"] == "t2"


def test_load_ledger_skips_malformed_lines(tmp_path: Path) -> None:
    p = tmp_path / "ledger.jsonl"
    p.write_text('{"valid": 1}\nBROKEN LINE\n{"valid": 2}\n')
    records = tt.load_ledger(p)
    assert len(records) == 2


def test_load_ledger_window_takes_last_n(tmp_path: Path) -> None:
    p = tmp_path / "ledger.jsonl"
    write_ledger(p, [make_record(ts=f"t{i}") for i in range(10)])
    records = tt.load_ledger(p, window=3)
    assert len(records) == 3
    assert records[0]["after_ts"] == "t7"
    assert records[-1]["after_ts"] == "t9"


def test_load_ledger_window_zero_or_none_returns_all(tmp_path: Path) -> None:
    p = tmp_path / "ledger.jsonl"
    write_ledger(p, [make_record(ts=f"t{i}") for i in range(5)])
    assert len(tt.load_ledger(p, window=None)) == 5
    assert len(tt.load_ledger(p, window=0)) == 5


def test_compute_trend_empty_records() -> None:
    trend = tt.compute_trend([])
    assert trend["session_count"] == 0
    assert trend["files_delta_cumulative"] == []
    assert trend["schema_version"] == 1


def test_compute_trend_single_record() -> None:
    records = [make_record(files_delta=5, tests_delta=2, loc_delta={"ts": 100})]
    trend = tt.compute_trend(records)
    assert trend["session_count"] == 1
    assert trend["files_delta_per_session"] == [5]
    assert trend["files_delta_cumulative"] == [5]
    assert trend["tests_delta_per_session"] == [2]
    assert trend["loc_delta_per_session"] == [100]
    assert trend["loc_delta_cumulative"] == [100]


def test_compute_trend_cumulative_sums() -> None:
    records = [
        make_record(files_delta=1, tests_delta=1, loc_delta={"ts": 10}),
        make_record(files_delta=2, tests_delta=2, loc_delta={"ts": 20}),
        make_record(files_delta=3, tests_delta=3, loc_delta={"ts": 30}),
    ]
    trend = tt.compute_trend(records)
    assert trend["files_delta_cumulative"] == [1, 3, 6]
    assert trend["tests_delta_cumulative"] == [1, 3, 6]
    assert trend["loc_delta_cumulative"] == [10, 30, 60]


def test_compute_trend_aggregates_loc_across_languages() -> None:
    records = [
        make_record(loc_delta={"typescript": 10, "python": 5, "rust": 3}),
    ]
    trend = tt.compute_trend(records)
    # Single session, all-languages sum.
    assert trend["loc_delta_per_session"] == [18]


def test_compute_trend_handles_missing_fields() -> None:
    """Records with partial/null fields don't crash."""
    records = [
        {"after_ts": "t1", "schema_version": 1},  # No code/lint/build
        {"code": {}},  # Empty code block
    ]
    trend = tt.compute_trend(records)
    assert trend["session_count"] == 2
    assert trend["files_delta_per_session"] == [None, None]
    assert trend["files_delta_cumulative"] == [0, 0]


def test_compute_trend_records_exit_code_history() -> None:
    records = [
        make_record(lint_exit=0, build_exit=0),
        make_record(lint_exit=1, build_exit=0),
        make_record(lint_exit=0, build_exit=2),
    ]
    trend = tt.compute_trend(records)
    assert trend["lint_after_history"] == [0, 1, 0]
    assert trend["build_after_history"] == [0, 0, 2]


def test_green_red_glyphs() -> None:
    assert tt._green_red([0, 0, 0]) == "✓✓✓"
    assert tt._green_red([0, 1, 0]) == "✓✗✓"
    assert tt._green_red([None, 0, None]) == "·✓·"
    assert tt._green_red([]) == ""


def test_render_text_empty_records() -> None:
    out = tt.render_text(tt.compute_trend([]))
    assert "no sessions yet" in out
    assert "0 sessions recorded" in out


def test_render_text_single_session() -> None:
    records = [make_record(files_delta=5, tests_delta=1, loc_delta={"ts": 10})]
    out = tt.render_text(tt.compute_trend(records))
    assert "1 session recorded" in out  # singular
    assert "files: +5" in out
    assert "tests: +1" in out
    assert "loc:   +10" in out
    assert "lint  exit codes: ✓" in out
    assert "build exit codes: ✓" in out


def test_render_text_multi_session_pluralized() -> None:
    records = [make_record() for _ in range(3)]
    out = tt.render_text(tt.compute_trend(records))
    assert "3 sessions recorded" in out


def test_render_text_negative_cumulative() -> None:
    records = [make_record(files_delta=-3, tests_delta=-1)]
    out = tt.render_text(tt.compute_trend(records))
    # Negative deltas display with their sign.
    assert "files: -3" in out
    assert "tests: -1" in out


def test_main_exits_1_on_missing_ledger(tmp_path: Path) -> None:
    rc = tt.main(["--repo", str(tmp_path)])
    assert rc == 1


def test_main_exits_2_on_unknown_flag() -> None:
    rc = tt.main(["--unknown"])
    assert rc == 2


def test_main_exits_2_on_bad_window_value(tmp_path: Path) -> None:
    rc = tt.main(["--repo", str(tmp_path), "--window", "not-a-number"])
    assert rc == 2


def test_main_help_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    rc = tt.main(["--help"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "transform_trend" in captured.out


def test_main_renders_text_by_default(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [make_record(ts="t1"), make_record(ts="t2")])
    rc = tt.main(["--repo", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "2 sessions recorded" in out
    assert "earliest: t1" in out
    assert "latest:   t2" in out


def test_main_emits_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [make_record(files_delta=5)])
    rc = tt.main(["--repo", str(tmp_path), "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["schema_version"] == 1
    assert data["session_count"] == 1
    assert data["files_delta_per_session"] == [5]


def test_main_window_limits_records(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    p = tmp_path / ".minsky" / "transform-runs.jsonl"
    write_ledger(p, [make_record(ts=f"t{i}") for i in range(10)])
    rc = tt.main(["--repo", str(tmp_path), "--window", "3", "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["session_count"] == 3


def test_main_accepts_custom_ledger_path(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    custom = tmp_path / "custom.jsonl"
    write_ledger(custom, [make_record()])
    rc = tt.main(["--repo", str(tmp_path), "--ledger", str(custom), "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["session_count"] == 1
