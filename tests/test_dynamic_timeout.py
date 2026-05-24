"""Parity tests for scripts/dynamic_timeout.py against dynamic-timeouts.ts.

Pins the Python port of `computeDynamicSettings` to byte-identical
behavior on the same fixture data. Fixture values lifted from the TS
test suite (`novel/cross-repo-runner/src/dynamic-timeouts.test.ts`).
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow importing scripts/dynamic_timeout.py without installing the package.
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import dynamic_timeout  # noqa: E402  pylint: disable=wrong-import-position


# --- compute_watchdog_seconds — algorithm parity -------------------------


def test_returns_default_when_no_history() -> None:
    assert dynamic_timeout.compute_watchdog_seconds([]) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_returns_default_when_under_5_samples() -> None:
    # 4 successful samples — below the MIN_SAMPLE_SIZE threshold.
    timings = [
        (60_000, "validated"),
        (90_000, "validated"),
        (120_000, "validated"),
        (180_000, "validated"),
    ]
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_excludes_sub_10s_samples() -> None:
    # 5 successes but 4 are sub-10s no-ops; should fall back to default
    # because only 1 sample survives the >10_000ms filter.
    timings = [
        (5_000, "validated"),
        (5_000, "validated"),
        (5_000, "validated"),
        (5_000, "validated"),
        (300_000, "validated"),
    ]
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_excludes_spawn_failed_from_successful_pool() -> None:
    # 6 spawn-failed samples + 0 successes → default
    timings = [(60_000, "spawn-failed")] * 6
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_computes_p95_times_1_5_when_history_is_thick() -> None:
    # 10 successful samples, p95 = 600s → watchdog = 900s
    durations_s = [60, 90, 120, 180, 240, 300, 360, 420, 480, 600]
    timings = [(s * 1000, "validated") for s in durations_s]
    # Sorted: [60, 90, 120, 180, 240, 300, 360, 420, 480, 600] seconds.
    # ceil(0.95 * 10) - 1 = 9 → index 9 = 600s. 600 * 1.5 = 900s.
    assert dynamic_timeout.compute_watchdog_seconds(timings) == 900


def test_clamps_below_minimum_to_2_minutes() -> None:
    # 5 fast (≈11s) samples — p95 ≈ 11s → 16s → clamps to 120s minimum.
    timings = [(11_000, "validated")] * 5
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.MIN_WATCHDOG_S


def test_clamps_above_maximum_to_45_minutes() -> None:
    # 5 slow samples — p95 = 3600s, ×1.5 = 5400s → clamps to 2700s max.
    timings = [(3_600_000, "validated")] * 5
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.MAX_WATCHDOG_S


def test_includes_scope_leak_in_successful_pool() -> None:
    # scope-leak counts as "completed work" for timing purposes.
    durations_s = [120, 180, 240, 300, 360]
    timings: list[tuple[int, str]] = [
        (durations_s[0] * 1000, "validated"),
        (durations_s[1] * 1000, "scope-leak"),
        (durations_s[2] * 1000, "validated"),
        (durations_s[3] * 1000, "scope-leak"),
        (durations_s[4] * 1000, "validated"),
    ]
    # sorted=[120, 180, 240, 300, 360]; ceil(0.95*5)-1 = 4 → 360s × 1.5 = 540s.
    assert dynamic_timeout.compute_watchdog_seconds(timings) == 540


# --- parse_timings_from_jsonl --------------------------------------------


def test_parses_validated_iteration_with_ms_in_notes() -> None:
    line = '{"ts":"2026-05-24T00:00:00Z","verdict":"validated","notes":"openhands exited 0; 142000ms","experiment_id":"x","host_repo":"h","branch":"b","pr_url":null}'
    timings = dynamic_timeout.parse_timings_from_jsonl(line)
    assert timings == [(142_000, "validated")]


def test_parses_spawn_failed_iteration() -> None:
    line = '{"verdict":"spawn-failed","notes":"timeout (1200s); 1203000ms"}'
    timings = dynamic_timeout.parse_timings_from_jsonl(line)
    assert timings == [(1_203_000, "spawn-failed")]


def test_skips_lines_without_duration_in_notes() -> None:
    line = '{"verdict":"validated","notes":"openhands exited 0 (no ms here)"}'
    assert dynamic_timeout.parse_timings_from_jsonl(line) == []


def test_skips_lines_with_unknown_verdict() -> None:
    line = '{"verdict":"planned","notes":"dry-run; 0ms"}'
    assert dynamic_timeout.parse_timings_from_jsonl(line) == []


def test_skips_malformed_lines() -> None:
    content = "not json\n{not-quite-json}\n\n"
    assert dynamic_timeout.parse_timings_from_jsonl(content) == []


def test_parses_multiple_lines_in_order() -> None:
    content = "\n".join([
        '{"verdict":"validated","notes":"100ms"}',
        '{"verdict":"spawn-failed","notes":"200ms"}',
        '{"verdict":"validated","notes":"300ms"}',
    ])
    timings = dynamic_timeout.parse_timings_from_jsonl(content)
    assert timings == [(100, "validated"), (200, "spawn-failed"), (300, "validated")]


# --- watchdog_seconds_for_host — full I/O path ---------------------------


def test_watchdog_for_missing_host_returns_default(tmp_path: Path) -> None:
    # tmp_path has no .minsky/ tree — must return default.
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_watchdog_for_empty_experiment_store_returns_default(tmp_path: Path) -> None:
    (tmp_path / ".minsky" / "experiment-store" / "cross-repo").mkdir(parents=True)
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_watchdog_for_host_with_5_validated_iterations(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    lines = [
        '{"verdict":"validated","notes":"120000ms"}',
        '{"verdict":"validated","notes":"180000ms"}',
        '{"verdict":"validated","notes":"240000ms"}',
        '{"verdict":"validated","notes":"300000ms"}',
        '{"verdict":"validated","notes":"360000ms"}',
    ]
    (store / "task-a.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # p95 of [120, 180, 240, 300, 360] = 360s, × 1.5 = 540s.
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == 540


def test_watchdog_aggregates_across_multiple_jsonl_files(tmp_path: Path) -> None:
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    # 3 iterations in file A + 2 in file B = 5 total.
    (store / "task-a.jsonl").write_text(
        '\n'.join([
            '{"verdict":"validated","notes":"100000ms"}',
            '{"verdict":"validated","notes":"200000ms"}',
            '{"verdict":"validated","notes":"300000ms"}',
        ]) + '\n', encoding="utf-8")
    (store / "task-b.jsonl").write_text(
        '\n'.join([
            '{"verdict":"validated","notes":"400000ms"}',
            '{"verdict":"validated","notes":"500000ms"}',
        ]) + '\n', encoding="utf-8")
    # sorted=[100, 200, 300, 400, 500] seconds; p95 idx = 4 → 500s; ×1.5 = 750s.
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == 750
