"""Parity tests for scripts/iteration_ship_rate.py against iteration-ship-rate.ts.

Pins the Python port to TS-parity on the same fixtures. Also exercises
the JSON I/O path that replaces `scripts/check-cross-repo-pr-rate.mjs`
for bash callers.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import iteration_ship_rate as isr  # noqa: E402  pylint: disable=wrong-import-position

SCRIPT = str(Path(__file__).parent.parent / "scripts" / "iteration_ship_rate.py")

# Reference clock — 2026-05-24T17:00:00Z. Lets the windowed cutoff math
# stay deterministic across fixtures. Computed via:
#   datetime(2026,5,24,17,0,0,tzinfo=timezone.utc).timestamp()*1000
NOW_MS = 1779642000000


# --- Threshold constants -----------------------------------------------


def test_thresholds_match_typescript_originals() -> None:
    """Pre-registered values pinned here so a drift in either side is loud."""
    assert isr.SHIP_RATE_TARGET == 0.15
    assert isr.SHIP_RATE_FLOOR == 0.10
    assert isr.MIN_SAMPLE_SIZE == 5
    assert isr.DEFAULT_WINDOW_DAYS == 30


# --- bucket_verdict — pure 4-way bucket -------------------------------


def test_bucket_verdict_insufficient_data_when_n_below_5() -> None:
    assert isr.bucket_verdict(1.0, 4) == "INSUFFICIENT-DATA"
    assert isr.bucket_verdict(0.0, 0) == "INSUFFICIENT-DATA"


def test_bucket_verdict_above_when_rate_geq_target() -> None:
    assert isr.bucket_verdict(0.15, 10) == "ABOVE"
    assert isr.bucket_verdict(0.5, 10) == "ABOVE"
    assert isr.bucket_verdict(1.0, 10) == "ABOVE"


def test_bucket_verdict_warn_in_band() -> None:
    assert isr.bucket_verdict(0.10, 10) == "WARN"
    assert isr.bucket_verdict(0.149, 10) == "WARN"


def test_bucket_verdict_below_when_rate_lt_floor() -> None:
    assert isr.bucket_verdict(0.099, 10) == "BELOW"
    assert isr.bucket_verdict(0.0, 10) == "BELOW"


# --- compute_ship_rate — windowed pure function -----------------------


def _record(ts: str, pr_url: str | None) -> dict:
    return {"ts": ts, "pr_url": pr_url}


def test_compute_ship_rate_empty_records_returns_zero_with_insufficient_verdict() -> None:
    result = isr.compute_ship_rate([], now_ms=NOW_MS)
    assert result.rate == 0
    assert result.n == 0
    assert result.withPr == 0
    assert result.verdict == "INSUFFICIENT-DATA"


def test_compute_ship_rate_filters_records_outside_window() -> None:
    # 5 records: 4 inside the 30d window, 1 just outside (31d old).
    records = [
        _record("2026-05-20T00:00:00Z", "url"),
        _record("2026-05-15T00:00:00Z", None),
        _record("2026-05-10T00:00:00Z", "url"),
        _record("2026-05-05T00:00:00Z", None),
        _record("2026-04-20T00:00:00Z", "url"),  # 34d old → outside
    ]
    result = isr.compute_ship_rate(records, now_ms=NOW_MS)
    assert result.n == 4
    assert result.withPr == 2
    assert result.rate == 0.5


def test_compute_ship_rate_treats_empty_string_pr_url_as_no_pr() -> None:
    """Mirrors TS hasNonEmptyPrUrl — empty string doesn't count."""
    records = [
        _record("2026-05-20T00:00:00Z", ""),
        _record("2026-05-19T00:00:00Z", "url"),
        _record("2026-05-18T00:00:00Z", None),
        _record("2026-05-17T00:00:00Z", "url"),
        _record("2026-05-16T00:00:00Z", "url"),
    ]
    result = isr.compute_ship_rate(records, now_ms=NOW_MS)
    assert result.n == 5
    assert result.withPr == 3
    assert abs(result.rate - 0.6) < 1e-9
    assert result.verdict == "ABOVE"


def test_compute_ship_rate_skips_records_with_malformed_ts() -> None:
    records = [
        _record("not-a-date", "url"),
        _record("2026-05-20T00:00:00Z", "url"),
        _record("2026-05-19T00:00:00Z", "url"),
        _record("2026-05-18T00:00:00Z", "url"),
        _record("2026-05-17T00:00:00Z", "url"),
        _record("2026-05-16T00:00:00Z", "url"),
    ]
    result = isr.compute_ship_rate(records, now_ms=NOW_MS)
    assert result.n == 5  # malformed dropped


