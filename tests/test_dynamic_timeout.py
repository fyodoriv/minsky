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


def test_excludes_sub_threshold_samples() -> None:
    # 5 successes but 4 are sub-MIN_SUCCESS_DURATION_MS no-ops (e.g. fast
    # backstop-PR completions); should fall back to default because only
    # 1 sample survives the filter. Pins the contract: the threshold IS
    # the constant, not a hardcoded 10s — worker-claude-concurrent-auth-
    # and-watchdog raised the floor from 10s to 60s.
    sub_threshold = dynamic_timeout.MIN_SUCCESS_DURATION_MS - 1
    timings = [
        (sub_threshold, "validated"),
        (sub_threshold, "validated"),
        (sub_threshold, "validated"),
        (sub_threshold, "validated"),
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


def test_clamps_below_minimum_to_floor() -> None:
    # 5 samples all just above the success-duration filter — p95 is small,
    # ×1.5 is below MIN_WATCHDOG_S, so the watchdog clamps to the floor.
    # The exact floor is the constant (worker-claude-concurrent-auth-and-
    # watchdog: bumped from 120s to 600s after a 175s SIGTERM kill).
    sample_ms = dynamic_timeout.MIN_SUCCESS_DURATION_MS + 1_000
    timings = [(sample_ms, "validated")] * 5
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.MIN_WATCHDOG_S


def test_min_watchdog_floor_fits_a_real_claude_task() -> None:
    # Anchor the post-worker-claude-concurrent-auth-and-watchdog floor:
    # the operator brief observed a 174549ms task SIGTERMed by a 175s
    # watchdog. The floor MUST exceed that observation by a comfortable
    # margin so a thick history of fast-paths can't poison the watchdog
    # back to the prior failure mode.
    assert dynamic_timeout.MIN_WATCHDOG_S >= 600, (
        f"MIN_WATCHDOG_S regressed to {dynamic_timeout.MIN_WATCHDOG_S}s; "
        "a real claude worker needs ≥10 min of runway."
    )


def test_clamps_above_maximum_to_45_minutes() -> None:
    # 5 slow samples — p95 = 3600s, ×1.5 = 5400s → clamps to 2700s max.
    timings = [(3_600_000, "validated")] * 5
    assert dynamic_timeout.compute_watchdog_seconds(timings) == dynamic_timeout.MAX_WATCHDOG_S


def test_includes_scope_leak_in_successful_pool() -> None:
    # scope-leak counts as "completed work" for timing purposes.
    # Durations chosen to land above the post-worker-claude-concurrent-
    # auth-and-watchdog MIN_WATCHDOG_S floor (600s) so we observe the
    # p95×1.5 path, not the clamp.
    durations_s = [600, 660, 720, 780, 840]
    timings: list[tuple[int, str]] = [
        (durations_s[0] * 1000, "validated"),
        (durations_s[1] * 1000, "scope-leak"),
        (durations_s[2] * 1000, "validated"),
        (durations_s[3] * 1000, "scope-leak"),
        (durations_s[4] * 1000, "validated"),
    ]
    # sorted=[600, 660, 720, 780, 840]; ceil(0.95*5)-1 = 4 → 840s × 1.5 = 1260s.
    assert dynamic_timeout.compute_watchdog_seconds(timings) == 1260


# --- model-aware cold-start floor ----------------------------------------
# worker-watchdog-scale-by-pinned-model-latency


def test_no_model_reproduces_flat_default() -> None:
    # Parity: model=None (the original signature) must return the legacy
    # flat default on the thin-history path — byte-identical pre-model.
    assert dynamic_timeout.compute_watchdog_seconds([]) == dynamic_timeout.DEFAULT_WATCHDOG_S
    assert dynamic_timeout.compute_watchdog_seconds([], model=None) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_thin_history_floor_is_model_class_ordered() -> None:
    # The Success criterion: a slow remote (Opus) floor is strictly
    # greater than a local floor, both clamped to [120, 2700].
    opus = dynamic_timeout.compute_watchdog_seconds([], model="claude-opus-4-7")
    local = dynamic_timeout.compute_watchdog_seconds([], model="ollama_chat/qwen3-coder:30b")
    assert opus > local
    assert 120 <= local <= 2700
    assert 120 <= opus <= 2700


def test_fast_remote_floor_between_slow_and_local() -> None:
    opus = dynamic_timeout.compute_watchdog_seconds([], model="claude-opus-4-7")
    sonnet = dynamic_timeout.compute_watchdog_seconds([], model="claude-sonnet-4-5")
    local = dynamic_timeout.compute_watchdog_seconds([], model="ollama_chat/qwen3-coder:30b")
    assert opus > sonnet > local


def test_local_floor_equals_legacy_default() -> None:
    # Local models keep the historical 20-min default (LOCAL = DEFAULT).
    assert (
        dynamic_timeout.compute_watchdog_seconds([], model="ollama_chat/qwen3-coder:30b")
        == dynamic_timeout.DEFAULT_WATCHDOG_S
    )


def test_unknown_remote_model_defaults_to_fast_remote() -> None:
    # An unrecognized remote model is treated as fast-remote, not local.
    floor = dynamic_timeout.compute_watchdog_seconds([], model="gpt-4o")
    assert floor == dynamic_timeout.FAST_REMOTE_COLD_START_S


def test_all_cold_start_floors_are_clamped() -> None:
    for floor in (
        dynamic_timeout.SLOW_REMOTE_COLD_START_S,
        dynamic_timeout.FAST_REMOTE_COLD_START_S,
        dynamic_timeout.LOCAL_COLD_START_S,
    ):
        assert dynamic_timeout.MIN_WATCHDOG_S <= floor <= dynamic_timeout.MAX_WATCHDOG_S


def test_model_does_not_change_thick_history_path() -> None:
    # ≥5 samples: the p95×1.5 result is model-agnostic (byte-identical).
    durations_s = [60, 90, 120, 180, 240, 300, 360, 420, 480, 600]
    timings = [(s * 1000, "validated") for s in durations_s]
    expected = 900
    assert dynamic_timeout.compute_watchdog_seconds(timings) == expected
    assert dynamic_timeout.compute_watchdog_seconds(timings, model="claude-opus-4-7") == expected
    assert (
        dynamic_timeout.compute_watchdog_seconds(timings, model="ollama_chat/qwen3-coder:30b")
        == expected
    )


def test_cold_start_floor_for_model_classification() -> None:
    f = dynamic_timeout.cold_start_floor_for_model
    assert f("claude-opus-4-7") == dynamic_timeout.SLOW_REMOTE_COLD_START_S
    assert f("claude-opus-4-7-max") == dynamic_timeout.SLOW_REMOTE_COLD_START_S
    assert f("claude-sonnet-4-5") == dynamic_timeout.FAST_REMOTE_COLD_START_S
    assert f("claude-haiku-4-5") == dynamic_timeout.FAST_REMOTE_COLD_START_S
    assert f("ollama_chat/qwen3-coder:30b") == dynamic_timeout.LOCAL_COLD_START_S
    assert f("lm_studio/some-model") == dynamic_timeout.LOCAL_COLD_START_S
    assert f(None) == dynamic_timeout.DEFAULT_WATCHDOG_S
    assert f("") == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_host_path_threads_model_into_cold_start_floor(tmp_path: Path) -> None:
    # Thin/missing history host: the model class drives the floor.
    opus = dynamic_timeout.watchdog_seconds_for_host(tmp_path, model="claude-opus-4-7")
    local = dynamic_timeout.watchdog_seconds_for_host(tmp_path, model="ollama_chat/qwen3-coder:30b")
    assert opus == dynamic_timeout.SLOW_REMOTE_COLD_START_S
    assert local == dynamic_timeout.LOCAL_COLD_START_S
    # Default (no model) unchanged from the pre-model host path.
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == dynamic_timeout.DEFAULT_WATCHDOG_S


def test_host_path_thick_history_ignores_model(tmp_path: Path) -> None:
    # ≥5 samples on a host: model must not change the p95×1.5 result.
    # Durations land above MIN_WATCHDOG_S (600s) so the comparison
    # observes the p95×1.5 path, not the floor clamp.
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    lines = [
        '{"verdict":"validated","notes":"600000ms"}',
        '{"verdict":"validated","notes":"660000ms"}',
        '{"verdict":"validated","notes":"720000ms"}',
        '{"verdict":"validated","notes":"780000ms"}',
        '{"verdict":"validated","notes":"840000ms"}',
    ]
    (store / "task-a.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # p95 of [600, 660, 720, 780, 840]s = 840s, × 1.5 = 1260s.
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path, model="claude-opus-4-7") == 1260
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == 1260


# --- CLI arg parsing -----------------------------------------------------


def test_parse_cli_args_host_only() -> None:
    assert dynamic_timeout.parse_cli_args(["prog", "/host"]) == ("/host", None)


def test_parse_cli_args_model_space_form() -> None:
    assert dynamic_timeout.parse_cli_args(["prog", "/host", "--model", "claude-opus-4-7"]) == (
        "/host",
        "claude-opus-4-7",
    )


def test_parse_cli_args_model_equals_form() -> None:
    assert dynamic_timeout.parse_cli_args(["prog", "/host", "--model=claude-opus-4-7"]) == (
        "/host",
        "claude-opus-4-7",
    )


def test_parse_cli_args_model_before_host() -> None:
    assert dynamic_timeout.parse_cli_args(["prog", "--model", "x", "/host"]) == ("/host", "x")


def test_parse_cli_args_missing_host_is_malformed() -> None:
    assert dynamic_timeout.parse_cli_args(["prog"]) == (None, None)
    assert dynamic_timeout.parse_cli_args(["prog", "--model", "x"]) == (None, None)


def test_parse_cli_args_dangling_model_flag_is_malformed() -> None:
    assert dynamic_timeout.parse_cli_args(["prog", "/host", "--model"]) == (None, None)


def test_parse_cli_args_second_positional_is_malformed() -> None:
    assert dynamic_timeout.parse_cli_args(["prog", "/host", "/other"]) == (None, None)


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
    # Durations chosen to exceed the post-worker-claude-concurrent-auth-
    # and-watchdog MIN_WATCHDOG_S floor (600s) so the assertion observes
    # the p95×1.5 path, not the floor clamp.
    store = tmp_path / ".minsky" / "experiment-store" / "cross-repo"
    store.mkdir(parents=True)
    lines = [
        '{"verdict":"validated","notes":"600000ms"}',
        '{"verdict":"validated","notes":"660000ms"}',
        '{"verdict":"validated","notes":"720000ms"}',
        '{"verdict":"validated","notes":"780000ms"}',
        '{"verdict":"validated","notes":"840000ms"}',
    ]
    (store / "task-a.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # p95 of [600, 660, 720, 780, 840] = 840s, × 1.5 = 1260s.
    assert dynamic_timeout.watchdog_seconds_for_host(tmp_path) == 1260


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
