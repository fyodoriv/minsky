"""Tests for scripts/cost_tier_picker.py — first-run cost-tier picker.

Pins the pure decision (`decide_tier`), the tier→config mapping
(`tier_to_config`), the non-destructive merge, and the config-path
resolution. The skip/use-default/prompt branches + the MINSKY_COST_TIER
env override + the non-TTY Pivot path are the load-bearing behaviors the
task's Success + Pivot thresholds rest on.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import cost_tier_picker  # noqa: E402  pylint: disable=wrong-import-position


# --- tier_definitions ----------------------------------------------------


def test_exactly_six_tiers_with_unique_ids() -> None:
    tiers = cost_tier_picker.tier_definitions()
    assert len(tiers) == 6
    assert sorted(t["tier"] for t in tiers) == [1, 2, 3, 4, 5, 6]


def test_every_tier_has_the_three_config_keys() -> None:
    for t in cost_tier_picker.tier_definitions():
        assert t["cloud_agent"]
        assert t["cloud_agent_model"]
        assert t["local_agent"]
        assert t["est_usd_per_hr"]


def test_tier_definitions_is_a_copy_not_a_shared_reference() -> None:
    tiers = cost_tier_picker.tier_definitions()
    tiers[0]["name"] = "MUTATED"
    assert cost_tier_picker.tier_definitions()[0]["name"] != "MUTATED"


# --- decide_tier — skip / use-default / prompt ---------------------------


def test_existing_tier_skips_regardless_of_env_or_tty() -> None:
    assert cost_tier_picker.decide_tier(2, None, True) == "skip"
    assert cost_tier_picker.decide_tier("3", "5", True) == "skip"
    assert cost_tier_picker.decide_tier(1, "5", False) == "skip"


def test_env_override_uses_default_path_even_on_a_tty() -> None:
    assert cost_tier_picker.decide_tier(None, "2", True) == "use-default"
    assert cost_tier_picker.decide_tier(None, 4, True) == "use-default"


def test_non_tty_without_env_uses_default_not_prompt() -> None:
    # The Pivot path: launchd/SSH/CI must never trip into an interactive
    # prompt — non-TTY always resolves to use-default (caller applies
    # DEFAULT_TIER).
    assert cost_tier_picker.decide_tier(None, None, False) == "use-default"


def test_interactive_tty_without_env_prompts() -> None:
    assert cost_tier_picker.decide_tier(None, None, True) == "prompt"


def test_invalid_existing_or_env_values_are_ignored() -> None:
    # Garbage existing tier falls through to the next rule.
    assert cost_tier_picker.decide_tier("not-a-number", None, True) == "prompt"
    assert cost_tier_picker.decide_tier(0, None, False) == "use-default"
    # Out-of-range env choice does not short-circuit on a TTY.
    assert cost_tier_picker.decide_tier(None, "99", True) == "prompt"


# --- is_valid_tier -------------------------------------------------------


def test_is_valid_tier_accepts_1_through_6_int_and_str() -> None:
    for v in (1, 2, 3, 4, 5, 6, "1", "6"):
        assert cost_tier_picker.is_valid_tier(v)


def test_is_valid_tier_rejects_out_of_range_and_garbage() -> None:
    for v in (0, 7, -1, None, "", "abc", 2.5):
        assert not cost_tier_picker.is_valid_tier(v)


# --- tier_to_config ------------------------------------------------------


def test_tier_to_config_returns_only_the_three_owned_keys() -> None:
    cfg = cost_tier_picker.tier_to_config(2)
    assert set(cfg.keys()) == {"cloud_agent", "cloud_agent_model", "local_agent"}


def test_tier_to_config_accepts_str_tier() -> None:
    assert cost_tier_picker.tier_to_config("2") == cost_tier_picker.tier_to_config(2)


def test_tier_5_is_fully_local_zero_cost() -> None:
    t5 = next(t for t in cost_tier_picker.tier_definitions() if t["tier"] == 5)
    assert t5["est_usd_per_hr"] == "$0"
    assert t5["local_agent"] == "aider"


def test_tier_to_config_raises_on_unknown_tier() -> None:
    import pytest

    with pytest.raises(ValueError):
        cost_tier_picker.tier_to_config(99)


# --- merge_tier_into_config — non-destructive ----------------------------


def test_merge_sets_cost_tier_and_agent_keys() -> None:
    merged = cost_tier_picker.merge_tier_into_config({}, 2)
    assert merged["cost_tier"] == 2
    assert merged["cloud_agent"] == cost_tier_picker.tier_to_config(2)["cloud_agent"]
    assert merged["cloud_agent_model"] == cost_tier_picker.tier_to_config(2)["cloud_agent_model"]
    assert merged["local_agent"] == cost_tier_picker.tier_to_config(2)["local_agent"]


def test_merge_preserves_unowned_keys() -> None:
    cfg = {"default_host": "/repo", "ollama_base_url": "http://localhost:11434"}
    merged = cost_tier_picker.merge_tier_into_config(cfg, 3)
    assert merged["default_host"] == "/repo"
    assert merged["ollama_base_url"] == "http://localhost:11434"


def test_merge_does_not_mutate_input() -> None:
    cfg = {"default_host": "/repo"}
    cost_tier_picker.merge_tier_into_config(cfg, 1)
    assert "cost_tier" not in cfg


def test_merge_overwrites_agent_keys_to_match_new_tier() -> None:
    cfg = {"cloud_agent": "stale", "cloud_agent_model": "stale", "local_agent": "stale"}
    merged = cost_tier_picker.merge_tier_into_config(cfg, 6)
    assert merged["cloud_agent"] == cost_tier_picker.tier_to_config(6)["cloud_agent"]


# --- resolve_config_path -------------------------------------------------


def test_minsky_config_env_wins(monkeypatch) -> None:
    monkeypatch.setenv("MINSKY_CONFIG", "/tmp/explicit.json")
    monkeypatch.setenv("MINSKY_STATE_DIR", "/tmp/state")
    assert cost_tier_picker.resolve_config_path() == Path("/tmp/explicit.json")


def test_state_dir_used_when_no_minsky_config(monkeypatch) -> None:
    monkeypatch.delenv("MINSKY_CONFIG", raising=False)
    monkeypatch.setenv("MINSKY_STATE_DIR", "/tmp/state")
    assert cost_tier_picker.resolve_config_path() == Path("/tmp/state/config.json")


def test_home_default_when_no_env(monkeypatch) -> None:
    monkeypatch.delenv("MINSKY_CONFIG", raising=False)
    monkeypatch.delenv("MINSKY_STATE_DIR", raising=False)
    assert cost_tier_picker.resolve_config_path() == Path.home() / ".minsky" / "config.json"


# --- read_config / write_config — fresh-machine + round-trip -------------


def test_read_missing_config_returns_empty_dict(tmp_path: Path) -> None:
    assert cost_tier_picker.read_config(tmp_path / "nope.json") == {}


def test_read_empty_or_malformed_returns_empty_dict(tmp_path: Path) -> None:
    empty = tmp_path / "empty.json"
    empty.write_text("", encoding="utf-8")
    assert cost_tier_picker.read_config(empty) == {}
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert cost_tier_picker.read_config(bad) == {}


def test_read_non_object_json_returns_empty_dict(tmp_path: Path) -> None:
    arr = tmp_path / "arr.json"
    arr.write_text("[1,2,3]", encoding="utf-8")
    assert cost_tier_picker.read_config(arr) == {}


def test_write_then_read_round_trips(tmp_path: Path) -> None:
    path = tmp_path / "sub" / "config.json"
    cfg = cost_tier_picker.merge_tier_into_config({"default_host": "/repo"}, 2)
    cost_tier_picker.write_config(path, cfg)
    assert json.loads(path.read_text(encoding="utf-8")) == cfg
    assert path.read_text(encoding="utf-8").endswith("\n")


# --- summarize_config ----------------------------------------------------


def test_summary_names_the_tier_and_price() -> None:
    cfg = cost_tier_picker.merge_tier_into_config({}, 2)
    summary = cost_tier_picker.summarize_config(cfg)
    assert "cost_tier 2" in summary
    assert "/hr" in summary
    assert "cloud_agent=" in summary


def test_summary_for_unset_tier() -> None:
    assert cost_tier_picker.summarize_config({}) == "cost_tier: not set"


# --- render_menu ---------------------------------------------------------


def test_menu_lists_all_six_tiers_and_marks_the_default() -> None:
    menu = cost_tier_picker.render_menu()
    for i in range(1, 7):
        assert f"  {i})" in menu
    assert "[default]" in menu


# --- CLI integration: the task's Success + Measurement -------------------


def test_apply_writes_cost_tier_and_agent_keys(tmp_path: Path, monkeypatch) -> None:
    cfg_path = tmp_path / "mctp.json"
    monkeypatch.setenv("MINSKY_CONFIG", str(cfg_path))
    monkeypatch.delenv("MINSKY_STATE_DIR", raising=False)
    rc = cost_tier_picker.main(["cost_tier_picker.py", "--apply", "2"])
    assert rc == 0
    written = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert written["cost_tier"] == 2
    for k in ("cloud_agent", "cloud_agent_model", "local_agent"):
        assert k in written


def test_apply_then_decide_returns_skip_no_reprompt(tmp_path: Path, monkeypatch) -> None:
    cfg_path = tmp_path / "mctp.json"
    monkeypatch.setenv("MINSKY_CONFIG", str(cfg_path))
    monkeypatch.delenv("MINSKY_STATE_DIR", raising=False)
    monkeypatch.delenv("MINSKY_COST_TIER", raising=False)
    cost_tier_picker.main(["cost_tier_picker.py", "--apply", "3"])
    # Second pass: the decision must be "skip" — never re-prompt.
    cfg = cost_tier_picker.read_config(cost_tier_picker.resolve_config_path())
    assert cost_tier_picker.decide_tier(cfg.get("cost_tier"), None, True) == "skip"


def test_apply_preserves_default_host(tmp_path: Path, monkeypatch) -> None:
    cfg_path = tmp_path / "mctp.json"
    cfg_path.write_text(json.dumps({"default_host": "/some/repo"}), encoding="utf-8")
    monkeypatch.setenv("MINSKY_CONFIG", str(cfg_path))
    monkeypatch.delenv("MINSKY_STATE_DIR", raising=False)
    cost_tier_picker.main(["cost_tier_picker.py", "--apply", "1"])
    written = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert written["default_host"] == "/some/repo"
    assert written["cost_tier"] == 1


def test_apply_invalid_tier_exits_2(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINSKY_CONFIG", str(tmp_path / "mctp.json"))
    assert cost_tier_picker.main(["cost_tier_picker.py", "--apply", "99"]) == 2


def test_unknown_command_exits_2() -> None:
    assert cost_tier_picker.main(["cost_tier_picker.py", "--bogus"]) == 2


def test_no_command_exits_2() -> None:
    assert cost_tier_picker.main(["cost_tier_picker.py"]) == 2
