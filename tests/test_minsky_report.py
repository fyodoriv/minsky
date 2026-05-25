#!/usr/bin/env python3
"""tests/test_minsky_report.py — paired tests for scripts/minsky_report.py.

Pinned scope:
- _diff_int / _diff_bool: edge cases for missing-before, missing-after,
  matching values, non-numeric values, bool transitions
- _diff_loc: per-language map diff with new / removed languages
- compute_delta: full snapshot diff returns the documented schema
- render_text: stable line order, presence of every field
- main: exits 1 on missing baseline, exits 2 on unknown flag,
  --json mode emits JSON, --no-recapture skips the live capture
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import minsky_report as mr  # noqa: E402


def test_diff_int_basic() -> None:
    d = mr._diff_int(5, 8)
    assert d == {"before": 5, "after": 8, "delta": 3}


def test_diff_int_decrease() -> None:
    d = mr._diff_int(10, 7)
    assert d == {"before": 10, "after": 7, "delta": -3}


def test_diff_int_both_missing_returns_none() -> None:
    assert mr._diff_int(None, None) is None


def test_diff_int_missing_before_treated_as_zero() -> None:
    d = mr._diff_int(None, 5)
    assert d == {"before": 0, "after": 5, "delta": 5}


def test_diff_int_missing_after_treated_as_zero() -> None:
    d = mr._diff_int(5, None)
    assert d == {"before": 5, "after": 0, "delta": -5}


def test_diff_int_non_numeric_surfaces_as_unmeasurable() -> None:
    d = mr._diff_int("alpha", "beta")
    assert d == {"before": "alpha", "after": "beta", "delta": "unmeasurable"}


def test_diff_bool_changed() -> None:
    d = mr._diff_bool(False, True)
    assert d == {"before": False, "after": True, "changed": True}


def test_diff_bool_unchanged() -> None:
    d = mr._diff_bool(True, True)
    assert d == {"before": True, "after": True, "changed": False}


def test_diff_bool_both_none() -> None:
    assert mr._diff_bool(None, None) is None


def test_diff_loc_basic() -> None:
    d = mr._diff_loc({"typescript": 100, "python": 50}, {"typescript": 120, "python": 50})
    assert d["typescript"] == {"before": 100, "after": 120, "delta": 20}
    assert d["python"] == {"before": 50, "after": 50, "delta": 0}


def test_diff_loc_new_language() -> None:
    d = mr._diff_loc({"typescript": 100}, {"typescript": 100, "rust": 25})
    assert d["rust"] == {"before": 0, "after": 25, "delta": 25}


def test_diff_loc_removed_language() -> None:
    d = mr._diff_loc({"typescript": 100, "go": 30}, {"typescript": 100})
    assert d["go"] == {"before": 30, "after": 0, "delta": -30}


def test_diff_loc_empty_inputs() -> None:
    assert mr._diff_loc(None, None) == {}
    assert mr._diff_loc({}, {}) == {}


def test_compute_delta_returns_full_schema() -> None:
    before = {
        "ts": "2026-05-25T00:00:00+00:00",
        "repo": "/r",
        "code": {"total_files_walked": 10, "test_file_count": 2, "loc_by_language": {"ts": 100}},
        "docs": {"markdown_file_count": 3, "has_readme": True},
        "lint": {"exit_code": 0},
        "build": {"exit_code": 0},
        "dependencies": {"package_manager": "pnpm", "outdated_count": 0},
    }
    after = {
        "ts": "2026-05-25T08:00:00+00:00",
        "repo": "/r",
        "code": {"total_files_walked": 15, "test_file_count": 5, "loc_by_language": {"ts": 150}},
        "docs": {"markdown_file_count": 4, "has_readme": True},
        "lint": {"exit_code": 0},
        "build": {"exit_code": 0},
        "dependencies": {"package_manager": "pnpm", "outdated_count": 2},
    }
    d = mr.compute_delta(before, after)
    assert d["code"]["total_files_walked"]["delta"] == 5
    assert d["code"]["test_file_count"]["delta"] == 3
    assert d["code"]["loc_by_language"]["ts"]["delta"] == 50
    assert d["docs"]["markdown_file_count"]["delta"] == 1
    assert d["docs"]["has_readme"]["changed"] is False
    assert d["lint"]["after_exit_code"] == 0
    assert d["dependencies"]["after_outdated_count"] == 2
    assert d["schema_version"] == 1


def test_compute_delta_handles_missing_fields() -> None:
    """Real fixtures often have partial data — the diff must not crash."""
    before = {"ts": "t1", "repo": "/r", "code": {}, "docs": {}, "lint": {}, "build": {}, "dependencies": {}}
    after = before
    d = mr.compute_delta(before, after)
    assert d["code"]["total_files_walked"] is None
    assert d["code"]["test_file_count"] is None
    assert d["docs"]["has_readme"] is None


def test_render_text_stable_order() -> None:
    delta = mr.compute_delta(
        {
            "ts": "before-ts",
            "repo": "/r",
            "code": {"total_files_walked": 1, "test_file_count": 0, "loc_by_language": {"ts": 5}},
            "docs": {"markdown_file_count": 1, "has_readme": True},
            "lint": {"exit_code": 0},
            "build": {"exit_code": 0},
            "dependencies": {"package_manager": "pnpm", "outdated_count": 0},
        },
        {
            "ts": "after-ts",
            "repo": "/r",
            "code": {"total_files_walked": 3, "test_file_count": 1, "loc_by_language": {"ts": 9}},
            "docs": {"markdown_file_count": 2, "has_readme": True},
            "lint": {"exit_code": 0},
            "build": {"exit_code": 0},
            "dependencies": {"package_manager": "pnpm", "outdated_count": 0},
        },
    )
    out = mr.render_text(delta)
    # Headers in expected order
    assert "minsky report — /r" in out
    assert "baseline: before-ts" in out
    assert "current:  after-ts" in out
    assert "Code:" in out
    assert "files walked: 1 → 3 (+2)" in out
    assert "test files: 0 → 1 (+1)" in out
    assert "loc.ts: 5 → 9 (+4)" in out
    assert "Docs:" in out
    assert "Lint: exit 0 → 0" in out
    assert "Build: exit 0 → 0" in out
    assert "Dependencies (pnpm): outdated 0 → 0" in out


def test_render_text_negative_delta_shows_sign() -> None:
    delta = mr.compute_delta(
        {
            "ts": "t1",
            "repo": "/r",
            "code": {"total_files_walked": 10, "test_file_count": 5, "loc_by_language": {}},
            "docs": {},
            "lint": {},
            "build": {},
            "dependencies": {},
        },
        {
            "ts": "t2",
            "repo": "/r",
            "code": {"total_files_walked": 4, "test_file_count": 2, "loc_by_language": {}},
            "docs": {},
            "lint": {},
            "build": {},
            "dependencies": {},
        },
    )
    out = mr.render_text(delta)
    assert "files walked: 10 → 4 (-6)" in out
    assert "test files: 5 → 2 (-3)" in out


def test_main_exits_1_on_missing_baseline(tmp_path: Path) -> None:
    rc = mr.main(["--repo", str(tmp_path)])
    assert rc == 1


def test_main_exits_2_on_unknown_flag() -> None:
    rc = mr.main(["--unknown-flag"])
    assert rc == 2


def test_main_help_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    rc = mr.main(["--help"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "minsky_report" in captured.out


def test_main_emits_text_by_default(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # Stage a fixture baseline + capture the same repo as "current".
    baseline = tmp_path / ".minsky" / "baseline.json"
    baseline.parent.mkdir()
    fixture = {
        "ts": "t1",
        "repo": str(tmp_path),
        "code": {"total_files_walked": 0, "test_file_count": 0, "loc_by_language": {}},
        "docs": {"markdown_file_count": 0, "has_readme": False},
        "lint": {"exit_code": None, "skipped": "test"},
        "build": {"exit_code": None, "skipped": "test"},
        "dependencies": {"package_manager": "none", "outdated_count": None},
    }
    baseline.write_text(json.dumps(fixture))
    rc = mr.main(["--repo", str(tmp_path), "--no-recapture"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "minsky report" in out
    assert "files walked:" in out


def test_main_emits_json_with_flag(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    baseline = tmp_path / ".minsky" / "baseline.json"
    baseline.parent.mkdir()
    baseline.write_text(json.dumps({"ts": "t1", "repo": str(tmp_path), "code": {}, "docs": {}, "lint": {}, "build": {}, "dependencies": {}}))
    rc = mr.main(["--repo", str(tmp_path), "--no-recapture", "--json"])
    assert rc == 0
    out = capsys.readouterr().out
    data = json.loads(out)
    assert data["schema_version"] == 1
    assert data["repo"] == str(tmp_path)


def test_main_accepts_custom_baseline_path(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    custom = tmp_path / "elsewhere.json"
    custom.write_text(json.dumps({"ts": "t1", "repo": str(tmp_path), "code": {}, "docs": {}, "lint": {}, "build": {}, "dependencies": {}}))
    rc = mr.main(["--repo", str(tmp_path), "--baseline", str(custom), "--no-recapture", "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["before_ts"] == "t1"