def test_compute_ship_rate_full_window_with_below_verdict() -> None:
    # 20 records, 1 with PR → rate 0.05, below floor.
    records = [
        _record(f"2026-05-{20 - i:02d}T00:00:00Z", "url" if i == 0 else None)
        for i in range(20)
    ]
    result = isr.compute_ship_rate(records, now_ms=NOW_MS)
    assert result.n == 20
    assert result.withPr == 1
    assert result.rate == 0.05
    assert result.verdict == "BELOW"


def test_compute_ship_rate_respects_custom_window_days() -> None:
    records = [
        _record("2026-05-20T00:00:00Z", "url"),
        _record("2026-05-19T00:00:00Z", "url"),
        _record("2026-05-15T00:00:00Z", "url"),  # 9d → outside a 7d window
        _record("2026-05-10T00:00:00Z", "url"),
        _record("2026-05-05T00:00:00Z", "url"),
    ]
    result = isr.compute_ship_rate(records, window_days=7, now_ms=NOW_MS)
    assert result.n == 2  # only the first 2


# --- read_cross_repo_records — filesystem reader ----------------------


def test_read_records_returns_empty_when_dir_missing(tmp_path: Path) -> None:
    assert isr.read_cross_repo_records(tmp_path) == []


def test_read_records_parses_multiple_jsonl_files(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    (store / "a.jsonl").write_text(
        json.dumps({"ts": "2026-05-20T00:00:00Z", "pr_url": "u"}) + "\n",
        encoding="utf-8",
    )
    (store / "b.jsonl").write_text(
        json.dumps({"ts": "2026-05-21T00:00:00Z", "pr_url": None}) + "\n",
        encoding="utf-8",
    )
    records = isr.read_cross_repo_records(tmp_path)
    assert len(records) == 2
    assert {r["pr_url"] for r in records} == {"u", None}


def test_read_records_skips_malformed_lines(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    (store / "a.jsonl").write_text(
        "not-json\n"
        + json.dumps({"ts": "2026-05-20T00:00:00Z", "pr_url": "u"}) + "\n"
        + "{}\n"  # missing ts → skipped
        + "\n"
        + json.dumps({"ts": "2026-05-21T00:00:00Z", "pr_url": None}) + "\n",
        encoding="utf-8",
    )
    records = isr.read_cross_repo_records(tmp_path)
    assert len(records) == 2


# --- CLI parity — exit codes + JSON output ----------------------------


def _run_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        capture_output=True, text=True, check=False,
    )


def test_cli_exits_0_when_verdict_is_insufficient_data(tmp_path: Path) -> None:
    result = _run_cli([f"--host-dir={tmp_path}", "--now=1779642000000"])
    assert result.returncode == 0
    parsed = json.loads(result.stdout)
    assert parsed["verdict"] == "INSUFFICIENT-DATA"


def test_cli_exits_1_when_verdict_is_below(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    lines = [
        json.dumps({"ts": f"2026-05-{20 - i:02d}T00:00:00Z",
                    "pr_url": "u" if i == 0 else None})
        for i in range(20)
    ]
    (store / "a.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = _run_cli([f"--host-dir={tmp_path}", "--now=1779642000000"])
    assert result.returncode == 1
    assert json.loads(result.stdout)["verdict"] == "BELOW"


def test_cli_json_mode_always_exits_0_even_on_below(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    lines = [
        json.dumps({"ts": f"2026-05-{20 - i:02d}T00:00:00Z",
                    "pr_url": "u" if i == 0 else None})
        for i in range(20)
    ]
    (store / "a.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = _run_cli(
        [f"--host-dir={tmp_path}", "--now=1779642000000", "--json"],
    )
    assert result.returncode == 0  # JSON-mode swallows the gate failure
    assert json.loads(result.stdout)["verdict"] == "BELOW"


def test_cli_exits_2_on_unknown_flag(tmp_path: Path) -> None:
    result = _run_cli(["--no-such-flag"])
    assert result.returncode == 2
    assert "unknown flag" in result.stderr


def test_cli_exits_2_on_bad_window_format(tmp_path: Path) -> None:
    result = _run_cli(["--window=30days"])
    assert result.returncode == 2
    assert "--window must be in the form Nd" in result.stderr


def test_cli_accepts_iso_timestamp_for_now(tmp_path: Path) -> None:
    result = _run_cli([f"--host-dir={tmp_path}", "--now=2026-05-24T17:00:00Z"])
    assert result.returncode == 0
    assert json.loads(result.stdout)["verdict"] == "INSUFFICIENT-DATA"


def test_cli_respects_custom_window(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    # 5 records, all 9-day old (so outside a 7d window).
    lines = [
        json.dumps({"ts": "2026-05-15T00:00:00Z", "pr_url": "u"})
        for _ in range(5)
    ]
    (store / "a.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = _run_cli([f"--host-dir={tmp_path}", "--now=1779642000000",
                       "--window=7d"])
    parsed = json.loads(result.stdout)
    assert parsed["n"] == 0  # all 5 are outside the 7d window
    assert parsed["verdict"] == "INSUFFICIENT-DATA"
