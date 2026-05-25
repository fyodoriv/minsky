#!/usr/bin/env python3
"""tests/test_transform_knowledge.py — paired tests for transform_knowledge.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import transform_knowledge as tk  # noqa: E402


def make_record(
    files_delta: int = 0,
    tests_delta: int = 0,
    loc_delta: dict[str, int] | None = None,
    lint_exit: int | None = 0,
    build_exit: int | None = 0,
    outdated: int | None = 0,
) -> dict:
    return {
        "after_ts": "t",
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


def make_host(parent: Path, name: str, records: list[dict]) -> Path:
    host = parent / name
    ledger_dir = host / ".minsky"
    ledger_dir.mkdir(parents=True)
    (ledger_dir / "transform-runs.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in records)
    )
    return host


# --- discover_hosts ---


def test_discover_hosts_returns_empty_for_missing_dir(tmp_path: Path) -> None:
    assert tk.discover_hosts(tmp_path / "nonexistent") == []


def test_discover_hosts_returns_empty_for_dir_without_hosts(tmp_path: Path) -> None:
    (tmp_path / "not-a-host").mkdir()
    (tmp_path / "regular-file.txt").write_text("noise")
    assert tk.discover_hosts(tmp_path) == []


def test_discover_hosts_finds_hosts_with_ledgers(tmp_path: Path) -> None:
    make_host(tmp_path, "alpha", [make_record()])
    make_host(tmp_path, "bravo", [make_record()])
    hosts = tk.discover_hosts(tmp_path)
    assert len(hosts) == 2
    assert [h.name for h in hosts] == ["alpha", "bravo"]


def test_discover_hosts_alphabetical_order(tmp_path: Path) -> None:
    make_host(tmp_path, "zebra", [make_record()])
    make_host(tmp_path, "apple", [make_record()])
    make_host(tmp_path, "mango", [make_record()])
    hosts = tk.discover_hosts(tmp_path)
    assert [h.name for h in hosts] == ["apple", "mango", "zebra"]


def test_discover_hosts_skips_dirs_without_ledger(tmp_path: Path) -> None:
    make_host(tmp_path, "with-ledger", [make_record()])
    (tmp_path / "without-ledger" / ".minsky").mkdir(parents=True)
    # No ledger file in 'without-ledger/.minsky/'
    hosts = tk.discover_hosts(tmp_path)
    assert [h.name for h in hosts] == ["with-ledger"]


# --- aggregate ---


def test_aggregate_empty_returns_zero_count(tmp_path: Path) -> None:
    k = tk.aggregate(tmp_path)
    assert k["host_count"] == 0
    assert k["per_host"] == []
    assert k["schema_version"] == 1


def test_aggregate_single_host(tmp_path: Path) -> None:
    make_host(tmp_path, "solo", [
        make_record(loc_delta={"ts": 10}, tests_delta=1, lint_exit=0, outdated=2),
        make_record(loc_delta={"ts": 20}, tests_delta=1, lint_exit=0, outdated=3),
    ])
    k = tk.aggregate(tmp_path)
    assert k["host_count"] == 1
    h = k["per_host"][0]
    assert h["host"] == "solo"
    assert h["session_count"] == 2
    assert h["loc_delta_cumulative"] == 30
    assert h["tests_delta_cumulative"] == 2
    assert h["lint_pass_fraction"] == 1.0
    assert h["outdated_growth"] == 1  # 3 - 2


def test_aggregate_multi_host(tmp_path: Path) -> None:
    make_host(tmp_path, "alpha", [
        make_record(loc_delta={"ts": 10}, tests_delta=2, lint_exit=0),
    ])
    make_host(tmp_path, "bravo", [
        make_record(loc_delta={"py": 80}, tests_delta=0, lint_exit=1),
    ])
    k = tk.aggregate(tmp_path)
    assert k["host_count"] == 2
    names = [h["host"] for h in k["per_host"]]
    assert names == ["alpha", "bravo"]


def test_aggregate_top_loc_growth_ranked_descending(tmp_path: Path) -> None:
    make_host(tmp_path, "small", [make_record(loc_delta={"ts": 5})])
    make_host(tmp_path, "large", [make_record(loc_delta={"ts": 500})])
    make_host(tmp_path, "medium", [make_record(loc_delta={"ts": 50})])
    k = tk.aggregate(tmp_path)
    # Top entry is largest growth.
    assert k["top_loc_growth"][0] == ("large", 500)
    assert k["top_loc_growth"][1] == ("medium", 50)
    assert k["top_loc_growth"][2] == ("small", 5)


def test_aggregate_worst_outdated_growth_descending(tmp_path: Path) -> None:
    make_host(tmp_path, "stable", [
        make_record(outdated=2),
        make_record(outdated=2),
    ])
    make_host(tmp_path, "rotting", [
        make_record(outdated=2),
        make_record(outdated=10),
    ])
    k = tk.aggregate(tmp_path)
    # Most growth first.
    assert k["worst_outdated_growth"][0] == ("rotting", 8)


def test_aggregate_lint_pass_fraction_computed(tmp_path: Path) -> None:
    make_host(tmp_path, "clean", [
        make_record(lint_exit=0),
        make_record(lint_exit=0),
    ])
    make_host(tmp_path, "broken", [
        make_record(lint_exit=1),
        make_record(lint_exit=1),
    ])
    make_host(tmp_path, "mixed", [
        make_record(lint_exit=0),
        make_record(lint_exit=1),
    ])
    k = tk.aggregate(tmp_path)
    by_host = {h["host"]: h["lint_pass_fraction"] for h in k["per_host"]}
    assert by_host["clean"] == 1.0
    assert by_host["broken"] == 0.0
    assert by_host["mixed"] == 0.5


def test_aggregate_window_limits_records(tmp_path: Path) -> None:
    # 10 records, window=3 → only last 3 counted.
    make_host(tmp_path, "long-history", [
        make_record(loc_delta={"ts": 1}) for _ in range(10)
    ])
    k = tk.aggregate(tmp_path, window=3)
    h = k["per_host"][0]
    assert h["session_count"] == 3
    assert h["loc_delta_cumulative"] == 3  # 1+1+1, last 3 only


def test_aggregate_outdated_none_when_non_numeric(tmp_path: Path) -> None:
    make_host(tmp_path, "stringy", [
        make_record(outdated="not-a-number"),
        make_record(outdated="also-not"),
    ])
    k = tk.aggregate(tmp_path)
    h = k["per_host"][0]
    # No numeric history → outdated_growth is None
    assert h["outdated_growth"] is None


# --- render_text ---


def test_render_text_empty_message(tmp_path: Path) -> None:
    k = tk.aggregate(tmp_path)
    out = tk.render_text(k)
    assert "0 hosts indexed" in out
    assert "no hosts found" in out


def test_render_text_singular_for_one_host(tmp_path: Path) -> None:
    make_host(tmp_path, "alone", [make_record()])
    out = tk.render_text(tk.aggregate(tmp_path))
    assert "1 host indexed" in out  # singular


def test_render_text_plural_for_multi_host(tmp_path: Path) -> None:
    make_host(tmp_path, "a", [make_record()])
    make_host(tmp_path, "b", [make_record()])
    out = tk.render_text(tk.aggregate(tmp_path))
    assert "2 hosts indexed" in out


def test_render_text_includes_per_host_summary(tmp_path: Path) -> None:
    make_host(tmp_path, "alpha", [
        make_record(loc_delta={"ts": 25}, tests_delta=3, lint_exit=0, outdated=0),
    ])
    out = tk.render_text(tk.aggregate(tmp_path))
    assert "alpha" in out
    assert "loc=+25" in out
    assert "tests=+3" in out
    assert "lint=100%" in out


def test_render_text_shows_top_loc_section_with_multiple_hosts(tmp_path: Path) -> None:
    make_host(tmp_path, "a", [make_record(loc_delta={"ts": 50})])
    make_host(tmp_path, "b", [make_record(loc_delta={"ts": 10})])
    out = tk.render_text(tk.aggregate(tmp_path))
    assert "Top LOC growth" in out


# --- main ---


def test_main_exits_2_when_hosts_dir_missing() -> None:
    rc = tk.main([])
    assert rc == 2


def test_main_exits_2_on_unknown_flag() -> None:
    rc = tk.main(["--unknown"])
    assert rc == 2


def test_main_exits_2_on_bad_window(tmp_path: Path) -> None:
    rc = tk.main(["--hosts-dir", str(tmp_path), "--window", "abc"])
    assert rc == 2


def test_main_help_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    rc = tk.main(["--help"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "transform_knowledge" in captured.out


def test_main_renders_text_by_default(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    make_host(tmp_path, "alpha", [make_record()])
    rc = tk.main(["--hosts-dir", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "alpha" in out


def test_main_emits_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    make_host(tmp_path, "alpha", [make_record(loc_delta={"ts": 10})])
    rc = tk.main(["--hosts-dir", str(tmp_path), "--json"])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["schema_version"] == 1
    assert data["host_count"] == 1
    assert data["per_host"][0]["host"] == "alpha"


def test_main_exits_0_with_empty_hosts_dir(tmp_path: Path) -> None:
    rc = tk.main(["--hosts-dir", str(tmp_path), "--json"])
    assert rc == 0  # 0 hosts is a valid state, not an error.
